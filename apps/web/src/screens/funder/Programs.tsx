// SPDX-License-Identifier: AGPL-3.0-only
// Programs: the funds a funder grants from. A program holds a budget and the defaults new
// opportunities start from. Committed and paid amounts come from the awards made from it.
import { Fragment, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Briefcase, Plus } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { AwardSummary } from "../../api/funder.ts";
import type { Submission } from "../../api/funderMoney.ts";
import type { Competition, Member, Opportunity, Program, ProgramInput } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { StatusBadge, statusLook } from "../../components/status.tsx";
import type { ProgramOwner } from "../../api/launch.ts";
import { useFundFilter } from "../../components/FundSwitcher.tsx";
import { BudgetCategoriesEditor, ProgramOutcomes, ProgramOwnerField, useProgramOwners } from "./ProgramExtras.tsx";
import { DataTable, EmptyState, ErrorBanner, Field, Loading, PageHeader, problemFor, SaveNote, type Column } from "../../components/ui.tsx";
import { formatDate, formatMinor, parseDollars } from "../../lib/format.ts";
import { t, useFunderMessages } from "./i18n.ts";

interface Draft {
  name: string;
  description: string;
  fiscalYear: string;
  budget: string;
  fundId: string;
}
const draftOf = (p: Program | undefined, fundId: string): Draft => ({
  fundId,
  name: p?.name ?? "",
  description: p?.description ?? "",
  fiscalYear: p?.fiscalYear ? String(p.fiscalYear) : "",
  budget: p?.budgetAmountMinor !== null && p?.budgetAmountMinor !== undefined ? String(p.budgetAmountMinor / 100) : "",
});

function ProgramDialog({ program, onClose, onSaved }: { program: Program | null; onClose: () => void; onSaved: (p: Program) => void }) {
  const fund = useFundFilter();
  // A new program goes into the fund chosen in the switcher, else the default fund (or the advisor's only fund).
  const startFund = program ? (fund.fundOf(program) ?? "") : (fund.current?.id ?? (fund.funds.find((f) => f.isDefault) ?? fund.funds[0])?.id ?? "");
  const [draft, setDraft] = useState<Draft>(() => draftOf(program ?? undefined, startFund));
  const [local, setLocal] = useState<Partial<Record<keyof Draft, string>>>({});
  const save = useApiMutation((api, input: ProgramInput) => (program ? api.updateProgram(program.id, input) : api.createProgram(input)));
  const set = (key: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errors: typeof local = {};
    if (!draft.name.trim()) errors.name = t("funderPrograms.problem.name");
    const year = draft.fiscalYear.trim() ? Number(draft.fiscalYear) : null;
    if (year !== null && (!Number.isInteger(year) || year < 1990 || year > 2200)) errors.fiscalYear = t("funderPrograms.problem.year");
    const budget = draft.budget.trim() ? parseDollars(draft.budget) : null;
    if (draft.budget.trim() && budget === null) errors.budget = t("funderPrograms.problem.budget");
    setLocal(errors);
    if (Object.keys(errors).length) return;
    const fundId = draft.fundId || startFund;
    const saved = await save.run({ name: draft.name.trim(), description: draft.description.trim() || null, fiscalYear: year, budgetAmountMinor: budget, ...(fundId && (!program || fundId !== fund.fundOf(program)) ? { fundId } : {}) });
    if (saved) onSaved(saved);
  }

  return (
    <Dialog open onClose={onClose} labelledBy="program-dialog-title">
      <form onSubmit={submit} noValidate>
        <div className="hd">
          <h2 id="program-dialog-title">{program ? t("funderPrograms.editProgram") : t("funderPrograms.newProgram")}</h2>
        </div>
        <div className="bd">
          {save.error !== null && <ErrorBanner error={save.error} />}
          <Field id="program-name" label={t("funderPrograms.name")} required error={local.name ?? problemFor(save.error, "name")}>
            <input className={local.name ? "inp err" : "inp"} id="program-name" value={draft.name} onChange={set("name")} aria-invalid={!!local.name} required />
          </Field>
          {fund.funds.length > 1 && (
            <Field id="program-fund" label={t("funderPrograms.fund")} help={program ? t("funderPrograms.movingAProgramMoves") : t("funderPrograms.everythingMadeInThis")} error={problemFor(save.error, "fundId")}>
              <select className="sel" id="program-fund" value={draft.fundId || startFund} onChange={set("fundId")}>
                {fund.funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field id="program-description" label={t("funderPrograms.description")} help={t("funderPrograms.shownToYourTeam")}>
            <textarea className="ta" id="program-description" value={draft.description} onChange={set("description")} />
          </Field>
          <div className="fld-row">
            <Field id="program-fy" label={t("funderPrograms.fiscalYear")} error={local.fiscalYear}>
              <input className={local.fiscalYear ? "inp err" : "inp"} id="program-fy" inputMode="numeric" value={draft.fiscalYear} onChange={set("fiscalYear")} placeholder="2027" />
            </Field>
            <Field id="program-budget" label={t("funderPrograms.budgetUsd")} help={t("funderPrograms.thePanelAllocatorRefuses")} error={local.budget}>
              <input className={local.budget ? "inp err" : "inp"} id="program-budget" inputMode="decimal" value={draft.budget} onChange={set("budget")} placeholder="1,200,000" />
            </Field>
          </div>
        </div>
        <div className="ft">
          <SaveNote state={save.state === "saving" ? "saving" : "idle"} />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("funderPrograms.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.state === "saving"}>
            {program ? t("funderPrograms.saveProgram") : t("funderPrograms.createProgram")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ProgramDetail({ program, opportunities, awards, competitions, received, submissions, base, onEdit, owner, members, onOwnerChanged, fundName }: { owner: ProgramOwner | null; members: Member[]; onOwnerChanged: () => void; program: Program; opportunities: Opportunity[]; awards: AwardSummary[]; competitions: Competition[]; received: Map<string, number | null>; submissions: Submission[]; base: string; onEdit: () => void; fundName: string | null }) {
  const defaults = program.defaults as { reminderPlan?: number[] };
  const competitionOf = (o: Opportunity) => competitions.find((c) => c.opportunityId === o.id);
  const byStatus = (["offered", "accepted", "active", "suspended", "completed"] as const).map((status) => {
    const rows = awards.filter((a) => a.status === status);
    return { status, count: rows.length, minor: rows.reduce((n, a) => n + (a.awardedAmountMinor ?? 0), 0) };
  });
  const committed = byStatus.reduce((n, r) => n + r.minor, 0);
  const over = program.budgetAmountMinor !== null && committed > program.budgetAmountMinor;
  const awardIds = new Set(awards.map((a) => a.id));
  const reports = submissions.filter((r) => r.awardId && awardIds.has(r.awardId));
  const accepted = reports.filter((r) => r.status === "accepted").length;
  return (
    <section className="card" aria-labelledby="program-detail-title">
      <div className="card-h" style={{ padding: "16px 20px" }}>
        <div>
          <h2 id="program-detail-title" style={{ fontSize: "18px" }}>
            {program.name}
          </h2>
          <div className="small muted" style={{ marginTop: "4px" }}>
            {[
              ...(fundName ? [fundName] : []),
              program.fiscalYear ? t("funderPrograms.fy", { fiscalYear: String(program.fiscalYear) }) : t("funderPrograms.noFiscalYear"),
              t("funderPrograms.budgetAmount", { amount: formatMinor(program.budgetAmountMinor, program.currency) }),
              owner ? t("funderPrograms.owner", { name: owner.name }) : t("funderPrograms.noOwner"),
              t("funderPrograms.updatedOn", { date: formatDate(program.updatedAt) }),
            ].join(" · ")}
          </div>
        </div>
        <div className="row" style={{ gap: "8px" }}>
          <button type="button" className="btn btn-secondary" onClick={onEdit}>
            {t("funderPrograms.editProgram")}
          </button>
          <Link to={`${base}/opportunities/new?program=${program.id}`} className="btn btn-primary">
            <Plus className="ic" aria-hidden="true" />
            {t("funderPrograms.newOpportunity")}
          </Link>
        </div>
      </div>
      <div className="card-b" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "24px", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: "0" }}>
          {program.description && <p>{program.description}</p>}
          <ProgramOwnerField programId={program.id} owner={owner} members={members} onChanged={onOwnerChanged} />
          <h3>{t("funderPrograms.opportunities")}</h3>
          <DataTable
            label={t("funderPrograms.opportunitiesIn", { name: program.name })}
            rows={opportunities}
            rowKey={(o) => o.id}
            empty={
              <EmptyState icon={Briefcase} title={t("funderPrograms.noOpportunitiesInThis")}>
                {t("funderPrograms.anOpportunityIsWhat")}
              </EmptyState>
            }
            columns={[
              { key: "title", header: t("funderPrograms.opportunity"), cell: (o) => <Link to={`${base}/opportunities/${o.id}/edit`} className="b" style={{ color: "#0D2A43" }}>{o.title}</Link>, sort: (o) => o.title },
              { key: "status", header: t("funderPrograms.status"), cell: (o) => <StatusBadge kind="opportunity" status={o.status} label={o.published ? undefined : t("funderPrograms.draft")} /> },
              { key: "stage", header: t("funderPrograms.stage"), cell: (o) => { const c = competitionOf(o); return c ? `${c.stages.map((st) => st.label).join(" → ")}${c.status === "open" ? "" : ` · ${statusLook("competition", c.status).label}`}` : t("funderPrograms.noCompetition"); } },
              { key: "apps", header: t("funderPrograms.applications"), numeric: true, cell: (o) => { const c = competitionOf(o); return c ? (received.get(c.id) ?? "—") : "—"; } },
              { key: "closes", header: t("funderPrograms.closes"), cell: (o) => formatDate(o.keyDates.closeDate?.date), sort: (o) => o.keyDates.closeDate?.date ?? null },
              { key: "go", header: "", numeric: true, cell: (o) => <Link to={`${base}/opportunities/${o.id}/competition`} className="btn btn-sm btn-secondary">{t("funderPrograms.competition")}</Link> },
            ]}
          />
        </div>
        <div className="card" style={{ background: "#F7FAFA" }}>
          <div className="card-h" style={{ padding: "12px 16px" }}>
            <h3 style={{ fontSize: "14px" }}>{t("funderPrograms.programDefaults")}</h3>
          </div>
          <div className="card-b" style={{ padding: "14px 16px" }}>
            <dl className="kv" style={{ gridTemplateColumns: "120px minmax(0, 1fr)" }}>
              <dt>{t("funderPrograms.budget2")}</dt>
              <dd>{formatMinor(program.budgetAmountMinor, program.currency)}</dd>
              <dt>{t("funderPrograms.currency")}</dt>
              <dd>{program.currency}</dd>
              <dt>{t("funderPrograms.reminderPlan")}</dt>
              <dd>{defaults.reminderPlan?.length ? t("funderPrograms.daysFromTheDue", { days: defaults.reminderPlan.map((d) => (d > 0 ? `+${d}` : String(d))).join(", ") }) : t("funderPrograms.workspaceDefault")}</dd>
            </dl>
          </div>
          <div className="card-h" style={{ padding: "12px 16px", borderTop: "1px solid var(--og-gray-200)" }}>
            <h3 style={{ fontSize: "14px" }}>{t("funderPrograms.committedByStatus")}</h3>
            <span className={over ? "small b var-neg" : "small muted"}>{formatMinor(committed, program.currency)}</span>
          </div>
          <div className="card-b" style={{ padding: "14px 16px" }}>
            {over && (
              <div className="bnr bnr-dng" role="status" style={{ marginBottom: "10px" }}>
                <div>
                  <div className="t">{t("funderPrograms.overCommittedBy", { amount: formatMinor(committed - program.budgetAmountMinor!, program.currency) })}</div>
                  <div className="d">{t("funderPrograms.awardsExceedThisPrograms")}</div>
                </div>
              </div>
            )}
            <dl className="kv" style={{ gridTemplateColumns: "120px minmax(0, 1fr)" }}>
              {byStatus.map((r) => (
                <Fragment key={r.status}>
                  <dt>
                    <StatusBadge kind="award" status={r.status} />
                  </dt>
                  <dd>
                    {r.count} · {formatMinor(r.minor, program.currency)}
                  </dd>
                </Fragment>
              ))}
            </dl>
          </div>
          <ProgramOutcomes programId={program.id} reportsTotal={reports.length} reportsAccepted={accepted} base={base} />
          <BudgetCategoriesEditor programId={program.id} />
        </div>
      </div>
    </section>
  );
}

export default function Programs() {
  useFunderMessages();
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const { programId } = useParams();
  const navigate = useNavigate();
  const data = useApiQuery(async (api) => {
    const [programs, opportunities, portfolio, awards, competitions, submissions] = await Promise.all([
      api.listPrograms(),
      api.listOpportunities(),
      api.portfolio().catch(() => null),
      api.listAwards().catch(() => []),
      api.listCompetitions().catch(() => []),
      api.listSubmissions().catch(() => []),
    ]);
    const received = await Promise.all(competitions.map(async (c) => [c.id, (await api.listApplications({ competitionId: c.id, pageSize: 1 }).catch(() => null))?.total ?? null] as const));
    return { programs, opportunities, money: new Map((portfolio?.programs ?? []).map((m) => [m.programId, m])), awards, competitions, submissions, received: new Map(received) };
  }, [ws.id]);
  const [dialog, setDialog] = useState<{ program: Program | null } | null>(null);

  const fund = useFundFilter();
  // The fund chosen in the switcher narrows the list; the API already left out funds the person does not work on.
  const programs = data.status === "ready" ? data.data.programs.filter(fund.keepProgram) : [];
  const opportunities = data.status === "ready" ? data.data.opportunities : [];
  const selected = programs.find((p) => p.id === programId) ?? null;
  const countFor = (p: Program) => opportunities.filter((o) => o.programId === p.id).length;
  const totalBudget = programs.reduce((sum, p) => sum + (p.budgetAmountMinor ?? 0), 0);
  const moneyFor = (p: Program) => (data.status === "ready" ? data.data.money.get(p.id) : undefined);
  const owners = useProgramOwners();
  const members = useApiQuery((api) => api.listMembers(ws.id), [ws.id]);

  // An unknown id in the URL (an old link) falls back to the list.
  useEffect(() => {
    if (data.status === "ready" && programId && !selected) navigate(`${base}/programs`, { replace: true });
  }, [data.status, programId, selected, navigate, base]);

  const columns: Column<Program>[] = [
    { key: "name", header: t("funderPrograms.program"), cell: (p) => <Link to={`${base}/programs/${p.id}`} className="b" style={{ color: "#0D2A43" }}>{p.name}</Link>, sort: (p) => p.name },
    ...(fund.several && !fund.current ? [{ key: "fund", header: t("funderPrograms.fund"), cell: (p: Program) => fund.nameOf(fund.fundOf(p)) ?? "—", sort: (p: Program) => fund.nameOf(fund.fundOf(p)) } satisfies Column<Program>] : []),
    { key: "fy", header: t("funderPrograms.fy2"), cell: (p) => p.fiscalYear ?? "—", sort: (p) => p.fiscalYear },
    { key: "budget", header: t("funderPrograms.budget2"), numeric: true, cell: (p) => formatMinor(p.budgetAmountMinor, p.currency), sort: (p) => p.budgetAmountMinor },
    { key: "committed", header: t("funderPrograms.committed"), numeric: true, cell: (p) => formatMinor(moneyFor(p)?.committedMinor ?? 0, p.currency), sort: (p) => moneyFor(p)?.committedMinor ?? 0 },
    { key: "paid", header: t("funderPrograms.paid"), numeric: true, cell: (p) => formatMinor(moneyFor(p)?.paidMinor ?? 0, p.currency), sort: (p) => moneyFor(p)?.paidMinor ?? 0 },
    {
      key: "remaining",
      header: t("funderPrograms.remaining"),
      numeric: true,
      cell: (p) => {
        if (p.budgetAmountMinor === null) return "—";
        const left = p.budgetAmountMinor - (moneyFor(p)?.committedMinor ?? 0);
        return <span className={left < 0 ? "var-neg b" : undefined}>{formatMinor(left, p.currency)}</span>;
      },
      sort: (p) => (p.budgetAmountMinor === null ? null : p.budgetAmountMinor - (moneyFor(p)?.committedMinor ?? 0)),
    },
    { key: "owner", header: t("funderPrograms.owner2"), cell: (p) => owners.data?.[p.id]?.name ?? <span className="muted">—</span>, sort: (p) => owners.data?.[p.id]?.name ?? null },
    { key: "opps", header: t("funderPrograms.opportunities"), numeric: true, cell: countFor, sort: countFor },
  ];

  return (
    <FunderShell active="Programs">
      <title>{t("funderPrograms.programs", { name: ws.name })}</title>
      <main className="main">
        <PageHeader
          crumbs={[{ label: ws.name, to: base }, { label: t("funderPrograms.programs2"), ...(selected ? { to: `${base}/programs` } : {}) }, ...(selected ? [{ label: selected.name }] : [])]}
          title={t("funderPrograms.programs2")}
          meta={
            data.status === "ready" && (
              <>
                <span>
                  {t("funderPrograms.programCount", { count: programs.length })}
                </span>
                <span>·</span>
                <span>{t("funderPrograms.budgeted", { amount: formatMinor(totalBudget) })}</span>
                {fund.current && (
                  <>
                    <span>·</span>
                    <span>{fund.current.name}</span>
                  </>
                )}
              </>
            )
          }
          actions={
            <button type="button" className="btn btn-primary" onClick={() => setDialog({ program: null })}>
              <Plus className="ic" aria-hidden="true" />
              {t("funderPrograms.newProgram")}
            </button>
          }
        />
        {data.status === "loading" && <Loading label={t("funderPrograms.loadingPrograms")} />}
        {data.status === "error" && <ErrorBanner error={data.error} onRetry={data.reload} title={t("funderPrograms.programsCouldNotBe")} />}
        {data.status === "ready" && (
          <>
            <DataTable
              label={t("funderPrograms.programs2")}
              rows={programs}
              rowKey={(p) => p.id}
              selectedKey={selected?.id ?? null}
              columns={columns}
              empty={
                <EmptyState
                  icon={Briefcase}
                  title={t("funderPrograms.startWithAProgram")}
                  actions={
                    <button type="button" className="btn btn-primary" onClick={() => setDialog({ program: null })}>
                      {t("funderPrograms.createAProgram")}
                    </button>
                  }
                >
                  {t("funderPrograms.aProgramHoldsA")}
                </EmptyState>
              }
            />
            {selected && (
              <ProgramDetail
                owner={owners.data?.[selected.id] ?? null}
                members={members.data ?? []}
                onOwnerChanged={owners.reload}
                program={selected}
                opportunities={opportunities.filter((o) => o.programId === selected.id)}
                awards={data.data.awards.filter((a) => a.programId === selected.id)}
                competitions={data.data.competitions}
                received={data.data.received}
                submissions={data.data.submissions}
                base={base}
                onEdit={() => setDialog({ program: selected })}
                fundName={fund.several ? fund.nameOf(fund.fundOf(selected)) : null}
              />
            )}
          </>
        )}
        {dialog && (
          <ProgramDialog
            program={dialog.program}
            onClose={() => setDialog(null)}
            onSaved={(p) => {
              setDialog(null);
              data.reload();
              fund.reload();
              navigate(`${base}/programs/${p.id}`);
            }}
          />
        )}
      </main>
    </FunderShell>
  );
}
