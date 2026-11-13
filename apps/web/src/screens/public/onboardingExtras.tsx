// SPDX-License-Identifier: AGPL-3.0-only
// The optional last steps of applicant onboarding: invite teammates, and connect the apps that
// feed the organization's record. Apps are connected in Passport, never in the GMS.
import { useState, type FormEvent } from "react";
import { Check, Cloud, UserPlus } from "lucide-react";
import type { ApplicantApi } from "../../api/applicant.ts";
import { useLocation } from "react-router";
import { ErrorBanner, Field } from "../../components/ui.tsx";
import { needsSecondStep, SecondStepNotice } from "../../components/SecondStep.tsx";

const ROLES = [
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
  { value: "finance", label: "Finance" },
];

export function InviteTeammates({ api }: { api: ApplicantApi }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [sent, setSent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.invite({ email: email.trim(), role });
      setSent((prev) => [...prev, email.trim()]);
      setEmail("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="invite-h">
      <div className="card-h">
        <h3 id="invite-h">Invite teammates</h3>
        <span className="small muted">Optional</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <p className="small muted">Teammates edit applications with you. Consultants can be invited later with an end date, under Team &amp; access.</p>
        <div className="fld-row">
          <Field id="onb-invite-email" label="Email">
            <input id="onb-invite-email" className="inp" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field id="onb-invite-role" label="Role">
            <select id="onb-invite-role" className="sel" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {error ? needsSecondStep(error) ? <SecondStepNotice next={here} /> : <ErrorBanner error={error} title="The invitation was not sent" /> : null}
        <button type="submit" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} disabled={busy || !email.trim()}>
          <UserPlus className="ic" aria-hidden="true" />
          Send invitation
        </button>
        {sent.length > 0 ? (
          <ul role="status" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {sent.map((s) => (
              <li key={s} className="row small" style={{ gap: "6px", color: "var(--s-ok-fg)", fontWeight: 700 }}>
                <Check className="ic" aria-hidden="true" />
                Invitation sent to {s}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </form>
  );
}

export function ConnectApps({ passportUrl }: { passportUrl: string | null }) {
  return (
    <section className="card" aria-labelledby="apps-onb-h">
      <div className="card-h">
        <h3 id="apps-onb-h">Connect apps</h3>
        <span className="small muted">Optional · in Passport</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div className="row" style={{ gap: "12px", alignItems: "flex-start" }}>
          <span style={{ width: "36px", height: "36px", borderRadius: "8px", background: "var(--og-blue-light)", color: "var(--s-info-fg)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <Cloud className="ic" aria-hidden="true" />
          </span>
          <p>Connect your accounting system and file storage in Passport, and budget figures and documents arrive in your record for every funder to prefill from. The GMS never connects to them itself.</p>
        </div>
        {passportUrl ? (
          <a href={passportUrl} className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
            Connect apps in Passport
          </a>
        ) : (
          <p className="help">Open your Passport record to connect apps.</p>
        )}
      </div>
    </section>
  );
}
