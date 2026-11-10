// SPDX-License-Identifier: AGPL-3.0-only
// Programs: the funds a funder grants from. A program holds a budget and the defaults new
// opportunities start from. Committed and paid amounts join this screen with awards (phase 3).
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Briefcase, Plus } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { Opportunity, Program, ProgramInput } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { DataTable, EmptyState, ErrorBanner, Field, Loading, PageHeader, problemFor, SaveNote, type Column } from "../../components/ui.tsx";
import { formatDate, formatMinor, parseDollars } from "../../lib/format.ts";

interface Draft {
  name: string;
  description: string;
  fiscalYear: string;
  budget: string;
}
const draftOf = (p?: Program): Draft => ({
  name: p?.name ?? "",
  description: p?.description ?? "",
  fiscalYear: p?.fiscalYear ? String(p.fiscalYear) : "",
  budget: p?.budgetAmountMinor !== null && p?.budgetAmountMinor !== undefined ? String(p.budgetAmountMinor / 100) : "",
});

function ProgramDialog({ program, onClose, onSaved }: { program: Program | null; onClose: () => void; onSaved: (p: Program) => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(program ?? undefined));
  const [local, setLocal] = useState<Partial<Record<keyof Draft, string>>>({});
  const save = useApiMutation((api, input: ProgramInput) => (program ? api.updateProgram(program.id, input) : api.createProgram(input)));
  const set = (key: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errors: typeof local = {};
    if (!draft.name.trim()) errors.name = "Give the program a name";
    const year = draft.fiscalYear.trim() ? Number(draft.fiscalYear) : null;
    if (year !== null && (!Number.isInteger(year) || year < 1990 || year > 2200)) errors.fiscalYear = "Enter a four-digit year";
    const budget = draft.budget.trim() ? parseDollars(draft.budget) : null;
    if (draft.budget.trim() && budget === null) errors.budget = "Enter an amount in dollars, such as 1,200,000";
    setLocal(errors);
    if (Object.keys(errors).length) return;
    const saved = await save.run({ name: draft.name.trim(), description: draft.description.trim() || null, fiscalYear: year, budgetAmountMinor: budget });
    if (saved) onSaved(saved);
  }

  return (
    <Dialog open onClose={onClose} labelledBy="program-dialog-title">
      <form onSubmit={submit} noValidate>
        <div className="hd">
          <h2 id="program-dialog-title">{program ? "Edit program" : "New program"}</h2>
        </div>
        <div className="bd">
          {save.error !== null && <ErrorBanner error={save.error} />}
          <Field id="program-name" label="Name" required error={local.name ?? problemFor(save.error, "name")}>
            <input className={local.name ? "inp err" : "inp"} id="program-name" value={draft.name} onChange={set("name")} aria-invalid={!!local.name} required />
          </Field>
          <Field id="program-description" label="Description" help="Shown to your team. The public page describes each opportunity separately.">
            <textarea className="ta" id="program-description" value={draft.description} onChange={set("description")} />
          </Field>
          <div className="fld-row">
            <Field id="program-fy" label="Fiscal year" error={local.fiscalYear}>
              <input className={local.fiscalYear ? "inp err" : "inp"} id="program-fy" inputMode="numeric" value={draft.fiscalYear} onChange={set("fiscalYear")} placeholder="2027" />
            </Field>
            <Field id="program-budget" label="Budget (USD)" help="The panel allocator refuses decisions that exceed it." error={local.budget}>
              <input className={local.budget ? "inp err" : "inp"} id="program-budget" inputMode="decimal" value={draft.budget} onChange={set("budget")} placeholder="1,200,000" />
            </Field>
          </div>
        </div>
        <div className="ft">
          <SaveNote state={save.state === "saving" ? "saving" : "idle"} />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.state === "saving"}>
            {program ? "Save program" : "Create program"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ProgramDetail({ program, opportunities, base, onEdit }: { program: Program; opportunities: Opportunity[]; base: string; onEdit: () => void }) {
  const defaults = program.defaults as { reminderPlan?: number[] };
  return (
    <section className="card" aria-labelledby="program-detail-title">
      <div className="card-h" style={{ padding: "16px 20px" }}>
        <div>
          <h2 id="program-detail-title" style={{ fontSize: "18px" }}>
            {program.name}
          </h2>
          <div className="small muted" style={{ marginTop: "4px" }}>
            {program.fiscalYear ? `FY${program.fiscalYear}` : "No fiscal year"} · Budget {formatMinor(program.budgetAmountMinor, program.currency)} · Updated {formatDate(program.updatedAt)}
          </div>
        </div>
        <div className="row" style={{ gap: "8px" }}>
          <button type="button" className="btn btn-secondary" onClick={onEdit}>
            Edit program
          </button>
          <Link to={`${base}/opportunities/new?program=${program.id}`} className="btn btn-primary">
            <Plus className="ic" aria-hidden="true" />
            New opportunity
          </Link>
        </div>
      </div>
      <div className="card-b" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "24px", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: "0" }}>
          {program.description && <p>{program.description}</p>}
          <h3>Opportunities</h3>
          <DataTable
            label={`Opportunities in ${program.name}`}
            rows={opportunities}
            rowKey={(o) => o.id}
            empty={
              <EmptyState icon={Briefcase} title="No opportunities in this program yet">
                An opportunity is what applicants see and apply to. Create one to start a cycle.
              </EmptyState>
            }
            columns={[
              { key: "title", header: "Opportunity", cell: (o) => <Link to={`${base}/opportunities/${o.id}/edit`} className="b" style={{ color: "#0D2A43" }}>{o.title}</Link>, sort: (o) => o.title },
              { key: "status", header: "Status", cell: (o) => <StatusBadge kind="opportunity" status={o.status} label={o.published ? undefined : "Draft"} /> },
              { key: "closes", header: "Closes", cell: (o) => formatDate(o.keyDates.closeDate?.date), sort: (o) => o.keyDates.closeDate?.date ?? null },
              { key: "go", header: "", numeric: true, cell: (o) => <Link to={`${base}/opportunities/${o.id}/competition`} className="btn btn-sm btn-secondary">Competition</Link> },
            ]}
          />
        </div>
        <div className="card" style={{ background: "#F7FAFA" }}>
          <div className="card-h" style={{ padding: "12px 16px" }}>
            <h3 style={{ fontSize: "14px" }}>Program defaults</h3>
          </div>
          <div className="card-b" style={{ padding: "14px 16px" }}>
            <dl className="kv" style={{ gridTemplateColumns: "120px minmax(0, 1fr)" }}>
              <dt>Budget</dt>
              <dd>{formatMinor(program.budgetAmountMinor, program.currency)}</dd>
              <dt>Currency</dt>
              <dd>{program.currency}</dd>
              <dt>Reminder plan</dt>
              <dd>{defaults.reminderPlan?.length ? `${defaults.reminderPlan.map((d) => (d > 0 ? `+${d}` : String(d))).join(", ")} days from the due date` : "Workspace default"}</dd>
            </dl>
            <p className="small muted" style={{ marginTop: "10px" }}>
              Committed and paid amounts appear here once awards are made from this program.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Programs() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const { programId } = useParams();
  const navigate = useNavigate();
  const data = useApiQuery(async (api) => {
    const [programs, opportunities] = await Promise.all([api.listPrograms(), api.listOpportunities()]);
    return { programs, opportunities };
  }, [ws.id]);
  const [dialog, setDialog] = useState<{ program: Program | null } | null>(null);

  const programs = data.status === "ready" ? data.data.programs : [];
  const opportunities = data.status === "ready" ? data.data.opportunities : [];
  const selected = programs.find((p) => p.id === programId) ?? null;
  const countFor = (p: Program) => opportunities.filter((o) => o.programId === p.id).length;
  const totalBudget = programs.reduce((sum, p) => sum + (p.budgetAmountMinor ?? 0), 0);

  // An unknown id in the URL (an old link) falls back to the list.
  useEffect(() => {
    if (data.status === "ready" && programId && !selected) navigate(`${base}/programs`, { replace: true });
  }, [data.status, programId, selected, navigate, base]);

  const columns: Column<Program>[] = [
    { key: "name", header: "Program", cell: (p) => <Link to={`${base}/programs/${p.id}`} className="b" style={{ color: "#0D2A43" }}>{p.name}</Link>, sort: (p) => p.name },
    { key: "fy", header: "FY", cell: (p) => p.fiscalYear ?? "—", sort: (p) => p.fiscalYear },
    { key: "budget", header: "Budget", numeric: true, cell: (p) => formatMinor(p.budgetAmountMinor, p.currency), sort: (p) => p.budgetAmountMinor },
    { key: "opps", header: "Opportunities", numeric: true, cell: countFor, sort: countFor },
  ];

  return (
    <FunderShell active="Programs">
      <title>{`Programs — ${ws.name}`}</title>
      <main className="main">
        <PageHeader
          crumbs={[{ label: ws.name, to: base }, { label: "Programs", ...(selected ? { to: `${base}/programs` } : {}) }, ...(selected ? [{ label: selected.name }] : [])]}
          title="Programs"
          meta={
            data.status === "ready" && (
              <>
                <span>
                  {programs.length} program{programs.length === 1 ? "" : "s"}
                </span>
                <span>·</span>
                <span>{formatMinor(totalBudget)} budgeted</span>
              </>
            )
          }
          actions={
            <button type="button" className="btn btn-primary" onClick={() => setDialog({ program: null })}>
              <Plus className="ic" aria-hidden="true" />
              New program
            </button>
          }
        />
        {data.status === "loading" && <Loading label="Loading programs" />}
        {data.status === "error" && <ErrorBanner error={data.error} onRetry={data.reload} title="Programs could not be loaded" />}
        {data.status === "ready" && (
          <>
            <DataTable
              label="Programs"
              rows={programs}
              rowKey={(p) => p.id}
              selectedKey={selected?.id ?? null}
              columns={columns}
              empty={
                <EmptyState
                  icon={Briefcase}
                  title="Start with a program"
                  actions={
                    <button type="button" className="btn btn-primary" onClick={() => setDialog({ program: null })}>
                      Create a program
                    </button>
                  }
                >
                  A program holds a budget, default rubric and templates. Opportunities, competitions and awards hang off it.
                </EmptyState>
              }
            />
            {selected && <ProgramDetail program={selected} opportunities={opportunities.filter((o) => o.programId === selected.id)} base={base} onEdit={() => setDialog({ program: selected })} />}
          </>
        )}
        {dialog && (
          <ProgramDialog
            program={dialog.program}
            onClose={() => setDialog(null)}
            onSaved={(p) => {
              setDialog(null);
              data.reload();
              navigate(`${base}/programs/${p.id}`);
            }}
          />
        )}
      </main>
    </FunderShell>
  );
}
