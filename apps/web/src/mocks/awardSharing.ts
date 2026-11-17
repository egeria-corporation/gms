// SPDX-License-Identifier: AGPL-3.0-only
// The award sharing port in the browser (VITE_USE_MOCKS=true), with the server's rules: an award is
// public only when it is not confidential, went to an organization, is accepted or later, the funder
// lists awards (off until turned on) and the grantee did not opt out. The fixture award is the
// Riverbend award to Alder Creek Family Services, under its id in the funder's screens and in the
// grantee's; nothing here is ever posted anywhere.
import { ApiError } from "../api/client.ts";
import type { AwardFederalFunding, AwardListingSettings, AwardNotListedReason, AwardPublicPage, AwardShareKit, AwardSharing, AwardSharingApi, FunderAwardsPage, PublicAward, ShareKitProfile, ShareSide, SocialTag } from "../api/awardSharing.ts";
import type { FunderPageData } from "../api/types.ts";
import { MOCK_IDS } from "./funder.ts";
import { IDS } from "./store.ts";

type Money = { amount: string; currency: string };
type PublicFunder = FunderPageData["funder"];

export interface MockShareAward {
  /** The award's ids: the funder's screens and the grantee's use different fixture ids for the same award. */
  ids: string[];
  funder: string;
  recipient: string;
  individual: boolean;
  purpose: string;
  program: string | null;
  awardDate: string;
  amount: Money;
  status: string;
  confidential: boolean;
  recipientUnlisted: boolean;
  token: string;
  /** The grantee's workspace handle, for its share-kit settings. */
  recipientHandle: string;
  /** The federal share, as the funder entered it (v1.12.0). */
  federal: { funded: boolean; amount: string | null; percent: number | null; source: string | null };
}
/** A workspace's share-kit settings (v1.12.0), by workspace handle. */
export interface MockShareProfile {
  pageUrl: string | null;
  tagConsent: boolean;
  consentedAt: string | null;
  creditWording: "funded_by" | "supported_by";
  standardDescription: string | null;
}
export interface AwardSharingStore {
  awards: MockShareAward[];
  settings: Record<string, { listAwards: boolean; showAmounts: boolean }>;
  programs: Record<string, { id: string; name: string; awardsConfidential: boolean }[]>;
  profiles: Record<string, MockShareProfile>;
}

export function seedAwardSharingStore(): AwardSharingStore {
  return {
    awards: [
      { ids: [MOCK_IDS.award, "awd_a0000000-0000-7000-8000-000000000001"], funder: "riverbend", recipient: "Alder Creek Family Services", individual: false, purpose: "Mobile Health Navigation for Rural Families", program: "Community Health 2027", awardDate: "2027-05-18", amount: { amount: "150000.00", currency: "USD" }, status: "accepted", confidential: false, recipientUnlisted: false, token: "7k2m9x4qp1ad", recipientHandle: "alder-creek", federal: { funded: false, amount: null, percent: null, source: null } },
      { ids: ["awd_a0000000-0000-7000-8000-000000000002"], funder: "cascade-county", recipient: "Alder Creek Family Services", individual: false, purpose: "Clinic Navigation Pilot", program: null, awardDate: "2026-07-01", amount: { amount: "40000.00", currency: "USD" }, status: "active", confidential: false, recipientUnlisted: false, token: "3d8f2c6b9e1a", recipientHandle: "alder-creek", federal: { funded: false, amount: null, percent: null, source: null } },
    ],
    settings: { riverbend: { listAwards: false, showAmounts: true }, "cascade-county": { listAwards: false, showAmounts: true } },
    programs: {
      riverbend: [
        { id: IDS.programHealth26, name: "Community Health 2026", awardsConfidential: false },
        { id: IDS.programHealth27, name: "Community Health 2027", awardsConfidential: false },
      ],
    },
    profiles: {},
  };
}

type Current = { id: string; kind: "funder" | "applicant"; handle: string; role: string } | null;
export interface MockAwardSharingOptions {
  store: AwardSharingStore;
  workspace: () => Current;
  /** The funder's public record, as its public page gives it. */
  funder: (handle: string) => Promise<PublicFunder>;
}

const LISTABLE = ["accepted", "active", "completed"];
const FUNDER_CHANGE_ROLES = ["admin", "program_officer"];
const nameSlug = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const usd = (m: Money) => new Intl.NumberFormat("en-US", { style: "currency", currency: m.currency, maximumFractionDigits: 0 }).format(Number(m.amount));
const aGrant = (amount: string | null) => (amount ? `${/^\D*(8|11\b|18\b)/.test(amount.replace(/,/g, " ")) ? "an" : "a"} ${amount} grant` : "a grant");
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = xml;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A small stand-in for the API's badge (services/award-sharing.ts `badgeSvg`), drawn the same way. */
function badgeSvg(funder: string, verified: boolean): string {
  const right = `${funder}${verified ? " · verified" : ""}`;
  const lw = 74;
  const rw = Math.ceil(right.length * 6.6) + 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="20" role="img" aria-label="${xml(`Funded by ${funder}${verified ? ", verified" : ""}`)}"><rect width="${lw}" height="20" rx="3" fill="#0D2A43"/><rect x="${lw}" width="${rw}" height="20" fill="#145450"/><g fill="#FFFFFF" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle"><text x="${lw / 2}" y="14">Funded by</text><text x="${lw + rw / 2}" y="14">${xml(right)}</text></g></svg>`;
}


// ---- the kit, plus (v1.12.0): the same words as services/award-sharing.ts, in English

const PAGE_HOSTS: Record<string, SocialTag["platform"]> = { "linkedin.com": "linkedin", "facebook.com": "facebook", "instagram.com": "instagram", "x.com": "x", "twitter.com": "x", "bsky.app": "bluesky", "threads.net": "threads", "threads.com": "threads" };
/** An organization's page from a link, as the API reads it; null for anything else. */
export function socialPageOf(raw: string | null | undefined): { url: string; platform: SocialTag["platform"]; handle: string } | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  const platform = PAGE_HOSTS[host];
  if (!platform) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  let name: string | undefined;
  let path: string;
  if (platform === "linkedin") {
    if (!["company", "school", "showcase"].includes(parts[0] ?? "")) return null;
    name = parts[1];
    path = `${parts[0]}/${name}`;
  } else if (platform === "bluesky") {
    if (parts[0] !== "profile") return null;
    name = parts[1];
    path = `profile/${name}`;
  } else {
    name = parts[0]?.replace(/^@/, "");
    path = platform === "threads" ? `@${name}` : `${name}`;
  }
  if (!name || !/^[A-Za-z0-9._-]{1,100}$/.test(name) || (platform !== "linkedin" && platform !== "bluesky" && parts.length > 1)) return null;
  const canonical = platform === "x" ? "x.com" : platform === "bluesky" ? "bsky.app" : platform === "threads" ? "www.threads.net" : `www.${host}`;
  return { url: `https://${canonical}/${path}`, platform, handle: `@${name}` };
}

const NO_PROFILE: MockShareProfile = { pageUrl: null, tagConsent: false, consentedAt: null, creditWording: "funded_by", standardDescription: null };
const profileOf = (s: AwardSharingStore, handle: string): MockShareProfile => s.profiles[handle] ?? NO_PROFILE;
const tagFor = (p: MockShareProfile, name: string): SocialTag | null => {
  const page = p.tagConsent ? socialPageOf(p.pageUrl) : null;
  return page ? { ...page, name } : null;
};
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const usdIn = (amount: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(Number(amount)) ? 0 : 2, maximumFractionDigits: Number.isInteger(Number(amount)) ? 0 : 2 }).format(Number(amount));

/** The statement of the federal share of costs: only with both numbers (the Stevens Amendment). */
export function mockFederalStatement(f: MockShareAward["federal"]): string | null {
  if (!f.funded || f.amount === null || f.percent === null) return null;
  const amount = usdIn(f.amount);
  const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(f.percent);
  return f.source
    ? `This project is supported by ${f.source} as part of a financial assistance award totaling ${amount}, with ${percent} percent of the project's total costs funded by ${f.source}. The contents are those of the authors and do not necessarily represent the official views of, nor an endorsement by, ${f.source} or the U.S. Government.`
    : `This project is supported with federal funds as part of a financial assistance award totaling ${amount}, with ${percent} percent of the project's total costs funded with federal money. The contents are those of the authors and do not necessarily represent the official views of, nor an endorsement by, the U.S. Government.`;
}

/** A PDF of `pages` blank 1080 × 1350 pages, standing in for the carousel the API draws. */
function stubPdf(title: string, pages: number): Blob {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(" ")}] /Count ${pages} >>`, ...Array.from({ length: pages }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1080 1350] >>"), `<< /Title (${title.replace(/[()\\]/g, "")}) >>`];
  let out = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([out], { type: "application/pdf" });
}

/** "Meet our grantees" in mock mode: a program's awards that may be public, as the API lists them. */
export function mockMeetOurGrantees(s: AwardSharingStore, funderHandle: string, programId: string, origin: string): { program: { id: string; name: string }; grantees: { awardId: string; recipient: string; purpose: string; link: string; tag: SocialTag | null }[]; awardsPage: string } | null {
  const program = (s.programs[funderHandle] ?? []).find((p) => p.id === programId);
  if (!program) return null;
  const settings = s.settings[funderHandle] ?? { listAwards: false, showAmounts: true };
  const listed = s.awards.filter((a) => a.funder === funderHandle && a.program === program.name && !a.confidential && !a.individual && LISTABLE.includes(a.status) && settings.listAwards && !a.recipientUnlisted);
  return {
    program: { id: program.id, name: program.name },
    grantees: listed.slice(0, 10).map((a) => ({ awardId: a.ids[0]!, recipient: a.recipient, purpose: a.purpose, link: `${origin}/f/${a.funder}/awards/${nameSlug(a.recipient)}-${a.token}`, tag: tagFor(profileOf(s, a.recipientHandle), a.recipient) })),
    awardsPage: `${origin}/f/${funderHandle}/awards`,
  };
}

export function createMockAwardSharingApi(opts: MockAwardSharingOptions): AwardSharingApi {
  const s = opts.store;
  const fail = (status: number, message: string) => new ApiError(status, message);
  const web = () => (typeof window === "undefined" ? "https://gms.opengrants.io" : window.location.origin);
  const settingsOf = (handle: string) => (s.settings[handle] ??= { listAwards: false, showAmounts: true });

  function reasonOf(a: MockShareAward): AwardNotListedReason | null {
    if (a.confidential) return "confidential";
    if (a.individual) return "individual";
    if (!LISTABLE.includes(a.status)) return "not_accepted";
    if (!settingsOf(a.funder).listAwards) return "listing_off";
    if (a.recipientUnlisted) return "recipient_unlisted";
    return null;
  }
  function view(a: MockShareAward): PublicAward {
    const slug = `${nameSlug(a.recipient)}-${a.token}`;
    const base = web();
    return { slug, recipient: { name: a.recipient }, purpose: a.purpose, program: a.program, year: Number(a.awardDate.slice(0, 4)), awardDate: a.awardDate, amount: settingsOf(a.funder).showAmounts ? clone(a.amount) : null, links: { page: `${base}/f/${a.funder}/awards/${slug}`, image: `${base}/og/f/${a.funder}/awards/${slug}.png`, badge: `${base}/badge/${slug}.svg` } };
  }
  async function kitOf(a: MockShareAward, side: ShareSide): Promise<AwardShareKit> {
    const f = await opts.funder(a.funder);
    const award = view(a);
    const verified = f.verification ? f.verification.source === "passport" : !!f.verificationLevel;
    const grant = aGrant(award.amount ? usd(award.amount) : null);
    const its = a.program ? ` through its ${a.program} program` : "";
    const our = a.program ? ` through our ${a.program} program` : "";
    const awards = `${web()}/f/${a.funder}/awards`;
    const page = award.links.page;
    const text = `Funded by ${f.name}${verified ? " · verified" : ""}`;
    const svg = badgeSvg(f.name, verified);
    const posts =
      side === "grantee"
        ? { linkedin: `We are grateful to ${f.name} for ${grant}${its}. It funds our work on “${a.purpose}”.\n\nThank you to the ${f.name} team for backing this work.\n\n${page}`, short: `Thank you, ${f.name}, for ${grant} for “${a.purpose}”. ${page}`, newsletter: `${a.recipient} has received ${grant} from ${f.name}${its}. The grant funds “${a.purpose}”. We thank ${f.name} for its support. Read more: ${page}` }
        : { linkedin: `We are proud to support ${a.recipient} with ${grant}${our}. The grant funds “${a.purpose}”.\n\nCongratulations to the ${a.recipient} team.\n\n${page}`, short: `Congratulations to ${a.recipient} on ${grant} from ${f.name} for “${a.purpose}”. ${page}`, newsletter: `${f.name} has awarded ${a.recipient} ${grant}${its}. The grant funds “${a.purpose}”. See every grant we have awarded: ${awards}` };
    const width = /width="(\d+)"/.exec(svg)?.[1] ?? "200";
    // The extras, worded as the API words them in English.
    const fp = profileOf(s, a.funder);
    const credit = fp.creditWording === "supported_by" ? `Supported by ${f.name}` : `Funded by ${f.name}`;
    const federal = mockFederalStatement(a.federal);
    const amount = award.amount ? usd(award.amount) : null;
    const date = longDate(a.awardDate);
    const grantOf = amount ? `a grant of ${amount}` : "a grant";
    const through = a.program ? ` through its ${a.program} program` : "";
    const description = fp.standardDescription ?? f.mission ?? null;
    const press = [
      side === "funder" ? `${f.name} awards a grant to ${a.recipient}` : `${a.recipient} receives a grant from ${f.name}`,
      "FOR IMMEDIATE RELEASE",
      side === "funder" ? `${date}: ${f.name} has awarded ${a.recipient} ${grantOf}${through}. The grant funds “${a.purpose}”.` : `${date}: ${a.recipient} has received ${grantOf} from ${f.name}${through}. The grant funds “${a.purpose}”.`,
      fp.creditWording === "supported_by" ? `The project is supported by ${f.name}.` : `The project is funded by ${f.name}.`,
      "[Add a quote: “…,” said [name, title].]",
      ...(federal ? [federal] : []),
      `About ${f.name}`,
      description ?? `[Add a short description of ${f.name}.]`,
      `About ${a.recipient}`,
      `[Add a short description of ${a.recipient}.]`,
      "Media contact: [name, email address, phone]",
      `Read more: ${page}`,
    ].join("\n\n");
    const pages: { heading: string; body: string[] }[] = [
      { heading: `${f.name} awarded ${a.recipient} a grant`, body: [a.purpose] },
      { heading: a.purpose, body: [a.program ? `Through the ${a.program} program, awarded ${date}.` : `Awarded ${date}.`] },
      { heading: a.recipient, body: [`${a.recipient} received this grant from ${f.name}.`] },
      ...(amount ? [{ heading: amount, body: [`A grant from ${f.name} to ${a.recipient}.`] }] : []),
      { heading: f.name, body: [description ?? `${f.name} lists every grant it awards on its public page.`] },
      ...(federal ? [{ heading: "The federal share of costs", body: [federal] }] : []),
      { heading: side === "funder" ? `Congratulations to the ${a.recipient} team` : `Thank you, ${f.name}`, body: [credit] },
      { heading: "Read about this grant", body: [page, `Every grant ${f.name} has awarded: ${awards}`] },
    ];
    const id = a.ids.find((x) => (side === "funder" ? x === a.ids[0] : x !== a.ids[0])) ?? a.ids[0]!;
    return {
      posts,
      links: { page, awards, image: award.links.image, badge: award.links.badge },
      badge: { verified, text, svg, snippet: `<a href="${attr(page)}"><img src="${attr(award.links.badge)}" alt="${attr(verified ? `Funded by ${f.name}, verified` : `Funded by ${f.name}`)}" width="${width}" height="20"></a>` },
      award,
      creditLine: credit,
      pressRelease: press,
      federalStatement: federal,
      carousel: { pages: pages.map((p, i) => ({ heading: p.heading, alt: `Slide ${i + 1} of ${pages.length}: ${p.heading}. ${p.body.join(" ")}` })), path: side === "funder" ? `/gms/awards/${id}/sharing/carousel.pdf` : `/gms/my/awards/${id}/sharing/carousel.pdf`, fileName: `${award.slug}-carousel.pdf` },
      portrait: { funder: f.name, recipient: a.recipient, program: a.program, purpose: a.purpose, year: award.year, amount: award.amount, verified },
      tags: { funder: tagFor(fp, f.name), grantee: tagFor(profileOf(s, a.recipientHandle), a.recipient) },
    };
  }

  function federalView(a: MockShareAward, ws: NonNullable<Current>, side: ShareSide): AwardFederalFunding {
    return { ...a.federal, statement: mockFederalStatement(a.federal), canChange: side === "funder" && FUNDER_CHANGE_ROLES.includes(ws.role) };
  }
  function profileView(ws: NonNullable<Current>): ShareKitProfile {
    const p = profileOf(s, ws.handle);
    return { pageUrl: p.pageUrl, page: socialPageOf(p.pageUrl), tagConsent: p.tagConsent, consentedAt: p.consentedAt, creditWording: p.creditWording, standardDescription: p.standardDescription, canChange: ws.role === "admin" };
  }

  const current = () => {
    const ws = opts.workspace();
    if (!ws) throw fail(403, "Name a workspace for this action");
    return ws;
  };
  function sideAward(awardId: string, side: ShareSide): { a: MockShareAward; ws: NonNullable<Current> } {
    const ws = current();
    if ((side === "funder") !== (ws.kind === "funder")) throw fail(403, `This action belongs to ${side === "funder" ? "funder" : "applicant"} workspaces`);
    const a = s.awards.find((x) => x.ids.includes(awardId));
    if (!a || (side === "funder" && a.funder !== ws.handle)) throw fail(404, "Award not found");
    return { a, ws };
  }
  async function panel(awardId: string, side: ShareSide): Promise<AwardSharing> {
    const { a, ws } = sideAward(awardId, side);
    const reason = reasonOf(a);
    const settings = settingsOf(a.funder);
    return {
      listed: reason === null,
      reason,
      confidential: a.confidential,
      recipientUnlisted: a.recipientUnlisted,
      listingOn: settings.listAwards,
      amountsShown: settings.showAmounts,
      canChange: (side === "funder" ? FUNDER_CHANGE_ROLES : ["admin"]).includes(ws.role),
      awardsPage: settings.listAwards ? `${web()}/f/${a.funder}/awards` : null,
      kit: reason === null ? await kitOf(a, side) : null,
      federal: federalView(a, ws, side),
    };
  }
  function settingsView(handle: string): AwardListingSettings {
    const mine = s.awards.filter((a) => a.funder === handle && LISTABLE.includes(a.status));
    return { ...settingsOf(handle), awardsPage: `${web()}/f/${handle}/awards`, counts: { listed: mine.filter((a) => reasonOf(a) === null).length, confidential: mine.filter((a) => a.confidential).length, recipientUnlisted: mine.filter((a) => !a.confidential && a.recipientUnlisted).length }, programs: clone(s.programs[handle] ?? []) };
  }
  const funderWorkspace = (roles: string[]) => {
    const ws = current();
    if (ws.kind !== "funder") throw fail(403, "This action belongs to funder workspaces");
    if (!roles.includes(ws.role)) throw fail(403, `This needs one of these roles: ${roles.join(", ")}`);
    return ws;
  };

  return {
    async funderAwards(handle) {
      const funder = await opts.funder(handle);
      if (!settingsOf(handle).listAwards) throw fail(404, "Page not found");
      const awards = s.awards.filter((a) => a.funder === handle && reasonOf(a) === null).map(view).sort((x, y) => (x.awardDate < y.awardDate ? 1 : -1));
      const page: FunderAwardsPage = { funder: clone(funder) as FunderAwardsPage["funder"], awards, years: [...new Set(awards.map((a) => a.year))].sort((a, b) => b - a), programs: [...new Set(awards.map((a) => a.program).filter((p): p is string => !!p))].sort(), amountsShown: settingsOf(handle).showAmounts, links: { page: `${web()}/f/${handle}/awards`, funder: `${web()}/f/${handle}` } };
      return page;
    },
    async awardPage(handle, slug) {
      const token = slug.slice(slug.lastIndexOf("-") + 1);
      const a = s.awards.find((x) => x.token === token && x.funder === handle);
      if (!a || reasonOf(a) !== null) throw fail(404, "Page not found");
      const funder = await opts.funder(handle);
      const verified = funder.verification ? funder.verification.source === "passport" : !!funder.verificationLevel;
      const page: AwardPublicPage = { funder: clone(funder) as AwardPublicPage["funder"], award: view(a), verified, links: { awards: `${web()}/f/${handle}/awards` } };
      return page;
    },
    sharing: (awardId, side) => panel(awardId, side),
    async setConfidential(awardId, confidential) {
      const { a, ws } = sideAward(awardId, "funder");
      if (!FUNDER_CHANGE_ROLES.includes(ws.role)) throw fail(403, "This needs one of these roles: admin, program_officer");
      a.confidential = confidential;
      return panel(awardId, "funder");
    },
    async setUnlisted(awardId, unlisted) {
      const { a, ws } = sideAward(awardId, "grantee");
      if (ws.role !== "admin") throw fail(403, "This needs one of these roles: admin");
      a.recipientUnlisted = unlisted;
      return panel(awardId, "grantee");
    },
    async settings() {
      const ws = current();
      if (ws.kind !== "funder") throw fail(403, "This action belongs to funder workspaces");
      return settingsView(ws.handle);
    },
    async updateSettings(patch) {
      const ws = funderWorkspace(["admin"]);
      const now = settingsOf(ws.handle);
      s.settings[ws.handle] = { listAwards: patch.listAwards ?? now.listAwards, showAmounts: patch.showAmounts ?? now.showAmounts };
      return settingsView(ws.handle);
    },
    async setProgramDefault(programId, awardsConfidential) {
      const ws = funderWorkspace(FUNDER_CHANGE_ROLES);
      const p = (s.programs[ws.handle] ?? []).find((x) => x.id === programId);
      if (!p) throw fail(404, "Program not found");
      p.awardsConfidential = awardsConfidential;
      return settingsView(ws.handle);
    },
    async setFederalFunding(awardId, input) {
      const { a, ws } = sideAward(awardId, "funder");
      if (!FUNDER_CHANGE_ROLES.includes(ws.role)) throw fail(403, "This needs one of these roles: admin, program_officer");
      const amountOk = input.amount === undefined || input.amount === null || (/^\d{1,12}(\.\d{1,2})?$/.test(input.amount) && Number(input.amount) > 0);
      const percentOk = input.percent === undefined || input.percent === null || (input.percent > 0 && input.percent <= 100 && Math.abs(input.percent * 100 - Math.round(input.percent * 100)) < 1e-6);
      if (!amountOk || !percentOk) throw fail(400, "Check the federal amount and percentage");
      a.federal = input.federallyFunded
        ? { funded: true, amount: input.amount === undefined ? a.federal.amount : input.amount === null ? null : Number(input.amount).toFixed(2), percent: input.percent === undefined ? a.federal.percent : input.percent, source: input.source === undefined ? a.federal.source : input.source?.trim() || null }
        : { funded: false, amount: null, percent: null, source: null };
      return panel(awardId, "funder");
    },
    async carouselPdf(path) {
      const id = /^\/gms\/(?:my\/)?awards\/([^/]+)\/sharing\/carousel\.pdf$/.exec(path)?.[1];
      const side: ShareSide = path.startsWith("/gms/my/") ? "grantee" : "funder";
      const kit = id ? (await panel(id, side)).kit : null;
      if (!kit) throw fail(409, "This award is not listed publicly, so it has no carousel");
      return stubPdf(kit.carousel.pages[0]!.heading, kit.carousel.pages.length);
    },
    async shareProfile() {
      return profileView(current());
    },
    async updateShareProfile(patch) {
      const ws = current();
      if (ws.role !== "admin") throw fail(403, "This needs one of these roles: admin");
      if (ws.kind !== "funder" && (patch.creditWording !== undefined || patch.standardDescription !== undefined)) throw fail(422, "Only a funder sets the press release's credit wording and description");
      const before = profileOf(s, ws.handle);
      let pageUrl = patch.pageUrl === undefined ? before.pageUrl : patch.pageUrl || null;
      if (pageUrl !== null) {
        const page = socialPageOf(pageUrl);
        if (!page) throw fail(422, "Give the https address of your organization's page on LinkedIn, Facebook, Instagram, X, Bluesky or Threads");
        pageUrl = page.url;
      }
      const changed = pageUrl !== before.pageUrl;
      const consent = patch.tagConsent ?? (changed ? false : before.tagConsent);
      if (consent && !pageUrl) throw fail(422, "Give your page's link before you agree to be tagged");
      s.profiles[ws.handle] = {
        pageUrl,
        tagConsent: consent,
        consentedAt: consent ? (before.tagConsent && !changed ? before.consentedAt : new Date().toISOString()) : null,
        creditWording: patch.creditWording ?? before.creditWording,
        standardDescription: patch.standardDescription === undefined ? before.standardDescription : patch.standardDescription?.trim() || null,
      };
      return profileView(ws);
    },
  };
}
