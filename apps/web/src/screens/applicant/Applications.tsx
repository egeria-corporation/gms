// SPDX-License-Identifier: AGPL-3.0-only
// The applicant's pipeline: every application in one place, whether it is to a funder on this GMS
// or anywhere else, plus opportunities saved on this GMS. A list or a board by stage, filtered by
// stage, deadline and owner. New applications start from an OpenGrants listing, a pasted link or
// typed details; a spreadsheet can be imported, and everything exported.
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Archive, CalendarDays, FileText, Kanban, LayoutList, Plus, Search, Upload } from "lucide-react";
import type { ApplicantMember } from "../../api/applicant.ts";
import { useApplicantApi } from "../../api/applicantHooks.ts";
import { useAppConfig } from "../../api/launchHooks.ts";
import type { OutsideListItem, OwnerRef, PipelineItem } from "../../api/outside.ts";
import { useOutsideMutation, useOutsideQuery } from "../../api/outsideHooks.ts";
import { useServices } from "../../app/services.tsx";
import { useWorkspace } from "../../app/workspace.tsx";
import { Loaded } from "../../components/applicant.tsx";
import { RequirementsCalendar, type CalendarItem } from "../../components/RequirementsCalendar.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { DataTable, EmptyState, ErrorBanner, type Column } from "../../components/ui.tsx";
import { downloadBlob } from "../../lib/browser.ts";
import { daysUntil, formatDate } from "../../lib/format.ts";
import { NewApplicationDialog } from "./outside/NewApplicationDialog.tsx";
import { DEADLINE_LABELS, DeadlineText, moneyText, nextDeadline } from "./outside/shared.tsx";
import { t, useApplicantText } from "./i18n.ts";

/** Board columns. Built-in applications are placed by their status; withdrawn and not pursuing share "Closed". */
export const LANES = ["prospect", "deciding", "loi", "invited", "drafting", "submitted", "awarded", "declined", "closed"] as const;
export type Lane = (typeof LANES)[number];
/** Each lane's name, read in the page's language every time. */
export const LANE_LABELS: Record<Lane, string> = {
  get prospect() { return t("pipeline.lane.prospect"); },
  get deciding() { return t("pipeline.lane.deciding"); },
  get loi() { return t("pipeline.lane.loi"); },
  get invited() { return t("pipeline.lane.invited"); },
  get drafting() { return t("pipeline.lane.drafting"); },
  get submitted() { return t("pipeline.lane.submitted"); },
  get awarded() { return t("pipeline.lane.awarded"); },
  get declined() { return t("pipeline.lane.declined"); },
  get closed() { return t("pipeline.lane.closed"); },
};
/** Always on the board; the other lanes appear once something is in them. */
const CORE_LANES: ReadonlySet<Lane> = new Set(["prospect", "drafting", "submitted", "awarded"]);
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
  if (row.item.kind === "saved_gms") return <StatusBadge kind="outside" status="prospect" label={t("pipeline.saved")} />;
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
        {row.item.kind !== "outside_application" && <span className="tag">{t("pipeline.onThisGms")}</span>}
      </span>
    </div>
  );
}

function Board({ rows, lanes }: { rows: Row[]; lanes: Lane[] }) {
  return (
    <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("pipeline.boardScrollable")} style={{ border: 0, background: "transparent", overflowX: "auto" }}>
      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", paddingBottom: "8px" }}>
        {lanes.map((lane) => {
          const mine = rows.filter((r) => r.lane === lane);
          return (
            <section key={lane} aria-label={`${LANE_LABELS[lane]}, ${mine.length}`} style={{ flex: "0 0 232px", background: "var(--og-gray-50)", border: "1px solid var(--og-gray-200)", borderRadius: "10px", padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <h2 className="row" style={{ fontSize: "13px", justifyContent: "space-between", gap: "6px" }}>
                {LANE_LABELS[lane]}
                <span className="tag">{mine.length}</span>
              </h2>
              {mine.length === 0 && <p className="small muted">{t("pipeline.nothingHere")}</p>}
              {mine.map((r) => (
                <article key={r.key} className="card" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "6px" }} aria-label={r.item.title}>
                  <Link to={r.href} className="b" style={{ fontSize: "14px", overflowWrap: "anywhere" }}>
                    {r.item.title}
                  </Link>
                  <span className="small muted">{r.item.funderName ?? ""}</span>
                  <div className="row" style={{ gap: "6px", flexWrap: "wrap" }}>
                    <StageCell row={r} />
                    {r.item.kind !== "outside_application" && <span className="tag">{t("pipeline.onThisGms")}</span>}
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

/** Every deadline still to meet: an outside application's letter of inquiry, full and internal dates, a built-in application's stage close. */
export function deadlinesOf(rows: Row[]): { id: string; date: string; what: string; row: Row }[] {
  return rows.flatMap((r) => {
    if (["submitted", "awarded", "declined", "closed"].includes(r.lane)) return [];
    // Past the letter of inquiry (invited or drafting), its deadline is behind the application, not due.
    const pastLoi = r.lane === "invited" || r.lane === "drafting";
    if (r.outside) return (Object.keys(DEADLINE_LABELS) as (keyof typeof DEADLINE_LABELS)[]).flatMap((k) => (r.outside!.deadlines[k] && !(k === "loiDue" && pastLoi) ? [{ id: `${r.key}:${k}`, date: r.outside!.deadlines[k]!, what: DEADLINE_LABELS[k], row: r }] : []));
    return r.deadline ? [{ id: `${r.key}:next`, date: r.deadline, what: r.item.kind === "gms_application" ? t("pipeline.stageCloses") : t("pipeline.deadline"), row: r }] : [];
  });
}

/** The pipeline as a month of deadlines; a day with something due lists what, and the list below follows the day chosen. */
function CalendarView({ rows }: { rows: Row[] }) {
  const [day, setDay] = useState<string | null>(null);
  const all = deadlinesOf(rows).sort((a, b) => a.date.localeCompare(b.date));
  const items: CalendarItem[] = all.map((d) => {
    const n = daysUntil(d.date) ?? 0;
    return { id: d.id, date: d.date, label: `${d.what}: ${d.row.item.title}`, tone: n < 0 ? "overdue" : n <= 7 ? "due" : "scheduled" };
  });
  const shown = day ? all.filter((d) => d.date.slice(0, 10) === day) : all.filter((d) => (daysUntil(d.date) ?? -1) >= 0).slice(0, 12);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
      <RequirementsCalendar items={items} selectedDay={day} onSelectDay={setDay} legend={["overdue", "due", "scheduled"]} label={t("pipeline.deadlines")} />
      <section className="card" aria-labelledby="cal-list-h">
        <div className="card-h">
          <h2 id="cal-list-h" style={{ fontSize: "16px" }}>
            {day ? t("pipeline.dueOn", { date: formatDate(day) }) : t("pipeline.comingUp")}
          </h2>
          {day && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDay(null)}>
              {t("pipeline.showAllComingUp")}
            </button>
          )}
        </div>
        <div className="card-b">
          {shown.length === 0 ? (
            <p className="muted">{day ? t("pipeline.nothingDueThatDay") : t("pipeline.noDeadlinesAhead")}</p>
          ) : (
            <ul aria-label={t("pipeline.deadlines2")} style={{ display: "flex", flexDirection: "column", gap: "10px", listStyle: "none", padding: 0, margin: 0 }}>
              {shown.map((d) => (
                <li key={d.id} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <Link to={d.row.href} className="b">
                    {d.row.item.title}
                  </Link>
                  <span className="small muted">
                    {d.what} · {d.row.item.funderName ?? ""}
                  </span>
                  <span className="small">
                    <DeadlineText date={d.date} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Archived({ base }: { base: string }) {
  const query = useOutsideQuery((api) => api.list({ archived: true }), []);
  return (
    <Loaded query={query} label={t("pipeline.loadingArchivedApplications")}>
      {(items) => (
        <DataTable
          label={t("pipeline.archivedApplications")}
          rows={items}
          rowKey={(a) => a.id}
          columns={[
            {
              key: "t",
              header: t("pipeline.col.application"),
              cell: (a) => (
                <div className="ent">
                  <Link to={`${base}/outside/${a.id}`} className="nm">
                    {a.title}
                  </Link>
                  <span className="small muted">{a.funderName}</span>
                </div>
              ),
            },
            { key: "s", header: t("pipeline.col.stage"), cell: (a) => <StatusBadge kind="outside" status={a.stage} /> },
            { key: "a", header: t("pipeline.col.ask"), numeric: true, cell: (a) => moneyText(a.askAmount) },
          ]}
          empty={
            <EmptyState icon={Archive} title={t("pipeline.nothingArchived")}>
              {t("pipeline.archivedApplicationsAreKeptHereFor")}
            </EmptyState>
          }
        />
      )}
    </Loaded>
  );
}

export default function Applications() {
  useApplicantText();
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
  const asked = params.get("view");
  const view = asked === "board" || asked === "calendar" ? asked : "list";
  const setView = (v: "list" | "board" | "calendar") => {
    const next = new URLSearchParams(params);
    if (v !== "list") next.set("view", v);
    else next.delete("view");
    setParams(next, { replace: true });
  };
  const [lane, setLane] = useState<Lane | "">("");
  const [deadline, setDeadline] = useState<DeadlineFilter>("any");
  const [owner, setOwner] = useState<string>("");
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const [dialog, setDialog] = useState<null | "new">(null);
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
    { key: "title", header: t("pipeline.col.application"), cell: (r) => <Title row={r} />, sort: (r) => r.item.title.toLowerCase() },
    { key: "stage", header: t("pipeline.col.stage"), cell: (r) => <StageCell row={r} />, sort: (r) => LANES.indexOf(r.lane) },
    { key: "deadline", header: t("pipeline.col.nextDeadline"), cell: (r) => <DeadlineText date={r.deadline} />, sort: (r) => r.deadline },
    { key: "ask", header: t("pipeline.col.ask"), numeric: true, cell: (r) => moneyText(r.outside?.askAmount), sort: (r) => (r.outside?.askAmount ? Number(r.outside.askAmount.amount) : null) },
    { key: "owner", header: t("pipeline.col.owner"), cell: (r) => (r.owner ? (r.owner.name ?? (query.status === "ready" ? query.data.members.find((m) => m.userId === r.owner!.userId)?.name : null) ?? t("pipeline.aTeammate")) : <span className="muted">—</span>) },
    { key: "questions", header: t("pipeline.col.answers"), cell: (r) => (r.outside && r.outside.questionCounts.total ? t("pipeline.answersApproved", { approved: r.outside.questionCounts.approved, total: r.outside.questionCounts.total }) : <span className="muted">—</span>) },
  ];

  return (
    <>
      <title>{t("pipeline.pageTitle", { workspace: ws.name })}</title>
      <ApplicantShell
        active="Applications"
        overlay={
          <>
        {dialog === "new" && <NewApplicationDialog base={base} records={query.status === "ready" ? query.data.records : []} openGrants={openGrants} onClose={() => setDialog(null)} />}
          </>
        }
      >
        <main className="main">
          <div className="ph">
            <div>
              <div className="title">
                <h1>{t("pipeline.applications")}</h1>
              </div>
              <div className="meta">
                <span>{t("pipeline.everyApplicationYouAreWorkingOn")}</span>
              </div>
            </div>
            <div className="actions">
              <button type="button" className="btn btn-primary" aria-haspopup="dialog" onClick={() => setDialog("new")}>
                <Plus className="ic" aria-hidden="true" />
                {t("pipeline.newApplication")}
              </button>
              <Link to={`${base}/import`} className="btn btn-secondary">
                <Upload className="ic" aria-hidden="true" />
                {t("pipeline.import")}
              </Link>
              <label className="sr" htmlFor="apps-export">
                {t("pipeline.export")}
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
                  {t("pipeline.export2")}
                </option>
                <option value="csv">{t("pipeline.spreadsheetCsv")}</option>
                <option value="json">{t("pipeline.dataJson")}</option>
              </select>
            </div>
          </div>
          {exporter.error ? <ErrorBanner error={exporter.error} title={t("pipeline.theExportDidNotStart")} /> : null}

          <div className="filterbar" role="group" aria-label={t("pipeline.filters")}>
            <div className="seg" role="group" aria-label={t("pipeline.view")}>
              <button type="button" className={view === "list" ? "on" : undefined} aria-pressed={view === "list"} onClick={() => setView("list")}>
                <LayoutList className="ic ic-sm" aria-hidden="true" />
                {t("pipeline.list")}
              </button>
              <button type="button" className={view === "board" ? "on" : undefined} aria-pressed={view === "board"} onClick={() => setView("board")}>
                <Kanban className="ic ic-sm" aria-hidden="true" />
                {t("pipeline.board")}
              </button>
              <button type="button" className={view === "calendar" ? "on" : undefined} aria-pressed={view === "calendar"} onClick={() => setView("calendar")}>
                <CalendarDays className="ic ic-sm" aria-hidden="true" />
                {t("pipeline.calendar")}
              </button>
            </div>
            <div className="inp-icon" style={{ flex: "1 1 200px", maxWidth: "280px" }}>
              <Search className="ic" aria-hidden="true" />
              <input className="inp" type="search" aria-label={t("pipeline.searchApplications")} placeholder={t("pipeline.titleOrFunder")} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <label className="sr" htmlFor="apps-stage">
              {t("pipeline.stage")}
            </label>
            <select id="apps-stage" className="sel" style={{ width: "auto", height: "30px" }} value={lane} onChange={(e) => setLane(e.target.value as Lane | "")}>
              <option value="">{t("pipeline.allStages")}</option>
              {LANES.map((l) => (
                <option key={l} value={l}>
                  {LANE_LABELS[l]}
                </option>
              ))}
            </select>
            <label className="sr" htmlFor="apps-deadline">
              {t("pipeline.deadline")}
            </label>
            <select id="apps-deadline" className="sel" style={{ width: "auto", height: "30px" }} value={deadline} onChange={(e) => setDeadline(e.target.value as DeadlineFilter)}>
              <option value="any">{t("pipeline.anyDeadline")}</option>
              <option value="overdue">{t("pipeline.overdue")}</option>
              <option value="7">{t("pipeline.dueInTheNext7Days")}</option>
              <option value="30">{t("pipeline.dueInTheNext30Days")}</option>
              <option value="none">{t("pipeline.noDeadline")}</option>
            </select>
            <label className="sr" htmlFor="apps-owner">
              {t("pipeline.owner")}
            </label>
            <select id="apps-owner" className="sel" style={{ width: "auto", height: "30px" }} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">{t("pipeline.anyone")}</option>
              <option value="me">{t("pipeline.me")}</option>
              <option value="none">{t("pipeline.noOwner")}</option>
              {query.status === "ready" &&
                query.data.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name ?? m.email}
                  </option>
                ))}
            </select>
            <button type="button" className={archived ? "fchip on" : "fchip"} aria-pressed={archived} onClick={() => setArchived((v) => !v)}>
              <Archive className="ic ic-sm" aria-hidden="true" />
              {t("pipeline.archived")}
            </button>
          </div>

          {archived ? (
            <Archived base={base} />
          ) : (
            <Loaded query={query} label={t("pipeline.loadingApplications")}>
              {({ rows }) =>
                rows.length === 0 ? (
                  <div className="card">
                    <EmptyState
                      icon={FileText}
                      title={t("pipeline.noApplicationsYet")}
                      actions={
                        <>
                          <button type="button" className="btn btn-primary" onClick={() => setDialog("new")}>
                            {t("pipeline.newApplication")}
                          </button>
                          <Link to={`${base}/find`} className="btn btn-secondary">
                            {t("pipeline.findFunding")}
                          </Link>
                        </>
                      }
                    >
                      {t("pipeline.trackAnApplicationToAnyFunder")}
                    </EmptyState>
                  </div>
                ) : view === "calendar" ? (
                  <CalendarView rows={filtered} />
                ) : view === "board" ? (
                  <Board rows={filtered} lanes={LANES.filter((l) => CORE_LANES.has(l) || filtered.some((r) => r.lane === l) || lane === l)} />
                ) : (
                  <DataTable
                    label={t("pipeline.applications")}
                    columns={columns}
                    rows={filtered}
                    rowKey={(r) => r.key}
                    empty={
                      <EmptyState icon={Search} title={t("pipeline.nothingMatchesTheseFilters")}>
                        {t("pipeline.clearAFilterToSeeMore")}
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
