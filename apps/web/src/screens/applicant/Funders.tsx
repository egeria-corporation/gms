// SPDX-License-Identifier: AGPL-3.0-only
// Funders this organization has a relationship with on the GMS: anyone it has applied to.
import { Link } from "react-router";
import { Clock, ExternalLink, Landmark, Search } from "lucide-react";
import type { ApplicantApi, MyFunder } from "../../api/applicant.ts";
import { useApplicantQuery } from "../../api/applicantHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { accentOf, FunderChip, Loaded } from "../../components/applicant.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { DataTable, EmptyState, type Column } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import type { ApplicantFullApi } from "../../api/applicantFull.ts";
import { useFullApi } from "../../api/applicantFullHooks.ts";
import type { ApplicantMoreApi, MyRequirement } from "../../api/applicantMore.ts";
import { useMoreApi } from "../../api/applicantMoreHooks.ts";

const load = async (api: ApplicantApi, more: ApplicantMoreApi, full: ApplicantFullApi) => {
  const [funders, applications, awards, consents, requirements] = await Promise.all([api.funders(), api.applications(), api.awards(), api.consents(), more.requirements().catch(() => [] as MyRequirement[])]);
  // Contact details are what the funder publishes; a funder without a public page simply has none.
  const contacts = Object.fromEntries(await Promise.all(funders.map(async (f) => [f.workspaceId, (await full.publicExtras(f.handle).catch(() => null))?.contactEmail ?? null] as const)));
  return { funders, applications, awards, consents, requirements, contacts };
};

const OPEN_REQ = ["due", "overdue", "returned"];
const OPEN_APP = ["draft", "revision_requested"];

export default function Funders() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const more = useMoreApi();
  const full = useFullApi();
  const query = useApplicantQuery((api) => load(api, more, full), [ws.id, more, full]);

  return (
    <>
      <title>{`Funders — ${ws.name}`}</title>
      <ApplicantShell active="Funders">
        <main className="main">
          <div className="crumbs">
            <Link to={base}>Dashboard</Link>
            <span>›</span>
            <span>Funders</span>
          </div>
          <Loaded query={query} label="Loading funders">
            {({ funders, applications, awards, consents, requirements, contacts }) => {
              const openFor = (f: MyFunder) => ({
                reports: requirements.filter((r) => r.funder?.workspaceId === f.workspaceId && OPEN_REQ.includes(r.status)),
                apps: applications.filter((a) => a.funder.workspaceId === f.workspaceId && OPEN_APP.includes(a.status)),
              });
              const columns: Column<MyFunder>[] = [
                { key: "name", header: "Funder", cell: (f) => <FunderChip name={f.name} accent={accentOf(f.brand)} />, sort: (f) => f.name },
                { key: "since", header: "Relationship since", cell: (f) => (f.since ? new Date(f.since).getUTCFullYear() : "—"), sort: (f) => f.since },
                { key: "apps", header: "Applications", numeric: true, cell: (f) => f.applications, sort: (f) => f.applications },
                { key: "awards", header: "Awards", numeric: true, cell: (f) => f.awards, sort: (f) => f.awards },
                {
                  key: "open",
                  header: "Open items",
                  cell: (f) => {
                    const o = openFor(f);
                    const n = o.reports.length + o.apps.length;
                    return n === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      <span className="bdg bdg-warn">
                        <Clock className="ic" aria-hidden="true" />
                        {n} open
                      </span>
                    );
                  },
                },
                {
                  key: "access",
                  header: "Reads your Passport record",
                  cell: (f) => (consents.some((c) => c.funder.workspaceId === f.workspaceId && !c.revokedAt) ? <span>Yes · <Link to={`${base}/team`}>manage</Link></span> : <span className="muted">No</span>),
                },
                {
                  key: "page",
                  header: "",
                  cell: (f) => (
                    <Link to={`/f/${f.handle}`} className="small b">
                      Public page <ExternalLink className="ic ic-sm" aria-hidden="true" />
                    </Link>
                  ),
                },
              ];
              return (
                <>
                  <div className="ph">
                    <div>
                      <div className="title">
                        <h1>Funders</h1>
                      </div>
                      <div className="meta">
                        <span>
                          {funders.length} funder{funders.length === 1 ? "" : "s"} you have applied to on the GMS
                        </span>
                      </div>
                    </div>
                    <div className="actions">
                      <Link to={`${base}/find`} className="btn btn-secondary">
                        <Search className="ic" aria-hidden="true" />
                        Find more funding
                      </Link>
                    </div>
                  </div>
                  <DataTable
                    label="Funders"
                    columns={columns}
                    rows={funders}
                    rowKey={(f) => f.workspaceId}
                    empty={
                      <EmptyState icon={Landmark} title="No funders yet">
                        A funder appears here once you start an application with it.
                      </EmptyState>
                    }
                  />
                  {funders.map((f) => {
                    const apps = applications.filter((a) => a.funder.workspaceId === f.workspaceId);
                    const mine = awards.filter((w) => w.funder.workspaceId === f.workspaceId);
                    const open = openFor(f);
                    return (
                      <div key={f.workspaceId} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                      <section className="card" aria-label={`History with ${f.name}`}>
                        <div className="card-h">
                          <div className="row" style={{ gap: "12px" }}>
                            <FunderChip name={f.name} accent={accentOf(f.brand)} />
                            <h2 style={{ fontSize: "18px" }}>History</h2>
                          </div>
                        </div>
                        <ul className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                          {apps.map((a) => (
                            <li key={a.id} className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                              <StatusBadge kind="application" status={a.status} />
                              <Link to={`${base}/applications/${a.id}`} className="b">
                                {a.title}
                              </Link>
                              <span className="small muted">
                                {a.stage.label}
                                {a.submittedAt ? ` · submitted ${formatDate(a.submittedAt)}` : ""}
                              </span>
                            </li>
                          ))}
                          {mine.map((w) => (
                            <li key={w.id} className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                              <StatusBadge kind="award" status={w.status} />
                              <Link to={`${base}/grants/${w.id}/offer`} className="b">
                                {w.title}
                              </Link>
                              <span className="small muted">Award</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                          <section className="card" aria-label={`Open items with ${f.name}`}>
                            <div className="card-h">
                              <h3>Open items</h3>
                            </div>
                            <ul className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                              {open.reports.length + open.apps.length === 0 && <li className="muted">Nothing is waiting on you.</li>}
                              {open.reports.map((r) => (
                                <li key={r.id} className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                                  <StatusBadge kind="requirement" status={r.status} />
                                  <Link to={`${base}/reports?r=${r.id}`} className="b">
                                    {r.title}
                                  </Link>
                                  {r.dueAt ? <span className="small muted">Due {formatDate(r.dueAt)}</span> : null}
                                </li>
                              ))}
                              {open.apps.map((a) => (
                                <li key={a.id} className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                                  <StatusBadge kind="application" status={a.status} />
                                  <Link to={`${base}/applications/${a.id}/edit`} className="b">
                                    {a.title}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </section>
                          <section className="card" aria-label={`Documents from ${f.name}`}>
                            <div className="card-h">
                              <h3>Documents from {f.name}</h3>
                            </div>
                            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                              {mine.length === 0 && <p className="muted">Agreements and award letters appear here once {f.name} makes an award.</p>}
                              {mine.map((w) => (
                                <div className="doc" key={w.id}>
                                  <span className="ft ft-pdf">PDF</span>
                                  <div className="grow">
                                    <div className="nm">Grant agreement — {w.title}</div>
                                    <div className="mt">
                                      <StatusBadge kind="award" status={w.status} />
                                    </div>
                                  </div>
                                  <Link to={`${base}/grants/${w.id}/offer`} className="btn btn-sm btn-ghost">
                                    Open
                                  </Link>
                                </div>
                              ))}
                            </div>
                          </section>
                          <section className="card" aria-label={`Contact ${f.name}`}>
                            <div className="card-h">
                              <h3>Contact</h3>
                            </div>
                            <div className="card-b">
                              <dl className="kv" style={{ fontSize: "15px" }}>
                                <dt>Email</dt>
                                <dd>{contacts[f.workspaceId] ? <a href={`mailto:${contacts[f.workspaceId]}`}>{contacts[f.workspaceId]}</a> : <span className="muted">Not published. Use the shared thread on an application.</span>}</dd>
                                <dt>Public page</dt>
                                <dd>
                                  <Link to={`/f/${f.handle}`}>gms.opengrants.io/f/{f.handle}</Link>
                                </dd>
                              </dl>
                            </div>
                          </section>
                        </div>
                      </div>
                    );
                  })}
                </>
              );
            }}
          </Loaded>
        </main>
      </ApplicantShell>
    </>
  );
}
