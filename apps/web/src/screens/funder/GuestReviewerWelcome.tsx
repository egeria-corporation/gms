// SPDX-License-Identifier: AGPL-3.0-only
// The guest reviewer's welcome (C4), where an accepted invitation to review lands
// (`/review/welcome?ws=<funder handle>`). One screen: who invited them, to review what, how many
// applications, by when, the conflict-of-interest note, and "Start reviewing". No workspace or
// organization setup is asked of a guest.
import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowRight, CalendarClock, CircleCheck, ClipboardCheck, ShieldCheck } from "lucide-react";
import { useGuestMembership, useGuestReviewQuery } from "../../api/guestReviewHooks.ts";
import { initialsOf } from "../../api/client.ts";
import { useServices } from "../../app/services.tsx";
import { EmptyState, ErrorBanner, Loading } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";

/** The guest's own chrome: the reviewer portal's top bar, nothing else. */
export function GuestFrame({ title, funder, children }: { title: string; funder: string | null; children: ReactNode }) {
  const { meState } = useServices();
  const me = meState.status === "ready" ? meState.me : null;
  return (
    <>
      <title>{`${title} — Reviewer portal`}</title>
      <div className="gms gms-funder gms-frame">
        <header className="topbar">
          <Link to="/review/assignments" className="logo">
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
            <span className="suffix">GMS</span>
          </Link>
          <span className="ws">
            Reviewer portal{funder ? ` · ${funder}` : ""}
            <span className="role">Guest reviewer</span>
          </span>
          {me && (
            <div className="row" style={{ marginLeft: "auto" }}>
              <Link to="/account/agents" className="av av-t">
                <span aria-hidden="true">{initialsOf(me.email)}</span>
                <span className="sr">Account: {me.email}</span>
              </Link>
            </div>
          )}
        </header>
        <main className="main" style={{ maxWidth: "760px", width: "100%", margin: "0 auto" }}>
          {children}
        </main>
      </div>
    </>
  );
}

/** Shown when the signed-in person reviews for no funder as a guest. */
export function NotAGuest() {
  return (
    <EmptyState
      icon={ClipboardCheck}
      title="This page is for invited reviewers"
      actions={
        <Link to="/workspaces" className="btn btn-primary">
          Go to your workspaces
        </Link>
      }
    >
      An invitation to review from a funder brings you here.
    </EmptyState>
  );
}

export default function GuestReviewerWelcome() {
  const [params] = useSearchParams();
  const guest = useGuestMembership(params.get("ws"));
  const membership = guest.status === "ready" ? guest.membership : null;
  return (
    <GuestFrame title="Welcome" funder={membership?.name ?? null}>
      {guest.status === "loading" && <Loading label="Opening your invitation" />}
      {guest.status === "ready" && !membership && <NotAGuest />}
      {membership && <Welcome workspaceId={membership.id} />}
    </GuestFrame>
  );
}

function Welcome({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const query = useGuestReviewQuery((api) => api.welcome(workspaceId), [workspaceId]);
  if (query.status === "loading") return <Loading label="Opening your invitation" />;
  if (query.status === "error") return <ErrorBanner error={query.error} onRetry={query.reload} />;
  const w = query.data;
  const comp = w.competitions[0];
  return (
    <section className="card" aria-labelledby="gw-title">
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        <div>
          <span className="eyebrow">You are reviewing for {w.funder.name}</span>
          <h1 id="gw-title" style={{ fontSize: "22px", marginTop: "4px" }}>
            Welcome. Thank you for reviewing.
          </h1>
          <p className="muted" style={{ marginTop: "6px" }}>
            You are a guest reviewer: you see only the applications assigned to you, and nothing to set up.
          </p>
        </div>
        <dl className="kv" style={{ fontSize: "14px" }}>
          <dt>Funder</dt>
          <dd>{w.funder.name}</dd>
          <dt>Competition</dt>
          <dd>{w.competitions.length > 1 ? w.competitions.map((c) => c.title).join(" · ") : (comp?.title ?? "Not named yet")}</dd>
          <dt>Applications</dt>
          <dd>
            {w.assigned} assigned to you{w.submitted > 0 ? ` · ${w.submitted} submitted` : ""}
          </dd>
          <dt>Due</dt>
          <dd className="row" style={{ gap: "6px" }}>
            <CalendarClock className="ic ic-sm" aria-hidden="true" />
            {w.dueAt ? formatDate(w.dueAt) : "No due date set"}
          </dd>
        </dl>
        <div className="bnr bnr-info" role="note" aria-label="Conflicts of interest">
          <ShieldCheck className="ic" aria-hidden="true" />
          <div>
            <div className="b">Conflicts of interest</div>
            <p className="small">{w.coi.note}</p>
            <Link to={w.coi.link} className="small">
              Read and confirm the conflict-of-interest steps
            </Link>
          </div>
        </div>
        {w.done ? (
          <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
            <span className="bdg bdg-ok">
              <CircleCheck className="ic" aria-hidden="true" />
              All {w.submitted} reviews submitted
            </span>
            <Link to={`/review/done?ws=${encodeURIComponent(w.funder.handle)}`} className="btn btn-primary">
              See what’s next
              <ArrowRight className="ic" aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <div>
            <button type="button" className="btn btn-primary" onClick={() => navigate(w.startUrl)}>
              Start reviewing
              <ArrowRight className="ic" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
