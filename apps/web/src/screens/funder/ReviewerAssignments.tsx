// SPDX-License-Identifier: AGPL-3.0-only
// Reviewer portal: the assignments of the signed-in reviewer. An application opens for scoring
// only after the reviewer has declared whether they have a conflict of interest; declaring one
// recuses them and the application never opens.
import { createContext, useContext, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Ban, Bell, ChartColumn, ChevronDown, ClipboardCheck, EyeOff, Star } from "lucide-react";
import { initialsOf, type MeWorkspace, type Workspace } from "../../api/client.ts";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { ReviewAssignment } from "../../api/funder.ts";
import { useServices } from "../../app/services.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { EmptyState, ErrorBanner, Loading } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";

const COI_STATEMENTS = [
  "I am not an employee, board member, or contractor of this organization, and have not been in the last three years.",
  "No member of my household has a financial interest in this organization or this project.",
  "I have not discussed this application with the applicant outside the review process.",
];

export const ASSIGNMENT_LOOK: Record<ReviewAssignment["status"], { label: string; tone: string }> = {
  assigned: { label: "Not started", tone: "neutral" },
  coi_declared: { label: "Ready to score", tone: "info" },
  in_progress: { label: "In progress", tone: "prog" },
  submitted: { label: "Submitted", tone: "ok" },
  recused: { label: "Recused", tone: "done" },
};

interface Portal {
  workspace: Workspace;
  userId: string;
  email: string;
}
const PortalContext = createContext<Portal | null>(null);
export const usePortal = () => {
  const p = useContext(PortalContext);
  if (!p) throw new Error("ReviewerFrame is missing");
  return p;
};

/** The reviewer portal's own chrome: no workspace rail, only assignments and scoring. */
export function ReviewerFrame({ tab, title, children }: { tab: "assignments" | "scoring"; title: string; children: ReactNode }) {
  const { meState, api } = useServices();
  const [params] = useSearchParams();
  const funders: MeWorkspace[] = meState.status === "ready" ? meState.me.workspaces.filter((w) => w.kind === "funder") : [];
  const membership = funders.find((w) => w.handle === params.get("ws")) ?? funders[0];
  // Opening the workspace also tells the API client which workspace the following calls act in.
  const workspace = useApiQuery(async () => (membership ? api.workspace(membership.handle) : null), [membership?.handle]);
  const me = meState.status === "ready" ? meState.me : null;
  const ready = workspace.status === "ready" && workspace.data && me;

  return (
    <>
      <title>{`${title} — Reviewer portal`}</title>
      <div className="gms gms-funder gms-frame">
        <header className="topbar">
          <Link to="/review/assignments" className="logo">
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
            <span className="suffix">GMS</span>
          </Link>
          <Link to="/workspaces" className="ws">
            Reviewer portal{membership ? ` · ${membership.name}` : ""}
            <span className="role">Reviewer</span>
            <ChevronDown className="ic" aria-hidden="true" />
          </Link>
          <div className="row" style={{ marginLeft: "auto", gap: "4px" }}>
            <Link to="/notifications" className="iconbtn" aria-label="Notifications">
              <Bell className="ic ic-md" aria-hidden="true" />
            </Link>
            {me && (
              <Link to="/account/agents" className="av av-t" aria-label={`Account: ${me.email}`}>
                {initialsOf(me.email)}
              </Link>
            )}
          </div>
        </header>
        <nav aria-label="Reviewer portal" style={{ background: "#fff", borderBottom: "1px solid #D6DEDE", padding: "0 32px" }}>
          <div className="tabs" style={{ borderBottom: 0 }}>
            <Link to="/review/assignments" className={tab === "assignments" ? "tab on" : "tab"} aria-current={tab === "assignments" ? "page" : undefined}>
              <ClipboardCheck className="ic" aria-hidden="true" />
              My assignments
            </Link>
            <span className={tab === "scoring" ? "tab on" : "tab"} aria-current={tab === "scoring" ? "page" : undefined}>
              <Star className="ic" aria-hidden="true" />
              Scoring
            </span>
          </div>
        </nav>
        <main className="main" style={{ maxWidth: "1120px", width: "100%", margin: "0 auto" }}>
          {(meState.status === "loading" || workspace.status === "loading") && <Loading label="Opening the reviewer portal" />}
          {workspace.status === "error" && <ErrorBanner error={workspace.error} onRetry={workspace.reload} />}
          {meState.status === "ready" && !membership && (
            <EmptyState icon={ClipboardCheck} title="No reviews assigned to you">
              You are not a reviewer for any funder yet. An invitation email brings you here.
            </EmptyState>
          )}
          {ready && <PortalContext.Provider value={{ workspace: workspace.data!, userId: me.userId, email: me.email }}>{children}</PortalContext.Provider>}
        </main>
      </div>
    </>
  );
}

function CoiDialog({ assignment, onClose, onDeclared }: { assignment: ReviewAssignment; onClose: () => void; onDeclared: (a: ReviewAssignment) => void }) {
  const [checks, setChecks] = useState<boolean[]>(() => COI_STATEMENTS.map(() => false));
  const [conflict, setConflict] = useState(false);
  const [reason, setReason] = useState("");
  const declare = useApiMutation((api, hasConflict: boolean) => api.updateAssignment(assignment.id, { action: "declare_coi", hasConflict, ...(hasConflict && reason.trim() ? { reason: reason.trim() } : {}) }));
  const allChecked = checks.every(Boolean);
  return (
    <Dialog open onClose={onClose} labelledBy="coi-title">
      <div className="hd">
        <div>
          <h3 id="coi-title" style={{ fontSize: "16px" }}>
            Conflict of interest declaration
          </h3>
          <p className="small muted">{assignment.applicationTitle}</p>
        </div>
      </div>
      <div className="bd">
        {declare.error !== null && <ErrorBanner error={declare.error} />}
        {!conflict ? (
          <>
            <p>Confirm each statement before this application opens for scoring.</p>
            {COI_STATEMENTS.map((s, i) => (
              <label key={s} className="cb">
                <input type="checkbox" checked={checks[i]} onChange={(e) => setChecks((c) => c.map((v, j) => (j === i ? e.target.checked : v)))} />
                <span>{s}</span>
              </label>
            ))}
          </>
        ) : (
          <div className="fld">
            <label className="lbl" htmlFor="coi-reason">
              What is the conflict?
            </label>
            <textarea className="ta" id="coi-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <span className="help">Program staff see this. You are recused and the application will not open.</span>
          </div>
        )}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-danger" style={{ marginRight: "auto" }} onClick={() => setConflict((c) => !c)}>
          <Ban className="ic" aria-hidden="true" />
          {conflict ? "Back" : "I have a conflict"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        {conflict ? (
          <button type="button" className="btn btn-danger-solid" disabled={declare.state === "saving" || !reason.trim()} onClick={async () => { const a = await declare.run(true); if (a) onDeclared(a); }}>
            Recuse me
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!allChecked || declare.state === "saving"} onClick={async () => { const a = await declare.run(false); if (a) onDeclared(a); }}>
            Declare no conflict and open
          </button>
        )}
      </div>
    </Dialog>
  );
}

function AssignmentList() {
  const { userId, email } = usePortal();
  const navigate = useNavigate();
  const list = useApiQuery((api) => api.listAssignments({ reviewerUserId: userId }), [userId]);
  const [declaring, setDeclaring] = useState<ReviewAssignment | null>(null);
  if (list.status === "loading") return <Loading label="Loading your assignments" />;
  if (list.status === "error") return <ErrorBanner error={list.error} onRetry={list.reload} />;
  const rows = list.data;
  const count = (s: ReviewAssignment["status"]) => rows.filter((r) => r.status === s).length;
  return (
    <>
      <div className="ph">
        <div>
          <div className="title">
            <h1>My assignments</h1>
          </div>
          <div className="meta">
            <span>Signed in as {email}</span>
            <span>·</span>
            <span>
              {rows.length} {rows.length === 1 ? "assignment" : "assignments"}
            </span>
          </div>
        </div>
        <div className="actions">
          <span className="row small muted" style={{ gap: "6px" }}>
            <ChartColumn className="ic" aria-hidden="true" />
            {count("submitted")} submitted · {count("in_progress")} in progress · {count("assigned") + count("coi_declared")} not started · {count("recused")} recused
          </span>
        </div>
      </div>
      <div className="bnr bnr-neu">
        <EyeOff className="ic" aria-hidden="true" />
        <div>
          <div className="t">What you can see</div>
          <div className="d">Applicant contact details and fields flagged as personal are hidden from external reviewers. You see the organization name and the responses marked visible to reviewers.</div>
        </div>
      </div>
      {rows.length === 0 && (
        <EmptyState icon={ClipboardCheck} title="Nothing assigned yet">
          Assignments appear here when program staff assign applications to you.
        </EmptyState>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px" }}>
        {rows.map((a) => {
          const look = ASSIGNMENT_LOOK[a.status];
          const open = () => (a.status === "assigned" ? setDeclaring(a) : navigate(`/review/score/${a.id}`));
          return (
            <article key={a.id} className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                <h2 style={{ fontSize: "16px" }}>{a.applicationTitle ?? "Application"}</h2>
                <span className={`bdg bdg-${look.tone}`}>
                  <ClipboardCheck className="ic" aria-hidden="true" />
                  {look.label}
                </span>
              </div>
              <div className="small muted">
                Stage: {a.stage}
                {a.dueAt ? ` · due ${formatDate(a.dueAt)}` : ""}
                {a.review?.overall !== null && a.review?.overall !== undefined ? ` · your score ${a.review.overall.toFixed(1)}` : ""}
              </div>
              {a.status === "recused" ? (
                <span className="small muted">You are recused from this application.</span>
              ) : (
                <button type="button" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} aria-haspopup={a.status === "assigned" ? "dialog" : undefined} onClick={open}>
                  {a.status === "assigned" ? "Declare conflicts and open" : a.status === "submitted" ? "View my review" : "Continue scoring"}
                </button>
              )}
            </article>
          );
        })}
      </div>
      {declaring && (
        <CoiDialog
          assignment={declaring}
          onClose={() => setDeclaring(null)}
          onDeclared={(a) => {
            setDeclaring(null);
            if (a.status === "recused") list.reload();
            else navigate(`/review/score/${a.id}`);
          }}
        />
      )}
    </>
  );
}

export default function ReviewerAssignments() {
  return (
    <ReviewerFrame tab="assignments" title="My assignments">
      <AssignmentList />
    </ReviewerFrame>
  );
}
