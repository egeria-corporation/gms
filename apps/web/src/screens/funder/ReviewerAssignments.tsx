// SPDX-License-Identifier: AGPL-3.0-only
// Reviewer portal: the assignments of the signed-in reviewer. Nothing in a competition opens before
// the reviewer has signed its conflict-of-interest policy; then an application opens for scoring
// only after the reviewer has declared whether they have a conflict of interest on it; declaring
// one recuses them and the application never opens. In a stage with anonymized review the
// application shows as a code ("Applicant A-1042"), never by who applied.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Ban, Bell, ChartColumn, ChevronDown, ClipboardCheck, EyeOff, Signature, Star } from "lucide-react";
import { initialsOf, type MeWorkspace, type Workspace } from "../../api/client.ts";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { ReviewAssignment } from "../../api/funder.ts";
import { useServices } from "../../app/services.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { EmptyState, ErrorBanner, Loading } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { SignPolicyDialog } from "./ReviewParity.tsx";
import { t, useFunderMessages } from "./i18n.ts";

/** How an assignment names its application: the code under anonymized review, else the title. */
export const assignmentName = (a: Pick<ReviewAssignment, "applicationTitle" | "applicantCode" | "anonymized">) => (a.anonymized && a.applicantCode ? t("reviewerAssignments.applicantCode", { code: a.applicantCode }) : (a.applicationTitle ?? t("reviewerAssignments.application")));

const COI_STATEMENTS = () => [t("reviewerAssignments.coi.notEmployee"), t("reviewerAssignments.coi.household"), t("reviewerAssignments.coi.notDiscussed")];

export const ASSIGNMENT_LOOK: Record<ReviewAssignment["status"], { readonly label: string; tone: string }> = {
  assigned: { get label() { return t("reviewerAssignments.look.assigned"); }, tone: "neutral" },
  coi_declared: { get label() { return t("reviewerAssignments.look.coiDeclared"); }, tone: "info" },
  in_progress: { get label() { return t("reviewerAssignments.look.inProgress"); }, tone: "prog" },
  submitted: { get label() { return t("reviewerAssignments.look.submitted"); }, tone: "ok" },
  recused: { get label() { return t("reviewerAssignments.look.recused"); }, tone: "done" },
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
      <title>{t("reviewerAssignments.reviewerPortal", { title })}</title>
      <div className="gms gms-funder gms-frame">
        <header className="topbar">
          <Link to="/review/assignments" className="logo">
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
            <span className="suffix">GMS</span>
          </Link>
          <Link to="/workspaces" className="ws">
            {t("reviewerAssignments.reviewerPortal2")}{membership ? ` · ${membership.name}` : ""}
            <span className="role">{t("reviewerAssignments.reviewer")}</span>
            <ChevronDown className="ic" aria-hidden="true" />
          </Link>
          <div className="row" style={{ marginLeft: "auto", gap: "4px" }}>
            <Link to="/notifications" className="iconbtn" aria-label={t("reviewerAssignments.notifications")}>
              <Bell className="ic ic-md" aria-hidden="true" />
            </Link>
            {me && (
              <Link to="/account/agents" className="av av-t">
                <span aria-hidden="true">{initialsOf(me.email)}</span>
                <span className="sr">{t("reviewerAssignments.account", { email: me.email })}</span>
              </Link>
            )}
          </div>
        </header>
        <nav aria-label={t("reviewerAssignments.reviewerPortal2")} style={{ background: "#fff", borderBottom: "1px solid #D6DEDE", padding: "0 32px" }}>
          <div className="tabs" style={{ borderBottom: 0 }}>
            <Link to="/review/assignments" className={tab === "assignments" ? "tab on" : "tab"} aria-current={tab === "assignments" ? "page" : undefined}>
              <ClipboardCheck className="ic" aria-hidden="true" />
              {t("reviewerAssignments.myAssignments")}
            </Link>
            <span className={tab === "scoring" ? "tab on" : "tab"} aria-current={tab === "scoring" ? "page" : undefined}>
              <Star className="ic" aria-hidden="true" />
              {t("reviewerAssignments.scoring")}
            </span>
          </div>
        </nav>
        <main className="main" style={{ maxWidth: "1120px", width: "100%", margin: "0 auto" }}>
          {(meState.status === "loading" || workspace.status === "loading") && <Loading label={t("reviewerAssignments.openingTheReviewerPortal")} />}
          {workspace.status === "error" && <ErrorBanner error={workspace.error} onRetry={workspace.reload} />}
          {meState.status === "ready" && !membership && (
            <EmptyState icon={ClipboardCheck} title={t("reviewerAssignments.noReviewsAssignedTo")}>
              {t("reviewerAssignments.youAreNotA")}
            </EmptyState>
          )}
          {ready && <PortalContext.Provider value={{ workspace: workspace.data!, userId: me.userId, email: me.email }}>{children}</PortalContext.Provider>}
        </main>
      </div>
    </>
  );
}

function CoiDialog({ assignment, onClose, onDeclared }: { assignment: ReviewAssignment; onClose: () => void; onDeclared: (a: ReviewAssignment) => void }) {
  const [checks, setChecks] = useState<boolean[]>(() => COI_STATEMENTS().map(() => false));
  const [conflict, setConflict] = useState(false);
  const [reason, setReason] = useState("");
  const declare = useApiMutation((api, hasConflict: boolean) => api.updateAssignment(assignment.id, { action: "declare_coi", hasConflict, ...(hasConflict && reason.trim() ? { reason: reason.trim() } : {}) }));
  const allChecked = checks.every(Boolean);
  return (
    <Dialog open onClose={onClose} labelledBy="coi-title">
      <div className="hd">
        <div>
          <h3 id="coi-title" style={{ fontSize: "16px" }}>
            {t("reviewerAssignments.conflictOfInterestDeclaration")}
          </h3>
          <p className="small muted">{assignmentName(assignment)}</p>
        </div>
      </div>
      <div className="bd">
        {declare.error !== null && <ErrorBanner error={declare.error} />}
        {!conflict ? (
          <>
            <p>{t("reviewerAssignments.confirmEachStatementBefore")}</p>
            {COI_STATEMENTS().map((s, i) => (
              <label key={s} className="cb">
                <input type="checkbox" checked={checks[i]} onChange={(e) => setChecks((c) => c.map((v, j) => (j === i ? e.target.checked : v)))} />
                <span>{s}</span>
              </label>
            ))}
          </>
        ) : (
          <div className="fld">
            <label className="lbl" htmlFor="coi-reason">
              {t("reviewerAssignments.whatIsTheConflict")}
            </label>
            <textarea className="ta" id="coi-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <span className="help">{t("reviewerAssignments.programStaffSeeThis")}</span>
          </div>
        )}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-danger" style={{ marginRight: "auto" }} onClick={() => setConflict((c) => !c)}>
          <Ban className="ic" aria-hidden="true" />
          {conflict ? t("reviewerAssignments.back") : t("reviewerAssignments.iHaveAConflict")}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t("reviewerAssignments.cancel")}
        </button>
        {conflict ? (
          <button type="button" className="btn btn-danger-solid" disabled={declare.state === "saving" || !reason.trim()} onClick={async () => { const a = await declare.run(true); if (a) onDeclared(a); }}>
            {t("reviewerAssignments.recuseMe")}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!allChecked || declare.state === "saving"} onClick={async () => { const a = await declare.run(false); if (a) onDeclared(a); }}>
            {t("reviewerAssignments.declareNoConflictAnd")}
          </button>
        )}
      </div>
    </Dialog>
  );
}

function AssignmentList() {
  const { userId, email, workspace } = usePortal();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const list = useApiQuery((api) => api.listAssignments({ reviewerUserId: userId }), [userId]);
  const [declaring, setDeclaring] = useState<ReviewAssignment | null>(null);
  const [signing, setSigning] = useState<string | null>(null);
  // The guest welcome's conflict-of-interest link (`?sign=1`) opens the first policy waiting for this reviewer's signature, once.
  const [askedToSign, setAskedToSign] = useState(params.get("sign") === "1");
  const firstUnsigned = list.status === "ready" ? (list.data.find((r) => r.policyRequired && r.competitionId)?.competitionId ?? null) : null;
  useEffect(() => {
    if (!askedToSign || list.status !== "ready") return;
    setAskedToSign(false);
    if (firstUnsigned) setSigning(firstUnsigned);
  }, [askedToSign, list.status, firstUnsigned]);
  if (list.status === "loading") return <Loading label={t("reviewerAssignments.loadingYourAssignments")} />;
  if (list.status === "error") return <ErrorBanner error={list.error} onRetry={list.reload} />;
  const rows = list.data;
  const count = (s: ReviewAssignment["status"]) => rows.filter((r) => r.status === s).length;
  // Competitions whose conflict-of-interest policy waits for this reviewer's signature.
  const unsigned = [...new Set(rows.filter((r) => r.policyRequired && r.competitionId).map((r) => r.competitionId!))];
  const guestDone = workspace.member.role === "external_reviewer" && rows.some((r) => r.status === "submitted") && rows.every((r) => r.status === "submitted" || r.status === "recused");
  const anonymized = rows.some((r) => r.anonymized);
  return (
    <>
      <div className="ph">
        <div>
          <div className="title">
            <h1>{t("reviewerAssignments.myAssignments")}</h1>
          </div>
          <div className="meta">
            <span>{t("reviewerAssignments.signedInAs", { email })}</span>
            <span>·</span>
            <span>
              {t("reviewerAssignments.assignmentCount", { count: rows.length })}
            </span>
          </div>
        </div>
        <div className="actions">
          <span className="row small muted" style={{ gap: "6px" }}>
            <ChartColumn className="ic" aria-hidden="true" />
            {t("reviewerAssignments.submittedInProgressNot", { count: count("submitted"), count2: count("in_progress"), count3: count("assigned") + count("coi_declared"), count4: count("recused") })}
          </span>
        </div>
      </div>
      {guestDone && (
        <div className="bnr bnr-ok" role="status">
          <ClipboardCheck className="ic" aria-hidden="true" />
          <div>
            <div className="t">{t("reviewerAssignments.everyReviewIsIn")}</div>
            <div className="d">{t("reviewerAssignments.thankYouThereIs")}</div>
          </div>
          <Link to={`/review/done?ws=${encodeURIComponent(workspace.handle)}`} className="btn btn-secondary btn-sm act">
            {t("reviewerAssignments.seeWhatsNext")}
          </Link>
        </div>
      )}
      {unsigned.map((competitionId) => (
        <div key={competitionId} className="bnr bnr-warn" role="status">
          <Signature className="ic" aria-hidden="true" />
          <div>
            <div className="t">{t("reviewerAssignments.signTheConflictOf")}</div>
            <div className="d">
              {t("reviewerAssignments.waitForSignature", { count: rows.filter((r) => r.competitionId === competitionId && r.policyRequired).length })}
            </div>
          </div>
          <button type="button" className="btn btn-primary btn-sm act" aria-haspopup="dialog" onClick={() => setSigning(competitionId)}>
            {t("reviewerAssignments.readAndSign")}
          </button>
        </div>
      ))}
      <div className="bnr bnr-neu">
        <EyeOff className="ic" aria-hidden="true" />
        <div>
          <div className="t">{t("reviewerAssignments.whatYouCanSee")}</div>
          <div className="d">
            {anonymized
              ? t("reviewerAssignments.someOfYourApplications")
              : t("reviewerAssignments.applicantContactDetailsAnd")}
          </div>
        </div>
      </div>
      {rows.length === 0 && (
        <EmptyState icon={ClipboardCheck} title={t("reviewerAssignments.nothingAssignedYet")}>
          {t("reviewerAssignments.assignmentsAppearHereWhen")}
        </EmptyState>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px" }}>
        {rows.map((a) => {
          const look = ASSIGNMENT_LOOK[a.status];
          const open = () => (a.status === "assigned" ? setDeclaring(a) : navigate(`/review/score/${a.id}`));
          return (
            <article key={a.id} className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                <h2 style={{ fontSize: "16px" }}>{a.policyRequired ? t("reviewerAssignments.waitingForYourSignature") : assignmentName(a)}</h2>
                <span className={`bdg bdg-${look.tone}`}>
                  <ClipboardCheck className="ic" aria-hidden="true" />
                  {look.label}
                </span>
              </div>
              {a.anonymized && (
                <div className="row small" style={{ gap: "6px" }}>
                  <span className="bdg bdg-info">
                    <EyeOff className="ic" aria-hidden="true" />
                    {t("reviewerAssignments.anonymizedReview")}
                  </span>
                  {a.applicationTitle && <span className="muted">{a.applicationTitle}</span>}
                </div>
              )}
              <div className="small muted">
                {t("reviewerAssignments.stage", { stage: a.stage })}
                {a.dueAt ? t("reviewerAssignments.due", { date: formatDate(a.dueAt) }) : ""}
                {a.review?.overall !== null && a.review?.overall !== undefined ? t("reviewerAssignments.yourScore", { overall: a.review.overall.toFixed(1) }) : ""}
              </div>
              {a.policyRequired ? (
                <span className="small muted">{t("reviewerAssignments.opensOnceYouHave")}</span>
              ) : a.status === "recused" ? (
                <span className="small muted">{t("reviewerAssignments.youAreRecusedFrom")}</span>
              ) : (
                <button type="button" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} aria-haspopup={a.status === "assigned" ? "dialog" : undefined} onClick={open}>
                  {a.status === "assigned" ? t("reviewerAssignments.declareConflictsAndOpen") : a.status === "submitted" ? t("reviewerAssignments.viewMyReview") : t("reviewerAssignments.continueScoring")}
                </button>
              )}
            </article>
          );
        })}
      </div>
      {signing && (
        <SignPolicyDialog
          competitionId={signing}
          onClose={() => setSigning(null)}
          onSigned={() => {
            setSigning(null);
            list.reload();
          }}
        />
      )}
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
  useFunderMessages();
  return (
    <ReviewerFrame tab="assignments" title={t("reviewerAssignments.myAssignments")}>
      <AssignmentList />
    </ReviewerFrame>
  );
}
