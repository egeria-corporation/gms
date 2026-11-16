// SPDX-License-Identifier: AGPL-3.0-only
// Where the link in an award invitation lands (`/awards/claim?token=…`). Behind RequireAuth: a
// signed-out person signs in first and comes back here with the token still in the address. The
// token is only ever sent in a request body. Nothing is matched by name: the award attaches to an
// organization only when the person signed in with the address it was sent to accepts it for a
// workspace they administer.
import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { Award as AwardIcon, Ban, CircleCheck, CircleX, Clock, LogOut, ShieldOff, TriangleExclamationPoint } from "lucide-react";
import { errorCode, type InvitationLookup } from "../../api/directAwards.ts";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { useServices } from "../../app/services.tsx";
import { RequireAuth, signInPath } from "../../auth/RequireAuth.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { VerificationBadge } from "../../components/status.tsx";
import { ErrorBanner, Field, Loading, Notice } from "../../components/ui.tsx";
import { CLAIM_PATH, captureClaimToken, clearClaimToken, getClaimToken } from "../../lib/claimToken.ts";
import { formatDate } from "../../lib/format.ts";
import { FUNDER_TEXT_LINK, formatDecimalAmount } from "../../lib/directAward.ts";

import { translator } from "../../i18n/index.tsx";


const t = translator("public");
/** Where "Set up your organization" goes: the no-Passport onboarding, then back to this claim. */
export function setupOrganizationHref(organizationName: string, claimUrl: string): string {
  return `/onboarding/applicant?start=email&name=${encodeURIComponent(organizationName)}&next=${encodeURIComponent(claimUrl)}`;
}

export interface ClaimViewProps {
  lookup: InvitationLookup;
  /** The path and query of this page: where onboarding and a second step send the person back to. */
  claimUrl: string;
  signedInAs: string;
  onAccept: (workspaceId: string, signerName?: string) => void;
  onDecline: (reason: string) => void;
  onSwitchAddress: () => void;
  accepting?: boolean;
  declining?: boolean;
  /** What went wrong with the last accept or decline. */
  error?: unknown;
}

/** The server says whether the funder is linked to Passport at L1 or above; a missing field counts as not verified. */
export function funderIsVerified(funder: { verified?: unknown } | null | undefined): boolean {
  return funder?.verified === true;
}

function AwardSummary({ lookup }: { lookup: InvitationLookup }) {
  const { award, funder } = lookup;
  const period = award.startDate && award.endDate ? `${formatDate(award.startDate)} to ${formatDate(award.endDate)}` : award.startDate ? t("claimAward.from2", { startDate: formatDate(award.startDate) }) : award.endDate ? t("claimAward.until", { endDate: formatDate(award.endDate) }) : null;
  return (
    <section className="card" aria-labelledby="claim-award-h">
      <div className="card-h">
        <div>
          <span className="eyebrow">{t("claimAward.from")}</span>
          <div className="row wrap" style={{ gap: "8px" }}>
            <span className="b">{funder.name}</span>
            <VerificationBadge verification={funder.verification} />
            {funder.workspaceName && funder.workspaceName !== funder.name && <span className="small muted">{t("claimAward.workspaceName", { workspaceName: funder.workspaceName })}</span>}
          </div>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {!funderIsVerified(funder) && (
          <p className="row small" style={{ gap: "6px" }}>
            <ShieldOff className="ic" aria-hidden="true" />
            <span>{t("claimAward.thisFunderSOrganizationIs")}</span>
          </p>
        )}
        <h2 id="claim-award-h" style={{ fontSize: "20px" }}>
          {award.title}
        </h2>
        <dl className="kv">
          <dt>{t("claimAward.amount")}</dt>
          <dd>{award.amount ? formatDecimalAmount(award.amount.value, award.amount.currency) : "—"}</dd>
          <dt>{t("claimAward.for")}</dt>
          <dd>{lookup.organizationName}</dd>
          {period && (
            <>
              <dt>{t("claimAward.period")}</dt>
              <dd>{period}</dd>
            </>
          )}
          <dt>{t("claimAward.sentTo")}</dt>
          <dd>{lookup.invitedEmail}</dd>
        </dl>
        {award.message && (
          <blockquote style={{ margin: 0, padding: "8px 12px", borderLeft: "3px solid var(--og-gray-200)", whiteSpace: "pre-wrap" }}>
            <span className="eyebrow">{t("claimAward.messageFrom", { name: funder.name })}</span>
            <p>{award.message}</p>
          </blockquote>
        )}
      </div>
    </section>
  );
}

function DeclineDialog({ funderName, busy, onClose, onDecline }: { funderName: string; busy: boolean; onClose: () => void; onDecline: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  // The reason is emailed to the funder's staff as plain text, so it follows the same rule as the funder's own text.
  const problem = FUNDER_TEXT_LINK.test(reason) ? t("claimAward.theReasonCannotContainA") : null;
  return (
    <Dialog open onClose={onClose} labelledBy="decline-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (problem) return;
          onDecline(reason);
        }}
      >
        <div className="hd">
          <h2 id="decline-title">{t("claimAward.declineThisAward")}</h2>
        </div>
        <div className="bd">
          <p>{t("claimAward.isToldYouDeclinedThey", { funderName })}</p>
          <Field id="decline-reason" label={t("claimAward.reason")} help={t("claimAward.optionalSharedWithTheFunder")} error={problem}>
            <textarea className="ta" id="decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("claimAward.keepTheAwardOpen")}
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy || problem !== null}>
            <CircleX className="ic" aria-hidden="true" />
            {t("claimAward.declineAward")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Why an accept did not work, in words the person can act on. */
function AcceptProblem({ error, claimUrl, onSwitchAddress }: { error: unknown; claimUrl: string; onSwitchAddress: () => void }) {
  const code = errorCode(error);
  if (code === "email_mismatch") {
    return (
      <Notice tone="warn" title={t("claimAward.thisInvitationWasSentTo")}>
        {error instanceof Error ? error.message : t("claimAward.signInWithTheAddress")}{" "}
        <button type="button" className="btn btn-sm btn-secondary" onClick={onSwitchAddress}>
          {t("claimAward.signInWithADifferent")}
        </button>
      </Notice>
    );
  }
  if (code === "signer_name_required") {
    return <Notice tone="info" title={t("claimAward.typeYourFullLegalName")}>{t("claimAward.passportListsVerifiedRepresentativesFor")}</Notice>;
  }
  if (code === "invitation_revoked") {
    return <Notice tone="warn" title={t("claimAward.thisAwardWasWithdrawn")}>{t("claimAward.theFunderWithdrewThisAward")}</Notice>;
  }
  if (code === "not_workspace_admin") {
    return <Notice tone="warn" title={t("claimAward.onlyAnAdminCanAccept")}>{t("claimAward.onlyAnAdminOfAn")}</Notice>;
  }
  if (code === "mfa_required") {
    return (
      <Notice tone="warn" title={t("claimAward.oneMoreStepBeforeYou")}>
        {t.rich("claimAward.acceptingNeedsTheSecondStep", { link: (chunks) => <Link to={signInPath(claimUrl, "mfa")}>{chunks}</Link> })}
      </Notice>
    );
  }
  return <ErrorBanner error={error} title={t("claimAward.theAwardWasNotAccepted")} />;
}

/** The claim screen for one invitation, whatever state it is in. Pure: the page below supplies the calls. */
export function ClaimView({ lookup, claimUrl, signedInAs, onAccept, onDecline, onSwitchAddress, accepting = false, declining = false, error }: ClaimViewProps) {
  const [chosen, setChosen] = useState<string>(lookup.workspaces.length === 1 ? lookup.workspaces[0]!.id : "");
  const [deciding, setDeciding] = useState(false);
  // Where Passport lists verified representatives, the person accepting types their legal name; it must match one.
  const [signerName, setSignerName] = useState("");
  const errorCode_ = errorCode(error);
  const needsName = errorCode_ === "signer_name_required" || errorCode_ === "not_a_representative";
  const funderName = lookup.funder.name;
  const setUp = setupOrganizationHref(lookup.organizationName, claimUrl);

  let body: ReactNode;
  if (lookup.status !== "pending") {
    const closed = {
      accepted: { icon: CircleCheck, title: t("claimAward.thisAwardWasAlreadyAccepted"), text: t("claimAward.nothingMoreIsNeededHere") },
      declined: { icon: CircleX, title: t("claimAward.thisInvitationWasDeclined"), text: `${funderName} was told. If that was a mistake, ask them to send a new invitation.` },
      expired: { icon: Clock, title: t("claimAward.thisInvitationHasExpired"), text: t("claimAward.askToSendANew", { funderName }) },
      revoked: { icon: Ban, title: t("claimAward.thisAwardWasWithdrawn"), text: `${funderName} withdrew this award, so it can no longer be accepted.` },
    }[lookup.status];
    const Icon = closed.icon;
    body = (
      <div className="empty" role="status">
        <Icon className="ic" aria-hidden="true" />
        <h3>{closed.title}</h3>
        <p>{closed.text}</p>
        <div className="acts">
          <Link to="/workspaces" className="btn btn-primary">
            {t("claimAward.goToYourWorkspaces")}
          </Link>
        </div>
      </div>
    );
  } else if (!lookup.emailMatches) {
    body = (
      <div className="bnr bnr-warn" role="alert">
        <TriangleExclamationPoint className="ic" aria-hidden="true" />
        <div>
          <div className="t">{t("claimAward.thisInvitationWasSentTo")}</div>
          <div className="d">
            {t("claimAward.signInWithTheAddress2", { invitedEmail: lookup.invitedEmail, signedInAs })}
          </div>
          <div style={{ marginTop: "8px" }}>
            <button type="button" className="btn btn-secondary" onClick={onSwitchAddress}>
              <LogOut className="ic" aria-hidden="true" />
              {t("claimAward.signInWithADifferent")}
            </button>
          </div>
        </div>
      </div>
    );
  } else {
    body = (
      <section className="card" aria-labelledby="claim-who-h">
        <div className="card-h">
          <h2 id="claim-who-h" style={{ fontSize: "18px" }}>
            {lookup.workspaces.length > 0 ? t("claimAward.whichOrganizationIsAccepting") : t("claimAward.setUpYourOrganization")}
          </h2>
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {error !== undefined && error !== null && <AcceptProblem error={error} claimUrl={claimUrl} onSwitchAddress={onSwitchAddress} />}
          {lookup.workspaces.length > 0 ? (
            <>
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                <legend className="sr">{t("claimAward.organizationAcceptingThisAward")}</legend>
                {lookup.workspaces.map((w) => (
                  <label key={w.id} className="radio" style={{ cursor: "pointer" }}>
                    <input type="radio" name="claim-workspace" value={w.id} checked={chosen === w.id} onChange={() => setChosen(w.id)} />
                    <span className="row wrap" style={{ gap: "8px" }}>
                      <span className="b">{w.name}</span>
                      <VerificationBadge verification={w.verification} />
                    </span>
                  </label>
                ))}
              </fieldset>
              <p className="small">
                {t.rich("claimAward.notOneOfTheseSet", { link: (chunks) => <Link to={setUp}>{chunks}</Link> })}
              </p>
              {needsName && (
                <Field id="claim-signer" label={t("claimAward.yourFullLegalName")} required help={t("claimAward.passportListsVerifiedRepresentativesFor2")}>
                  <input className="inp" id="claim-signer" value={signerName} onChange={(e) => setSignerName(e.target.value)} autoComplete="name" />
                </Field>
              )}
              <p>{t("claimAward.acceptingSharesYourOrganizationS", { funderName })}</p>
              <div className="row wrap">
                <button type="button" className="btn btn-primary" disabled={!chosen || accepting || (needsName && signerName.trim().length < 2)} onClick={() => onAccept(chosen, signerName.trim() || undefined)}>
                  <AwardIcon className="ic" aria-hidden="true" />
                  {t("claimAward.acceptAward")}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setDeciding(true)}>
                  {t("claimAward.decline")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                {t("claimAward.youDoNotHaveAn")}
              </p>
              <div className="row wrap">
                <Link to={setUp} className="btn btn-primary">
                  {t("claimAward.setUpYourOrganization")}
                </Link>
                <button type="button" className="btn btn-secondary" onClick={() => setDeciding(true)}>
                  {t("claimAward.decline")}
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <h1>{t("claimAward.acceptAnAwardFrom", { funderName })}</h1>
        <p className="muted">{t("claimAward.signedInAs", { signedInAs })}</p>
      </div>
      <AwardSummary lookup={lookup} />
      {body}
      {deciding && (
        <DeclineDialog
          funderName={funderName}
          busy={declining}
          onClose={() => setDeciding(false)}
          onDecline={(reason) => {
            onDecline(reason);
            setDeciding(false);
          }}
        />
      )}
    </>
  );
}

/**
 * The route. Outside the sign-in guard on purpose: the token is taken from the address before anything
 * can build a sign-in `next` from it, and the address becomes the plain `/awards/claim`.
 */
export default function ClaimEntry() {
  const location = useLocation();
  captureClaimToken(location.search, location.hash);
  if (location.search || location.hash) return <Navigate to={CLAIM_PATH} replace />;
  return (
    <RequireAuth>
      <ClaimAward />
    </RequireAuth>
  );
}

function ClaimAward() {
  const { auth, meState, sessionState, reloadMe } = useServices();
  const navigate = useNavigate();
  // Read once: the stored copy is cleared when the invitation is used up, and this page may reload after that.
  const [token] = useState(getClaimToken);
  const claimUrl = CLAIM_PATH;
  const lookup = useApiQuery((api) => (token ? api.lookupAwardInvitation(token) : Promise.reject(Object.assign(new Error(t("claimAward.thisInvitationLinkIsNot2")), { status: 404 }))), [token]);
  const accept = useApiMutation((api, workspaceId: string, name?: string) => api.acceptAwardInvitation({ token, workspaceId, ...(name ? { name } : {}) }));
  const decline = useApiMutation((api, reason: string) => api.declineAwardInvitation({ token, ...(reason.trim() ? { reason: reason.trim() } : {}) }));
  const email = sessionState.status === "signedIn" ? sessionState.session.email : "";

  const handleFor = (workspaceId: string) => (meState.status === "ready" ? meState.me.workspaces.find((w) => w.id === workspaceId)?.handle : undefined);
  const onAccept = async (workspaceId: string, name?: string) => {
    const done = await accept.run(workspaceId, name);
    if (!done) return;
    clearClaimToken();
    reloadMe();
    const handle = handleFor(done.workspaceId);
    navigate(handle ? `/w/${handle}/grants/${done.awardId}` : "/workspaces", { replace: true });
  };
  const onDecline = async (reason: string) => {
    // The page then shows the invitation as declined.
    if (await decline.run(reason)) lookup.reload();
  };
  // A link that stopped working while this page was open: show what it is now.
  const failure = errorCode(accept.error) ?? errorCode(decline.error);
  const reloadLookup = lookup.reload;
  useEffect(() => {
    if (failure === "invitation_expired" || failure === "invitation_used" || failure === "invitation_revoked") reloadLookup();
  }, [failure, reloadLookup]);

  // The link is spent or invalid: nothing more to keep.
  const spent = lookup.status === "ready" ? lookup.data.status !== "pending" : lookup.status === "error";
  useEffect(() => {
    if (spent) clearClaimToken();
  }, [spent]);

  const notFound = lookup.status === "error" && (errorCode(lookup.error) === "invitation_not_found" || (lookup.error as { status?: number }).status === 404);
  return (
    <>
      <title>{t("claimAward.acceptAnAwardOpengrantsGms")}</title>
      <div className="gms gms-applicant gms-frame">
        <header className="topbar">
          <Link to="/" className="logo">
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
            <span className="suffix">GMS</span>
          </Link>
        </header>
        <main className="main" style={{ maxWidth: "720px", width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" }}>
          {lookup.status === "loading" && <Loading label={t("claimAward.openingTheInvitation")} />}
          {notFound && (
            <div className="empty" role="alert">
              <TriangleExclamationPoint className="ic" aria-hidden="true" />
              <h3>{t("claimAward.thisInvitationLinkIsNot")}</h3>
              <p>{t("claimAward.theLinkMayBeIncomplete")}</p>
              <div className="acts">
                <Link to="/workspaces" className="btn btn-primary">
                  {t("claimAward.goToYourWorkspaces")}
                </Link>
              </div>
            </div>
          )}
          {lookup.status === "error" && !notFound && <ErrorBanner error={lookup.error} onRetry={lookup.reload} title={t("claimAward.theInvitationCouldNotBe")} />}
          {lookup.status === "ready" && (
            <ClaimView
              lookup={lookup.data}
              claimUrl={claimUrl}
              signedInAs={email}
              accepting={accept.state === "saving"}
              declining={decline.state === "saving"}
              error={accept.error ?? decline.error}
              onAccept={onAccept}
              onDecline={onDecline}
              onSwitchAddress={() => void auth.signOut()}
            />
          )}
        </main>
      </div>
    </>
  );
}
