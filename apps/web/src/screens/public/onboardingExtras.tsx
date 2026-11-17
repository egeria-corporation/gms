// SPDX-License-Identifier: AGPL-3.0-only
// The optional last steps of applicant onboarding: invite teammates, and connect the apps that
// feed the organization's record. Apps are connected in Passport, never in the GMS.
import { useState, type FormEvent } from "react";
import { Check, Cloud, UserPlus } from "lucide-react";
import type { ApplicantApi } from "../../api/applicant.ts";
import { useLocation } from "react-router";
import { ErrorBanner, Field } from "../../components/ui.tsx";
import { needsSecondStep, SecondStepNotice } from "../../components/SecondStep.tsx";

import { translator } from "../../i18n/index.tsx";

const t = translator("public");
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
        <h3 id="invite-h">{t("onboardingExtras.inviteTeammates")}</h3>
        <span className="small muted">{t("onboardingExtras.optional")}</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <p className="small muted">{t("onboardingExtras.teammatesEditApplicationsWithYou")}</p>
        <div className="fld-row">
          <Field id="onb-invite-email" label={t("onboardingExtras.email")}>
            <input id="onb-invite-email" className="inp" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field id="onb-invite-role" label={t("onboardingExtras.role")}>
            <select id="onb-invite-role" className="sel" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {error ? needsSecondStep(error) ? <SecondStepNotice next={here} /> : <ErrorBanner error={error} title={t("onboardingExtras.theInvitationWasNotSent")} /> : null}
        <button type="submit" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} disabled={busy || !email.trim()}>
          <UserPlus className="ic" aria-hidden="true" />
          {t("onboardingExtras.sendInvitation")}
        </button>
        {sent.length > 0 ? (
          <ul role="status" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {sent.map((s) => (
              <li key={s} className="row small" style={{ gap: "6px", color: "var(--s-ok-fg)", fontWeight: 700 }}>
                <Check className="ic" aria-hidden="true" />
                {t("onboardingExtras.invitationSentTo", { s })}
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
        <h3 id="apps-onb-h">{t("onboardingExtras.connectApps")}</h3>
        <span className="small muted">{t("onboardingExtras.optionalInPassport")}</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div className="row" style={{ gap: "12px", alignItems: "flex-start" }}>
          <span style={{ width: "36px", height: "36px", borderRadius: "8px", background: "var(--og-blue-light)", color: "var(--s-info-fg)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <Cloud className="ic" aria-hidden="true" />
          </span>
          <p>{t("onboardingExtras.connectYourAccountingSystemAnd")}</p>
        </div>
        {passportUrl ? (
          <a href={passportUrl} className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
            {t("onboardingExtras.connectAppsInPassport")}
          </a>
        ) : (
          <p className="help">{t("onboardingExtras.openYourPassportRecordTo")}</p>
        )}
      </div>
    </section>
  );
}
