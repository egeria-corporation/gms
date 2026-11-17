// SPDX-License-Identifier: AGPL-3.0-only
// What a shared link and a search engine see for the public pages: the title, description,
// canonical address, Open Graph and Twitter tags, schema.org JSON-LD, the share card's text and
// robots.txt. Built only from the public page data (`/gms/public/funders/...`, an approved template
// gallery item at `/gms/gallery/{slug}`) and the switch pages' own text, the same published fields
// the pages show, so nothing private can reach a preview.
import { seoFor, switchEntry } from "../content/switch.ts";
import { daysUntil, formatAwardRange, formatDate } from "../lib/format.ts";
import type { CardText, Tone } from "./og/card.ts";
import { cleanText } from "./og/raster.ts";

export const SITE_NAME = "OpenGrants GMS";
export const DEFAULT_TITLE = "OpenGrants GMS: free grants management for funders and grantees";
export const DEFAULT_DESCRIPTION = "Run grant programs, apply for grants and manage awards in one free, open-source system. Sign up with your email.";
/**
 * The default share card in index.html (apps/web/public/brand/og-preview.png, drawn by
 * scripts/render-default-share-card.ts). The front Worker gives the landing page a card with the
 * instance's own address instead.
 */
export const DEFAULT_IMAGE = "/brand/og-preview.png";
export const IMAGE_WIDTH = 1200;
export const IMAGE_HEIGHT = 627;
export const LANDING_CARD = { eyebrow: SITE_NAME, title: "Run grant programs, apply for grants and manage awards.", detail: "One free, open-source system. Sign up with your email." } as const;

/** Longest description sent; previews show about the first 160 characters. */
const DESCRIPTION_MAX = 200;
const NOT_VERIFIED = "Not verified with OpenGrants Passport";

// ---- the public page data this reads (apps/api/src/services/public.ts) ----
interface Money {
  amount: string;
  currency: string;
}
interface PublicEvent {
  name?: string;
  date?: string;
}
export interface PublicCard {
  slug: string;
  title: string;
  description: string;
  status: string;
  funding?: { minAwardAmount?: Money; maxAwardAmount?: Money; details?: string } | null;
  keyDates?: { postDate?: PublicEvent; closeDate?: PublicEvent } | null;
  acceptingApplications?: boolean;
}
export interface PublicFunder {
  handle: string;
  name: string;
  mission?: string | null;
  website?: string | null;
  verificationLevel?: string | null;
  verification?: { source?: string } | null;
}
export interface FunderPageData {
  funder: PublicFunder;
  opportunities: PublicCard[];
}
export interface OpportunityPageData {
  funder: PublicFunder;
  opportunity: PublicCard;
  competitions?: { status: string }[];
}
/** An approved template gallery item (apps/api/src/services/gallery.ts, `GET /gms/gallery/{slug}`). */
export interface GalleryItemData {
  slug: string;
  title: string;
  summary: string;
}

// ---- routes ----
export type PageRoute = { kind: "funder"; handle: string } | { kind: "opportunity"; handle: string; slug: string };
/** The pages that have their own share image: the landing page and the funder pages. */
export type ImageRoute = { kind: "landing" } | PageRoute;
/** The switch pages (`/switch`, `/switch/{system}`) and the template gallery (`/templates`, `/templates/{slug}`). */
export type ContentRoute = { kind: "switch"; system: string | null } | { kind: "templates" } | { kind: "template"; slug: string };
export type PublicRoute = ImageRoute | ContentRoute;

/** Handles and slugs are lowercase letters, digits and hyphens; anything else is not looked up. */
const SEGMENT = /^[a-z0-9][a-z0-9-]{0,127}$/;

function pageRoute(handle: string | undefined, slug: string | undefined): PageRoute | null {
  if (!handle || !SEGMENT.test(handle) || (slug !== undefined && !SEGMENT.test(slug))) return null;
  return slug === undefined ? { kind: "funder", handle } : { kind: "opportunity", handle, slug };
}

/** The public page a path shows, if it is one: `/`, `/f/{handle}`, `/f/{handle}/o/{slug}`, `/switch[/{system}]` or `/templates[/{slug}]`. */
export function routeOf(pathname: string): PublicRoute | null {
  if (pathname === "/") return { kind: "landing" };
  const sw = /^\/switch(?:\/([^/]+))?\/?$/.exec(pathname);
  if (sw) return sw[1] === undefined ? { kind: "switch", system: null } : switchEntry(sw[1]) ? { kind: "switch", system: sw[1] } : null;
  const tpl = /^\/templates(?:\/([^/]+))?\/?$/.exec(pathname);
  if (tpl) return tpl[1] === undefined ? { kind: "templates" } : SEGMENT.test(tpl[1]) ? { kind: "template", slug: tpl[1] } : null;
  const m = /^\/f\/([^/]+)(?:\/o\/([^/]+))?\/?$/.exec(pathname);
  return m ? pageRoute(m[1], m[2]) : null;
}

/** The page whose share image a path asks for: `/og/home.png`, `/og/f/{handle}.png` or `/og/f/{handle}/o/{slug}.png`. */
export function imageRouteOf(pathname: string): ImageRoute | null {
  if (pathname === "/og/home.png") return { kind: "landing" };
  const m = /^\/og\/f\/([^/]+?)(?:\/o\/([^/]+?))?\.png$/.exec(pathname);
  return m ? pageRoute(m[1], m[2]) : null;
}

export const pagePathOf = (r: PageRoute) => (r.kind === "funder" ? `/f/${r.handle}` : `/f/${r.handle}/o/${r.slug}`);
export const apiPathOf = (r: PageRoute) => (r.kind === "funder" ? `/gms/public/funders/${r.handle}` : `/gms/public/funders/${r.handle}/opportunities/${r.slug}`);
export const imagePathOf = (r: ImageRoute) => (r.kind === "landing" ? "/og/home.png" : `/og${pagePathOf(r)}.png`);
/** Where a template gallery item's public data is read. */
export const galleryApiPathOf = (slug: string) => `/gms/gallery/${slug}`;

// ---- words ----
const clip = (text: string | null | undefined, max = DESCRIPTION_MAX): string => {
  const t = cleanText(text ?? "");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:\u2013-]+$/, "")}\u2026`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const isVerified = (f: PublicFunder) => (f.verification ? f.verification.source === "passport" : !!f.verificationLevel);
const accepting = (o: PublicCard) => o.acceptingApplications ?? o.status === "open";

/** An award range in words, or null when the opportunity gives none. */
export function amountOf(o: PublicCard): string | null {
  const range = formatAwardRange(o.funding ?? null);
  return range === "\u2014" ? null : range;
}

export interface StatusText {
  /** Short, for the card's label. */
  label: string;
  /** A sentence for the description. */
  sentence: string;
  tone: Tone;
}

/** Where an opportunity stands, in words. Closed and forecasted calls say so. */
export function opportunityStatus(o: PublicCard, now: Date = new Date()): StatusText {
  if (o.status === "closed") return { label: "Closed", sentence: "Closed to applications.", tone: "closed" };
  if (o.status === "forecasted") {
    const opens = o.keyDates?.postDate?.date;
    return opens ? { label: `Opens ${formatDate(opens)}`, sentence: `Forecasted to open ${formatDate(opens)}.`, tone: "upcoming" } : { label: "Forecasted", sentence: "Forecasted, not open yet.", tone: "upcoming" };
  }
  if (!accepting(o)) return { label: "Not taking applications yet", sentence: "Not taking applications yet.", tone: "neutral" };
  const close = o.keyDates?.closeDate?.date;
  const days = daysUntil(close, now);
  if (close && days !== null && days >= 0) return { label: `Apply by ${formatDate(close)}`, sentence: `Open for applications until ${formatDate(close)}.`, tone: "open" };
  return { label: "Open for applications", sentence: "Open for applications.", tone: "open" };
}

function funderSummary(d: FunderPageData): { sentence: string; label: string; tone: Tone } {
  const open = d.opportunities.filter(accepting).length;
  const forecasted = d.opportunities.filter((o) => o.status === "forecasted").length;
  const closed = d.opportunities.filter((o) => o.status === "closed").length;
  const parts = [open && `${plural(open, "call", "calls")} open for applications`, forecasted && `${forecasted} forecasted`, closed && `${closed} closed`].filter((p): p is string => !!p);
  const sentence = parts.length ? `${parts.join(", ")}.` : "No calls published yet.";
  if (open) return { sentence, label: plural(open, "open call", "open calls"), tone: "open" };
  if (forecasted) return { sentence, label: `${forecasted} coming up`, tone: "upcoming" };
  return { sentence, label: "No open calls right now", tone: "neutral" };
}

// ---- share cards ----
export const landingCard = (site: string): CardText => ({ site, ...LANDING_CARD });

export function funderCard(d: FunderPageData, site: string): CardText {
  const s = funderSummary(d);
  return { site, eyebrow: "Grants from", title: d.funder.name, detail: d.funder.mission ?? null, status: { label: s.label, tone: s.tone }, note: isVerified(d.funder) ? null : NOT_VERIFIED };
}

export function opportunityCard(d: OpportunityPageData, site: string, now: Date = new Date()): CardText {
  const s = opportunityStatus(d.opportunity, now);
  return { site, eyebrow: d.funder.name, title: d.opportunity.title, amount: amountOf(d.opportunity), status: { label: s.label, tone: s.tone }, note: isVerified(d.funder) ? null : NOT_VERIFIED };
}

/** A short hash of a card's text, so its image address changes when what it shows does. */
export function cardVersion(card: CardText): string {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(card)) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// ---- page meta ----
export interface PageMeta {
  title: string;
  description: string;
  /** Open Graph and Twitter text, where it differs from the title and description. */
  ogTitle?: string;
  ogDescription?: string;
  /** The canonical address. */
  url: string;
  image: string;
  imageAlt: string;
  /** schema.org nodes, each with its own @context. */
  jsonLd: Record<string, unknown>[];
}

export function landingMeta(origin: string): PageMeta {
  return {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: `${origin}/`,
    image: `${origin}${imagePathOf({ kind: "landing" })}?v=${cardVersion(landingCard(new URL(origin).host))}`,
    imageAlt: `${SITE_NAME}: ${LANDING_CARD.title}`,
    jsonLd: [{ "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: `${origin}/`, description: DEFAULT_DESCRIPTION }],
  };
}

/** The landing page's card, for pages that have no card of their own. */
const landingImage = (origin: string) => `${origin}${imagePathOf({ kind: "landing" })}?v=${cardVersion(landingCard(new URL(origin).host))}`;

/** `/switch` and `/switch/{system}`: the text the switch pages give for crawlers (content/switch.ts `seoFor`). */
export function switchMeta(system: string | null, origin: string): PageMeta | null {
  const entry = system === null ? null : switchEntry(system);
  if (system !== null && !entry) return null;
  const seo = seoFor(entry ?? null);
  const url = `${origin}/switch${entry ? `/${entry.slug}` : ""}`;
  return {
    title: seo.title,
    description: clip(seo.description, 320),
    ogTitle: seo.ogTitle,
    ogDescription: clip(seo.ogDescription, 320),
    url,
    image: landingImage(origin),
    imageAlt: `${SITE_NAME}: ${LANDING_CARD.title}`,
    jsonLd: [{ "@context": "https://schema.org", "@type": "WebPage", name: seo.title, description: clip(seo.description, 500), url, isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${origin}/` } }],
  };
}

export const TEMPLATES_TITLE = "Template gallery \u2014 OpenGrants GMS";
export const TEMPLATES_DESCRIPTION = "Free, ready-to-use grant application forms, rubrics, report forms and email templates. Copy one into your workspace and start in minutes.";
const CC_BY = "https://creativecommons.org/licenses/by/4.0/";

/** `/templates`: the template gallery. */
export function templatesMeta(origin: string): PageMeta {
  const url = `${origin}/templates`;
  return {
    title: TEMPLATES_TITLE,
    description: TEMPLATES_DESCRIPTION,
    url,
    image: landingImage(origin),
    imageAlt: `${SITE_NAME}: ${LANDING_CARD.title}`,
    jsonLd: [{ "@context": "https://schema.org", "@type": "CollectionPage", name: TEMPLATES_TITLE, description: TEMPLATES_DESCRIPTION, url, license: CC_BY }],
  };
}

/** `/templates/{slug}`: one approved gallery item, from its public data. */
export function templateMeta(item: GalleryItemData, origin: string): PageMeta {
  const url = `${origin}/templates/${item.slug}`;
  const title = `${cleanText(item.title)} \u2014 ${TEMPLATES_TITLE}`;
  const description = clip(item.summary);
  return {
    title,
    description,
    url,
    image: landingImage(origin),
    imageAlt: `${SITE_NAME}: ${cleanText(item.title)}`,
    jsonLd: [{ "@context": "https://schema.org", "@type": "CreativeWork", name: cleanText(item.title), description: clip(item.summary, 500), url, license: CC_BY, isAccessibleForFree: true, isPartOf: { "@type": "CollectionPage", name: TEMPLATES_TITLE, url: `${origin}/templates` } }],
  };
}

/** The funder as a schema.org Organization. A funder not verified with Passport gets no `url`: its website is its own word. */
const organization = (f: PublicFunder) => ({ "@type": "Organization", name: f.name, ...(isVerified(f) && f.website ? { url: f.website } : {}) });

export function funderMeta(d: FunderPageData, origin: string): PageMeta {
  const route: PageRoute = { kind: "funder", handle: d.funder.handle };
  const url = `${origin}${pagePathOf(route)}`;
  const card = funderCard(d, new URL(origin).host);
  const summary = funderSummary(d).sentence;
  return {
    title: `Grants from ${cleanText(d.funder.name)}`,
    description: clip(`${summary} ${d.funder.mission ?? ""}`),
    url,
    image: `${origin}${imagePathOf(route)}?v=${cardVersion(card)}`,
    imageAlt: `Grants from ${cleanText(d.funder.name)}: ${summary}`,
    jsonLd: [{ "@context": "https://schema.org", ...organization(d.funder), ...(d.funder.mission ? { description: clip(d.funder.mission, 500) } : {}), mainEntityOfPage: url }],
  };
}

export function opportunityMeta(d: OpportunityPageData, origin: string, now: Date = new Date()): PageMeta {
  const o = d.opportunity;
  const route: PageRoute = { kind: "opportunity", handle: d.funder.handle, slug: o.slug };
  const url = `${origin}${pagePathOf(route)}`;
  const status = opportunityStatus(o, now);
  const amount = amountOf(o);
  const card = opportunityCard(d, new URL(origin).host, now);
  const image = `${origin}${imagePathOf(route)}?v=${cardVersion(card)}`;
  const min = o.funding?.minAwardAmount;
  const max = o.funding?.maxAwardAmount;
  const currency = max?.currency ?? min?.currency;
  const value = (m: Money | undefined) => (m && m.currency === currency && Number.isFinite(Number(m.amount)) ? Number(m.amount) : undefined);
  const [minValue, maxValue] = [value(min), value(max)];
  const grant: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "MonetaryGrant",
    name: cleanText(o.title),
    description: clip(o.description, 500),
    url,
    image,
    funder: organization(d.funder),
    ...(currency && (minValue !== undefined || maxValue !== undefined) ? { amount: { "@type": "MonetaryAmount", currency, ...(minValue !== undefined ? { minValue } : {}), ...(maxValue !== undefined ? { maxValue } : {}) } } : {}),
  };
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: cleanText(d.funder.name), item: `${origin}${pagePathOf({ kind: "funder", handle: d.funder.handle })}` },
      { "@type": "ListItem", position: 2, name: cleanText(o.title), item: url },
    ],
  };
  return {
    title: `${cleanText(o.title)} | ${cleanText(d.funder.name)}`,
    description: clip([status.sentence, amount ? `Awards ${/^(Up to|From) /.test(amount) ? amount.charAt(0).toLowerCase() + amount.slice(1) : `of ${amount}`}.` : "", o.description].filter(Boolean).join(" ")),
    url,
    image,
    imageAlt: [cleanText(o.title), cleanText(d.funder.name), amount, status.label].filter(Boolean).join(". "),
    jsonLd: [grant, breadcrumbs],
  };
}

// ---- HTML ----
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** JSON that is safe inside a <script> element: no `<`, `>` or `&` can end it or open a comment. */
export const scriptJson = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

/** The tags that go at the end of <head>, replacing the defaults (the title is set separately). */
export function headTags(m: PageMeta): string {
  const meta = (key: "name" | "property", k: string, v: string) => `<meta ${key}="${k}" content="${attr(v)}" />`;
  return [
    meta("name", "description", m.description),
    `<link rel="canonical" href="${attr(m.url)}" />`,
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", SITE_NAME),
    meta("property", "og:title", m.ogTitle ?? m.title),
    meta("property", "og:description", m.ogDescription ?? m.description),
    meta("property", "og:url", m.url),
    meta("property", "og:image", m.image),
    meta("property", "og:image:width", String(IMAGE_WIDTH)),
    meta("property", "og:image:height", String(IMAGE_HEIGHT)),
    meta("property", "og:image:alt", m.imageAlt),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", m.ogTitle ?? m.title),
    meta("name", "twitter:description", m.ogDescription ?? m.description),
    meta("name", "twitter:image", m.image),
    meta("name", "twitter:image:alt", m.imageAlt),
    `<script type="application/ld+json">${scriptJson(m.jsonLd.length === 1 ? m.jsonLd[0] : m.jsonLd)}</script>`,
  ].join("\n    ");
}

// ---- robots.txt ----
/** The app's own screens and its API: not for search engines. The public data the pages load stays open. */
export const ROBOTS_DISALLOW = ["/w/", "/gms/", "/signin", "/onboarding", "/auth/", "/oauth/", "/consent", "/workspaces", "/account", "/notifications", "/invitations/", "/awards/claim", "/apply/", "/review/", "/embed/", "/mcp", "/gallery/"] as const;

export function robotsTxt(origin: string): string {
  return [
    `# ${SITE_NAME}: funder, opportunity, switch and template gallery pages are public; the app and its API are not.`,
    "User-agent: *",
    "Allow: /",
    // The public pages load their data from here; crawlers that render them need it.
    "Allow: /gms/public/",
    ...ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`),
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}
