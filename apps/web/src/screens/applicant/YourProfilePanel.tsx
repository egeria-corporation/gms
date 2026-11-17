// SPDX-License-Identifier: AGPL-3.0-only
// "Your organization profile is reused by every funder you apply to here" (E4). On the applicant
// dashboard and at the start of applying: the organization facts a funder sees when the
// organization applies (exactly those: GET /gms/reusable-profile), whether they are verified
// through Passport or self-declared (icon and label), where to edit them, and where to verify with
// Passport. Mounted with one line on each screen.
//
// It also counts a workspace made from an intermediary's onboarding link when the person went
// through Passport and so came back here rather than to the link's page (the pending referral).
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { BadgeCheck, CircleDashed, ExternalLink, IdCard, Pencil, ShieldCheck } from "lucide-react";
import { forgetReferral, pendingReferral, type FunderSeenField, type ReusableProfile } from "../../api/loops.ts";
import { useLoopsApi, useLoopsQuery } from "../../api/loopsHooks.ts";
import { usePassportFlags } from "../../api/launchHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { ErrorBanner } from "../../components/ui.tsx";
import { t, useApplicantText } from "./i18n.ts";

const FIELD_KEY = {
  legalName: "yourProfile.field.legalName",
  ein: "yourProfile.field.ein",
  orgType: "yourProfile.field.orgType",
  address: "yourProfile.field.address",
  email: "yourProfile.field.email",
  website: "yourProfile.field.website",
  mission: "yourProfile.field.mission",
} as const satisfies Record<FunderSeenField, string>;

/** Where the facts come from, as icon and label. */
export function ProfileSource({ profile }: { profile: Pick<ReusableProfile, "source"> }) {
  if (profile.source === "passport")
    return (
      <span className="prov prov-passport">
        <BadgeCheck className="ic" aria-hidden="true" />
        {t("yourProfile.source.passport")}
      </span>
    );
  if (profile.source === "self_declared")
    return (
      <span className="prov prov-entered">
        <Pencil className="ic" aria-hidden="true" />
        {t("yourProfile.source.selfDeclared")}
      </span>
    );
  return (
    <span className="prov prov-entered">
      <CircleDashed className="ic" aria-hidden="true" />
      {t("yourProfile.source.none")}
    </span>
  );
}

/** Counts this workspace for the onboarding link the person came from, once, when it was just made. */
function usePendingClaim(workspaceId: string, isAdmin: boolean) {
  const loops = useLoopsApi();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || !isAdmin) return;
    const p = pendingReferral();
    if (!p || p.source !== "onboarding") return;
    ran.current = true;
    loops.claim({ workspaceId, source: p.source, token: p.token }).then(
      () => forgetReferral(),
      // An older workspace is not counted; the link stays pending for a new one, for its hour.
      () => undefined,
    );
  }, [loops, workspaceId, isAdmin]);
}

function Fields({ profile }: { profile: ReusableProfile }) {
  return (
    <dl className="kv">
      {profile.fields.map((f) => (
        <div key={f.key} style={{ display: "contents" }}>
          <dt>{t(FIELD_KEY[f.key])}</dt>
          <dd>{f.value ?? <span className="muted">{t("yourProfile.notGiven")}</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function Links({ profile }: { profile: ReusableProfile }) {
  const flags = usePassportFlags();
  return (
    <div className="row" style={{ gap: "16px", flexWrap: "wrap" }}>
      {profile.editUrl ? (
        <a href={profile.editUrl} className="b row" style={{ gap: "6px" }}>
          <ExternalLink className="ic ic-sm" aria-hidden="true" />
          {t("yourProfile.editInPassport")}
        </a>
      ) : profile.editPath ? (
        <Link to={profile.editPath} className="b row" style={{ gap: "6px" }}>
          <Pencil className="ic ic-sm" aria-hidden="true" />
          {t("yourProfile.edit")}
        </Link>
      ) : null}
      {profile.verifyPath && flags.linking && (
        <Link to={profile.verifyPath} className="b row" style={{ gap: "6px" }}>
          <ShieldCheck className="ic ic-sm" aria-hidden="true" />
          {t("yourProfile.verify")}
        </Link>
      )}
    </div>
  );
}

export function YourProfilePanel({ compact = false }: { compact?: boolean }) {
  useApplicantText();
  const ws = useWorkspace("applicant");
  usePendingClaim(ws.id, (ws.member.role ?? "admin") === "admin");
  const query = useLoopsQuery((api) => api.reusableProfile(ws.id), [ws.id]);
  if (query.status === "loading") return null;
  if (query.status === "error") return compact ? null : <ErrorBanner error={query.error} onRetry={query.reload} title={t("yourProfile.notLoaded")} />;
  const p = query.data;
  if (compact)
    return (
      <section className="card" aria-labelledby="your-profile-compact">
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
            <IdCard className="ic" aria-hidden="true" />
            <h2 id="your-profile-compact" style={{ fontSize: "14px" }}>
              {t("yourProfile.reused")}
            </h2>
            <ProfileSource profile={p} />
          </div>
          <details>
            <summary className="b small">{t("yourProfile.seeWhatFundersSee")}</summary>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
              <Fields profile={p} />
              <Links profile={p} />
            </div>
          </details>
        </div>
      </section>
    );
  return (
    <section className="card" aria-labelledby="your-profile">
      <div className="card-h" style={{ flexWrap: "wrap", gap: "8px" }}>
        <h2 id="your-profile" style={{ fontSize: "18px" }} className="row">
          <IdCard className="ic" aria-hidden="true" />
          {t("yourProfile.title")}
        </h2>
        <ProfileSource profile={p} />
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <p>{t("yourProfile.reused")}</p>
        <p className="small muted">{p.verified ? t("yourProfile.verifiedNote") : t("yourProfile.selfDeclaredNote")}</p>
        <Fields profile={p} />
        <Links profile={p} />
      </div>
    </section>
  );
}
