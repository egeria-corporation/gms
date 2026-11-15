// SPDX-License-Identifier: AGPL-3.0-only
// The award sharing port in the browser (VITE_USE_MOCKS=true), with the server's rules: an award is
// public only when it is not confidential, went to an organization, is accepted or later, the funder
// lists awards (off until turned on) and the grantee did not opt out. The fixture award is the
// Riverbend award to Alder Creek Family Services, under its id in the funder's screens and in the
// grantee's; nothing here is ever posted anywhere.
import { ApiError } from "../api/client.ts";
import type { AwardListingSettings, AwardNotListedReason, AwardPublicPage, AwardShareKit, AwardSharing, AwardSharingApi, FunderAwardsPage, PublicAward, ShareSide } from "../api/awardSharing.ts";
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
}
export interface AwardSharingStore {
  awards: MockShareAward[];
  settings: Record<string, { listAwards: boolean; showAmounts: boolean }>;
  programs: Record<string, { id: string; name: string; awardsConfidential: boolean }[]>;
}

export function seedAwardSharingStore(): AwardSharingStore {
  return {
    awards: [
      { ids: [MOCK_IDS.award, "awd_a0000000-0000-7000-8000-000000000001"], funder: "riverbend", recipient: "Alder Creek Family Services", individual: false, purpose: "Mobile Health Navigation for Rural Families", program: "Community Health 2027", awardDate: "2027-05-18", amount: { amount: "150000.00", currency: "USD" }, status: "accepted", confidential: false, recipientUnlisted: false, token: "7k2m9x4qp1ad" },
      { ids: ["awd_a0000000-0000-7000-8000-000000000002"], funder: "cascade-county", recipient: "Alder Creek Family Services", individual: false, purpose: "Clinic Navigation Pilot", program: null, awardDate: "2026-07-01", amount: { amount: "40000.00", currency: "USD" }, status: "active", confidential: false, recipientUnlisted: false, token: "3d8f2c6b9e1a" },
    ],
    settings: { riverbend: { listAwards: false, showAmounts: true }, "cascade-county": { listAwards: false, showAmounts: true } },
    programs: {
      riverbend: [
        { id: IDS.programHealth26, name: "Community Health 2026", awardsConfidential: false },
        { id: IDS.programHealth27, name: "Community Health 2027", awardsConfidential: false },
      ],
    },
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
    return { posts, links: { page, awards, image: award.links.image, badge: award.links.badge }, badge: { verified, text, svg, snippet: `<a href="${attr(page)}"><img src="${attr(award.links.badge)}" alt="${attr(verified ? `Funded by ${f.name}, verified` : `Funded by ${f.name}`)}" width="${width}" height="20"></a>` }, award };
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
  };
}
