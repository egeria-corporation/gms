// SPDX-License-Identifier: AGPL-3.0-only
// Syndication (docs/syndication.md): where a published call goes besides its own page.
//
//   * Open-call feeds for newsletters and partners, `/gms/public/feeds/opportunities.{json,csv,rss}`:
//     open and forecasted calls whose public page is on, unless the funder took the call out of
//     the feeds (`publish.feeds`, on unless set to false). Each item carries only what the call's
//     public page shows (`PublicCall` is a part of `opportunityPage`'s answer, and a test keeps the
//     two equal) and links to that page with `utm_source=feed`.
//   * The OpenGrants index feed, `/gms/public/feeds/opengrants.json`: the CommonGrants records of
//     calls whose `publish.openGrantsIndex` is on, for OpenGrants to pull. OpenGrants documents no
//     endpoint to publish to (checked 2026-11-17: its OpenAPI document, llms-full.txt and MCP tools
//     only read), so nothing here pushes; docs/syndication.md says what OpenGrants must pull.
//   * Philanthropy News Digest (Candid) takes RFPs by email at pndrfp@candid.org, four weeks
//     before the earliest deadline, free for U.S. organizations (https://philanthropynewsdigest.org/rfps).
//     A person in the funder workspace previews the email, filled from the call's public page, and
//     sends it; replies go to the funder. One submission per call (migration 0045). No agent, API
//     client or MCP tool sends it.
//   * Counts of applications started from feed and PND links (`utm_source`), from the `started`
//     application events (services/apply.ts records the source). No tracker, no page-view log.
import { formatCurrency, formatDateTimeIn, formatList } from "@gms/i18n";
import { toCsv } from "@gms/importers";
import { cleanLine, emailT, escapeHtml, fromWithName, type EmailKey } from "@gms/notify";
import { ProjectionError, projectOpportunity, type OpportunityBase, type OpportunityRow } from "@gms/protocol";
import { parseRules } from "@gms/rules";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { forbidden } from "../auth/verify.ts";
import { ApiError } from "../lib/errors.ts";
import { maskEmail } from "./award-invitations.ts";
import { audit, authorize, required, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { publicFundsOf } from "./funds.ts";
import { funderOf } from "./opportunities.ts";
import { sha256Hex } from "./ports.ts";
import { namesOf, orgFacts, verificationOf } from "./profile.ts";
import { acceptingApplications, card, publishFlag, ruleLabels, type PublicContext } from "./public.ts";
import { RepoError, type Row } from "./repos/types.ts";

type Opp = Row<"opportunities">;
type Ws = Row<"workspaces">;
type Comp = Row<"competitions">;

// ------------------------------------------------------------------------------------ constants

/** The `utm_source` of a feed item's link, and of the link in a PND submission. services/apply.ts counts both. */
export const FEED_UTM_SOURCE = "feed";
export const PND_UTM_SOURCE = "pnd";
/** The most items one feed answer carries, newest first. */
export const FEED_MAX_ITEMS = 500;
/** `closingWithin` takes 1 to this many days. */
export const FEED_CLOSING_MAX_DAYS = 365;
/** How long browsers and the edge keep a feed: five minutes, fifteen at the edge (as the 360Giving feed). */
export const FEED_CACHE_CONTROL = "public, max-age=300, s-maxage=900";
/** The OpenGrants index feed's page size, at most. */
export const OPENGRANTS_FEED_MAX_PAGE = 100;
/**
 * Whether OpenGrants pulls the index feed today. False: as of 2026-11-17 no gms.opengrants.io call
 * appears in OpenGrants search and OpenGrants offers no endpoint to send one to. The panel says so
 * rather than promising a listing; set true once the OpenGrants team pulls the feed.
 */
export const OPENGRANTS_PULLS_FEED = false;

/** Philanthropy News Digest's RFP submissions, as Candid's own page states them (docs/syndication.md). */
export const PND = {
  name: "Philanthropy News Digest",
  /** The submission address on https://philanthropynewsdigest.org/rfps. */
  address: "pndrfp@candid.org",
  sourceUrl: "https://philanthropynewsdigest.org/rfps",
  /** "We require notice of funding opportunities four weeks in advance of their deadline." */
  leadDays: 28,
} as const;
/** Who may send a call to PND: a person who edits calls. */
export const PND_ROLES: readonly string[] = ["admin", "program_officer"];
/** A claim older than this with no send recorded is taken as a send that never finished. */
const PND_STALE_CLAIM_MS = 15 * 60 * 1000;

// ------------------------------------------------------------------------------------ the public page's data

/**
 * What the public opportunity page shows about a call, as `opportunityPage` (services/public.ts)
 * returns it: everything a feed item or a PND submission is made from. A part of that answer, so
 * `feedItemOf(await opportunityPage(…))` is the feed item (apps/api/test/syndication.test.ts).
 */
export interface PublicCall {
  funder: { name: string; handle: string };
  opportunity: {
    id: string;
    slug: string;
    title: string;
    description: string;
    status: string;
    funding: unknown;
    keyDates: unknown;
    acceptedApplicantTypes: unknown;
    acceptingApplications: boolean;
    publishedAt: string | null;
    eligibility: string[];
    fund: { name: string; slug: string; isDefault: boolean } | null;
  };
  competitions: { status: string; stages: { label: string; closes: string | null }[] }[];
  links: { page: string };
}

const publishOf = (o: Pick<Opp, "publish">): Record<string, unknown> => (o.publish as Record<string, unknown> | null) ?? {};
/** In the open-call feeds unless the funder took it out (`publish.feeds: false`). */
export const feedsOn = (o: Pick<Opp, "publish">) => publishFlag(o, "feeds");
const liveFunder = (w: Ws | undefined): w is Ws => !!w && w.kind === "funder" && w.status === "active";
/** Published, with its public page on, under an active funder: the page anyone can open. */
const pageLive = (o: Opp, w: Ws | undefined): w is Ws => o.published_at !== null && publishFlag(o, "publicPage") && liveFunder(w);

async function competitionsOf(ctx: PublicContext, oppIds: string[]): Promise<Comp[]> {
  const out: Comp[] = [];
  for (let i = 0; i < oppIds.length; i += 100) out.push(...(await ctx.repos.table("competitions").find({ opportunity_id: oppIds.slice(i, i + 100) }, { orderBy: "created_at" })));
  return out.filter((c) => c.status !== "draft");
}

const stagesOf = (c: Comp) => (Array.isArray(c.stages) ? (c.stages as { label?: string; closes?: string | null }[]) : []);

/** The public page's data for each of these calls whose page is live, read in batches. */
async function publicCalls(ctx: PublicContext, opps: Opp[]): Promise<PublicCall[]> {
  const ids = [...new Set(opps.map((o) => o.workspace_id))];
  const funders = new Map((ids.length ? await ctx.repos.table("workspaces").find({ id: ids }) : []).map((w) => [w.id, w]));
  const live = opps.filter((o) => pageLive(o, funders.get(o.workspace_id)));
  const comps = await competitionsOf(ctx, live.map((o) => o.id));
  const fundOf = new Map<string, PublicCall["opportunity"]["fund"]>();
  for (const wsId of new Set(live.map((o) => o.workspace_id))) {
    for (const f of await publicFundsOf(ctx, wsId)) for (const id of f.opportunityIds) if (!fundOf.has(id)) fundOf.set(id, { name: f.name, slug: f.slug, isDefault: f.isDefault });
  }
  return live.map((o) => {
    const w = funders.get(o.workspace_id)!;
    const mine = comps.filter((c) => c.opportunity_id === o.id);
    const parsed = parseRules(o.eligibility_rules);
    // The public page's card and rule labels (services/public.ts), in the call's own language: the
    // funder's words as written, whatever language a reader picks on the page.
    return {
      funder: { name: namesOf(w).name, handle: w.handle },
      opportunity: {
        ...card(o, acceptingApplications(o, mine)),
        publishedAt: o.published_at,
        eligibility: ruleLabels(parsed.ok ? parsed.rules : null),
        fund: fundOf.get(o.id) ?? null,
      },
      competitions: mine.map((c) => ({ status: c.status, stages: stagesOf(c).map((s) => ({ label: s.label ?? "", closes: s.closes ?? null })) })),
      links: { page: `${ctx.config.webBaseUrl}/f/${w.handle}/o/${o.slug}` },
    };
  });
}

// ------------------------------------------------------------------------------------ dates

type DateEvent = { name?: unknown; eventType?: unknown; date?: unknown; startDate?: unknown; endDate?: unknown };
const DAY = /^\d{4}-\d{2}-\d{2}/;
const dayOf = (v: unknown): string | null => (typeof v === "string" && DAY.test(v) ? v.slice(0, 10) : null);
/** The day an event falls on (a range: its end, the day it closes). */
const eventDay = (e: DateEvent | undefined): string | null => (e ? (dayOf(e.date) ?? dayOf(e.endDate) ?? dayOf(e.startDate)) : null);
const keyDatesOf = (p: PublicCall) => (p.opportunity.keyDates ?? {}) as { postDate?: DateEvent; closeDate?: DateEvent; otherDates?: Record<string, DateEvent> };
/** The call's deadline as its page shows it (`keyDates.closeDate`); null for a call without one. */
export const closesOn = (p: PublicCall): string | null => eventDay(keyDatesOf(p).closeDate);
const opensOn = (p: PublicCall): string | null => eventDay(keyDatesOf(p).postDate);
const today = (now: Date) => now.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------------------------------------------ feed filters

/** US states, DC and the territories, by USPS code. A region that is not one of them is matched as written. */
const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands", AS: "American Samoa", MP: "Northern Mariana Islands",
};
const STATE_NAMES = Object.values(US_STATES);

export const feedQuery = z
  .object({
    /** A US state or territory (code or name), or any other region, as the call's page words it. */
    region: z.string().trim().min(2).max(80).optional(),
    /** A fund of the funder (its name or the slug of its page), the one way the GMS sorts calls. */
    category: z.string().trim().min(1).max(100).optional(),
    /** A funder's handle, as in `/f/{handle}`. */
    funder: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, "A funder handle: 3 to 64 lowercase letters, digits and hyphens")
      .optional(),
    /** Only calls whose deadline is today or within this many days. */
    closingWithin: z.coerce.number().int().min(1).max(FEED_CLOSING_MAX_DAYS).optional(),
  })
  .strict();
export type FeedQuery = z.output<typeof feedQuery>;
/** The query parameters a feed reads; any other (a `utm_*` a newsletter adds) is ignored. */
export const FEED_PARAMS = ["region", "category", "funder", "closingWithin"] as const;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (term: string, flags: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(term).replace(/\s+/g, "\\s+")}($|[^\\p{L}\\p{N}])`, flags);

/**
 * Whether the call's public text (title, description, eligibility labels) names the region. A US
 * state matches its name anywhere, or its code in an eligibility label ("Based in OR or WA"); a
 * longer state name that holds it ("West Virginia" for "Virginia") does not count. The rule values
 * behind the labels are never read: the page does not show them.
 */
export function regionMatches(p: PublicCall, region: string): boolean {
  const code = Object.keys(US_STATES).find((k) => k === region.toUpperCase()) ?? Object.keys(US_STATES).find((k) => US_STATES[k]!.toLowerCase() === region.toLowerCase());
  const name = code ? US_STATES[code]! : region;
  const longer = STATE_NAMES.filter((n) => n !== name && word(name, "iu").test(n));
  const strip = (s: string) => longer.reduce((out, n) => out.replace(new RegExp(word(n, "giu").source, "giu"), " "), s);
  const text = strip([p.opportunity.title, p.opportunity.description, ...p.opportunity.eligibility].join("\n"));
  if (word(name, "iu").test(text)) return true;
  return !!code && p.opportunity.eligibility.some((l) => word(code, "u").test(strip(l)));
}

/** A fund other than the default, as the page names it ("{Fund} · A fund of {Funder}"). */
const categoryOf = (p: PublicCall) => (p.opportunity.fund && !p.opportunity.fund.isDefault ? p.opportunity.fund : null);

function matchesQuery(p: PublicCall, q: FeedQuery, now: Date): boolean {
  if (q.funder && p.funder.handle !== q.funder) return false;
  if (q.category) {
    const c = categoryOf(p);
    const want = q.category.toLowerCase();
    if (!c || (c.slug !== want && c.name.toLowerCase() !== want)) return false;
  }
  if (q.closingWithin !== undefined) {
    const closes = closesOn(p);
    if (!closes || closes < today(now) || closes > addDays(today(now), q.closingWithin)) return false;
  }
  return !q.region || regionMatches(p, q.region);
}

// ------------------------------------------------------------------------------------ feed items

const withUtm = (url: string, source: string) => {
  const u = new URL(url);
  u.searchParams.set("utm_source", source);
  return u.toString();
};

/** One call in a feed: only what its public page shows, and the page's address with `utm_source=feed`. */
export interface FeedItem {
  id: string;
  title: string;
  description: string;
  status: string;
  acceptingApplications: boolean;
  funder: { name: string; handle: string; page: string };
  category: { name: string; slug: string; page: string } | null;
  /** CommonGrants `OppFunding` and `OppTimeline`, as on the page. */
  funding: unknown;
  keyDates: unknown;
  opens: string | null;
  closes: string | null;
  acceptedApplicantTypes: string[];
  eligibility: string[];
  publishedAt: string | null;
  link: string;
}

export function feedItemOf(p: PublicCall): FeedItem {
  // The funder page is the opportunity page's parent: `/f/{handle}/o/{slug}` → `/f/{handle}`.
  const funderPage = p.links.page.replace(/\/o\/[^/]+$/, "");
  const c = categoryOf(p);
  return {
    id: p.opportunity.id,
    title: p.opportunity.title,
    description: p.opportunity.description,
    status: p.opportunity.status,
    acceptingApplications: p.opportunity.acceptingApplications,
    funder: { name: p.funder.name, handle: p.funder.handle, page: funderPage },
    category: c ? { name: c.name, slug: c.slug, page: `${funderPage}/${c.slug}` } : null,
    funding: p.opportunity.funding ?? {},
    keyDates: p.opportunity.keyDates ?? {},
    opens: opensOn(p),
    closes: closesOn(p),
    acceptedApplicantTypes: Array.isArray(p.opportunity.acceptedApplicantTypes) ? (p.opportunity.acceptedApplicantTypes as unknown[]).map(String) : [],
    eligibility: p.opportunity.eligibility,
    publishedAt: p.opportunity.publishedAt,
    link: withUtm(p.links.page, FEED_UTM_SOURCE),
  };
}

/** The feed's calls: open and forecasted, page live, in the feeds, matching the query, newest first. */
export async function feedItems(ctx: PublicContext, q: FeedQuery): Promise<FeedItem[]> {
  let wsId: string | undefined;
  if (q.funder) {
    const w = await ctx.repos.table("workspaces").one({ handle: q.funder, kind: "funder" });
    if (!liveFunder(w ?? undefined)) return [];
    wsId = w!.id;
  }
  const opps = (await ctx.repos.table("opportunities").find({ status: ["open", "forecasted"], ...(wsId ? { workspace_id: wsId } : {}) }, { notNull: ["published_at"], orderBy: "published_at", ascending: false, limit: 5000 })).filter(feedsOn);
  const calls = (await publicCalls(ctx, opps)).filter((p) => matchesQuery(p, q, ctx.now()));
  return calls
    .sort((a, b) => (b.opportunity.publishedAt ?? "").localeCompare(a.opportunity.publishedAt ?? "") || a.opportunity.id.localeCompare(b.opportunity.id))
    .slice(0, FEED_MAX_ITEMS)
    .map(feedItemOf);
}

// ------------------------------------------------------------------------------------ feed formats

export interface FeedMeta {
  title: string;
  description: string;
  homePage: string;
  /** This feed's own address, with its query. */
  self: string;
}

/** The feed's address for a format, with the filters in a fixed order (the address a feed reader keeps). */
export function feedUrl(ctx: Pick<PublicContext, "config">, format: "json" | "csv" | "rss", q: FeedQuery = {}): string {
  const u = new URL(`${ctx.config.baseUrl}/gms/public/feeds/opportunities.${format}`);
  for (const k of FEED_PARAMS) if (q[k] !== undefined) u.searchParams.set(k, String(q[k]));
  return u.toString();
}

export async function feedMeta(ctx: PublicContext, format: "json" | "csv" | "rss", q: FeedQuery): Promise<FeedMeta> {
  const t = emailT("en");
  const w = q.funder ? await ctx.repos.table("workspaces").one({ handle: q.funder, kind: "funder" }) : null;
  const named = w && liveFunder(w) ? namesOf(w).name : null;
  return {
    title: named ? t("syndication.feed.titleFunder", { funder: named }) : t("syndication.feed.title"),
    description: t("syndication.feed.description"),
    homePage: named ? `${ctx.config.webBaseUrl}/f/${w!.handle}` : `${ctx.config.webBaseUrl}/`,
    self: feedUrl(ctx, format, q),
  };
}

/** JSON Feed 1.1 (https://jsonfeed.org/version/1.1); each item's fields in `_gms`. */
export function jsonFeed(items: FeedItem[], meta: FeedMeta) {
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: meta.title,
    home_page_url: meta.homePage,
    feed_url: meta.self,
    description: meta.description,
    language: "en",
    items: items.map((i) => ({
      id: i.id,
      url: i.link,
      title: i.title,
      content_text: i.description,
      ...(i.publishedAt ? { date_published: new Date(i.publishedAt).toISOString() } : {}),
      authors: [{ name: i.funder.name, url: i.funder.page }],
      ...(i.category ? { tags: [i.category.name] } : {}),
      _gms: i,
    })),
  };
}

/** The CSV's columns: stable English names, as an API's fields (docs/i18n.md: machine interfaces stay English). */
export const FEED_CSV_COLUMNS = ["id", "title", "funder", "funder_handle", "status", "accepting_applications", "opens", "closes", "min_award", "max_award", "total_available", "currency", "applicant_types", "eligibility", "category", "published_at", "link", "description"] as const;

const money = (v: unknown): { amount: string; currency: string } | null => {
  const m = v as { amount?: unknown; currency?: unknown } | null | undefined;
  return m && typeof m.amount === "string" && typeof m.currency === "string" ? { amount: m.amount, currency: m.currency } : null;
};
const fundingOf = (i: { funding: unknown }) => (i.funding ?? {}) as { minAwardAmount?: unknown; maxAwardAmount?: unknown; totalAmountAvailable?: unknown; estimatedAwardCount?: unknown; minAwardCount?: unknown; maxAwardCount?: unknown; details?: unknown };

/** RFC 4180, every cell formula-safe (`@gms/importers` `csvCell`: a leading =, +, -, @, tab or CR gets an apostrophe). */
export function csvFeed(items: FeedItem[]): string {
  return toCsv(
    FEED_CSV_COLUMNS,
    items.map((i) => {
      const f = fundingOf(i);
      const currency = money(f.maxAwardAmount)?.currency ?? money(f.minAwardAmount)?.currency ?? money(f.totalAmountAvailable)?.currency ?? "";
      return [i.id, i.title, i.funder.name, i.funder.handle, i.status, i.acceptingApplications ? "yes" : "no", i.opens ?? "", i.closes ?? "", money(f.minAwardAmount)?.amount ?? "", money(f.maxAwardAmount)?.amount ?? "", money(f.totalAmountAvailable)?.amount ?? "", currency, i.acceptedApplicantTypes.join("; "), i.eligibility.join("; "), i.category?.name ?? "", i.publishedAt ? new Date(i.publishedAt).toISOString() : "", i.link, i.description];
    }),
  );
}

/** Characters XML 1.0 does not allow, dropped from every text node and attribute. */
const NOT_XML = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu;
const xml = (s: string) => s.replace(NOT_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const rfc822 = (iso: string) => new Date(iso).toUTCString().replace("GMT", "+0000");

/** RSS 2.0 (https://www.rssboard.org/rss-specification), with an `atom:link` to itself. */
export function rssFeed(items: FeedItem[], meta: FeedMeta): string {
  const latest = items.map((i) => i.publishedAt).filter((d): d is string => !!d).sort().pop();
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    `<channel>`,
    `<title>${xml(meta.title)}</title>`,
    `<link>${xml(meta.homePage)}</link>`,
    `<description>${xml(meta.description)}</description>`,
    `<language>en</language>`,
    `<atom:link href="${xml(meta.self)}" rel="self" type="application/rss+xml"/>`,
    ...(latest ? [`<lastBuildDate>${rfc822(latest)}</lastBuildDate>`] : []),
    ...items.map((i) =>
      [
        `<item>`,
        `<title>${xml(i.title)}</title>`,
        `<link>${xml(i.link)}</link>`,
        `<guid isPermaLink="false">urn:uuid:${xml(i.id)}</guid>`,
        ...(i.publishedAt ? [`<pubDate>${rfc822(i.publishedAt)}</pubDate>`] : []),
        `<description>${xml(i.description)}</description>`,
        ...(i.category ? [`<category>${xml(i.category.name)}</category>`] : []),
        `</item>`,
      ].join(""),
    ),
    `</channel>`,
    `</rss>`,
  ];
  return `${lines.join("\n")}\n`;
}

// ------------------------------------------------------------------------------------ the OpenGrants index feed

export const openGrantsFeedQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(OPENGRANTS_FEED_MAX_PAGE).default(OPENGRANTS_FEED_MAX_PAGE),
    /** Only records changed after this time (an incremental pull). */
    modifiedSince: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

/**
 * The calls OpenGrants may list: published, public page on, `publish.openGrantsIndex` on, open,
 * forecasted or closed (a closed call stays so OpenGrants can mark it closed), as CommonGrants
 * `OpportunityBase` records validated with `@common-grants/sdk`, least recently changed first. A
 * call taken out of the index, or whose page was turned off, is no longer listed: a full pull that
 * does not list a record OpenGrants holds means it is gone.
 */
export async function openGrantsIndexFeed(ctx: PublicContext, q: z.output<typeof openGrantsFeedQuery>): Promise<{ items: OpportunityBase[]; total: number }> {
  const opps = (await ctx.repos.table("opportunities").find({ status: ["open", "forecasted", "closed"] }, { notNull: ["published_at"], orderBy: "updated_at", ascending: true, limit: 10_000 })).filter((o) => publishFlag(o, "openGrantsIndex") && (!q.modifiedSince || Date.parse(o.updated_at) > Date.parse(q.modifiedSince)));
  const wsIds = [...new Set(opps.map((o) => o.workspace_id))];
  const funders = new Map((wsIds.length ? await ctx.repos.table("workspaces").find({ id: wsIds }) : []).map((w) => [w.id, w]));
  const listed = opps.filter((o) => pageLive(o, funders.get(o.workspace_id))).sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id));
  const items: OpportunityBase[] = [];
  for (const o of listed.slice((q.page - 1) * q.pageSize, q.page * q.pageSize)) {
    try {
      items.push(projectOpportunity({ opportunity: o as unknown as OpportunityRow, funder: funderOf(funders.get(o.workspace_id)!) }, { baseUrl: ctx.config.baseUrl, webBaseUrl: ctx.config.webBaseUrl }));
    } catch (e) {
      // A record that no longer validates is left out rather than sent half right.
      if (!(e instanceof ProjectionError)) throw e;
    }
  }
  return { items, total: listed.length };
}

export const openGrantsFeedUrl = (ctx: Pick<PublicContext, "config">) => `${ctx.config.baseUrl}/gms/public/feeds/opengrants.json`;

// ------------------------------------------------------------------------------------ Philanthropy News Digest

/** CommonGrants applicant types as PND's readers would say them (the email is in English). */
const APPLICANT_TYPE_KEY: Record<string, EmailKey> = {
  individual: "syndication.pnd.applicantType.individual",
  organization: "syndication.pnd.applicantType.organization",
  government_state: "syndication.pnd.applicantType.government_state",
  government_county: "syndication.pnd.applicantType.government_county",
  government_municipal: "syndication.pnd.applicantType.government_municipal",
  government_special_district: "syndication.pnd.applicantType.government_special_district",
  government_tribal: "syndication.pnd.applicantType.government_tribal",
  organization_tribal_other: "syndication.pnd.applicantType.organization_tribal_other",
  school_district_independent: "syndication.pnd.applicantType.school_district_independent",
  higher_education_public: "syndication.pnd.applicantType.higher_education_public",
  higher_education_private: "syndication.pnd.applicantType.higher_education_private",
  non_profit_with_501c3: "syndication.pnd.applicantType.non_profit_with_501c3",
  nonprofit_without_501c3: "syndication.pnd.applicantType.nonprofit_without_501c3",
  for_profit_small_business: "syndication.pnd.applicantType.for_profit_small_business",
  for_profit_not_small_business: "syndication.pnd.applicantType.for_profit_not_small_business",
  unrestricted: "syndication.pnd.applicantType.unrestricted",
  custom: "syndication.pnd.applicantType.custom",
};

/** The fields PND asks for ("program scope, grantee qualifications, application instructions, and deadlines"), with the call's name and link. */
export const PND_FIELDS = ["funder", "title", "scope", "qualifications", "instructions", "deadlines", "link", "contact"] as const;
export type PndField = (typeof PND_FIELDS)[number];

const LABEL_KEY: Record<PndField, EmailKey> = {
  funder: "syndication.pnd.label.funder",
  title: "syndication.pnd.label.title",
  scope: "syndication.pnd.label.scope",
  qualifications: "syndication.pnd.label.qualifications",
  instructions: "syndication.pnd.label.instructions",
  deadlines: "syndication.pnd.label.deadlines",
  link: "syndication.pnd.label.link",
  contact: "syndication.pnd.label.contact",
};

const en = emailT("en");
const usd = (v: unknown) => {
  const m = money(v);
  return m && Number.isFinite(Number(m.amount)) ? formatCurrency("en", Number(m.amount), m.currency) : null;
};
/** "April 30, 2027", as PND's own listings write a deadline. */
const longDate = (day: string) => formatDateTimeIn("en", `${day}T00:00:00Z`, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) ?? day;

function fundingSentence(funding: unknown): string | null {
  const f = fundingOf({ funding });
  const min = usd(f.minAwardAmount);
  const max = usd(f.maxAwardAmount);
  const total = usd(f.totalAmountAvailable);
  const count = [f.estimatedAwardCount, f.maxAwardCount].find((n): n is number => typeof n === "number" && n > 0);
  const parts = [
    min && max ? (min === max ? en("syndication.pnd.funding.exact", { amount: min }) : en("syndication.pnd.funding.range", { min, max })) : max ? en("syndication.pnd.funding.upTo", { max }) : min ? en("syndication.pnd.funding.from", { min }) : null,
    total ? en("syndication.pnd.funding.total", { total }) : null,
    count ? en("syndication.pnd.funding.awards", { count }) : null,
  ].filter((s): s is string => !!s);
  return parts.length ? parts.join(" ") : null;
}

/**
 * Every dated key event of the call ("{name}: {date}") and the closing date of each stage of its
 * public competitions ("{stage} due: {date}"), as the page lists them, in date order.
 */
function deadlineLines(p: PublicCall): string[] {
  const k = keyDatesOf(p);
  const events = [k.postDate, k.closeDate, ...Object.values(k.otherDates ?? {})]
    .map((e) => ({ day: eventDay(e), name: typeof e?.name === "string" && e.name.trim() ? cleanLine(e.name) : null }))
    .filter((x): x is { day: string; name: string } => !!x.day && !!x.name)
    .map((x) => ({ day: x.day, line: en("syndication.pnd.date", { name: x.name, date: longDate(x.day) }) }));
  const stages = p.competitions
    .flatMap((c) => c.stages)
    .map((s) => ({ day: dayOf(s.closes), stage: cleanLine(s.label) }))
    .filter((x): x is { day: string; stage: string } => !!x.day && !!x.stage)
    .map((x) => ({ day: x.day, line: en("syndication.pnd.stageDue", { stage: x.stage, date: longDate(x.day) }) }));
  return [...events, ...stages]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((x) => x.line)
    .filter((line, i, all) => all.indexOf(line) === i);
}

/**
 * The earliest deadline still ahead: the call's closing date and the closing date of each stage
 * of its public competitions (a letter of intent due first counts). PND's four weeks run back
 * from it. Null when the call states none (it is open all year).
 */
export function earliestDeadline(p: PublicCall, now: Date): string | null {
  const days = [closesOn(p), ...p.competitions.flatMap((c) => c.stages.map((s) => dayOf(s.closes)))].filter((d): d is string => !!d && d >= today(now));
  return days.sort()[0] ?? null;
}

/** The last day PND takes the call (four weeks before the earliest deadline); null when there is no deadline. */
export const pndSendBy = (deadline: string | null): string | null => (deadline ? addDays(deadline, -PND.leadDays) : null);

export interface PndEmail {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  /** The same content as labelled fields, in the email's order, for the preview. */
  fields: { key: PndField; label: string; value: string }[];
}

/** The submission email, from the call's public page only. The same call and reply-to always give the same email. */
export function pndEmail(p: PublicCall, replyTo: string, mailFrom: string): PndEmail {
  const funder = cleanLine(p.funder.name);
  const title = cleanLine(p.opportunity.title);
  const link = withUtm(p.links.page, PND_UTM_SOURCE);
  const types = (Array.isArray(p.opportunity.acceptedApplicantTypes) ? (p.opportunity.acceptedApplicantTypes as unknown[]) : []).map((t) => APPLICANT_TYPE_KEY[String(t)]).filter((k): k is EmailKey => !!k).map((k) => en(k));
  const description = p.opportunity.description.replace(/\r\n?/g, "\n").replace(NOT_XML, "").trim();
  const funding = fundingSentence(p.opportunity.funding);
  const opens = opensOn(p);
  const dated = deadlineLines(p);
  const value: Record<PndField, string> = {
    funder,
    title,
    scope: [description, funding].filter(Boolean).join("\n\n"),
    qualifications: [types.length ? en("syndication.pnd.openTo", { types: formatList("en", types) }) : null, ...p.opportunity.eligibility.map((l) => `- ${cleanLine(l)}`)].filter(Boolean).join("\n") || en("syndication.pnd.qualificationsOnPage"),
    instructions: p.opportunity.status === "forecasted" && opens ? en("syndication.pnd.instructions.opens", { date: longDate(opens), link }) : en("syndication.pnd.instructions.apply", { link }),
    deadlines: dated.length ? dated.join("\n") : en("syndication.pnd.rolling"),
    link,
    contact: replyTo,
  };
  const fields = PND_FIELDS.map((key) => ({ key, label: en(LABEL_KEY[key]), value: value[key] }));
  const subject = cleanLine(en("syndication.pnd.subject", { title, funder }));
  const intro = en("syndication.pnd.intro", { funder });
  const footer = en("syndication.pnd.footer", { funder, replyTo });
  const text = [intro, ...fields.map((f) => `${f.label}:\n${f.value}`), `--\n${footer}`].join("\n\n");
  const para = (s: string) => `<p>${escapeHtml(s).replace(/\n/g, "<br>")}</p>`;
  const html = [
    para(intro),
    ...fields.map((f) => `<h3>${escapeHtml(f.label)}</h3>\n${f.key === "link" ? `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` : f.value.split(/\n{2,}/).map(para).join("\n")}`),
    `<p><small>${escapeHtml(footer)}</small></p>`,
  ].join("\n");
  return { from: fromWithName(funder, mailFrom), to: PND.address, replyTo, subject, text, html, fields };
}

const digestOf = async (e: PndEmail) => sha256Hex(new TextEncoder().encode(JSON.stringify({ from: e.from, to: e.to, replyTo: e.replyTo, subject: e.subject, text: e.text, html: e.html })));

/** Why a call cannot go to PND now; null when it can. The web words each code. */
export type PndBlock = "person_only" | "role" | "not_listed" | "closed" | "too_late" | "mail_not_configured" | "no_reply_to" | "sent" | "sending";

type Loaded = { ws: ServiceWorkspace; opp: Opp; funder: Ws; call: PublicCall | null };

async function load(ctx: ServiceContext, oppId: string, scope: "opportunities:read" | "opportunities:write"): Promise<Loaded> {
  const ws = await authorize(ctx, { scope, kind: "funder" });
  const opp = required(await ctx.repos.table("opportunities").one({ id: oppId, workspace_id: ws.id }), "Opportunity");
  const funder = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const [call] = await publicCalls(ctx, [opp]);
  return { ws, opp, funder, call: call ?? null };
}

/** Replies go to the funder: its public contact address (the one its page gives), else the person's own. */
async function replyToOf(ctx: ServiceContext, funder: Ws): Promise<string | null> {
  const settings = (funder.settings ?? {}) as { contactEmail?: unknown };
  if (typeof settings.contactEmail === "string" && settings.contactEmail.includes("@")) return settings.contactEmail.trim();
  if (verificationOf(funder).source === "passport") {
    const primary = (orgFacts(funder).org as { emails?: { primary?: unknown } }).emails?.primary;
    if (typeof primary === "string" && primary.includes("@")) return primary.trim();
  }
  const who = ctx.actor.userId && ctx.ports.directory ? (await ctx.ports.directory.lookup([ctx.actor.userId])).get(ctx.actor.userId) : undefined;
  return who?.email?.trim() || null;
}

const sendRow = (ctx: ServiceContext, oppId: string) => ctx.repos.table("syndication_sends").one({ opportunity_id: oppId, target: "pnd" });
const staleClaim = (ctx: ServiceContext, r: Row<"syndication_sends">) => r.sent_at === null && ctx.now().getTime() - Date.parse(r.created_at) > PND_STALE_CLAIM_MS;

/** What stands between this call and a PND submission, in the order a person would fix it. */
async function pndState(ctx: ServiceContext, l: Loaded) {
  const sent = await sendRow(ctx, l.opp.id);
  const deadline = l.call ? earliestDeadline(l.call, ctx.now()) : null;
  const sendBy = pndSendBy(deadline);
  const person = ctx.actor.kind === "user" && !!ctx.actor.userId;
  const block: PndBlock | null =
    sent?.sent_at
      ? "sent"
      : sent && !staleClaim(ctx, sent)
        ? "sending"
        : !l.call
          ? "not_listed"
          : !["open", "forecasted"].includes(l.opp.status)
            ? "closed"
            : sendBy !== null && today(ctx.now()) > sendBy
              ? "too_late"
              : !person
                ? "person_only"
                : !l.ws.role || !PND_ROLES.includes(l.ws.role)
                  ? "role"
                  : !ctx.ports.mailer || !ctx.config.mailFrom
                    ? "mail_not_configured"
                    : null;
  return { sent, deadline, sendBy, block };
}

/** A person who edits calls, in the call's funder workspace. Checked before anything is composed. */
async function loadForSend(ctx: ServiceContext, oppId: string): Promise<Loaded> {
  if (ctx.actor.kind !== "user" || !ctx.actor.userId) throw forbidden("human_only", "Sending a call to Philanthropy News Digest is done by a signed-in person in the GMS, never by an agent or API client");
  const l = await load(ctx, oppId, "opportunities:write");
  if (!l.ws.role || !PND_ROLES.includes(l.ws.role)) throw new ApiError(403, "insufficient_role", `This needs one of these roles: ${PND_ROLES.join(", ")}`);
  return l;
}

/** The send route's first check, before it reads the body: a person who edits calls, on a call of this workspace. */
export async function assertMaySendPnd(ctx: ServiceContext, oppId: string): Promise<void> {
  await loadForSend(ctx, oppId);
}

const BLOCKED: Record<Exclude<PndBlock, "person_only" | "role">, [ContentfulStatusCode, string, string]> = {
  sent: [409, "pnd_already_sent", "This call was already sent to Philanthropy News Digest. Each call is sent once"],
  sending: [409, "pnd_sending", "This call is being sent to Philanthropy News Digest. Look again in a minute"],
  not_listed: [409, "pnd_not_listed", "Publish this call with its public page on before sending it to Philanthropy News Digest"],
  closed: [409, "pnd_call_closed", "This call is closed, so Philanthropy News Digest would not list it"],
  too_late: [409, "pnd_too_late", "Philanthropy News Digest needs a call four weeks before its earliest deadline, and that date has passed"],
  mail_not_configured: [503, "mail_not_configured", "This server cannot send email. Copy the fields and email them to Philanthropy News Digest yourself"],
  no_reply_to: [422, "pnd_no_reply_to", "Add a public contact email in Settings, Public page, so Philanthropy News Digest can reply"],
};
const refuse = (b: PndBlock): never => {
  if (b === "person_only") throw forbidden("human_only", "Sending a call to Philanthropy News Digest is done by a signed-in person in the GMS, never by an agent or API client");
  if (b === "role") throw new ApiError(403, "insufficient_role", `This needs one of these roles: ${PND_ROLES.join(", ")}`);
  const [status, code, message] = BLOCKED[b];
  throw new ApiError(status, code, message);
};

async function composePnd(ctx: ServiceContext, l: Loaded) {
  const state = await pndState(ctx, l);
  if (state.block) refuse(state.block);
  const replyTo = await replyToOf(ctx, l.funder);
  if (!replyTo) refuse("no_reply_to");
  const email = pndEmail(l.call!, replyTo!, ctx.config.mailFrom!);
  return { email, digest: await digestOf(email), state };
}

/** The submission exactly as it would be sent, with the digest that ties a send to this preview. A person who edits calls. */
export async function previewPnd(ctx: ServiceContext, oppId: string) {
  const l = await loadForSend(ctx, oppId);
  const { email, digest, state } = await composePnd(ctx, l);
  return { ...email, digest, earliestDeadline: state.deadline, sendBy: state.sendBy, sourceUrl: PND.sourceUrl };
}

export const pndSendInput = z.object({ digest: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

/** Send the submission, if it is still exactly the preview the person saw. Once per call; recorded with a masked reply-to; ledgered. */
export async function sendPnd(ctx: ServiceContext, oppId: string, input: z.output<typeof pndSendInput>) {
  const l = await loadForSend(ctx, oppId);
  const { email, digest, state } = await composePnd(ctx, l);
  if (digest !== input.digest) throw new ApiError(409, "preview_changed", "The call changed since the preview. Look at the preview again before sending");
  if (state.sent) await ctx.repos.table("syndication_sends").remove({ id: state.sent.id, sent_at: null });
  let claim: Row<"syndication_sends">;
  try {
    claim = await ctx.repos.table("syndication_sends").insert({ workspace_id: l.ws.id, opportunity_id: l.opp.id, target: "pnd", sent_by: ctx.actor.userId!, to_address: PND.address, reply_to_masked: maskEmail(email.replyTo), digest });
  } catch (e) {
    if (e instanceof RepoError && e.kind === "conflict") refuse("sending");
    throw e;
  }
  let messageId: string;
  try {
    // One key per call: should a claim go stale after Resend took the email, a second send is the same email to Resend.
    messageId = (await ctx.ports.mailer!.send({ from: email.from, to: [email.to], replyTo: email.replyTo, subject: email.subject, text: email.text, html: email.html, idempotencyKey: `pnd:${l.opp.id}`, tags: [{ name: "kind", value: "pnd_submission" }] })).id;
  } catch {
    await ctx.repos.table("syndication_sends").remove({ id: claim!.id, sent_at: null }).catch(() => undefined);
    throw new ApiError(502, "mail_failed", "The email to Philanthropy News Digest could not be sent. Try again in a few minutes");
  }
  const at = ctx.now().toISOString();
  await ctx.repos.table("syndication_sends").update({ id: claim!.id }, { sent_at: at, message_id: messageId.slice(0, 200) });
  await audit(ctx, "opportunity.syndicated", "opportunity", l.opp.id, { target: "pnd", to: PND.address, replyTo: maskEmail(email.replyTo), digest, sentAt: at });
  return { sent: true as const, sentAt: at, to: email.to, replyTo: email.replyTo };
}

// ------------------------------------------------------------------------------------ the panel

export const feedsInput = z.object({ feeds: z.boolean() }).strict();

/** Take a call out of the open-call feeds, or put it back (`publish.feeds`). The other publish options are kept. */
export async function setFeeds(ctx: ServiceContext, oppId: string, input: z.output<typeof feedsInput>) {
  const { opp } = await load(ctx, oppId, "opportunities:write");
  const publish = { ...publishOf(opp), feeds: input.feeds };
  await ctx.repos.table("opportunities").update({ id: opp.id, workspace_id: opp.workspace_id }, { publish: publish as Opp["publish"] });
  await audit(ctx, "opportunity.updated", "opportunity", opp.id, { fields: ["publish.feeds"], feeds: input.feeds });
  return syndicationOf(ctx, oppId);
}

/** Applications to this call started from a feed link and from a PND link (`utm_source` on the started event). */
async function startedFrom(ctx: ServiceContext, opp: Opp) {
  const apps = await ctx.repos.table("applications").find({ workspace_id: opp.workspace_id, opportunity_id: opp.id }, { limit: 5000 });
  const started = apps.length ? await ctx.repos.table("application_events").find({ application_id: apps.map((a) => a.id), type: "started" }, { limit: 5000 }) : [];
  const from = (s: string) => started.filter((e) => (e.payload as { utmSource?: unknown } | null)?.utmSource === s).length;
  return { feed: from(FEED_UTM_SOURCE), pnd: from(PND_UTM_SOURCE) };
}

/**
 * The "Share this call" panel: the feeds this call is in and their addresses, what OpenGrants can
 * pull, the PND submission (its last day, whether it went, and why it cannot go now), and the
 * applications started from those links. A read: agents and API clients see the same, and are
 * told a person sends to PND.
 */
export async function syndicationOf(ctx: ServiceContext, oppId: string) {
  const l = await load(ctx, oppId, "opportunities:read");
  const state = await pndState(ctx, l);
  const listed = !!l.call;
  const byFunder: FeedQuery = { funder: l.funder.handle };
  return {
    opportunityId: l.opp.id,
    feeds: {
      on: feedsOn(l.opp),
      listed: listed && feedsOn(l.opp) && ["open", "forecasted"].includes(l.opp.status),
      urls: { json: feedUrl(ctx, "json", byFunder), csv: feedUrl(ctx, "csv", byFunder), rss: feedUrl(ctx, "rss", byFunder) },
      allUrl: feedUrl(ctx, "rss"),
    },
    openGrants: { on: publishFlag(l.opp, "openGrantsIndex"), inFeed: listed && publishFlag(l.opp, "openGrantsIndex"), feedUrl: openGrantsFeedUrl(ctx), pulling: OPENGRANTS_PULLS_FEED },
    pnd: {
      name: PND.name,
      address: PND.address,
      sourceUrl: PND.sourceUrl,
      leadDays: PND.leadDays,
      earliestDeadline: state.deadline,
      sendBy: state.sendBy,
      sent: state.sent?.sent_at ? { sentAt: state.sent.sent_at, replyTo: state.sent.reply_to_masked } : null,
      canSend: state.block === null,
      blocked: state.block,
    },
    startedFrom: await startedFrom(ctx, l.opp),
  };
}
