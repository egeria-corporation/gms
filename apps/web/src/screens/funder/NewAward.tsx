// SPDX-License-Identifier: AGPL-3.0-only
// New award: give an award to an organization that has not applied. The funder names the
// organization and a contact address; the contact is emailed a link, signs in with that address,
// sets up the organization (Passport not needed) and accepts. Nothing is attached to an
// organization until a person at that address accepts.
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Send } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { InvitationError } from "../../components/InvitationError.tsx";
import { Field, Notice, PageHeader, problemFor } from "../../components/ui.tsx";
import { directAwardProblems, EMPTY_DIRECT_AWARD, MESSAGE_MAX, toDirectAwardInput, type DirectAwardField, type DirectAwardForm } from "../../lib/directAward.ts";
import { canGiveDirectAward } from "../../lib/roles.ts";
import { t } from "./i18n.ts";

export default function NewAward() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const navigate = useNavigate();
  const allowed = canGiveDirectAward(ws.member.role ?? "admin");
  const programs = useApiQuery((api) => api.listPrograms(), []);
  const [form, setForm] = useState<DirectAwardForm>(EMPTY_DIRECT_AWARD);
  const [touched, setTouched] = useState<Partial<Record<DirectAwardField, true>>>({});
  const [submitted, setSubmitted] = useState(false);
  const create = useApiMutation((api, input: ReturnType<typeof toDirectAwardInput>) => api.createDirectAward(input));

  const problems = directAwardProblems(form);
  // A field shows its problem once it has been left, or once the form has been sent.
  const shown = (f: DirectAwardField): string | null => {
    if (submitted || touched[f]) return problems[f] ?? null;
    return create.error !== null ? problemFor(create.error, f) : null;
  };
  const set = (f: DirectAwardField, v: string) => {
    setForm((x) => ({ ...x, [f]: v }));
    if (create.error !== null) create.reset();
  };
  const blur = (f: DirectAwardField) => () => setTouched((item) => ({ ...item, [f]: true }));
  const field = (f: DirectAwardField) => ({ id: `na-${f}`, value: form[f], onChange: (e: { target: { value: string } }) => set(f, e.target.value), onBlur: blur(f), "aria-invalid": shown(f) ? (true as const) : undefined, "aria-describedby": shown(f) ? `na-${f}-err` : `na-${f}-help` });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(problems).length) return;
    const award = await create.run(toDirectAwardInput(form));
    if (award) navigate(`${base}/awards/${award.id}/agreement`, { state: { emailed: award.emailed } });
  }

  return (
    <>
      <title>{t("newAward.newAward", { name: ws.name })}</title>
      <FunderShell active="Awards">
        <main className="main">
          <PageHeader crumbs={[{ label: ws.name, to: base }, { label: t("newAward.awards"), to: `${base}/awards` }, { label: t("newAward.newAward2") }]} title={t("newAward.newAward2")} meta={<span>{t("newAward.giveAnAwardTo")}</span>} />
          {!allowed && (
            <Notice tone="warn" title={t("newAward.youCannotGiveAn")}>
              {t("newAward.onlyAWorkspaceAdmin")}
            </Notice>
          )}
          <form className="card" onSubmit={submit} noValidate aria-label={t("newAward.newAward2")} style={{ maxWidth: "720px" }}>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {create.error !== null && <InvitationError error={create.error} title={t("newAward.theInvitationWasNot")} />}

              <Field id="na-organizationName" label={t("newAward.organizationName")} required error={shown("organizationName")}>
                <input className={shown("organizationName") ? "inp err" : "inp"} {...field("organizationName")} autoComplete="off" />
              </Field>
              <Field id="na-contactEmail" label={t("newAward.contactEmail")} required error={shown("contactEmail")} help={t("newAward.wellEmailThisPerson")}>
                <input className={shown("contactEmail") ? "inp err" : "inp"} type="email" {...field("contactEmail")} autoComplete="off" />
              </Field>
              <Field id="na-title" label={t("newAward.awardTitle")} required error={shown("title")}>
                <input className={shown("title") ? "inp err" : "inp"} {...field("title")} />
              </Field>
              <Field id="na-amount" label={t("newAward.amountUsDollars")} required error={shown("amount")} help={t("newAward.dollarsAndCentsFor")}>
                <input className={shown("amount") ? "inp err" : "inp"} inputMode="decimal" {...field("amount")} autoComplete="off" />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
                <Field id="na-startDate" label={t("newAward.startDate")} error={shown("startDate")} help={t("newAward.optional")}>
                  <input className={shown("startDate") ? "inp err" : "inp"} type="date" {...field("startDate")} />
                </Field>
                <Field id="na-endDate" label={t("newAward.endDate")} error={shown("endDate")} help={t("newAward.optional")}>
                  <input className={shown("endDate") ? "inp err" : "inp"} type="date" {...field("endDate")} />
                </Field>
              </div>
              <Field id="na-programId" label={t("newAward.program")} help={t("newAward.optionalCountsThisAward")}>
                <select className="sel" id="na-programId" value={form.programId} onChange={(e) => set("programId", e.target.value)}>
                  <option value="">{t("newAward.noProgram")}</option>
                  {(programs.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="na-message" label={t("newAward.message")} error={shown("message")} help={t("newAward.optionalPlainTextShown", { count: form.message.length, MESSAGE_MAX })}>
                <textarea className={shown("message") ? "ta err" : "ta"} rows={4} {...field("message")} />
              </Field>
              <p className="small muted">{t("newAward.theAwardIsOffered")}</p>
            </div>
            <div className="ft" style={{ display: "flex", gap: "8px", justifyContent: "flex-end", padding: "12px 20px" }}>
              <Link to={`${base}/awards`} className="btn btn-secondary">
                {t("newAward.cancel")}
              </Link>
              <button type="submit" className="btn btn-primary" disabled={!allowed || create.state === "saving"}>
                <Send className="ic" aria-hidden="true" />
                {t("newAward.sendInvitation")}
              </button>
            </div>
          </form>
        </main>
      </FunderShell>
    </>
  );
}
