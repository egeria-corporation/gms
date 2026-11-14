// SPDX-License-Identifier: AGPL-3.0-only
// Find funding: opportunities on this GMS (open ones with this organization's eligibility, and
// published ones not taking applications yet), the OpenGrants index searched with the Passport
// profile as context, and what the organization saved. "Start application" works on every
// listing: an opportunity open on this GMS starts the built-in application; anything else starts
// (or opens) an outside application the organization tracks itself.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Bookmark, CalendarClock, CircleCheck, CircleDashed, CircleX, ExternalLink, Info, Search, X } from "lucide-react";
import type { ApplicantApi, OpenGrantsListing, SavedListing } from "../../api/applicant.ts";
import { useApplicantApi, useApplicantMutation, useApplicantQuery } from "../../api/applicantHooks.ts";
import { isAccepting, type DiscoverItem, type ListingSnapshot, type OpenDiscoverItem, type OutsideApi, type OutsideListItem } from "../../api/outside.ts";
import { useOutsideApi, useOutsideMutation } from "../../api/outsideHooks.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { useAppConfig } from "../../api/launchHooks.ts";
import { forgetWanted, wantedFrom } from "../../lib/wantedOpportunity.ts";
import { ApiError } from "../../api/client.ts";
import type { OppFunding } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { accentOf, FunderChip, Loaded } from "../../components/applicant.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Notice, TabPanel, Tabs } from "../../components/ui.tsx";
import { formatAwardRange, formatDate } from "../../lib/format.ts";
import { FundingAlerts } from "./fundingAlerts.tsx";

type Tab = "here" | "index" | "saved" | "alerts";

const load = async (api: ApplicantApi, outside: OutsideApi) => {
  const [competitions, saved, mine] = await Promise.all([api.discover(), api.saved(), outside.list().catch(() => [] as OutsideListItem[])]);
  return { competitions, saved, mine };
};

/** Saved rows that are funding alerts belong on the Alerts tab, never under Saved. */
export const isAlertRow = (s: SavedListing) => (s.source as string) === "alert" || s.externalId.startsWith("alert:");

/** The outside application already started from an OpenGrants listing, if any. */
export const outsideFor = (mine: OutsideListItem[], l: OpenGrantsListing) =>
  mine.find((o) => o.sourceRef === l.id) ?? mine.find((o) => !o.sourceRef && o.title === l.title && (!l.funder || o.funderName === l.funder));

/** The opportunity on this GMS an OpenGrants listing points at. */
export const gmsItemFor = (competitions: DiscoverItem[], l: OpenGrantsListing) =>
  l.gms ? competitions.find((c) => (l.gms!.competitionId && c.competitionId === l.gms!.competitionId) || c.opportunity.id === l.gms!.opportunityId) : undefined;

const dateOnly = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined);
const snapshotOf = (l: OpenGrantsListing): ListingSnapshot => ({ ...(l.funder ? { funder: l.funder } : {}), ...(l.amount ? { amount: l.amount } : {}), ...(l.deadline ? { deadline: l.deadline } : {}), ...(l.summary ? { summary: l.summary } : {}), ...(l.url ? { url: l.url } : {}) });

/** Creates (or finds) the outside application for a listing, at `stage`; a prospect being started moves to drafting. */
async function outsideFromListing(api: OutsideApi, l: OpenGrantsListing, stage: "prospect" | "drafting") {
  const due = dateOnly(l.deadline);
  const made = await api.create({
    source: "opengrants",
    sourceRef: l.id,
    listing: snapshotOf(l),
    title: l.title,
    funderName: l.funder?.trim() || "Funder not named in the listing",
    ...(l.url ? { listingUrl: l.url } : {}),
    ...(due ? { fullDue: due } : {}),
    stage,
  });
  return stage === "drafting" && made.stage === "prospect" ? api.move(made.id, "drafting") : made;
}

export function NotTakingYet() {
  return (
    <span className="bdg bdg-neutral">
      <CalendarClock className="ic" aria-hidden="true" />
      Not taking applications yet
    </span>
  );
}

const OUTCOME = {
  pass: { icon: CircleCheck, color: "var(--s-ok-fg)", word: "Passes" },
  fail: { icon: CircleX, color: "var(--s-dng-fg)", word: "Does not pass" },
  unknown: { icon: CircleDashed, color: "var(--og-gray-600)", word: "Could not be checked" },
} as const;

function EligibilityBadge({ eligible }: { eligible: boolean | "unknown" }) {
  if (eligible === true) {
    return (
      <span className="bdg bdg-ok bdg-lg">
        <CircleCheck className="ic" aria-hidden="true" />
        Eligible
      </span>
    );
  }
  if (eligible === false) {
    return (
      <span className="bdg bdg-dng bdg-lg">
        <CircleX className="ic" aria-hidden="true" />
        Not eligible
      </span>
    );
  }
  return (
    <span className="bdg bdg-neutral bdg-lg">
      <CircleDashed className="ic" aria-hidden="true" />
      Eligibility unknown
    </span>
  );
}

function NotOpenCard({ c, saved, onSave, saving }: { c: DiscoverItem; saved: boolean; onSave: () => void; saving: boolean }) {
  const range = formatAwardRange(c.opportunity.funding as OppFunding);
  return (
    <article className="card" style={{ padding: "22px", display: "flex", flexDirection: "column", gap: "12px" }} aria-label={c.opportunity.title}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
        <FunderChip name={c.funder.name} accent={accentOf(c.funder.brand)} />
        <NotTakingYet />
      </div>
      <h2 style={{ fontSize: "20px" }}>{c.opportunity.title}</h2>
      {range && range !== "—" && (
        <span className="b" style={{ color: "var(--og-navy-dark)", fontSize: "14px" }}>
          {range}
        </span>
      )}
      <p className="small muted">The funder has published this opportunity but is not taking applications yet. Save it to keep it in your applications as a prospect.</p>
      <div className="row" style={{ gap: "14px", marginTop: "4px", flexWrap: "wrap" }}>
        <button className="btn btn-secondary" type="button" disabled={saved || saving} onClick={onSave}>
          <Bookmark className="ic" aria-hidden="true" />
          {saved ? "Saved" : "Save"}
        </button>
        {c.funder.handle && (
          <Link to={`/f/${c.funder.handle}/o/${c.opportunity.slug}`} className="small b">
            Read the opportunity
          </Link>
        )}
      </div>
    </article>
  );
}

function CompetitionCard({ c, base, onStart, starting }: { c: OpenDiscoverItem; base: string; onStart: (c: OpenDiscoverItem) => void; starting: boolean }) {
  const failed = c.eligibility.results.filter((r) => r.outcome === "fail");
  const unknown = c.eligibility.results.filter((r) => r.outcome === "unknown");
  const range = formatAwardRange(c.opportunity.funding as OppFunding);
  return (
    <article className="card" style={{ padding: "22px", display: "flex", flexDirection: "column", gap: "12px" }} aria-label={c.opportunity.title}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
        <FunderChip name={c.funder.name} accent={accentOf(c.funder.brand)} />
        <EligibilityBadge eligible={c.eligibility.eligible} />
      </div>
      <h2 style={{ fontSize: "20px" }}>{c.opportunity.title}</h2>
      <div className="row" style={{ gap: "14px", flexWrap: "wrap", fontSize: "14px", color: "var(--og-gray-600)" }}>
        {range && (
          <>
            <span className="b" style={{ color: "var(--og-navy-dark)" }}>
              {range}
            </span>
            <span>·</span>
          </>
        )}
        {c.stage && (
          <span>
            {c.stage.label}
            {c.stage.closes ? ` closes ${formatDate(c.stage.closes)}` : ""}
          </span>
        )}
      </div>
      {c.eligibility.eligible === false && failed[0] && (
        <div className="bnr bnr-dng" style={{ padding: "10px 12px" }}>
          <CircleX className="ic" aria-hidden="true" />
          <div>
            <div className="t" style={{ fontSize: "14px" }}>
              {failed[0].label}
            </div>
            <div className="d" style={{ fontSize: "13px" }}>
              {failed[0].explain} If your organization details are out of date, <Link to={`${base}/organization`}>update them</Link> and the result re-evaluates.
            </div>
          </div>
        </div>
      )}
      {c.eligibility.eligible === "unknown" && (
        <div className="bnr bnr-neu" style={{ padding: "10px 12px" }}>
          <Info className="ic" aria-hidden="true" />
          <div>
            <div className="t" style={{ fontSize: "14px" }}>
              {unknown.length === 1 ? "One rule could not be checked" : `${unknown.length} rules could not be checked`}
            </div>
            <div className="d" style={{ fontSize: "13px" }}>
              {unknown[0] ? `“${unknown[0].label}”: ${unknown[0].explain}` : "A program officer reviews this by hand."}
            </div>
          </div>
        </div>
      )}
      {c.eligibility.eligible === true && (
        <ul style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px" }}>
          {c.eligibility.results.map((r, i) => {
            const look = OUTCOME[r.outcome];
            return (
              <li key={i} className="row" style={{ gap: "6px", color: look.color }}>
                <look.icon className="ic" role="img" aria-label={look.word} />
                {r.label}
              </li>
            );
          })}
        </ul>
      )}
      <div className="row" style={{ gap: "14px", marginTop: "4px", flexWrap: "wrap" }}>
        {c.application ? (
          <>
            <Link to={`${base}/applications/${c.application.id}${c.application.status === "draft" || c.application.status === "revision_requested" ? "/edit" : ""}`} className="btn btn-primary">
              {c.application.status === "draft" ? "Continue application" : "Open application"}
            </Link>
            <StatusBadge kind="application" status={c.application.status} />
          </>
        ) : c.eligibility.eligible === false ? (
          <button className="btn btn-secondary" type="button" disabled>
            Start application
          </button>
        ) : (
          <button className={c.eligibility.eligible === true ? "btn btn-primary" : "btn btn-secondary"} type="button" onClick={() => onStart(c)} disabled={starting}>
            {starting ? "Starting…" : c.eligibility.eligible === true ? "Start application" : "Start anyway"}
          </button>
        )}
        {c.eligibility.eligible === "unknown" && !c.application && <span className="small muted">You can start; eligibility re-checks at submit.</span>}
        {c.funder.handle && (
          <Link to={`/f/${c.funder.handle}/o/${c.opportunity.slug}`} className="small b">
            Read the opportunity
          </Link>
        )}
      </div>
    </article>
  );
}

/** What a listing offers: built-in on this GMS, not open yet on this GMS, or an outside application. */
type ListingAction =
  | { kind: "builtin"; item: OpenDiscoverItem }
  | { kind: "builtin-direct"; competitionId: string }
  | { kind: "not-open"; item: DiscoverItem | null }
  | { kind: "outside"; existing: OutsideListItem | undefined };

function actionFor(l: OpenGrantsListing, competitions: DiscoverItem[], mine: OutsideListItem[]): ListingAction {
  if (l.gms) {
    const item = gmsItemFor(competitions, l);
    if (item && isAccepting(item)) return { kind: "builtin", item };
    if (!item && l.gms.competitionId) return { kind: "builtin-direct", competitionId: l.gms.competitionId };
    return { kind: "not-open", item: item ?? null };
  }
  return { kind: "outside", existing: outsideFor(mine, l) };
}

interface ListingHandlers {
  base: string;
  busy: boolean;
  isSavedGms: (item: DiscoverItem) => boolean;
  onStartBuiltIn: (competitionId: string) => void;
  onStartOutside: (l: OpenGrantsListing) => void;
  onSaveOutside: (l: OpenGrantsListing) => void;
  onSaveGms: (item: DiscoverItem) => void;
}

function ListingActions({ l, action, h, size = "sm" }: { l: OpenGrantsListing; action: ListingAction; h: ListingHandlers; size?: "sm" | "md" }) {
  const sm = size === "sm" ? " btn-sm" : "";
  if (action.kind === "builtin" || action.kind === "builtin-direct") {
    const app = action.kind === "builtin" ? action.item.application : null;
    if (app) {
      return (
        <Link to={`${h.base}/applications/${app.id}${app.status === "draft" || app.status === "revision_requested" ? "/edit" : ""}`} className={`btn btn-primary${sm}`}>
          {app.status === "draft" ? "Continue application" : "Open application"}
        </Link>
      );
    }
    return (
      <button className={`btn btn-primary${sm}`} type="button" disabled={h.busy} onClick={() => h.onStartBuiltIn(action.kind === "builtin" ? action.item.competitionId : action.competitionId)}>
        Start application
      </button>
    );
  }
  if (action.kind === "not-open") {
    const saved = action.item ? h.isSavedGms(action.item) : false;
    return (
      <>
        <NotTakingYet />
        {action.item && (
          <button className={`btn btn-secondary${sm}`} type="button" disabled={saved || h.busy} onClick={() => h.onSaveGms(action.item!)}>
            <Bookmark className="ic" aria-hidden="true" />
            {saved ? "Saved" : "Save"}
          </button>
        )}
      </>
    );
  }
  const existing = action.existing;
  return (
    <>
      {existing && existing.stage !== "prospect" ? (
        <Link to={`${h.base}/outside/${existing.id}`} className={`btn btn-primary${sm}`}>
          Open application
        </Link>
      ) : (
        <button className={`btn btn-primary${sm}`} type="button" disabled={h.busy} onClick={() => h.onStartOutside(l)}>
          Start application
        </button>
      )}
      <button className={`btn btn-secondary${sm}`} type="button" disabled={!!existing || h.busy} onClick={() => h.onSaveOutside(l)}>
        <Bookmark className="ic" aria-hidden="true" />
        {existing ? "Saved" : "Save"}
      </button>
    </>
  );
}

/** A listing's details. The single-listing endpoint is used when OpenGrants has one; otherwise the search result already held. */
function DetailsDialog({ held, action, h, onClose }: { held: OpenGrantsListing; action: ListingAction; h: ListingHandlers; onClose: () => void }) {
  const outside = useOutsideApi();
  const [listing, setListing] = useState(held);
  useEffect(() => {
    let live = true;
    outside.openGrantsListing(held.id).then(
      (l) => live && setListing({ ...held, ...l, gms: l.gms ?? held.gms }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [outside, held]);
  return (
    <Dialog open onClose={onClose} labelledBy="ff-details-title">
      <div className="hd">
        <div>
          <h3 id="ff-details-title" style={{ fontSize: "17px" }}>
            {listing.title}
          </h3>
          {listing.funder && <p className="small muted">{listing.funder}</p>}
        </div>
        <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd">
        <dl className="kv" style={{ fontSize: "15px" }}>
          <dt>Funder</dt>
          <dd>{listing.funder ?? "Not named in the listing"}</dd>
          <dt>Amount</dt>
          <dd>{listing.amount ?? "—"}</dd>
          <dt>Deadline</dt>
          <dd>{listing.deadline ? formatDate(listing.deadline) : "—"}</dd>
          <dt>Source</dt>
          <dd>{listing.gms ? "OpenGrants · this opportunity is on this GMS" : `OpenGrants${typeof listing.source === "string" && listing.source ? ` · ${listing.source}` : ""}`}</dd>
        </dl>
        {listing.summary && <p style={{ fontSize: "15px", whiteSpace: "pre-wrap" }}>{listing.summary}</p>}
        {action.kind === "outside" && !action.existing && <p className="small muted">Starting adds it to your applications, where you keep its questions, answers and deadlines. Nothing is sent to the funder.</p>}
      </div>
      <div className="ft" style={{ flexWrap: "wrap" }}>
        {listing.url && (
          <a href={listing.url} target="_blank" rel="noreferrer noopener" className="btn btn-ghost" style={{ marginRight: "auto" }}>
            Open original listing <ExternalLink className="ic ic-sm" aria-hidden="true" />
            <span className="sr"> (opens in a new tab)</span>
          </a>
        )}
        <ListingActions l={listing} action={action} h={h} size="md" />
      </div>
    </Dialog>
  );
}

function OpenGrantsIndex({ base, competitions, mine, h }: { base: string; competitions: DiscoverItem[]; mine: OutsideListItem[]; h: ListingHandlers }) {
  const api = useApplicantApi();
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState<OpenGrantsListing | null>(null);
  const [state, setState] = useState<{ status: "idle" } | { status: "loading" } | { status: "error"; error: unknown } | { status: "ready"; results: OpenGrantsListing[]; cached: boolean; matched: boolean }>({ status: "idle" });

  const run = async (tool: "search" | "match") => {
    setState({ status: "loading" });
    try {
      const r = await api.openGrants(tool, tool === "search" ? { query } : {});
      setState({ status: "ready", results: r.results, cached: r.cached, matched: tool === "match" });
    } catch (error) {
      setState({ status: "error", error });
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run("search");
  };
  const unavailable = state.status === "error" && state.error instanceof ApiError && state.error.status === 503;

  return (
    <section className="card" aria-labelledby="index-h">
      <div className="card-h">
        <div>
          <h2 id="index-h" style={{ fontSize: "18px" }}>
            OpenGrants index
          </h2>
          <p className="small muted">Opportunities from every funder on OpenGrants. Your organization type, state, mission and budget band are sent as context; nothing else.</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <form onSubmit={onSubmit} className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
          <div className="inp-icon" style={{ flex: "1 1 260px" }}>
            <Search className="ic" aria-hidden="true" />
            <input className="inp" type="search" aria-label="Search the OpenGrants index" placeholder="rural health navigation" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={state.status === "loading"}>
            Search
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => void run("match")} disabled={state.status === "loading"}>
            Match to my profile
          </button>
        </form>

        {state.status === "loading" && (
          <div className="notice" role="status" aria-busy="true">
            Searching OpenGrants…
          </div>
        )}
        {unavailable && (
          <Notice tone="neu" title="OpenGrants did not answer">
            Nothing was searched. Competitions open on this GMS are listed under “Open here”.
          </Notice>
        )}
        {state.status === "error" && !unavailable && <ErrorBanner error={state.error} />}
        {state.status === "ready" && state.results.length === 0 && <p className="muted">No listings matched. Try fewer words.</p>}
        {state.status === "ready" && state.results.length > 0 && (
          <>
            <span className="small muted">
              {state.results.length} result{state.results.length === 1 ? "" : "s"}
              {state.matched ? " matched to your Passport profile" : ""}
              {state.cached ? " · from the last 15 minutes" : ""}
            </span>
            {state.results.map((l) => (
              <article key={l.id} className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "8px" }} aria-label={l.title}>
                <div className="row" style={{ justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                  <h3 style={{ fontSize: "16px" }}>{l.title}</h3>
                  {l.gms && <span className="tag">On this GMS</span>}
                </div>
                <div className="row small muted" style={{ gap: "10px", flexWrap: "wrap" }}>
                  {l.funder && <span>{l.funder}</span>}
                  {l.amount && <span>· {l.amount}</span>}
                  {l.deadline && <span>· closes {formatDate(l.deadline)}</span>}
                </div>
                {l.summary && <p style={{ fontSize: "14px" }}>{l.summary}</p>}
                <div className="row" style={{ gap: "12px", flexWrap: "wrap" }}>
                  <ListingActions l={l} action={actionFor(l, competitions, mine)} h={h} />
                  <button className="btn btn-sm btn-ghost" type="button" aria-haspopup="dialog" onClick={() => setDetails(l)}>
                    Details
                  </button>
                </div>
              </article>
            ))}
          </>
        )}
        {state.status === "idle" && (
          <p className="small muted">
            Search by topic, or match against your <Link to={`${base}/organization`}>Passport profile</Link>.
          </p>
        )}
      </div>
      {details && <DetailsDialog held={details} action={actionFor(details, competitions, mine)} h={h} onClose={() => setDetails(null)} />}
    </section>
  );
}

function SavedTab({ base, prospects, gmsSaved, competitions, h, onStartProspect, startingId }: { base: string; prospects: OutsideListItem[]; gmsSaved: SavedListing[]; competitions: DiscoverItem[]; h: ListingHandlers; onStartProspect: (p: OutsideListItem) => void; startingId: string | null }) {
  if (prospects.length + gmsSaved.length === 0) {
    return (
      <div className="card">
        <EmptyState icon={Bookmark} title="Nothing saved yet">
          Save a listing from the OpenGrants index, or an opportunity on this GMS, to keep it here as a prospect.
        </EmptyState>
      </div>
    );
  }
  const itemFor = (s: SavedListing) => competitions.find((c) => c.opportunity.id === s.gmsOpportunityId || c.opportunity.id === s.externalId || (!!s.url && c.url === s.url));
  return (
    <ul className="card" style={{ display: "flex", flexDirection: "column" }} aria-label="Saved">
      {prospects.map((p, i) => (
        <li key={p.id} className="row" style={{ gap: "12px", padding: "14px 20px", borderTop: i ? "1px solid var(--og-gray-100)" : 0, flexWrap: "wrap" }}>
          <Bookmark className="ic" aria-hidden="true" />
          <div className="grow" style={{ minWidth: 0 }}>
            <Link to={`${base}/outside/${p.id}`} className="b">
              {p.title}
            </Link>
            <div className="small muted">
              {p.funderName}
              {p.deadlines.fullDue ? ` · closes ${formatDate(p.deadlines.fullDue)}` : p.deadlines.rolling ? " · rolling" : ""} · prospect
            </div>
          </div>
          <button className="btn btn-sm btn-primary" type="button" disabled={startingId === p.id} onClick={() => onStartProspect(p)}>
            {startingId === p.id ? "Starting…" : "Start application"}
          </button>
        </li>
      ))}
      {gmsSaved.map((s, i) => {
        const item = itemFor(s);
        return (
          <li key={s.id} className="row" style={{ gap: "12px", padding: "14px 20px", borderTop: i || prospects.length ? "1px solid var(--og-gray-100)" : 0, flexWrap: "wrap" }}>
            <Bookmark className="ic" aria-hidden="true" />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="b">{s.title}</div>
              <div className="small muted">Saved {formatDate(s.savedAt)} · this GMS</div>
            </div>
            {item && isAccepting(item) ? (
              item.application ? (
                <Link to={`${base}/applications/${item.application.id}${item.application.status === "draft" ? "/edit" : ""}`} className="btn btn-sm btn-primary">
                  {item.application.status === "draft" ? "Continue application" : "Open application"}
                </Link>
              ) : (
                <button className="btn btn-sm btn-primary" type="button" disabled={h.busy} onClick={() => h.onStartBuiltIn(item.competitionId)}>
                  Start application
                </button>
              )
            ) : (
              <NotTakingYet />
            )}
            {s.url && (
              <Link to={s.url.replace(/^https?:\/\/[^/]+/, "")} className="small b">
                View on this GMS
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function FindFunding() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const navigate = useNavigate();
  const outside = useOutsideApi();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (["here", "index", "saved", "alerts"].includes(params.get("tab") ?? "") ? (params.get("tab") as Tab) : "here"));
  const query = useApplicantQuery((api) => load(api, outside), [ws.id, outside]);
  // Funding search across OpenGrants exists only where the server is set up for it. Unknown
  // (still loading) counts as available, so the tab does not flicker.
  const indexAvailable = useAppConfig().available?.openGrants !== false;
  // Alerts run on this GMS's own alerts service, wherever the OpenGrants search is available.
  const alertsAvailable = indexAvailable;
  // Arriving from "Apply" on a public opportunity page: show that opportunity first.
  const [wanted] = useState(() => wantedFrom(params));
  const wantedCard = useRef<HTMLDivElement | null>(null);
  const loaded = query.status === "ready";
  useEffect(() => {
    if (!wanted || !loaded) return;
    forgetWanted();
    wantedCard.current?.scrollIntoView?.({ block: "center" });
  }, [wanted, loaded]);
  const [startingId, setStartingId] = useState<string | null>(null);
  const start = useApplicantMutation((api, competitionId: string) => api.startApplication(competitionId));
  const saveGms = useApplicantMutation((api, item: DiscoverItem) => api.save({ source: "gms", externalId: item.opportunity.id, title: item.opportunity.title, ...(item.url ? { url: item.url } : {}) }));
  const startOutside = useOutsideMutation((api, l: OpenGrantsListing) => outsideFromListing(api, l, "drafting"));
  const saveOutside = useOutsideMutation((api, l: OpenGrantsListing) => outsideFromListing(api, l, "prospect"));
  const startProspect = useOutsideMutation((api, p: OutsideListItem) => api.move(p.id, "drafting"));

  const onStart = async (competitionId: string) => {
    setStartingId(competitionId);
    const app = await start.run(competitionId);
    setStartingId(null);
    if (app) navigate(`${base}/applications/${app.id}/edit`);
  };
  const busy = start.state === "saving" || startOutside.state === "saving" || saveOutside.state === "saving" || saveGms.state === "saving";
  const writeError = start.error ?? startOutside.error ?? saveOutside.error ?? saveGms.error ?? startProspect.error;

  return (
    <>
      <title>{`Find funding — ${ws.name}`}</title>
      <ApplicantShell active="Find funding">
        <main className="main">
          <div className="ph">
            <div>
              <div className="title">
                <h1>Find funding</h1>
              </div>
              <div className="meta">
                <span>Eligibility is checked against your Passport record, so you can see what you can win before you start. Any listing can become an application you track here.</span>
              </div>
            </div>
          </div>

          <Loaded query={query} label="Checking what you are eligible for">
            {({ competitions, saved: everySaved, mine }) => {
              const saved = everySaved.filter((x) => !isAlertRow(x));
              const gmsSaved = saved.filter((x) => x.source === "gms");
              const prospects = mine.filter((o) => o.stage === "prospect");
              const isWanted = (c: DiscoverItem) => !!wanted && c.opportunity.slug === wanted.opportunity && c.funder.handle === wanted.funder;
              const found = wanted ? competitions.find(isWanted) : undefined;
              // The opportunity the person came for goes first.
              const ordered = found ? [found, ...competitions.filter((c) => c !== found)] : competitions;
              const isSavedGms = (item: DiscoverItem) => gmsSaved.some((s) => s.gmsOpportunityId === item.opportunity.id || s.externalId === item.opportunity.id);
              const refresh = () => query.reload();
              const h: ListingHandlers = {
                base,
                busy,
                isSavedGms,
                onStartBuiltIn: (id) => void onStart(id),
                onStartOutside: async (l) => {
                  const a = await startOutside.run(l);
                  if (a) navigate(`${base}/outside/${a.id}`);
                },
                onSaveOutside: async (l) => {
                  if (await saveOutside.run(l)) refresh();
                },
                onSaveGms: async (item) => {
                  const s = await saveGms.run(item);
                  if (s) query.set({ competitions, saved: [s, ...everySaved.filter((x) => x.id !== s.id)], mine });
                },
              };
              return (
                <>
                  {wanted && (!found || !isAccepting(found)) && (
                    <Notice tone="neu" title="That opportunity is not open for applications right now">
                      {found ? "The funder has published it but is not taking applications yet. You can save it and come back." : "It may not have opened yet, or its deadline has passed. Everything that is open is listed below."}
                    </Notice>
                  )}
                  <Tabs<Tab>
                    label="Where to look"
                    idPrefix="find"
                    active={tab}
                    onChange={setTab}
                    tabs={[
                      { key: "here", label: "Open here", count: competitions.length },
                      ...(indexAvailable ? [{ key: "index" as const, label: "OpenGrants index" }] : []),
                      { key: "saved", label: "Saved", count: prospects.length + gmsSaved.length },
                      ...(alertsAvailable ? [{ key: "alerts" as const, label: "Alerts" }] : []),
                    ]}
                  />
                  {writeError ? <ErrorBanner error={writeError} title="That did not work" /> : null}

                  <TabPanel idPrefix="find" tab="here" active={tab}>
                    {competitions.length === 0 ? (
                      <div className="card">
                        <EmptyState icon={Search} title="Nothing is open here right now">
                          {indexAvailable
                            ? "Funders on this GMS have no open competitions. Search the OpenGrants index for opportunities elsewhere."
                            : "Funders on this GMS have no open competitions yet. When one opens, it is listed here with your eligibility. Funding search across OpenGrants isn’t available on this site yet."}
                        </EmptyState>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px" }}>
                        {ordered.map((c) => (
                          <div key={c.competitionId ?? c.opportunity.id} ref={c === found ? wantedCard : undefined} style={c === found ? { outline: "2px solid var(--og-teal)", outlineOffset: "2px", borderRadius: "12px" } : undefined} data-wanted={c === found ? "true" : undefined}>
                            {c === found && <div className="small b" style={{ padding: "0 0 6px 4px" }}>The opportunity you chose</div>}
                            {isAccepting(c) ? (
                              <CompetitionCard c={c} base={base} onStart={(x) => void onStart(x.competitionId)} starting={startingId === c.competitionId} />
                            ) : (
                              <NotOpenCard c={c} saved={isSavedGms(c)} saving={saveGms.state === "saving"} onSave={() => h.onSaveGms(c)} />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </TabPanel>

                  <TabPanel idPrefix="find" tab="index" active={tab}>
                    <OpenGrantsIndex base={base} competitions={competitions} mine={mine} h={h} />
                  </TabPanel>

                  <TabPanel idPrefix="find" tab="saved" active={tab}>
                    <SavedTab
                      base={base}
                      prospects={prospects}
                      gmsSaved={gmsSaved}
                      competitions={competitions}
                      h={h}
                      startingId={startProspect.state === "saving" ? startingId : null}
                      onStartProspect={async (p) => {
                        setStartingId(p.id);
                        const a = await startProspect.run(p);
                        setStartingId(null);
                        if (a) navigate(`${base}/outside/${a.id}`);
                      }}
                    />
                  </TabPanel>
                  <TabPanel idPrefix="find" tab="alerts" active={tab}>
                    <FundingAlerts />
                  </TabPanel>
                </>
              );
            }}
          </Loaded>
        </main>
      </ApplicantShell>
    </>
  );
}
