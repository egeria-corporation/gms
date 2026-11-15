// SPDX-License-Identifier: AGPL-3.0-only
// Settings → Funds: the funds this workspace runs. Each fund has a name, a public address, a short
// description, a colour from the theme palette, its own budget per fiscal year shown beside its
// programs' budgets, and its advisors. An admin creates and edits funds and invites "Advisor for
// {fund}": a program officer or reviewer who then sees only that fund. Everyone else reads.
import { Fragment, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { CircleCheck, Info, Landmark, Plus, TriangleAlert, UserPlus } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { ADVISOR_ROLES, FUND_COLORS, RESERVED_FUND_SLUGS, type Fund, type FundBudgetInput, type FundColor } from "../../api/funds.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { CopyButton } from "../../components/CopyButton.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FundMark } from "../../components/FundSwitcher.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { EmptyState, ErrorBanner, Field, Loading, PageHeader, problemFor, SaveNote } from "../../components/ui.tsx";
import { formatMinor, parseDollars, slugify } from "../../lib/format.ts";
import { SettingsNav } from "./SettingsPassport.tsx";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function FundDialog({ fund, handle, onClose, onSaved }: { fund: Fund | null; handle: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(fund?.name ?? "");
  const [slug, setSlug] = useState(fund?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!fund);
  const [description, setDescription] = useState(fund?.description ?? "");
  const [color, setColor] = useState<FundColor | "">(fund?.brand.color ?? "");
  const [logoUrl, setLogoUrl] = useState(fund?.brand.logoUrl ?? "");
  const [local, setLocal] = useState<Record<string, string>>({});
  const save = useApiMutation((api, input: Parameters<typeof api.createFund>[0]) => (fund ? api.updateFund(fund.id, input) : api.createFund(input)));
  const address = slugTouched ? slug : slugify(name).slice(0, 64);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "Give the fund a name";
    if (!SLUG.test(address)) errors.slug = "Use lowercase letters, digits and hyphens";
    else if (RESERVED_FUND_SLUGS.includes(address)) errors.slug = "Your public pages use that address. Choose another";
    if (description.length > 500) errors.description = "Keep it to 500 characters";
    if (logoUrl.trim() && !/^https:\/\/\S+$/.test(logoUrl.trim())) errors.logoUrl = "Use an https link";
    setLocal(errors);
    if (Object.keys(errors).length) return;
    const saved = await save.run({ name: name.trim(), slug: address, description: description.trim() || null, brand: { color: color || null, logoUrl: logoUrl.trim() || null } });
    if (saved) onSaved();
  }

  return (
    <Dialog open onClose={onClose} labelledBy="fund-dialog-title">
      <form onSubmit={submit} noValidate>
        <div className="hd">
          <h2 id="fund-dialog-title">{fund ? `Edit ${fund.name}` : "New fund"}</h2>
        </div>
        <div className="bd">
          {save.error !== null && <ErrorBanner error={save.error} />}
          <Field id="fund-name" label="Name" required error={local.name ?? problemFor(save.error, "name")}>
            <input className={local.name ? "inp err" : "inp"} id="fund-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field id="fund-slug" label="Public address" help={`Your fund's page: /f/${handle}/${address || "…"}`} error={local.slug ?? problemFor(save.error, "slug")}>
            <input
              className={local.slug ? "inp err" : "inp mono"}
              id="fund-slug"
              value={address}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
            />
          </Field>
          <Field id="fund-description" label="Short description" help="Shown on your public pages. Up to 500 characters." error={local.description}>
            <textarea className="ta" id="fund-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </Field>
          <div className="fld-row">
            <Field id="fund-color" label="Colour" help="From your theme, so it always reads well.">
              <select className="sel" id="fund-color" value={color} onChange={(e) => setColor(e.target.value as FundColor | "")}>
                <option value="">No colour</option>
                {FUND_COLORS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="fund-logo" label="Logo link" help="An https link to an image." error={local.logoUrl}>
              <input className={local.logoUrl ? "inp err" : "inp"} id="fund-logo" inputMode="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://" />
            </Field>
          </div>
        </div>
        <div className="ft">
          <SaveNote state={save.state === "saving" ? "saving" : "idle"} />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.state === "saving"}>
            {fund ? "Save fund" : "Create fund"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface BudgetRow {
  fiscalYear: string;
  amount: string;
}

function BudgetsDialog({ fund, onClose, onSaved }: { fund: Fund; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<BudgetRow[]>(() => (fund.budgets.length ? fund.budgets.map((b) => ({ fiscalYear: String(b.fiscalYear), amount: String(b.amountMinor / 100) })) : [{ fiscalYear: String(new Date().getFullYear()), amount: "" }]));
  const [problem, setProblem] = useState<string | null>(null);
  const save = useApiMutation((api, budgets: FundBudgetInput[]) => api.putFundBudgets(fund.id, budgets));
  const set = (i: number, key: keyof BudgetRow, value: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [key]: value } : x)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const out: FundBudgetInput[] = [];
    for (const r of rows.filter((x) => x.fiscalYear.trim() || x.amount.trim())) {
      const year = Number(r.fiscalYear);
      const minor = parseDollars(r.amount);
      if (!Number.isInteger(year) || year < 1990 || year > 2200) return setProblem("Enter each fiscal year as four digits, such as 2027");
      if (minor === null) return setProblem("Enter each amount in dollars, such as 2,500,000");
      out.push({ fiscalYear: year, amountMinor: minor });
    }
    if (new Set(out.map((b) => b.fiscalYear)).size !== out.length) return setProblem("Give each fiscal year one budget");
    setProblem(null);
    if (await save.run(out)) onSaved();
  }

  return (
    <Dialog open onClose={onClose} labelledBy="budgets-dialog-title">
      <form onSubmit={submit} noValidate>
        <div className="hd">
          <h2 id="budgets-dialog-title">Budget for {fund.name}</h2>
        </div>
        <div className="bd">
          <p className="small muted">The fund's own budget for each fiscal year. Its programs' budgets are shown beside it, so you can see what is left to give.</p>
          {problem && (
            <div className="bnr bnr-warn" role="alert">
              <TriangleAlert className="ic" aria-hidden="true" />
              <div className="t">{problem}</div>
            </div>
          )}
          {save.error !== null && <ErrorBanner error={save.error} />}
          {rows.map((r, i) => (
            <div className="fld-row" key={i}>
              <Field id={`fy-${i}`} label="Fiscal year">
                <input className="inp" id={`fy-${i}`} inputMode="numeric" value={r.fiscalYear} onChange={(e) => set(i, "fiscalYear", e.target.value)} placeholder="2027" />
              </Field>
              <Field id={`amt-${i}`} label="Budget (USD)">
                <input className="inp" id={`amt-${i}`} inputMode="decimal" value={r.amount} onChange={(e) => set(i, "amount", e.target.value)} placeholder="2,500,000" />
              </Field>
            </div>
          ))}
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setRows((r) => [...r, { fiscalYear: "", amount: "" }])}>
            <Plus className="ic" aria-hidden="true" />
            Add a year
          </button>
        </div>
        <div className="ft">
          <SaveNote state={save.state === "saving" ? "saving" : "idle"} />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.state === "saving"}>
            Save budget
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AdvisorDialog({ fund, onClose, onSent }: { fund: Fund; onClose: () => void; onSent: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ADVISOR_ROLES)[number]["value"]>("program_officer");
  const invite = useApiMutation((api) => api.inviteAdvisor(fund.id, { email: email.trim(), role }));
  const [link, setLink] = useState<string | null>(null);
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  return (
    <Dialog open onClose={onClose} labelledBy="advisor-dialog-title">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          const out = await invite.run();
          if (out) {
            setLink(out.emailed ? null : out.acceptUrl);
            onSent();
          }
        }}
        noValidate
      >
        <div className="hd">
          <h2 id="advisor-dialog-title">Advisor for {fund.name}</h2>
        </div>
        <div className="bd">
          <p className="small muted">An advisor sees only this fund: its programs, opportunities, applications, awards and payments. Nothing of your other funds.</p>
          {invite.error !== null && <ErrorBanner error={invite.error} />}
          {invite.state === "saved" ? (
            <div className="bnr bnr-ok" role="status">
              <CircleCheck className="ic" aria-hidden="true" />
              <div>
                <div className="t">Invitation created for {email.trim()}</div>
                {link ? (
                  <div className="d row" style={{ gap: "8px" }}>
                    Send them this link: <span className="mono small">{link}</span> <CopyButton value={link} label="Copy link" what="invitation link" className="btn btn-sm btn-secondary" />
                  </div>
                ) : (
                  <div className="d">We emailed them a link to join.</div>
                )}
              </div>
            </div>
          ) : (
            <>
              <Field id="advisor-email" label="Their email address" required>
                <input className="inp" id="advisor-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@organization.org" required />
              </Field>
              <Field id="advisor-role" label="What they do" help="Program officers manage the fund's programs and awards. Reviewers score the applications assigned to them.">
                <select className="sel" id="advisor-role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                  {ADVISOR_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {invite.state === "saved" ? "Done" : "Cancel"}
          </button>
          {invite.state !== "saved" && (
            <button type="submit" className="btn btn-primary" disabled={!valid || invite.state === "saving"}>
              <UserPlus className="ic" aria-hidden="true" />
              Send invitation
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

function Advisors({ fundId, version }: { fundId: string; version: number }) {
  const detail = useApiQuery(async (api) => api.getFund(fundId), [fundId, version]);
  if (detail.status !== "ready") return null;
  const people = detail.data.advisors;
  if (!people.length) return <p className="small muted">No advisors yet.</p>;
  return (
    <ul className="small" aria-label="Advisors" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {people.map((a, i) => (
        <li key={`${a.email ?? a.userId}-${i}`}>
          {a.name ?? a.email ?? "Advisor"} · {ADVISOR_ROLES.find((r) => r.value === a.role)?.label ?? a.role.replace(/_/g, " ")}
        </li>
      ))}
    </ul>
  );
}

function FundCard({ fund, handle, isAdmin, onEdit, onBudgets, onInvite, version }: { fund: Fund; handle: string; isAdmin: boolean; onEdit: () => void; onBudgets: () => void; onInvite: () => void; version: number }) {
  const page = `/f/${handle}/${fund.slug}`;
  return (
    <section className="card" aria-labelledby={`fund-${fund.id}`}>
      <div className="card-h">
        <div className="row" style={{ gap: "10px" }}>
          <FundMark fund={fund} size={28} />
          <div>
            <h2 id={`fund-${fund.id}`} style={{ fontSize: "16px" }}>
              {fund.name}
              {fund.isDefault && <span className="small muted"> · Default fund</span>}
            </h2>
            <div className="small muted">
              <Link to={page} className="mono">
                {page}
              </Link>{" "}
              · {fund.programCount} program{fund.programCount === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        {isAdmin && (
          <div className="row" style={{ gap: "8px" }}>
            <button type="button" className="btn btn-sm btn-secondary" onClick={onEdit} aria-label={`Edit ${fund.name}`}>
              Edit
            </button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={onBudgets} aria-label={`Budget for ${fund.name}`}>
              Budget
            </button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={onInvite} aria-label={`Invite an advisor for ${fund.name}`}>
              <UserPlus className="ic" aria-hidden="true" />
              Invite an advisor
            </button>
          </div>
        )}
      </div>
      <div className="card-b" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          {fund.description && <p style={{ marginBottom: "10px" }}>{fund.description}</p>}
          {fund.totals.length === 0 ? (
            <p className="small muted">No budget yet. Set the fund's budget per fiscal year, and budget its programs, to see what is left to give.</p>
          ) : (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label={`Budget of ${fund.name}, scrollable`}>
              <table className="tbl" aria-label={`Budget of ${fund.name} by fiscal year`}>
                <thead>
                  <tr>
                    <th>Fiscal year</th>
                    <th className="num">Fund budget</th>
                    <th className="num">Programs</th>
                    <th className="num">Left to budget</th>
                  </tr>
                </thead>
                <tbody>
                  {fund.totals.map((t) => (
                    <tr key={t.fiscalYear}>
                      <td>FY{t.fiscalYear}</td>
                      <td className="num">{formatMinor(t.budgetMinor, t.currency)}</td>
                      <td className="num">
                        {formatMinor(t.programsMinor, t.currency)} <span className="small muted">({t.programCount})</span>
                      </td>
                      <td className="num">
                        {t.availableMinor === null ? (
                          <span className="muted">No fund budget</span>
                        ) : t.over ? (
                          <span className="var-neg b">
                            <TriangleAlert className="ic ic-sm" aria-hidden="true" /> Over by {formatMinor(-t.availableMinor, t.currency)}
                          </span>
                        ) : (
                          formatMinor(t.availableMinor, t.currency)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div>
          <h3 style={{ fontSize: "14px", marginBottom: "6px" }}>Advisors</h3>
          <Advisors fundId={fund.id} version={version} />
        </div>
      </div>
    </section>
  );
}

export default function FundSettings() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const isAdmin = (ws.member.role ?? "admin") === "admin";
  const funds = useApiQuery(async (api) => api.listFunds(), [ws.id]);
  const [dialog, setDialog] = useState<{ kind: "fund"; fund: Fund | null } | { kind: "budgets" | "advisor"; fund: Fund } | null>(null);
  const [version, setVersion] = useState(0);
  const saved = () => {
    setDialog(null);
    funds.reload();
    setVersion((v) => v + 1);
  };

  return (
    <FunderShell active="Settings">
      <title>{`Funds — ${ws.name}`}</title>
      <main className="main">
        <PageHeader
          crumbs={[{ label: ws.name, to: base }, { label: "Settings" }, { label: "Funds" }]}
          title="Settings"
          meta={funds.status === "ready" && <span>{funds.data.items.length === 1 ? "1 fund" : `${funds.data.items.length} funds`}</span>}
          actions={
            isAdmin && (
              <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: "fund", fund: null })}>
                <Plus className="ic" aria-hidden="true" />
                New fund
              </button>
            )
          }
        />
        <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
          <SettingsNav base={base} active="funds" />
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <section className="card" aria-labelledby="funds-intro">
              <div className="card-b row" style={{ gap: "12px", alignItems: "flex-start" }}>
                <Landmark className="ic ic-md" aria-hidden="true" />
                <div>
                  <h2 id="funds-intro" style={{ fontSize: "16px" }}>
                    Funds
                  </h2>
                  <p className="small muted">Run many funds from one workspace, each with its own programs, budget, advisors and public page. Every program belongs to one fund; its opportunities, applications and awards go with it.</p>
                </div>
              </div>
            </section>
            {funds.status === "loading" && <Loading label="Loading funds" />}
            {funds.status === "error" && <ErrorBanner error={funds.error} onRetry={funds.reload} title="Funds could not be loaded" />}
            {funds.status === "ready" && funds.data.items.length === 0 && <EmptyState icon={Landmark} title="No funds to show">Ask a workspace admin which funds you work on.</EmptyState>}
            {funds.status === "ready" &&
              funds.data.items.map((f) => (
                <Fragment key={f.id}>
                  <FundCard fund={f} handle={ws.handle} isAdmin={isAdmin} version={version} onEdit={() => setDialog({ kind: "fund", fund: f })} onBudgets={() => setDialog({ kind: "budgets", fund: f })} onInvite={() => setDialog({ kind: "advisor", fund: f })} />
                </Fragment>
              ))}
            {!isAdmin && (
              <p className="small muted row" style={{ gap: "6px" }}>
                <Info className="ic ic-sm" aria-hidden="true" />
                Only workspace admins can create funds, set their budgets and invite advisors.
              </p>
            )}
          </div>
        </div>
        {dialog?.kind === "fund" && <FundDialog fund={dialog.fund} handle={ws.handle} onClose={() => setDialog(null)} onSaved={saved} />}
        {dialog?.kind === "budgets" && <BudgetsDialog fund={dialog.fund} onClose={() => setDialog(null)} onSaved={saved} />}
        {dialog?.kind === "advisor" && <AdvisorDialog fund={dialog.fund} onClose={() => setDialog(null)} onSent={() => setVersion((v) => v + 1)} />}
      </main>
    </FunderShell>
  );
}
