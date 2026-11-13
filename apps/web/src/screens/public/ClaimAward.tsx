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
import { formatDecimalAmount } from "../../lib/directAward.ts";

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

/** Passport-verified at L1 or above. Linked at L0, self-declared, none or anything unexpected counts as not verified. */
export function funderIsVerified(v: { source?: unknown; level?: unknown } | null | undefined): boolean {
  return v?.source === "passport" && typeof v.level === "string" && /^L[1-3]$/.test(v.level);
}

function AwardSummary({ lookup }: { lookup: InvitationLookup }) {
  const { award, funder } = lookup;
  const period = award.startDate && award.endDate ? `${formatDate(award.startDate)} to ${formatDate(award.endDate)}` : award.startDate ? `From ${formatDate(award.startDate)}` : award.endDate ? `Until ${formatDate(award.endDate)}` : null;
  return (
    <section className="card" aria-labelledby="claim-award-h">
      <div className="card-h">
        <div>
          <span className="eyebrow">From</span>
          <div className="row wrap" style={{ gap: "8px" }}>
            <span className="b">{funder.name}</span>
            <VerificationBadge verification={funder.verification} />
          </div>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {!funderIsVerified(funder.verification) && (
          <p className="row small" style={{ gap: "6px" }}>
            <ShieldOff className="ic" aria-hidden="true" />
            <span>This funder's organization is not verified with OpenGrants Passport.</span>
          </p>
        )}
        <h2 id="claim-award-h" style={{ fontSize: "20px" }}>
          {award.title}
        </h2>
        <dl className="kv">
          <dt>Amount</dt>
          <dd>{award.amount ? formatDecimalAmount(award.amount.value, award.amount.currency) : "—"}</dd>
          <dt>For</dt>
          <dd>{lookup.organizationName}</dd>
          {period && (
            <>
              <dt>Period</dt>
              <dd>{period}</dd>
            </>
          )}
          <dt>Sent to</dt>
          <dd>{lookup.invitedEmail}</dd>
        </dl>
        {award.message && (
          <blockquote style={{ margin: 0, padding: "8px 12px", borderLeft: "3px solid var(--og-gray-200)", whiteSpace: "pre-wrap" }}>
            <span className="eyebrow">Message from {funder.name}</span>
            <p>{award.message}</p>
          </blockquote>
        )}
      </div>
    </section>
  );
}

function DeclineDialog({ funderName, busy, onClose, onDecline }: { funderName: string; busy: boolean; onClose: () => void; onDecline: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onClose={onClose} labelledBy="decline-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onDecline(reason);
        }}
      >
        <div className="hd">
          <h2 id="decline-title">Decline this award</h2>
        </div>
        <div className="bd">
          <p>{funderName} is told you declined. They decide what happens to the award.</p>
          <Field id="decline-reason" label="Reason" help="Optional. Shared with the funder.">
            <textarea className="ta" id="decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Keep the award open
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy}>
            <CircleX className="ic" aria-hidden="true" />
            Decline award
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
      <Notice tone="warn" title="This invitation was sent to a different address">
        {error instanceof Error ? error.message : "Sign in with the address the invitation was sent to."}{" "}
        <button type="button" className="btn btn-sm btn-secondary" onClick={onSwitchAddress}>
          Sign in with a different address
        </button>
      </Notice>
    );
  }
  if (code === "signer_name_required") {
    return <Notice tone="info" title="Type your full legal name">Passport lists verified representatives for this organization. Type your full legal name below, as it appears there, then accept again.</Notice>;
  }
  if (code === "invitation_revoked") {
    return <Notice tone="warn" title="This award was withdrawn">The funder withdrew this award, so it can no longer be accepted.</Notice>;
  }
  if (code === "not_workspace_admin") {
    return <Notice tone="warn" title="Only an admin can accept">Only an admin of an organization can accept an award for it. Choose an organization you administer, or ask one of its admins to accept.</Notice>;
  }
  if (code === "mfa_required") {
    return (
      <Notice tone="warn" title="One more step before you can accept">
        Accepting needs the second step of sign-in. <Link to={signInPath(claimUrl, "mfa")}>Finish the second step</Link>, then come back to accept.
      </Notice>
    );
  }
  return <ErrorBanner error={error} title="The award was not accepted" />;
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
      accepted: { icon: CircleCheck, title: "This award was already accepted", text: "Nothing more is needed here. Open your workspaces to find it." },
      declined: { icon: CircleX, title: "This invitation was declined", text: `${funderName} was told. If that was a mistake, ask them to send a new invitation.` },
      expired: { icon: Clock, title: "This invitation has expired", text: `Ask ${funderName} to send a new one. Links work for a limited time.` },
      revoked: { icon: Ban, title: "This award was withdrawn", text: `${funderName} withdrew this award, so it can no longer be accepted.` },
    }[lookup.status];
    const Icon = closed.icon;
    body = (
      <div className="empty" role="status">
        <Icon className="ic" aria-hidden="true" />
        <h3>{closed.title}</h3>
        <p>{closed.text}</p>
        <div className="acts">
          <Link to="/workspaces" className="btn btn-primary">
            Go to your workspaces
          </Link>
        </div>
      </div>
    );
  } else if (!lookup.emailMatches) {
    body = (
      <div className="bnr bnr-warn" role="alert">
        <TriangleExclamationPoint className="ic" aria-hidden="true" />
        <div>
          <div className="t">This invitation was sent to a different address</div>
          <div className="d">
            Sign in with the address the invitation was sent to: {lookup.invitedEmail}. You are signed in as {signedInAs}.
          </div>
          <div style={{ marginTop: "8px" }}>
            <button type="button" className="btn btn-secondary" onClick={onSwitchAddress}>
              <LogOut className="ic" aria-hidden="true" />
              Sign in with a different address
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
            {lookup.workspaces.length > 0 ? "Which organization is accepting?" : "Set up your organization"}
          </h2>
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {error !== undefined && error !== null && <AcceptProblem error={error} claimUrl={claimUrl} onSwitchAddress={onSwitchAddress} />}
          {lookup.workspaces.length > 0 ? (
            <>
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                <legend className="sr">Organization accepting this award</legend>
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
                Not one of these? <Link to={setUp}>Set up a new organization</Link>
              </p>
              {needsName && (
                <Field id="claim-signer" label="Your full legal name" required help="Passport lists verified representatives for this organization. Type your name as it appears there.">
                  <input className="inp" id="claim-signer" value={signerName} onChange={(e) => setSignerName(e.target.value)} autoComplete="name" />
                </Field>
              )}
              <p>Accepting shares your organization's record with {funderName}.</p>
              <div className="row wrap">
                <button type="button" className="btn btn-primary" disabled={!chosen || accepting || (needsName && signerName.trim().length < 2)} onClick={() => onAccept(chosen, signerName.trim() || undefined)}>
                  <AwardIcon className="ic" aria-hidden="true" />
                  Accept award
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setDeciding(true)}>
                  Decline…
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                You do not have an organization on OpenGrants GMS yet. Setting one up takes a few minutes and does not need Passport. Then you come back here to accept.
              </p>
              <div className="row wrap">
                <Link to={setUp} className="btn btn-primary">
                  Set up your organization
                </Link>
                <button type="button" className="btn btn-secondary" onClick={() => setDeciding(true)}>
                  Decline…
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
        <h1>Accept an award from {funderName}</h1>
        <p className="muted">Signed in as {signedInAs}</p>
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
  const lookup = useApiQuery((api) => (token ? api.lookupAwardInvitation(token) : Promise.reject(Object.assign(new Error("This invitation link is not complete."), { status: 404 }))), [token]);
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
      <title>Accept an award — OpenGrants GMS</title>
      <div className="gms gms-applicant gms-frame">
        <header className="topbar">
          <Link to="/" className="logo">
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
            <span className="suffix">GMS</span>
          </Link>
        </header>
        <main className="main" style={{ maxWidth: "720px", width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" }}>
          {lookup.status === "loading" && <Loading label="Opening the invitation" />}
          {notFound && (
            <div className="empty" role="alert">
              <TriangleExclamationPoint className="ic" aria-hidden="true" />
              <h3>This invitation link is not valid</h3>
              <p>The link may be incomplete, or a newer email may have replaced it. Open the most recent email from the funder, or ask them to send a new invitation.</p>
              <div className="acts">
                <Link to="/workspaces" className="btn btn-primary">
                  Go to your workspaces
                </Link>
              </div>
            </div>
          )}
          {lookup.status === "error" && !notFound && <ErrorBanner error={lookup.error} onRetry={lookup.reload} title="The invitation could not be opened" />}
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
