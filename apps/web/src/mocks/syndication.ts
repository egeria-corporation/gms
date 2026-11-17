// SPDX-License-Identifier: AGPL-3.0-only
// The "Share this call" port in the browser (VITE_USE_MOCKS=true), with the server's rules: a call
// is in the feeds while published, its page on, open or forecasted and not taken out; PND takes it
// until four weeks before its deadline; a person who edits calls previews and sends, once per call.
// Nothing leaves the browser: a send is recorded in the store.
import { ApiError } from "../api/client.ts";
import type { PndBlock, PndFieldKey, PndPreview, PndSent, Syndication, SyndicationApi } from "../api/syndication.ts";
import type { Opportunity } from "../api/types.ts";
import type { Session } from "../auth/types.ts";

export interface SyndicationStore {
  /** Calls taken out of the feeds. */
  feedsOff: Set<string>;
  /** Calls sent to PND: what was sent and when. */
  sent: Map<string, { sentAt: string; email: PndPreview }>;
  startedFrom: Map<string, { feed: number; pnd: number }>;
  /** Off to show a server that cannot send email. */
  mailConfigured: boolean;
  now: () => Date;
}

export function seedSyndicationStore(): SyndicationStore {
  return { feedsOff: new Set(), sent: new Map(), startedFrom: new Map(), mailConfigured: true, now: () => new Date() };
}

export interface MockSyndicationOptions {
  session: () => Promise<Session | null>;
  store: SyndicationStore;
  workspace: () => { id: string; handle: string; name: string; role: string } | null;
  getOpportunity: (id: string) => Promise<Opportunity>;
}

const PND = { name: "Philanthropy News Digest", address: "pndrfp@candid.org", sourceUrl: "https://philanthropynewsdigest.org/rfps", leadDays: 28 } as const;
const ROLES = ["admin", "program_officer"];
const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const longDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const usd = (m: { amount: string; currency: string } | undefined) => (m ? new Intl.NumberFormat("en-US", { style: "currency", currency: m.currency, maximumFractionDigits: 0 }).format(Number(m.amount)) : null);
const fail = (status: number, code: string, message: string) => new ApiError(status, message, [{ code, detail: message }]);

type RuleLike = { all?: RuleLike[]; any?: RuleLike[]; label?: string };
function labels(rule: RuleLike | null | undefined): string[] {
  if (!rule) return [];
  if (rule.all) return rule.all.flatMap(labels);
  if (rule.any) return [rule.any.flatMap(labels).join(" or ")].filter(Boolean);
  return rule.label ? [rule.label] : [];
}

const TYPE_WORDS: Record<string, string> = {
  non_profit_with_501c3: "501(c)(3) nonprofits",
  nonprofit_without_501c3: "Nonprofits without 501(c)(3) status",
  organization: "Organizations",
  individual: "Individuals",
  government_municipal: "Local governments",
  government_tribal: "Tribal governments",
  unrestricted: "Any applicant",
};

export function createMockSyndicationApi(opts: MockSyndicationOptions): SyndicationApi {
  const { store } = opts;
  const origin = () => (typeof window === "undefined" ? "http://localhost" : window.location.origin);
  const today = () => store.now().toISOString().slice(0, 10);

  async function load(id: string) {
    const s = await opts.session();
    if (!s) throw new ApiError(401, "Sign in to continue");
    const w = opts.workspace();
    if (!w) throw new ApiError(403, "Name a workspace for this action");
    const o = await opts.getOpportunity(id);
    return { s, w, o };
  }
  const listed = (o: Opportunity) => o.published && o.publish.publicPage !== false;
  const deadlineOf = (o: Opportunity) => {
    const d = day(o.keyDates.closeDate?.date);
    return d && d >= today() ? d : null;
  };
  function block(o: Opportunity, role: string): PndBlock | null {
    const deadline = deadlineOf(o);
    if (store.sent.has(o.id)) return "sent";
    if (!listed(o)) return "not_listed";
    if (o.status === "closed") return "closed";
    if (deadline && today() > addDays(deadline, -PND.leadDays)) return "too_late";
    if (!ROLES.includes(role)) return "role";
    if (!store.mailConfigured) return "mail_not_configured";
    return null;
  }
  function view(o: Opportunity, w: { handle: string; role: string }): Syndication {
    const feeds = `${origin()}/gms/public/feeds/opportunities`;
    const deadline = deadlineOf(o);
    const sent = store.sent.get(o.id);
    const b = block(o, w.role);
    const masked = (e: string) => `${e.slice(0, 1)}…${e.slice(e.lastIndexOf("@"))}`;
    return {
      opportunityId: o.id,
      feeds: { on: !store.feedsOff.has(o.id), listed: listed(o) && !store.feedsOff.has(o.id) && o.status !== "closed", urls: { json: `${feeds}.json?funder=${w.handle}`, csv: `${feeds}.csv?funder=${w.handle}`, rss: `${feeds}.rss?funder=${w.handle}` }, allUrl: `${feeds}.rss` },
      openGrants: { on: o.publish.openGrantsIndex !== false, inFeed: listed(o) && o.publish.openGrantsIndex !== false, feedUrl: `${origin()}/gms/public/feeds/opengrants.json`, pulling: false },
      pnd: { ...PND, earliestDeadline: deadline, sendBy: deadline ? addDays(deadline, -PND.leadDays) : null, sent: sent ? { sentAt: sent.sentAt, replyTo: masked(sent.email.replyTo) } : null, canSend: b === null, blocked: b },
      startedFrom: store.startedFrom.get(o.id) ?? { feed: 0, pnd: 0 },
    };
  }
  function compose(o: Opportunity, w: { handle: string; name: string }, replyTo: string): PndPreview {
    const link = `${origin()}/f/${w.handle}/o/${o.slug}?utm_source=pnd`;
    const f = o.funding;
    const min = usd(f.minAwardAmount);
    const max = usd(f.maxAwardAmount);
    const funding = [min && max ? `Grants of ${min} to ${max}.` : max ? `Grants of up to ${max}.` : min ? `Grants of ${min} or more.` : null, usd(f.totalAmountAvailable) ? `${usd(f.totalAmountAvailable)} available in all.` : null].filter(Boolean).join(" ");
    const types = o.acceptedApplicantTypes.map((t) => TYPE_WORDS[t]).filter(Boolean);
    const dated = [o.keyDates.postDate, o.keyDates.closeDate, ...Object.values(o.keyDates.otherDates ?? {})].flatMap((e) => (e?.name && day(e.date) ? [{ d: day(e.date)!, line: `${e.name}: ${longDate(day(e.date)!)}` }] : [])).sort((a, b) => a.d.localeCompare(b.d));
    const value: Record<PndFieldKey, string> = {
      funder: w.name,
      title: o.title,
      scope: [o.description.trim(), funding].filter(Boolean).join("\n\n"),
      qualifications: [types.length ? `Open to: ${types.join(", ")}.` : null, ...labels(o.eligibilityRules as RuleLike).map((l) => `- ${l}`)].filter(Boolean).join("\n") || "See the eligibility section of the full RFP.",
      instructions: `Read the full guidelines and apply online at ${link}`,
      deadlines: dated.length ? dated.map((x) => x.line).join("\n") : "Applications are accepted all year; there is no fixed deadline.",
      link,
      contact: replyTo,
    };
    const LABEL: Record<PndFieldKey, string> = { funder: "Funder", title: "Opportunity", scope: "Program scope", qualifications: "Grantee qualifications", instructions: "Application instructions", deadlines: "Deadlines", link: "Full RFP", contact: "Contact" };
    const fields = (Object.keys(LABEL) as PndFieldKey[]).map((key) => ({ key, label: LABEL[key], value: value[key] }));
    const intro = `Hello. ${w.name} would like this funding opportunity considered for the RFP listings of Philanthropy News Digest. The details are below, and the full guidelines are at the link.`;
    const text = [intro, ...fields.map((x) => `${x.label}:\n${x.value}`), `--\nSent from OpenGrants GMS on behalf of ${w.name}. Replies go to ${replyTo}.`].join("\n\n");
    const deadline = deadlineOf(o);
    return { from: `"${w.name}" <notices@gms.opengrants.io>`, to: PND.address, replyTo, subject: `RFP for Philanthropy News Digest: ${o.title} (${w.name})`, text, html: text, fields, digest: `mock-${o.id}-${o.updatedAt}`, earliestDeadline: deadline, sendBy: deadline ? addDays(deadline, -PND.leadDays) : null, sourceUrl: PND.sourceUrl };
  }
  async function forSend(id: string) {
    const { s, w, o } = await load(id);
    const b = block(o, w.role);
    const refusal: Record<PndBlock, [number, string, string]> = {
      sent: [409, "pnd_already_sent", "This call was already sent to Philanthropy News Digest. Each call is sent once"],
      sending: [409, "pnd_sending", "This call is being sent to Philanthropy News Digest. Look again in a minute"],
      not_listed: [409, "pnd_not_listed", "Publish this call with its public page on before sending it to Philanthropy News Digest"],
      closed: [409, "pnd_call_closed", "This call is closed, so Philanthropy News Digest would not list it"],
      too_late: [409, "pnd_too_late", "Philanthropy News Digest needs a call four weeks before its earliest deadline, and that date has passed"],
      role: [403, "insufficient_role", "This needs one of these roles: admin, program_officer"],
      person_only: [403, "human_only", "Sending a call to Philanthropy News Digest is done by a signed-in person in the GMS"],
      mail_not_configured: [503, "mail_not_configured", "This server cannot send email"],
      no_reply_to: [422, "pnd_no_reply_to", "Add a public contact email in Settings, Public page"],
    };
    if (b) throw fail(...refusal[b]);
    return { w, o, email: compose(o, w, s.email) };
  }

  return {
    async get(id) {
      const { w, o } = await load(id);
      return view(o, w);
    },
    async setFeeds(id, feeds) {
      const { w, o } = await load(id);
      if (!ROLES.includes(w.role)) throw fail(403, "insufficient_scope", "This action needs the opportunities:write scope");
      if (feeds) store.feedsOff.delete(o.id);
      else store.feedsOff.add(o.id);
      return view(o, w);
    },
    async previewPnd(id) {
      return (await forSend(id)).email;
    },
    async sendPnd(id, digest): Promise<PndSent> {
      const { o, email } = await forSend(id);
      if (digest !== email.digest) throw fail(409, "preview_changed", "The call changed since the preview. Look at the preview again before sending");
      const sentAt = store.now().toISOString();
      store.sent.set(o.id, { sentAt, email });
      return { sent: true, sentAt, to: email.to, replyTo: email.replyTo };
    },
  };
}
