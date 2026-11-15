// SPDX-License-Identifier: AGPL-3.0-only
// The open data port in the browser (mock mode): Riverbend's awards as fixtures, with the server's
// rule for what goes out (apps/api/src/services/open-data.ts) and the same settings checks. The
// downloads are built from the fixtures in the 360Giving and CommonGrants shapes.
import { ApiError } from "../api/client.ts";
import { fileNameFor, type OpenDataApi, type OpenDataAwardRow, type OpenDataFormat, type OpenDataRange, type OpenDataReason, type OpenDataSettings, type OpenDataSummary } from "../api/openData.ts";

const REASONS: Record<OpenDataReason, string> = {
  not_accepted: "Not accepted yet",
  cancelled: "Cancelled",
  individual: "Awarded to an individual",
  no_organization: "Recipient is not a linked organization",
  confidential: "Marked confidential",
  no_amount: "No amount awarded",
};
const ORDER: OpenDataReason[] = ["not_accepted", "cancelled", "individual", "no_organization", "confidential", "no_amount"];
const PREFIX = /^360G-[A-Za-z0-9](?:[A-Za-z0-9_-]{0,58}[A-Za-z0-9])?$/;
const REGISTER_URL = "https://www.360giving.org/publish/guidance/plan/register/";
const LICENSE = { name: "Creative Commons Attribution 4.0 International (CC BY 4.0)", url: "https://creativecommons.org/licenses/by/4.0/" };

interface Fixture {
  id: string;
  title: string;
  recipient: string;
  amount: string;
  awardDate: string;
  status: string;
  /** Why the rule leaves it out regardless of the confidential mark. */
  base: Exclude<OpenDataReason, "confidential"> | null;
  /** Verified with Passport and shared with Riverbend. */
  verified: boolean;
}

const fx = (n: number, title: string, recipient: string, amount: string, awardDate: string, status: string, base: Fixture["base"], verified: boolean): Fixture => ({ id: `awd_7a000000-0000-4000-8000-${String(n).padStart(12, "0")}`, title, recipient, amount, awardDate, status, base, verified });

export interface OpenDataStore {
  handle: string;
  funderName: string;
  awards: Fixture[];
  settings: OpenDataSettings;
  confidential: Set<string>;
  /** Published opportunities by publish date, for the CommonGrants count. */
  opportunities: { id: string; title: string; publishedOn: string }[];
}

export function seedOpenDataStore(): OpenDataStore {
  return {
    handle: "riverbend",
    funderName: "Riverbend Community Foundation",
    awards: [
      fx(1, "Community health navigators", "Alder Creek Family Services", "150000.00", "2027-03-12", "active", null, true),
      fx(2, "Rural clinic outreach", "Pine Ridge Clinic", "90000.00", "2027-02-20", "completed", null, true),
      fx(3, "Food pantry shelving", "Maple Hollow Food Bank", "25000.00", "2027-01-28", "accepted", null, false),
      fx(4, "Youth mentoring circles", "Cedar Row Youth", "40000.00", "2027-03-02", "suspended", null, false),
      fx(5, "Mobile health van", "Valley Transit Health", "60000.00", "2027-04-01", "offered", "not_accepted", false),
      fx(6, "Artist residency", "An individual", "8000.00", "2027-02-11", "active", "individual", false),
      fx(7, "Housing repairs pilot", "Riverbend Housing Alliance", "50000.00", "2027-01-15", "cancelled", "cancelled", true),
      fx(8, "Board-designated grant", "Harbor Light Shelter", "30000.00", "2027-03-20", "active", null, true),
      fx(9, "Clinic expansion", "Pine Ridge Clinic", "120000.00", "2026-06-15", "completed", null, true),
      fx(10, "2019 legacy grant", "Not linked to an organization", "15000.00", "2026-01-10", "completed", "no_organization", false),
    ],
    settings: { threeSixtyGivingPrefix: null, publishFeed: false },
    confidential: new Set(["awd_7a000000-0000-4000-8000-000000000008"]),
    opportunities: [{ id: "7b000000-0000-4000-8000-000000000001", title: "Community Health Grants 2027", publishedOn: "2027-01-05" }],
  };
}

const within = (day: string, r: OpenDataRange) => (!r.from || day >= r.from) && (!r.to || day <= r.to);

function rowsOf(store: OpenDataStore, range: OpenDataRange): OpenDataAwardRow[] {
  return store.awards
    .filter((a) => within(a.awardDate, range))
    .sort((x, y) => x.awardDate.localeCompare(y.awardDate))
    .map((a) => {
      const confidential = store.confidential.has(a.id);
      const reason: OpenDataReason | null = a.base === "not_accepted" || a.base === "cancelled" || a.base === "individual" || a.base === "no_organization" ? a.base : confidential ? "confidential" : a.base;
      return { awardId: a.id, title: a.title, recipientName: a.recipient, awardedAmount: { amount: a.amount, currency: "USD" }, awardDate: a.awardDate, status: a.status, exported: reason === null, reason, reasonLabel: reason ? REASONS[reason] : null, nameOnly: reason === null && !a.verified, confidential };
    });
}

const feedUrl = (store: OpenDataStore) => (store.settings.publishFeed && store.settings.threeSixtyGivingPrefix ? `https://gms.opengrants.io/gms/open-data/${store.handle}/360giving.json` : null);

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function createMockOpenDataApi(store: OpenDataStore): OpenDataApi {
  const summary = async (range: OpenDataRange): Promise<OpenDataSummary> => {
    const rows = rowsOf(store, range);
    const exported = rows.filter((r) => r.exported);
    return {
      range,
      years: [...new Set(store.awards.map((a) => Number(a.awardDate.slice(0, 4))))].sort((x, y) => y - x),
      settings: { ...store.settings },
      draft: !store.settings.threeSixtyGivingPrefix,
      registerUrl: REGISTER_URL,
      feedUrl: feedUrl(store),
      license: LICENSE,
      counts: { inRange: rows.length, exported: exported.length, leftOut: rows.length - exported.length, nameOnly: exported.filter((r) => r.nameOnly).length },
      leftOut: ORDER.map((reason) => ({ reason, label: REASONS[reason], count: rows.filter((r) => r.reason === reason).length })).filter((r) => r.count > 0),
      commonGrants: { opportunities: store.opportunities.filter((o) => within(o.publishedOn, range)).length, awards: exported.length },
      awards: rows,
      awardsShown: rows.length,
    };
  };
  return {
    summary,
    async download(format: OpenDataFormat, range, hint = false) {
      const s = await summary(range);
      const rows = s.awards.filter((r) => r.exported);
      if (format === "commongrants-json" ? !rows.length && !s.commonGrants.opportunities : !rows.length) throw new ApiError(409, "No awards in this period can be exported as open data. The summary says why each one is left out");
      const prefix = store.settings.threeSixtyGivingPrefix ?? `DRAFT-${store.handle}`;
      const grants = rows.map((r) => ({ id: `${prefix}-${r.awardId.slice(4)}`, title: r.title, description: r.title, currency: "USD", amountAwarded: Number(r.awardedAmount?.amount ?? 0), awardDate: r.awardDate, recipientOrganization: [{ id: `${prefix}-${r.awardId.slice(-12)}`, name: r.recipientName }], fundingOrganization: [{ id: "US-EIN-38-1234567", name: store.funderName }] }));
      const filename = fileNameFor(format, store.handle, range, hint || s.draft);
      if (format === "360giving-csv") {
        const header = ["Identifier", "Title", "Description", "Currency", "Amount Awarded", "Award Date", "Recipient Org:Identifier", "Recipient Org:Name", "Funding Org:Identifier", "Funding Org:Name"];
        const body = [header, ...grants.map((g) => [g.id, g.title, g.description, g.currency, g.amountAwarded, g.awardDate, g.recipientOrganization[0]!.id, g.recipientOrganization[0]!.name, g.fundingOrganization[0]!.id, g.fundingOrganization[0]!.name])].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
        return { filename, blob: new Blob([body], { type: "text/csv;charset=utf-8" }) };
      }
      const body =
        format === "commongrants-json"
          ? { commonGrants: "0.5.0", generatedAt: new Date().toISOString(), range, opportunities: store.opportunities.filter((o) => within(o.publishedOn, range)).map((o) => ({ id: o.id, title: o.title })), awards: rows.map((r) => ({ id: r.awardId.slice(4), title: r.title, funding: { awardedAmount: r.awardedAmount } })) }
          : { version: "1.4", title: `${s.draft ? "DRAFT: " : ""}${store.funderName} grants`, license: LICENSE.url, publisher: { name: store.funderName, identifier: "US-EIN-38-1234567" }, grants };
      return { filename, blob: new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }) };
    },
    async saveSettings(patch) {
      const next = { ...store.settings, ...patch };
      if (next.threeSixtyGivingPrefix !== null && !PREFIX.test(next.threeSixtyGivingPrefix)) throw new ApiError(400, "The request body is not valid", [{ code: "invalid_field", field: "threeSixtyGivingPrefix", detail: "A 360Giving prefix starts with 360G- followed by letters, numbers, hyphens or underscores, e.g. 360G-riverbend" }]);
      if (next.publishFeed && !next.threeSixtyGivingPrefix) throw new ApiError(409, store.settings.publishFeed ? "Turn off “Publish my awards as open data” before removing the 360Giving prefix" : "Add your registered 360Giving prefix before publishing your awards as open data");
      store.settings = next;
      return { ...store.settings, feedUrl: feedUrl(store) };
    },
    async setConfidential(awardId, confidential) {
      if (!store.awards.some((a) => a.id === awardId)) throw new ApiError(404, "Award not found");
      if (confidential) store.confidential.add(awardId);
      else store.confidential.delete(awardId);
      return { awardId, confidential };
    },
  };
}
