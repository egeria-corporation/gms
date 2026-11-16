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
import { t, useFunderMessages } from "./i18n.ts";

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
    if (!name.trim()) errors.name = t("fundSettings.problem.nameRequired");
    if (!SLUG.test(address)) errors.slug = t("fundSettings.problem.slugFormat");
    else if (RESERVED_FUND_SLUGS.includes(address)) errors.slug = t("fundSettings.problem.slugReserved");
    if (description.length > 500) errors.description = t("fundSettings.problem.descriptionLength");
    if (logoUrl.trim() && !/^https:\/\/\S+$/.test(logoUrl.trim())) errors.logoUrl = t("fundSettings.problem.logoHttps");
    setLocal(errors);
    if (Object.keys(errors).length) return;
    const saved = await save.run({ name: name.trim(), slug: address, description: description.trim() || null, brand: { color: color || null, logoUrl: logoUrl.trim() || null } });
    if (saved) onSaved();
  }

  return (
    <Dialog open onClose={onClose} labelledBy="fund-dialog-title">
      <form onSubmit={submit} noValidate>
        <div className="hd">
          <h2 id="fund-dialog-title">{fund ? t("fundSettings.edit", { name: fund.name }) : t("fundSettings.newFund")}</h2>
        </div>
        <div className="bd">
          {save.error !== null && <ErrorBanner error={save.error} />}
          <Field id="fund-name" label={t("fundSettings.name")} required error={local.name ?? problemFor(save.error, "name")}>
            <input className={local.name ? "inp err" : "inp"} id="fund-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field id="fund-slug" label={t("fundSettings.publicAddress")} help={t("fundSettings.yourFundsPageF", { handle, address: address || "…" })} error={local.slug ?? problemFor(save.error, "slug")}>
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
          <Field id="fund-description" label={t("fundSettings.shortDescription")} help={t("fundSettings.shownOnYourPublic")} error={local.description}>
            <textarea className="ta" id="fund-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </Field>
          <div className="fld-row">
            <Field id="fund-color" label={t("fundSettings.colour")} help={t("fundSettings.fromYourThemeSo")}>
              <select className="sel" id="fund-color" value={color} onChange={(e) => setColor(e.target.value as FundColor | "")}>
                <option value="">{t("fundSettings.noColour")}</option>
                {FUND_COLORS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="fund-logo" label={t("fundSettings.logoLink")} help={t("fundSettings.anHttpsLinkTo")} error={local.logoUrl}>
              <input className={local.logoUrl ? "inp err" : "inp"} id="fund-logo" inputMode="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder={t("fundSettings.https")} />
            </Field>
          </div>
        </div>
        <div className="ft">
          <SaveNote state={save.state === "saving" ? "saving" : "idle"} />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("fundSettings.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.state === "saving"}>
            {fund ? t("fundSettings.saveFund") : t("fundSettings.createFund")}
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
      if (!Number.isInteger(year) || year < 1990 || year > 2200) return setProblem(t("fundSettings.problem.fiscalYear"));
      if (minor === null) return setProblem(t("fundSettings.problem.amount"));
      out.push({ fiscalYear: year, amountMinor: minor });
    }
    if (new Set(out.map((b) => b.fiscalYear)).size !== out.length) return setProblem(t("fundSettings.problem.oneBudget"));
    setProblem(null);
    if (await save.run(out)) onSaved();
  }

  return (
    <Dialog open onClose={onClose} labelledBy="budgets-dialog-title">
      <form onSubmit={submit} noValidate>
        <div className="hd">
          <h2 id="budgets-dialog-title">{t("fundSettings.budgetFor", { name: fund.name })}</h2>
        </div>
        <div className="bd">
          <p className="small muted">{t("fundSettings.theFundsOwnBudget")}</p>
          {problem && (
            <div className="bnr bnr-warn" role="alert">
              <TriangleAlert className="ic" aria-hidden="true" />
              <div className="t">{problem}</div>
            </div>
          )}
          {save.error !== null && <ErrorBanner error={save.error} />}
          {rows.map((r, i) => (
            <div className="fld-row" key={i}>
              <Field id={`fy-${i}`} label={t("fundSettings.fiscalYear")}>
                <input className="inp" id={`fy-${i}`} inputMode="numeric" value={r.fiscalYear} onChange={(e) => set(i, "fiscalYear", e.target.value)} placeholder="2027" />
              </Field>
              <Field id={`amt-${i}`} label={t("fundSettings.budgetUsd")}>
                <input className="inp" id={`amt-${i}`} inputMode="decimal" value={r.amount} onChange={(e) => set(i, "amount", e.target.value)} placeholder="2,500,000" />
              </Field>
            </div>
          ))}
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setRows((r) => [...r, { fiscalYear: "", amount: "" }])}>
            <Plus className="ic" aria-hidden="true" />
            {t("fundSettings.addAYear")}
          </button>
        </div>
        <div className="ft">
          <SaveNote state={save.state === "saving" ? "saving" : "idle"} />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("fundSettings.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.state === "saving"}>
            {t("fundSettings.saveBudget")}
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
          <h2 id="advisor-dialog-title">{t("fundSettings.advisorFor", { name: fund.name })}</h2>
        </div>
        <div className="bd">
          <p className="small muted">{t("fundSettings.anAdvisorSeesOnly")}</p>
          {invite.error !== null && <ErrorBanner error={invite.error} />}
          {invite.state === "saved" ? (
            <div className="bnr bnr-ok" role="status">
              <CircleCheck className="ic" aria-hidden="true" />
              <div>
                <div className="t">{t("fundSettings.invitationCreatedFor", { email: email.trim() })}</div>
                {link ? (
                  <div className="d row" style={{ gap: "8px" }}>
                    {t.rich("fundSettings.sendThemThisLink", { link, span: (chunks) => <span className="mono small">{chunks}</span> })} <CopyButton value={link} label={t("fundSettings.copyLink")} what={t("fundSettings.invitationLink")} className="btn btn-sm btn-secondary" />
                  </div>
                ) : (
                  <div className="d">{t("fundSettings.weEmailedThemA")}</div>
                )}
              </div>
            </div>
          ) : (
            <>
              <Field id="advisor-email" label={t("fundSettings.theirEmailAddress")} required>
                <input className="inp" id="advisor-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("fundSettings.nameOrganizationOrg")} required />
              </Field>
              <Field id="advisor-role" label={t("fundSettings.whatTheyDo")} help={t("fundSettings.programOfficersManageThe")}>
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
            {invite.state === "saved" ? t("fundSettings.done") : t("fundSettings.cancel")}
          </button>
          {invite.state !== "saved" && (
            <button type="submit" className="btn btn-primary" disabled={!valid || invite.state === "saving"}>
              <UserPlus className="ic" aria-hidden="true" />
              {t("fundSettings.sendInvitation")}
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
  if (!people.length) return <p className="small muted">{t("fundSettings.noAdvisorsYet")}</p>;
  return (
    <ul className="small" aria-label={t("fundSettings.advisors")} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {people.map((a, i) => (
        <li key={`${a.email ?? a.userId}-${i}`}>
          {a.name ?? a.email ?? t("fundSettings.advisor")} · {ADVISOR_ROLES.find((r) => r.value === a.role)?.label ?? a.role.replace(/_/g, " ")}
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
              {fund.isDefault && <span className="small muted"> {t("fundSettings.defaultFund")}</span>}
            </h2>
            <div className="small muted">
              {t.rich("fundSettings.program", { page, count: fund.programCount, link: (chunks) => <Link to={page} className="mono">{chunks}</Link> })}
            </div>
          </div>
        </div>
        {isAdmin && (
          <div className="row" style={{ gap: "8px" }}>
            <button type="button" className="btn btn-sm btn-secondary" onClick={onEdit} aria-label={t("fundSettings.edit", { name: fund.name })}>
              {t("fundSettings.edit2")}
            </button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={onBudgets} aria-label={t("fundSettings.budgetFor", { name: fund.name })}>
              {t("fundSettings.budget")}
            </button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={onInvite} aria-label={t("fundSettings.inviteAnAdvisorFor", { name: fund.name })}>
              <UserPlus className="ic" aria-hidden="true" />
              {t("fundSettings.inviteAnAdvisor")}
            </button>
          </div>
        )}
      </div>
      <div className="card-b" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          {fund.description && <p style={{ marginBottom: "10px" }}>{fund.description}</p>}
          {fund.totals.length === 0 ? (
            <p className="small muted">{t("fundSettings.noBudgetYetSet")}</p>
          ) : (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("fundSettings.budgetOfScrollable", { name: fund.name })}>
              <table className="tbl" aria-label={t("fundSettings.budgetOfByFiscal", { name: fund.name })}>
                <thead>
                  <tr>
                    <th>{t("fundSettings.fiscalYear")}</th>
                    <th className="num">{t("fundSettings.fundBudget")}</th>
                    <th className="num">{t("fundSettings.programs")}</th>
                    <th className="num">{t("fundSettings.leftToBudget")}</th>
                  </tr>
                </thead>
                <tbody>
                  {fund.totals.map((year) => (
                    <tr key={year.fiscalYear}>
                      <td>{t("fundSettings.fy", { fiscalYear: String(year.fiscalYear) })}</td>
                      <td className="num">{formatMinor(year.budgetMinor, year.currency)}</td>
                      <td className="num">
                        {formatMinor(year.programsMinor, year.currency)} <span className="small muted">({year.programCount})</span>
                      </td>
                      <td className="num">
                        {year.availableMinor === null ? (
                          <span className="muted">{t("fundSettings.noFundBudget")}</span>
                        ) : year.over ? (
                          <span className="var-neg b">
                            <TriangleAlert className="ic ic-sm" aria-hidden="true" /> {t("fundSettings.overBy", { amount: formatMinor(-year.availableMinor, year.currency) })}
                          </span>
                        ) : (
                          formatMinor(year.availableMinor, year.currency)
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
          <h3 style={{ fontSize: "14px", marginBottom: "6px" }}>{t("fundSettings.advisors")}</h3>
          <Advisors fundId={fund.id} version={version} />
        </div>
      </div>
    </section>
  );
}

export default function FundSettings() {
  useFunderMessages();
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
      <title>{t("fundSettings.funds", { name: ws.name })}</title>
      <main className="main">
        <PageHeader
          crumbs={[{ label: ws.name, to: base }, { label: t("fundSettings.settings") }, { label: t("fundSettings.funds2") }]}
          title={t("fundSettings.settings")}
          meta={funds.status === "ready" && <span>{t("fundSettings.fundCount", { count: funds.data.items.length })}</span>}
          actions={
            isAdmin && (
              <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: "fund", fund: null })}>
                <Plus className="ic" aria-hidden="true" />
                {t("fundSettings.newFund")}
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
                    {t("fundSettings.funds2")}
                  </h2>
                  <p className="small muted">{t("fundSettings.runManyFundsFrom")}</p>
                </div>
              </div>
            </section>
            {funds.status === "loading" && <Loading label={t("fundSettings.loadingFunds")} />}
            {funds.status === "error" && <ErrorBanner error={funds.error} onRetry={funds.reload} title={t("fundSettings.fundsCouldNotBe")} />}
            {funds.status === "ready" && funds.data.items.length === 0 && <EmptyState icon={Landmark} title={t("fundSettings.noFundsToShow")}>{t("fundSettings.askAWorkspaceAdmin")}</EmptyState>}
            {funds.status === "ready" &&
              funds.data.items.map((f) => (
                <Fragment key={f.id}>
                  <FundCard fund={f} handle={ws.handle} isAdmin={isAdmin} version={version} onEdit={() => setDialog({ kind: "fund", fund: f })} onBudgets={() => setDialog({ kind: "budgets", fund: f })} onInvite={() => setDialog({ kind: "advisor", fund: f })} />
                </Fragment>
              ))}
            {!isAdmin && (
              <p className="small muted row" style={{ gap: "6px" }}>
                <Info className="ic ic-sm" aria-hidden="true" />
                {t("fundSettings.onlyWorkspaceAdminsCan")}
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
