// SPDX-License-Identifier: AGPL-3.0-only
// The applicant's pipeline: every application in one place, whether it is to a funder on this GMS
// or anywhere else, plus opportunities saved on this GMS. A list or a board by stage, filtered by
// stage, deadline and owner. New applications start from an OpenGrants listing, a pasted link or
// typed details; a spreadsheet can be imported, and everything exported.
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Archive, Download, FileText, Kanban, LayoutList, Plus, Search, Upload } from "lucide-react";
import type { ApplicantMember } from "../../api/applicant.ts";
import { useApplicantApi } from "../../api/applicantHooks.ts";
import { useAppConfig } from "../../api/launchHooks.ts";
import type { OutsideListItem, OwnerRef, PipelineItem } from "../../api/outside.ts";
import { useOutsideMutation, useOutsideQuery } from "../../api/outsideHooks.ts";
import { useServices } from "../../app/services.tsx";
import { useWorkspace } from "../../app/workspace.tsx";
import { Loaded } from "../../components/applicant.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { DataTable, EmptyState, ErrorBanner, Notice, type Column } from "../../components/ui.tsx";
import { downloadBlob } from "../../lib/browser.ts";
import { daysUntil } from "../../lib/format.ts";
import { ImportDialog } from "./outside/ImportDialog.tsx";
import { NewApplicationDialog } from "./outside/NewApplicationDialog.tsx";
import { DeadlineText, moneyText, nextDeadline } from "./outside/shared.tsx";

/** Board columns. Built-in applications are placed by their status; withdrawn and not pursuing share "Closed". */
export const LANES = ["prospect", "deciding", "loi", "invited", "drafting", "submitted", "awarded", "declined", "closed"] as const;
export type Lane = (typeof LANES)[number];
export const LANE_LABELS: Record<Lane, string> = {
  prospect: "Prospect",
  deciding: "Deciding",
  loi: "Letter of inquiry",
  invited: "Invited to apply",
  drafting: "Drafting",
  submitted: "Submitted",
  awarded: "Awarded",
  declined: "Declined",
  closed: "Withdrawn or not pursuing",
};
const GMS_LANE: Record<string, Lane> = {
  draft: "drafting",
  revision_requested: "drafting",
  submitted: "submitted",
  screening: "submitted",
  under_review: "submitted",
  interview: "submitted",
  recommended: "submitted",
  waitlisted: "submitted",
  accepted: "awarded",
  declined: "declined",
  withdrawn: "closed",
};
export function laneOf(item: Pick<PipelineItem, "kind" | "stage" | "status">): Lane {
  if (item.kind === "saved_gms") return "prospect";
  if (item.kind === "outside_application") return item.stage === "withdrawn" || item.stage === "not_pursuing" ? "closed" : ((item.stage as Lane | null) ?? "drafting");
  return GMS_LANE[item.status ?? ""] ?? "submitted";
}

type DeadlineFilter = "any" | "overdue" | "7" | "30" | "none";
export interface Row {
  key: string;
  item: PipelineItem;
  lane: Lane;
  href: string;
  deadline: string | null;
  owner: OwnerRef | null;
  outside: OutsideListItem | null;
}

const editable = (status: string | null | undefined) => status === "draft" || status === "revision_requested";
function hrefOf(base: string, item: PipelineItem): string {
  if (item.kind === "outside_application") return `${base}/outside/${item.id}`;
  if (item.kind === "gms_application") return `${base}/applications/${item.id}${editable(item.status) ? "/edit" : ""}`;
  return item.url && item.url.startsWith("/f/") ? item.url : `${base}/find`;
}

export function rowsOf(base: string, pipeline: PipelineItem[], outside: OutsideListItem[]): Row[] {
  const byId = new Map(outside.map((o) => [o.id, o]));
  return pipeline.map((item) => {
    const o = item.kind === "outside_application" ? (byId.get(item.id) ?? null) : null;
    const lane = laneOf(item);
    // A closed or submitted application has nothing left to meet.
    const open = !["submitted", "awarded", "declined", "closed"].includes(lane);
    const deadline = item.nextDeadline ?? (o && open ? (nextDeadline(o.deadlines)?.date ?? null) : null);
    return { key: `${item.kind}:${item.id}`, item, lane, href: hrefOf(base, item), deadline: open ? deadline : null, owner: o?.owner ?? null, outside: o };
  });
}

export function matchesDeadline(d: string | null, f: DeadlineFilter, now = new Date()): boolean {
  if (f === "any") return true;
  if (f === "none") return !d;
  const n = daysUntil(d, now);
  if (n === null) return false;
  return f === "overdue" ? n < 0 : n >= 0 && n <= Number(f);
}

function StageCell({ row }: { row: Row }) {
  if (row.item.kind === "saved_gms") return <StatusBadge kind="outside" status="prospect" label="Saved" />;
  if (row.item.kind === "outside_application") return <StatusBadge kind="outside" status={row.item.stage ?? "drafting"} />;
  return <StatusBadge kind="application" status={row.item.status ?? "submitted"} />;
}

function Title({ row }: { row: Row }) {
  return (
    <div className="ent">
      <Link to={row.href} className="nm">
        {row.item.title}
      </Link>
      <span className="small muted row" style={{ gap: "6px", flexWrap: "wrap" }}>
        {row.item.funderName ?? ""}
        {row.item.kind !== "outside_application" && <span className="tag">On this GMS</span>}
      </span>
    </div>
  );
}

function Board({ rows, lanes }: { rows: Row[]; lanes: Lane[] }) {
  return (
    <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Board, scrollable" style={{ border: 0, background: "transparent", overflowX: "auto" }}>
      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", paddingBottom: "8px" }}>
        {lanes.map((lane) => {
          const mine = rows.filter((r) => r.lane === lane);
          return (
            <section key={lane} aria-label={`${LANE_LABELS[lane]}, ${mine.length}`} style={{ flex: "0 0 232px", background: "var(--og-gray-50)", border: "1px solid var(--og-gray-200)", borderRadius: "10px", padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <h2 className="row" style={{ fontSize: "13px", justifyContent: "space-between", gap: "6px" }}>
                {LANE_LABELS[lane]}
                <span className="tag">{mine.length}</span>
              </h2>
              {mine.length === 0 && <p className="small muted">Nothing here.</p>}
              {mine.map((r) => (
                <article key={r.key} className="card" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "6px" }} aria-label={r.item.title}>
                  <Link to={r.href} className="b" style={{ fontSize: "14px", overflowWrap: "anywhere" }}>
                    {r.item.title}
                  </Link>
                  <span className="small muted">{r.item.funderName ?? ""}</span>
                  <div className="row" style={{ gap: "6px", flexWrap: "wrap" }}>
                    <StageCell row={r} />
                    {r.item.kind !== "outside_application" && <span className="tag">On this GMS</span>}
                  </div>
                  {r.deadline && (
                    <span className="small">
                      <DeadlineText date={r.deadline} />
                    </span>
                  )}
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Archived({ base }: { base: string }) {
  const query = useOutsideQuery((api) => api.list({ archived: true }), []);
  return (
    <Loaded query={query} label="Loading archived applications">
      {(items) => (
        <DataTable
          label="Archived applications"
          rows={items}
          rowKey={(a) => a.id}
          columns={[
            {
              key: "t",
              header: "Application",
              cell: (a) => (
                <div className="ent">
                  <Link to={`${base}/outside/${a.id}`} className="nm">
                    {a.title}
                  </Link>
                  <span className="small muted">{a.funderName}</span>
                </div>
              ),
            },
            { key: "s", header: "Stage", cell: (a) => <StatusBadge kind="outside" status={a.stage} /> },
            { key: "a", header: "Ask", numeric: true, cell: (a) => moneyText(a.askAmount) },
          ]}
          empty={
            <EmptyState icon={Archive} title="Nothing archived">
              Archived applications are kept here for your records.
            </EmptyState>
          }
        />
      )}
    </Loaded>
  );
}

export default function Applications() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const applicant = useApplicantApi();
  const { meState } = useServices();
  const meId = meState.status === "ready" ? meState.me.userId : null;
  const openGrants = useAppConfig().available?.openGrants !== false;
  const query = useOutsideQuery(
    async (api) => {
      const [pipeline, outside, members, records] = await Promise.all([api.pipeline(), api.list(), applicant.members().catch(() => [] as ApplicantMember[]), api.funderRecords().catch(() => [])]);
      return { rows: rowsOf(base, pipeline, outside), members, records };
    },
    [ws.id, applicant],
  );
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "board" ? "board" : "list";
  const setView = (v: "list" | "board") => {
    const next = new URLSearchParams(params);
    if (v === "board") next.set("view", "board");
    else next.delete("view");
    setParams(next, { replace: true });
  };
  const [lane, setLane] = useState<Lane | "">("");
  const [deadline, setDeadline] = useState<DeadlineFilter>("any");
  const [owner, setOwner] = useState<string>("");
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const [dialog, setDialog] = useState<null | "new" | "import">(null);
  const [note, setNote] = useState<string | null>(null);
  const exporter = useOutsideMutation(async (api, format: "csv" | "json") => {
    const f = await api.exportAll(format);
    downloadBlob(f.blob, f.filename);
    return true;
  });

  const filtered = useMemo(() => {
    if (query.status !== "ready") return [];
    const needle = q.trim().toLowerCase();
    return query.data.rows
      .filter((r) => !lane || r.lane === lane)
      .filter((r) => matchesDeadline(r.deadline, deadline))
      .filter((r) => !owner || (owner === "none" ? !r.owner : r.owner?.userId === (owner === "me" ? meId : owner)))
      .filter((r) => !needle || `${r.item.title} ${r.item.funderName ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || LANES.indexOf(a.lane) - LANES.indexOf(b.lane));
  }, [query, lane, deadline, owner, q, meId]);

  const columns: Column<Row>[] = [
    { key: "title", header: "Application", cell: (r) => <Title row={r} />, sort: (r) => r.item.title.toLowerCase() },
    { key: "stage", header: "Stage", cell: (r) => <StageCell row={r} />, sort: (r) => LANES.indexOf(r.lane) },
    { key: "deadline", header: "Next deadline", cell: (r) => <DeadlineText date={r.deadline} />, sort: (r) => r.deadline },
    { key: "ask", header: "Ask", numeric: true, cell: (r) => moneyText(r.outside?.askAmount), sort: (r) => (r.outside?.askAmount ? Number(r.outside.askAmount.amount) : null) },
    { key: "owner", header: "Owner", cell: (r) => (r.owner ? (r.owner.name ?? (query.status === "ready" ? query.data.members.find((m) => m.userId === r.owner!.userId)?.name : null) ?? "A teammate") : <span className="muted">—</span>) },
    { key: "questions", header: "Answers", cell: (r) => (r.outside && r.outside.questionCounts.total ? `${r.outside.questionCounts.approved} of ${r.outside.questionCounts.total} approved` : <span className="muted">—</span>) },
  ];

  return (
    <>
      <title>{`Applications — ${ws.name}`}</title>
      <ApplicantShell
        active="Applications"
        overlay={
          <>
        {dialog === "new" && <NewApplicationDialog base={base} records={query.status === "ready" ? query.data.records : []} openGrants={openGrants} onClose={() => setDialog(null)} />}
        {dialog === "import" && (
          <ImportDialog
            onClose={() => setDialog(null)}
            onImported={(n) => {
              setDialog(null);
              setNote(`${n} application${n === 1 ? "" : "s"} imported`);
              query.reload();
            }}
          />
        )}
          </>
        }
      >
        <main className="main">
          <div className="ph">
            <div>
              <div className="title">
                <h1>Applications</h1>
              </div>
              <div className="meta">
                <span>Every application you are working on, to funders on this GMS and anywhere else. Only your team sees this.</span>
              </div>
            </div>
            <div className="actions">
              <button type="button" className="btn btn-primary" aria-haspopup="dialog" onClick={() => setDialog("new")}>
                <Plus className="ic" aria-hidden="true" />
                New application
              </button>
              <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => setDialog("import")}>
                <Upload className="ic" aria-hidden="true" />
                Import
              </button>
              <label className="sr" htmlFor="apps-export">
                Export
              </label>
              <select
                id="apps-export"
                className="sel"
                style={{ width: "auto", height: "36px" }}
                value=""
                onChange={(e) => {
                  const v = e.target.value as "csv" | "json" | "";
                  if (v) void exporter.run(v);
                }}
              >
                <option value="" disabled>
                  Export…
                </option>
                <option value="csv">Spreadsheet (CSV)</option>
                <option value="json">Data (JSON)</option>
              </select>
              <Download className="ic" aria-hidden="true" style={{ alignSelf: "center" }} />
            </div>
          </div>
          {note && <Notice tone="ok" title={note} />}
          {exporter.error ? <ErrorBanner error={exporter.error} title="The export did not start" /> : null}

          <div className="filterbar" role="group" aria-label="Filters">
            <div className="seg" role="group" aria-label="View">
              <button type="button" className={view === "list" ? "on" : undefined} aria-pressed={view === "list"} onClick={() => setView("list")}>
                <LayoutList className="ic ic-sm" aria-hidden="true" />
                List
              </button>
              <button type="button" className={view === "board" ? "on" : undefined} aria-pressed={view === "board"} onClick={() => setView("board")}>
                <Kanban className="ic ic-sm" aria-hidden="true" />
                Board
              </button>
            </div>
            <div className="inp-icon" style={{ flex: "1 1 200px", maxWidth: "280px" }}>
              <Search className="ic" aria-hidden="true" />
              <input className="inp" type="search" aria-label="Search applications" placeholder="Title or funder" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <label className="sr" htmlFor="apps-stage">
              Stage
            </label>
            <select id="apps-stage" className="sel" style={{ width: "auto", height: "30px" }} value={lane} onChange={(e) => setLane(e.target.value as Lane | "")}>
              <option value="">All stages</option>
              {LANES.map((l) => (
                <option key={l} value={l}>
                  {LANE_LABELS[l]}
                </option>
              ))}
            </select>
            <label className="sr" htmlFor="apps-deadline">
              Deadline
            </label>
            <select id="apps-deadline" className="sel" style={{ width: "auto", height: "30px" }} value={deadline} onChange={(e) => setDeadline(e.target.value as DeadlineFilter)}>
              <option value="any">Any deadline</option>
              <option value="overdue">Overdue</option>
              <option value="7">Due in the next 7 days</option>
              <option value="30">Due in the next 30 days</option>
              <option value="none">No deadline</option>
            </select>
            <label className="sr" htmlFor="apps-owner">
              Owner
            </label>
            <select id="apps-owner" className="sel" style={{ width: "auto", height: "30px" }} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Anyone</option>
              <option value="me">Me</option>
              <option value="none">No owner</option>
              {query.status === "ready" &&
                query.data.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name ?? m.email}
                  </option>
                ))}
            </select>
            <button type="button" className={archived ? "fchip on" : "fchip"} aria-pressed={archived} onClick={() => setArchived((v) => !v)}>
              <Archive className="ic ic-sm" aria-hidden="true" />
              Archived
            </button>
          </div>

          {archived ? (
            <Archived base={base} />
          ) : (
            <Loaded query={query} label="Loading applications">
              {({ rows }) =>
                rows.length === 0 ? (
                  <div className="card">
                    <EmptyState
                      icon={FileText}
                      title="No applications yet"
                      actions={
                        <>
                          <button type="button" className="btn btn-primary" onClick={() => setDialog("new")}>
                            New application
                          </button>
                          <Link to={`${base}/find`} className="btn btn-secondary">
                            Find funding
                          </Link>
                        </>
                      }
                    >
                      Track an application to any funder here, or start one on this GMS from Find funding.
                    </EmptyState>
                  </div>
                ) : view === "board" ? (
                  <Board rows={filtered} lanes={LANES.filter((l) => (l !== "declined" && l !== "closed") || filtered.some((r) => r.lane === l) || lane === l)} />
                ) : (
                  <DataTable
                    label="Applications"
                    columns={columns}
                    rows={filtered}
                    rowKey={(r) => r.key}
                    empty={
                      <EmptyState icon={Search} title="Nothing matches these filters">
                        Clear a filter to see more.
                      </EmptyState>
                    }
                  />
                )
              }
            </Loaded>
          )}
        </main>
      </ApplicantShell>
    </>
  );
}
