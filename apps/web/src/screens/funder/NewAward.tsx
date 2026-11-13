// SPDX-License-Identifier: AGPL-3.0-only
// New award: give an award to an organization that has not applied. The funder names the
// organization and a contact address; the contact is emailed a link, signs in with that address,
// sets up the organization (Passport not needed) and accepts. Nothing is attached to an
// organization until a person at that address accepts.
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Send } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { errorCode } from "../../api/directAwards.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { ErrorBanner, Field, Notice, PageHeader, problemFor } from "../../components/ui.tsx";
import { directAwardProblems, EMPTY_DIRECT_AWARD, MESSAGE_MAX, toDirectAwardInput, type DirectAwardField, type DirectAwardForm } from "../../lib/directAward.ts";
import { canGiveDirectAward } from "../../lib/roles.ts";

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
  const blur = (f: DirectAwardField) => () => setTouched((t) => ({ ...t, [f]: true }));
  const field = (f: DirectAwardField) => ({ id: `na-${f}`, value: form[f], onChange: (e: { target: { value: string } }) => set(f, e.target.value), onBlur: blur(f), "aria-invalid": shown(f) ? (true as const) : undefined, "aria-describedby": shown(f) ? `na-${f}-err` : `na-${f}-help` });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(problems).length) return;
    const award = await create.run(toDirectAwardInput(form));
    if (award) navigate(`${base}/awards/${award.id}/agreement`);
  }

  const limited = errorCode(create.error) === "too_many_invitations";

  return (
    <>
      <title>{`New award — ${ws.name}`}</title>
      <FunderShell active="Awards">
        <main className="main">
          <PageHeader crumbs={[{ label: ws.name, to: base }, { label: "Awards", to: `${base}/awards` }, { label: "New award" }]} title="New award" meta={<span>Give an award to an organization that has not applied.</span>} />
          {!allowed && (
            <Notice tone="warn" title="You cannot give an award directly">
              Only a workspace admin or finance member can. Ask one of them, or have them add you with that role.
            </Notice>
          )}
          <form className="card" onSubmit={submit} noValidate aria-label="New award" style={{ maxWidth: "720px" }}>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {create.error !== null && <ErrorBanner error={create.error} title={limited ? "Too many invitations today" : "The invitation was not sent"} />}

              <Field id="na-organizationName" label="Organization name" required error={shown("organizationName")}>
                <input className={shown("organizationName") ? "inp err" : "inp"} {...field("organizationName")} autoComplete="off" />
              </Field>
              <Field id="na-contactEmail" label="Contact email" required error={shown("contactEmail")} help="We'll email this person a link. They sign in with this address, set up their organization (Passport not needed) and accept.">
                <input className={shown("contactEmail") ? "inp err" : "inp"} type="email" {...field("contactEmail")} autoComplete="off" />
              </Field>
              <Field id="na-title" label="Award title" required error={shown("title")}>
                <input className={shown("title") ? "inp err" : "inp"} {...field("title")} />
              </Field>
              <Field id="na-amount" label="Amount (US dollars)" required error={shown("amount")} help="Dollars and cents, for example 25000 or 25000.50.">
                <input className={shown("amount") ? "inp err" : "inp"} inputMode="decimal" {...field("amount")} autoComplete="off" />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
                <Field id="na-startDate" label="Start date" error={shown("startDate")} help="Optional.">
                  <input className={shown("startDate") ? "inp err" : "inp"} type="date" {...field("startDate")} />
                </Field>
                <Field id="na-endDate" label="End date" error={shown("endDate")} help="Optional.">
                  <input className={shown("endDate") ? "inp err" : "inp"} type="date" {...field("endDate")} />
                </Field>
              </div>
              <Field id="na-programId" label="Program" help="Optional. Counts this award against the program's budget.">
                <select className="sel" id="na-programId" value={form.programId} onChange={(e) => set("programId", e.target.value)}>
                  <option value="">No program</option>
                  {(programs.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="na-message" label="Message" error={shown("message")} help={`Optional. Plain text, shown in the invitation email. ${form.message.length} of ${MESSAGE_MAX} characters.`}>
                <textarea className={shown("message") ? "ta err" : "ta"} rows={4} {...field("message")} />
              </Field>
              <p className="small muted">The award is offered when you send. Nothing is paid, and no agreement or payment schedule can start, until the organization accepts.</p>
            </div>
            <div className="ft" style={{ display: "flex", gap: "8px", justifyContent: "flex-end", padding: "12px 20px" }}>
              <Link to={`${base}/awards`} className="btn btn-secondary">
                Cancel
              </Link>
              <button type="submit" className="btn btn-primary" disabled={!allowed || create.state === "saving"}>
                <Send className="ic" aria-hidden="true" />
                Send invitation
              </button>
            </div>
          </form>
        </main>
      </FunderShell>
    </>
  );
}
