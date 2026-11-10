// SPDX-License-Identifier: AGPL-3.0-only
// Find funding: competitions open on this GMS with this organization's eligibility, the OpenGrants
// index searched with the Passport profile as context, and saved listings.
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Bookmark, CircleCheck, CircleDashed, CircleX, ExternalLink, Info, Search } from "lucide-react";
import type { ApplicantApi, DiscoverCompetition, OpenGrantsListing, SavedListing } from "../../api/applicant.ts";
import { useApplicantApi, useApplicantMutation, useApplicantQuery } from "../../api/applicantHooks.ts";
import { ApiError } from "../../api/client.ts";
import type { OppFunding } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { accentOf, FunderChip, Loaded } from "../../components/applicant.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Notice, TabPanel, Tabs } from "../../components/ui.tsx";
import { formatAwardRange, formatDate } from "../../lib/format.ts";

type Tab = "here" | "index" | "saved";

const load = async (api: ApplicantApi) => {
  const [competitions, saved] = await Promise.all([api.discover(), api.saved()]);
  return { competitions, saved };
};

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

function CompetitionCard({ c, base, onStart, starting }: { c: DiscoverCompetition; base: string; onStart: (c: DiscoverCompetition) => void; starting: boolean }) {
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
              {failed[0].explain} If your record is out of date, <Link to={`${base}/organization`}>update it in Passport</Link> and the result re-evaluates.
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

function OpenGrantsIndex({ base, saved, onSaved, onStart }: { base: string; saved: SavedListing[]; onSaved: (s: SavedListing) => void; onStart: (competitionId: string) => void }) {
  const api = useApplicantApi();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ status: "idle" } | { status: "loading" } | { status: "error"; error: unknown } | { status: "ready"; results: OpenGrantsListing[]; cached: boolean; matched: boolean }>({ status: "idle" });
  const save = useApplicantMutation((a, l: OpenGrantsListing) => a.save({ source: "opengrants", externalId: l.id, title: l.title, ...(l.url ? { url: l.url } : {}) }));

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
          <Notice tone="neu" title="OpenGrants can’t be reached right now">
            Competitions open on this GMS are listed under “Open here”. Try the index again in a few minutes.
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
            {state.results.map((l) => {
              const isSaved = saved.some((s) => s.source === "opengrants" && s.externalId === l.id);
              return (
                <div key={l.id} className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "8px" }}>
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
                    {l.gms?.competitionId ? (
                      <button className="btn btn-sm btn-primary" type="button" onClick={() => onStart(l.gms!.competitionId!)}>
                        Start application
                      </button>
                    ) : null}
                    <button
                      className="btn btn-sm btn-secondary"
                      type="button"
                      disabled={isSaved}
                      onClick={async () => {
                        const s = await save.run(l);
                        if (s) onSaved(s);
                      }}
                    >
                      <Bookmark className="ic" aria-hidden="true" />
                      {isSaved ? "Saved" : "Save"}
                    </button>
                    {l.url && (
                      <a href={l.url} className="small b" rel="noreferrer">
                        View listing <ExternalLink className="ic ic-sm" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
        {state.status === "idle" && (
          <p className="small muted">
            Search by topic, or match against your <Link to={`${base}/organization`}>Passport profile</Link>.
          </p>
        )}
      </div>
    </section>
  );
}

export default function FindFunding() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("here");
  const query = useApplicantQuery(load, [ws.id]);
  const [startingId, setStartingId] = useState<string | null>(null);
  const start = useApplicantMutation((api, competitionId: string) => api.startApplication(competitionId));

  const onStart = async (competitionId: string) => {
    setStartingId(competitionId);
    const app = await start.run(competitionId);
    setStartingId(null);
    if (app) navigate(`${base}/applications/${app.id}/edit`);
  };

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
                <span>Eligibility is checked against your Passport record, so you can see what you can win before you start.</span>
              </div>
            </div>
          </div>

          <Loaded query={query} label="Checking what you are eligible for">
            {({ competitions, saved }) => (
              <>
                <Tabs<Tab>
                  label="Where to look"
                  idPrefix="find"
                  active={tab}
                  onChange={setTab}
                  tabs={[
                    { key: "here", label: "Open here", count: competitions.length },
                    { key: "index", label: "OpenGrants index" },
                    { key: "saved", label: "Saved", count: saved.length },
                  ]}
                />
                {start.error ? <ErrorBanner error={start.error} title="The application could not be started" /> : null}

                <TabPanel idPrefix="find" tab="here" active={tab}>
                  {competitions.length === 0 ? (
                    <div className="card">
                      <EmptyState icon={Search} title="Nothing is open here right now">
                        Funders on this GMS have no open competitions. Search the OpenGrants index for opportunities elsewhere.
                      </EmptyState>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px" }}>
                      {competitions.map((c) => (
                        <CompetitionCard key={c.competitionId} c={c} base={base} onStart={(x) => void onStart(x.competitionId)} starting={startingId === c.competitionId} />
                      ))}
                    </div>
                  )}
                </TabPanel>

                <TabPanel idPrefix="find" tab="index" active={tab}>
                  <OpenGrantsIndex base={base} saved={saved} onSaved={(s) => query.set({ competitions, saved: [s, ...saved.filter((x) => x.id !== s.id)] })} onStart={(id) => void onStart(id)} />
                </TabPanel>

                <TabPanel idPrefix="find" tab="saved" active={tab}>
                  {saved.length === 0 ? (
                    <div className="card">
                      <EmptyState icon={Bookmark} title="Nothing saved yet">
                        Save a listing from the OpenGrants index to keep it here.
                      </EmptyState>
                    </div>
                  ) : (
                    <ul className="card" style={{ display: "flex", flexDirection: "column" }}>
                      {saved.map((s, i) => (
                        <li key={s.id} className="row" style={{ gap: "12px", padding: "14px 20px", borderTop: i ? "1px solid var(--og-gray-100)" : 0, flexWrap: "wrap" }}>
                          <Bookmark className="ic" aria-hidden="true" />
                          <div className="grow">
                            <div className="b">{s.title}</div>
                            <div className="small muted">
                              Saved {formatDate(s.savedAt)} · {s.source === "gms" ? "this GMS" : "OpenGrants"}
                            </div>
                          </div>
                          {s.url && (
                            <a href={s.url} className="small b" rel="noreferrer">
                              View listing
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </TabPanel>
              </>
            )}
          </Loaded>
        </main>
      </ApplicantShell>
    </>
  );
}
