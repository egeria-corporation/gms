// SPDX-License-Identifier: AGPL-3.0-only
// What a shared link and a search engine see for the public pages: the title, description,
// canonical address, Open Graph and Twitter tags, schema.org JSON-LD, the share card's text and
// robots.txt. Built only from the public page data (`/gms/public/funders/...`, an approved template
// gallery item at `/gms/gallery/{slug}`) and the switch pages' own text, the same published fields
// the pages show, so nothing private can reach a preview. Since v1.9.0 also the grants a funder has
// awarded and lists (`/f/{handle}/awards`, each award's page) and the "Funded by" badge
// (`/badge/{slug}.svg`), whose data the API gives only for awards that may be public.
//
// Languages (docs/i18n.md): a page asked for with `?lang=es` gets its title, description and image
// text in Spanish, `<html lang="es">`, and every public page lists its English and Spanish addresses
// (`hreflang`, with English as x-default). What the funder wrote stays as written.
import { DEFAULT_LOCALE, INTL_LOCALE, LOCALES, LOCALE_QUERY, type Key, type Locale, type Values } from "@gms/i18n";
import { seoFor, switchEntry } from "../content/switch.ts";
import { translate } from "../i18n/current.ts";
import { daysUntil, formatAwardRange, formatDateAs, formatMoney } from "../lib/format.ts";
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

/** A fixed sentence of the page meta in a language (public catalog, `meta.*`). */
const m = (locale: Locale, key: Key<"public">, values?: Values) => translate("public", key, values, locale);
const formatDate = (iso: string | null | undefined, locale: Locale) => formatDateAs(iso, "short", locale);

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
/** A listed award (apps/api/src/services/award-sharing.ts `PublicAward`). */
export interface PublicAwardData {
  slug: string;
  recipient: { name: string };
  purpose: string;
  program: string | null;
  year: number;
  awardDate: string;
  /** Null when the funder hides amounts. */
  amount: Money | null;
}
export interface FunderAwardsPageData {
  funder: PublicFunder;
  awards: PublicAwardData[];
}
export interface AwardPageData {
  funder: PublicFunder;
  award: PublicAwardData;
}

// ---- routes ----
export type PageRoute = { kind: "funder"; handle: string } | { kind: "opportunity"; handle: string; slug: string } | { kind: "awards"; handle: string } | { kind: "award"; handle: string; slug: string };
/** The pages that have their own share image: the landing page, the funder pages and the award pages. */
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

/** The grants-awarded page (`/f/{handle}/awards`) or one award's page (`/f/{handle}/awards/{slug}`). */
function awardRoute(handle: string | undefined, slug: string | undefined): PageRoute | null {
  if (!handle || !SEGMENT.test(handle) || (slug !== undefined && !SEGMENT.test(slug))) return null;
  return slug === undefined ? { kind: "awards", handle } : { kind: "award", handle, slug };
}

/** The public page a path shows, if it is one: `/`, `/f/{handle}`, `/f/{handle}/o/{slug}`, `/f/{handle}/awards[/{slug}]`, `/switch[/{system}]` or `/templates[/{slug}]`. */
export function routeOf(pathname: string): PublicRoute | null {
  if (pathname === "/") return { kind: "landing" };
  const sw = /^\/switch(?:\/([^/]+))?\/?$/.exec(pathname);
  if (sw) return sw[1] === undefined ? { kind: "switch", system: null } : switchEntry(sw[1]) ? { kind: "switch", system: sw[1] } : null;
  const tpl = /^\/templates(?:\/([^/]+))?\/?$/.exec(pathname);
  if (tpl) return tpl[1] === undefined ? { kind: "templates" } : SEGMENT.test(tpl[1]) ? { kind: "template", slug: tpl[1] } : null;
  const awards = /^\/f\/([^/]+)\/awards(?:\/([^/]+))?\/?$/.exec(pathname);
  if (awards) return awardRoute(awards[1], awards[2]);
  const m = /^\/f\/([^/]+)(?:\/o\/([^/]+))?\/?$/.exec(pathname);
  return m ? pageRoute(m[1], m[2]) : null;
}

/** The page whose share image a path asks for: `/og/home.png`, `/og/f/{handle}.png`, `/og/f/{handle}/o/{slug}.png`, `/og/f/{handle}/awards.png` or `/og/f/{handle}/awards/{slug}.png`. */
export function imageRouteOf(pathname: string): ImageRoute | null {
  if (pathname === "/og/home.png") return { kind: "landing" };
  const awards = /^\/og\/f\/([^/]+?)\/awards(?:\/([^/]+?))?\.png$/.exec(pathname);
  if (awards) return awardRoute(awards[1], awards[2]);
  const m = /^\/og\/f\/([^/]+?)(?:\/o\/([^/]+?))?\.png$/.exec(pathname);
  return m ? pageRoute(m[1], m[2]) : null;
}

/** The award slug a badge path names: `/badge/{slug}.svg`. */
export function badgeRouteOf(pathname: string): string | null {
  const m = /^\/badge\/([^/]+)\.svg$/.exec(pathname);
  return m && SEGMENT.test(m[1]!) ? m[1]! : null;
}
export const badgeApiPathOf = (slug: string) => `/gms/public/badges/${slug}.svg`;

export function pagePathOf(r: PageRoute): string {
  switch (r.kind) {
    case "funder":
      return `/f/${r.handle}`;
    case "opportunity":
      return `/f/${r.handle}/o/${r.slug}`;
    case "awards":
      return `/f/${r.handle}/awards`;
    case "award":
      return `/f/${r.handle}/awards/${r.slug}`;
  }
}
export function apiPathOf(r: PageRoute): string {
  switch (r.kind) {
    case "funder":
      return `/gms/public/funders/${r.handle}`;
    case "opportunity":
      return `/gms/public/funders/${r.handle}/opportunities/${r.slug}`;
    case "awards":
      return `/gms/public/funders/${r.handle}/awards`;
    case "award":
      return `/gms/public/funders/${r.handle}/awards/${r.slug}`;
  }
}
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
export function opportunityStatus(o: PublicCard, now: Date = new Date(), locale: Locale = DEFAULT_LOCALE): StatusText {
  if (o.status === "closed") return { label: m(locale, "meta.status.closed"), sentence: m(locale, "meta.status.closedSentence"), tone: "closed" };
  if (o.status === "forecasted") {
    const opens = o.keyDates?.postDate?.date;
    return opens ? { label: m(locale, "meta.status.opens", { date: formatDate(opens, locale) }), sentence: m(locale, "meta.status.opensSentence", { date: formatDate(opens, locale) }), tone: "upcoming" } : { label: m(locale, "meta.status.forecasted"), sentence: m(locale, "meta.status.forecastedSentence"), tone: "upcoming" };
  }
  if (!accepting(o)) return { label: m(locale, "meta.status.notYet"), sentence: m(locale, "meta.status.notYetSentence"), tone: "neutral" };
  const close = o.keyDates?.closeDate?.date;
  const days = daysUntil(close, now);
  if (close && days !== null && days >= 0) return { label: m(locale, "meta.status.applyBy", { date: formatDate(close, locale) }), sentence: m(locale, "meta.status.applyBySentence", { date: formatDate(close, locale) }), tone: "open" };
  return { label: m(locale, "meta.status.open"), sentence: m(locale, "meta.status.openSentence"), tone: "open" };
}

function funderSummary(d: FunderPageData, locale: Locale = DEFAULT_LOCALE): { sentence: string; label: string; tone: Tone } {
  const open = d.opportunities.filter(accepting).length;
  const forecasted = d.opportunities.filter((o) => o.status === "forecasted").length;
  const closed = d.opportunities.filter((o) => o.status === "closed").length;
  if (locale !== DEFAULT_LOCALE) {
    const parts = [open && m(locale, "meta.funder.open", { count: open }), forecasted && m(locale, "meta.funder.forecasted", { count: forecasted }), closed && m(locale, "meta.funder.closed", { count: closed })].filter((p): p is string => !!p);
    return { sentence: parts.length ? m(locale, "meta.funder.summary", { parts: parts.join(", ") }) : m(locale, "meta.funder.none"), label: "", tone: open ? "open" : forecasted ? "upcoming" : "neutral" };
  }
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

/** "{Funder} awarded {Recipient} a grant": the award card's title and the award page's heading. */
export const awardHeadline = (d: AwardPageData) => `${cleanText(d.funder.name)} awarded ${cleanText(d.award.recipient.name)} a grant`;

export function awardsCard(d: FunderAwardsPageData, site: string): CardText {
  const n = d.awards.length;
  return { site, eyebrow: "Grants awarded by", title: d.funder.name, detail: d.funder.mission ?? null, status: n ? { label: plural(n, "grant listed", "grants listed"), tone: "open" } : { label: "No grants listed yet", tone: "neutral" }, note: isVerified(d.funder) ? null : NOT_VERIFIED };
}

/** The award's share card: who awarded whom, what for, the amount if shown, the year. Never a logo. */
export function awardCard(d: AwardPageData, site: string): CardText {
  const a = d.award;
  return { site, eyebrow: "Grant awarded", title: awardHeadline(d), detail: a.purpose, amount: a.amount ? formatMoney(a.amount) : null, status: { label: `Awarded ${a.year}`, tone: "neutral" }, note: isVerified(d.funder) ? null : NOT_VERIFIED };
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
  /** The language the text is in (English when absent); every public page lists both languages' addresses. */
  locale?: Locale;
}

/** A page's address in a language: English is the address itself, another language adds `?lang=`. */
export const localizedUrl = (url: string, locale: Locale): string => {
  const u = new URL(url);
  if (locale === DEFAULT_LOCALE) u.searchParams.delete(LOCALE_QUERY);
  else u.searchParams.set(LOCALE_QUERY, locale);
  return u.toString();
};
const OG_LOCALE = (locale: Locale) => INTL_LOCALE[locale].replace("-", "_");

export function landingMeta(origin: string, locale: Locale = DEFAULT_LOCALE): PageMeta {
  const description = m(locale, "meta.defaultDescription");
  return {
    title: m(locale, "meta.defaultTitle"),
    description,
    url: `${origin}/`,
    image: `${origin}${imagePathOf({ kind: "landing" })}?v=${cardVersion(landingCard(new URL(origin).host))}`,
    imageAlt: `${SITE_NAME}: ${m(locale, "meta.landingCardTitle")}`,
    jsonLd: [{ "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: `${origin}/`, description, inLanguage: locale }],
    locale,
  };
}

/** The landing page's card, for pages that have no card of their own. */
const landingImage = (origin: string) => `${origin}${imagePathOf({ kind: "landing" })}?v=${cardVersion(landingCard(new URL(origin).host))}`;

/** `/switch` and `/switch/{system}`: the text the switch pages give for crawlers (content/switch.ts `seoFor`). */
export function switchMeta(system: string | null, origin: string, locale: Locale = DEFAULT_LOCALE): PageMeta | null {
  const entry = system === null ? null : switchEntry(system);
  if (system !== null && !entry) return null;
  const seo = seoFor(entry ?? null, locale);
  const url = `${origin}/switch${entry ? `/${entry.slug}` : ""}`;
  return {
    title: seo.title,
    description: clip(seo.description, 320),
    ogTitle: seo.ogTitle,
    ogDescription: clip(seo.ogDescription, 320),
    url,
    image: landingImage(origin),
    imageAlt: `${SITE_NAME}: ${m(locale, "meta.landingCardTitle")}`,
    jsonLd: [{ "@context": "https://schema.org", "@type": "WebPage", name: seo.title, description: clip(seo.description, 500), url, inLanguage: locale, isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${origin}/` } }],
    locale,
  };
}

export const TEMPLATES_TITLE = "Template gallery \u2014 OpenGrants GMS";
export const TEMPLATES_DESCRIPTION = "Free, ready-to-use grant application forms, rubrics, report forms and email templates. Copy one into your workspace and start in minutes.";
const CC_BY = "https://creativecommons.org/licenses/by/4.0/";

/** `/templates`: the template gallery. */
export function templatesMeta(origin: string, locale: Locale = DEFAULT_LOCALE): PageMeta {
  const url = `${origin}/templates`;
  const title = m(locale, "gallery.templateGalleryOpengrantsGms");
  const description = m(locale, "gallery.freeReadyToUseGrant");
  return {
    title,
    description,
    url,
    image: landingImage(origin),
    imageAlt: `${SITE_NAME}: ${m(locale, "meta.landingCardTitle")}`,
    jsonLd: [{ "@context": "https://schema.org", "@type": "CollectionPage", name: title, description, url, license: CC_BY, inLanguage: locale }],
    locale,
  };
}

/** `/templates/{slug}`: one approved gallery item, from its public data. */
export function templateMeta(item: GalleryItemData, origin: string, locale: Locale = DEFAULT_LOCALE): PageMeta {
  const url = `${origin}/templates/${item.slug}`;
  const galleryTitle = m(locale, "gallery.templateGalleryOpengrantsGms");
  const title = `${cleanText(item.title)} \u2014 ${galleryTitle}`;
  const description = clip(item.summary);
  return {
    title,
    description,
    url,
    image: landingImage(origin),
    imageAlt: `${SITE_NAME}: ${cleanText(item.title)}`,
    jsonLd: [{ "@context": "https://schema.org", "@type": "CreativeWork", name: cleanText(item.title), description: clip(item.summary, 500), url, license: CC_BY, isAccessibleForFree: true, isPartOf: { "@type": "CollectionPage", name: galleryTitle, url: `${origin}/templates` } }],
    locale,
  };
}

/** The funder as a schema.org Organization. A funder not verified with Passport gets no `url`: its website is its own word. */
const organization = (f: PublicFunder) => ({ "@type": "Organization", name: f.name, ...(isVerified(f) && f.website ? { url: f.website } : {}) });

export function funderMeta(d: FunderPageData, origin: string, locale: Locale = DEFAULT_LOCALE): PageMeta {
  const route: PageRoute = { kind: "funder", handle: d.funder.handle };
  const url = `${origin}${pagePathOf(route)}`;
  const card = funderCard(d, new URL(origin).host);
  const summary = funderSummary(d, locale).sentence;
  const title = m(locale, "meta.funder.title", { name: cleanText(d.funder.name) });
  return {
    title,
    description: clip(`${summary} ${d.funder.mission ?? ""}`),
    url,
    image: `${origin}${imagePathOf(route)}?v=${cardVersion(card)}`,
    imageAlt: `${title}: ${summary}`,
    jsonLd: [{ "@context": "https://schema.org", ...organization(d.funder), ...(d.funder.mission ? { description: clip(d.funder.mission, 500) } : {}), mainEntityOfPage: url }],
    locale,
  };
}

export function opportunityMeta(d: OpportunityPageData, origin: string, now: Date = new Date(), locale: Locale = DEFAULT_LOCALE): PageMeta {
  const o = d.opportunity;
  const route: PageRoute = { kind: "opportunity", handle: d.funder.handle, slug: o.slug };
  const url = `${origin}${pagePathOf(route)}`;
  const status = opportunityStatus(o, now, locale);
  const amount = locale === DEFAULT_LOCALE ? amountOf(o) : formatAwardRange(o.funding ?? null, locale) === "\u2014" ? null : formatAwardRange(o.funding ?? null, locale);
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
    description: clip([status.sentence, amount ? awardsSentence(o, amount, locale) : "", o.description].filter(Boolean).join(" ")),
    url,
    image,
    imageAlt: [cleanText(o.title), cleanText(d.funder.name), amount, status.label].filter(Boolean).join(". "),
    jsonLd: [grant, breadcrumbs],
    locale,
  };
}

/** "Awards of $5,000 – $10,000." / "Awards up to $10,000." / "Awards from $5,000.", in a language. */
function awardsSentence(o: PublicCard, amount: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return `Awards ${/^(Up to|From) /.test(amount) ? amount.charAt(0).toLowerCase() + amount.slice(1) : `of ${amount}`}.`;
  const min = o.funding?.minAwardAmount;
  const max = o.funding?.maxAwardAmount;
  if (min && max) return m(locale, "meta.awards.range", { range: amount });
  if (max) return m(locale, "meta.awards.upTo", { max: formatMoney(max, locale) });
  return m(locale, "meta.awards.from", { min: formatMoney(min, locale) });
}

/** Most awards named in the grants-awarded page's schema.org list. */
const AWARDS_IN_LIST = 100;

export function awardsMeta(d: FunderAwardsPageData, origin: string, locale: Locale = DEFAULT_LOCALE): PageMeta {
  const route: PageRoute = { kind: "awards", handle: d.funder.handle };
  const url = `${origin}${pagePathOf(route)}`;
  const card = awardsCard(d, new URL(origin).host);
  const name = cleanText(d.funder.name);
  const years = d.awards.map((a) => a.year).filter(Number.isFinite);
  const n = d.awards.length;
  const [first, last] = [Math.min(...years), Math.max(...years)];
  const summary = !n
    ? m(locale, "meta.awards.none")
    : !years.length
      ? m(locale, "meta.awards.count", { count: n })
      : first === last
        ? m(locale, "meta.awards.countYear", { count: n, year: String(first) })
        : m(locale, "meta.awards.countYears", { count: n, from: String(first), to: String(last) });
  const title = m(locale, "meta.awards.title", { name });
  return {
    title,
    description: clip(`${summary} ${d.funder.mission ?? ""}`),
    url,
    image: `${origin}${imagePathOf(route)}?v=${cardVersion(card)}`,
    imageAlt: `${title}: ${summary}`,
    locale,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: title,
        url,
        numberOfItems: d.awards.length,
        itemListElement: d.awards.slice(0, AWARDS_IN_LIST).map((a, i) => ({ "@type": "ListItem", position: i + 1, name: awardHeadline({ funder: d.funder, award: a }), url: `${origin}${pagePathOf({ kind: "award", handle: d.funder.handle, slug: a.slug })}` })),
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name, item: `${origin}${pagePathOf({ kind: "funder", handle: d.funder.handle })}` },
          { "@type": "ListItem", position: 2, name: m(locale, "meta.awards.crumb"), item: url },
        ],
      },
    ],
  };
}

export function awardMeta(d: AwardPageData, origin: string, locale: Locale = DEFAULT_LOCALE): PageMeta {
  const a = d.award;
  const route: PageRoute = { kind: "award", handle: d.funder.handle, slug: a.slug };
  const url = `${origin}${pagePathOf(route)}`;
  const card = awardCard(d, new URL(origin).host);
  const image = `${origin}${imagePathOf(route)}?v=${cardVersion(card)}`;
  const headline = locale === DEFAULT_LOCALE ? awardHeadline(d) : m(locale, "meta.award.headline", { funder: cleanText(d.funder.name), recipient: cleanText(a.recipient.name) });
  const amount = a.amount ? formatMoney(a.amount, locale) : null;
  const value = a.amount && Number.isFinite(Number(a.amount.amount)) ? Number(a.amount.amount) : undefined;
  const description = clip(
    locale === DEFAULT_LOCALE
      ? `${amount ? `A ${amount} grant` : "A grant"} awarded in ${a.year}${a.program ? ` through ${a.program}` : ""}, for \u201c${a.purpose}\u201d.`
      : m(locale, a.program ? (amount ? "meta.award.amountProgram" : "meta.award.program") : amount ? "meta.award.amount" : "meta.award.plain", { amount: amount ?? "", year: String(a.year), program: a.program ?? "", purpose: a.purpose }),
  );
  // schema.org has no "recipient" for a grant: what a grant funds is its `fundedItem`, here the organization.
  const grant: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "MonetaryGrant",
    name: headline,
    description,
    url,
    image,
    funder: organization(d.funder),
    fundedItem: { "@type": "Organization", name: cleanText(a.recipient.name) },
    ...(a.amount && value !== undefined ? { amount: { "@type": "MonetaryAmount", currency: a.amount.currency, value } } : {}),
  };
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: cleanText(d.funder.name), item: `${origin}${pagePathOf({ kind: "funder", handle: d.funder.handle })}` },
      { "@type": "ListItem", position: 2, name: m(locale, "meta.awards.crumb"), item: `${origin}${pagePathOf({ kind: "awards", handle: d.funder.handle })}` },
      { "@type": "ListItem", position: 3, name: cleanText(a.recipient.name), item: url },
    ],
  };
  return { title: headline, description, url, image, imageAlt: [headline, amount, cleanText(a.purpose)].filter(Boolean).join(". "), jsonLd: [grant, breadcrumbs], locale };
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
  const locale = m.locale ?? DEFAULT_LOCALE;
  const own = localizedUrl(m.url, locale);
  return [
    meta("name", "description", m.description),
    `<link rel="canonical" href="${attr(own)}" />`,
    ...LOCALES.map((l) => `<link rel="alternate" hreflang="${l}" href="${attr(localizedUrl(m.url, l))}" />`),
    `<link rel="alternate" hreflang="x-default" href="${attr(localizedUrl(m.url, DEFAULT_LOCALE))}" />`,
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", SITE_NAME),
    meta("property", "og:locale", OG_LOCALE(locale)),
    ...LOCALES.filter((l) => l !== locale).map((l) => meta("property", "og:locale:alternate", OG_LOCALE(l))),
    meta("property", "og:title", m.ogTitle ?? m.title),
    meta("property", "og:description", m.ogDescription ?? m.description),
    meta("property", "og:url", own),
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
