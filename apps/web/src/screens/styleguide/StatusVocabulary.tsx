// SPDX-License-Identifier: AGPL-3.0-only
import {
  BadgeCheck,
  Ban,
  BookOpen,
  Bot,
  Calendar,
  Check,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CirclePause,
  CircleX,
  ClipboardCheck,
  Clock,
  Database,
  Eye,
  File,
  Hourglass,
  Loader,
  Lock,
  LogOut,
  Mail,
  PenLine,
  Pencil,
  RotateCcw,
  Search,
  Send,
  Shield,
  ShieldCheck,
  Star,
  TriangleExclamationPoint,
} from "lucide-react";

export default function StatusVocabulary() {
  return (
    <>
      <title>{"Status vocabulary"}</title>
      <div
        className="gms"
        style={{
          minHeight: "100vh",
          background: "#FFFFFF",
          padding: "40px 48px 56px",
          display: "flex",
          flexDirection: "column",
          gap: "28px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "900px" }}>
          <span className="eyebrow">OpenGrants GMS · Component additions</span>
          <h1 style={{ fontSize: "28px" }}>Status Vocabulary</h1>
          <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
            Every lifecycle state in the product, one badge each. A badge is always an icon plus a label, so state is never carried by color
            alone. Tones:{" "}
            <span className="bdg bdg-neutral">
              <Circle className="ic" aria-hidden="true" />
              Neutral
            </span>{" "}
            <span className="bdg bdg-info">
              <Circle className="ic" aria-hidden="true" />
              Info
            </span>{" "}
            <span className="bdg bdg-prog">
              <Circle className="ic" aria-hidden="true" />
              In progress
            </span>{" "}
            <span className="bdg bdg-ok">
              <Circle className="ic" aria-hidden="true" />
              Good
            </span>{" "}
            <span className="bdg bdg-warn">
              <Circle className="ic" aria-hidden="true" />
              Needs attention
            </span>{" "}
            <span className="bdg bdg-dng">
              <Circle className="ic" aria-hidden="true" />
              Stopped
            </span>{" "}
            <span className="bdg bdg-done">
              <Circle className="ic" aria-hidden="true" />
              Closed
            </span>{" "}
            <span className="bdg bdg-agent">
              <Circle className="ic" aria-hidden="true" />
              Agent
            </span>
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "24px" }}>
          <div className="card">
            <div className="card-h">
              <h3>Application</h3>
              <span className="muted small">11 states · moves between stages of a competition</span>
            </div>
            <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
              <table className="tbl voc">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Meaning</th>
                    <th>Who moves it</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span className="bdg bdg-neutral">
                        <Pencil className="ic" aria-hidden="true" />
                        Draft
                      </span>
                    </td>
                    <td>Being written by the applicant; not visible to the funder.</td>
                    <td>Applicant submits</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-info">
                        <Send className="ic" aria-hidden="true" />
                        Submitted
                      </span>
                    </td>
                    <td>Received with a snapshot and the Passport attestation attached.</td>
                    <td>System → Screening on open</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-info">
                        <Search className="ic" aria-hidden="true" />
                        Screening
                      </span>
                    </td>
                    <td>Eligibility and completeness check before reviewers see it.</td>
                    <td>Program officer or agent (gated)</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-prog">
                        <Eye className="ic" aria-hidden="true" />
                        Under review
                      </span>
                    </td>
                    <td>Assigned reviewers are scoring it.</td>
                    <td>Reviewers submit → panel</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-warn">
                        <RotateCcw className="ic" aria-hidden="true" />
                        Revision requested
                      </span>
                    </td>
                    <td>Funder asked for changes; the applicant edits and resubmits (diff recorded).</td>
                    <td>Applicant responds</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-info">
                        <Calendar className="ic" aria-hidden="true" />
                        Interview
                      </span>
                    </td>
                    <td>Invited to an interview stage; slot picker open to the applicant.</td>
                    <td>Funder schedules</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-prog">
                        <Star className="ic" aria-hidden="true" />
                        Recommended
                      </span>
                    </td>
                    <td>Panel recommends funding; allocation entered, decisions not yet committed.</td>
                    <td>Panel commits</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-ok">
                        <CircleCheck className="ic" aria-hidden="true" />
                        Accepted
                      </span>
                    </td>
                    <td>Decision committed; an award record exists.</td>
                    <td>Terminal (links to award)</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-dng">
                        <CircleX className="ic" aria-hidden="true" />
                        Declined
                      </span>
                    </td>
                    <td>Decision committed; decline letter queued or sent.</td>
                    <td>Terminal</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-neutral">
                        <Hourglass className="ic" aria-hidden="true" />
                        Waitlisted
                      </span>
                    </td>
                    <td>Held for funding if budget frees up before the cycle closes.</td>
                    <td>Panel re-decides</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-neutral">
                        <LogOut className="ic" aria-hidden="true" />
                        Withdrawn
                      </span>
                    </td>
                    <td>Applicant withdrew; record kept, reviews stop.</td>
                    <td>Applicant</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            <div className="card">
              <div className="card-h">
                <h3>Award</h3>
                <span className="muted small">6 states · mirrored to Passport</span>
              </div>
              <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                <table className="tbl voc">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Meaning</th>
                      <th>Who moves it</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <span className="bdg bdg-info">
                          <Mail className="ic" aria-hidden="true" />
                          Offered
                        </span>
                      </td>
                      <td>Letter sent; waiting for the grantee to accept.</td>
                      <td>Grantee accepts</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-prog">
                          <Check className="ic" aria-hidden="true" />
                          Accepted
                        </span>
                      </td>
                      <td>Grantee accepted; agreement in signature.</td>
                      <td>Agreement executed</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-ok">
                          <BadgeCheck className="ic" aria-hidden="true" />
                          Active
                        </span>
                      </td>
                      <td>Executed; tranches and requirements are live.</td>
                      <td>Closeout completes</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-warn">
                          <CirclePause className="ic" aria-hidden="true" />
                          Suspended
                        </span>
                      </td>
                      <td>Payments paused by the funder; banner states the reason.</td>
                      <td>Funder resumes</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-done">
                          <CircleCheck className="ic" aria-hidden="true" />
                          Completed
                        </span>
                      </td>
                      <td>Closeout checklist done: final report accepted, money settled or cancelled, budget reconciled.</td>
                      <td>Terminal</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-dng">
                          <Ban className="ic" aria-hidden="true" />
                          Cancelled
                        </span>
                      </td>
                      <td>Ended before completion; remaining tranches cancelled.</td>
                      <td>Terminal</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card">
              <div className="card-h">
                <h3>Agreement</h3>
                <span className="muted small">6 states · click-to-sign records name, time, IP, hash</span>
              </div>
              <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                <table className="tbl voc">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Meaning</th>
                      <th>Who moves it</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <span className="bdg bdg-neutral">
                          <Pencil className="ic" aria-hidden="true" />
                          Draft
                        </span>
                      </td>
                      <td>Generated from a template; editable by the funder.</td>
                      <td>Funder sends</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-info">
                          <Send className="ic" aria-hidden="true" />
                          Sent
                        </span>
                      </td>
                      <td>Waiting for the grantee's signature.</td>
                      <td>Grantee signs</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-prog">
                          <PenLine className="ic" aria-hidden="true" />
                          Signed by grantee
                        </span>
                      </td>
                      <td>Grantee signature recorded; funder countersignature pending.</td>
                      <td>Funder countersigns</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-prog">
                          <ClipboardCheck className="ic" aria-hidden="true" />
                          Countersigned
                        </span>
                      </td>
                      <td>Both signatures recorded; PDF being finalized.</td>
                      <td>System → Executed</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-ok">
                          <ShieldCheck className="ic" aria-hidden="true" />
                          Executed
                        </span>
                      </td>
                      <td>Binding; executed PDF available; award becomes Active.</td>
                      <td>Terminal</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-dng">
                          <Ban className="ic" aria-hidden="true" />
                          Voided
                        </span>
                      </td>
                      <td>Cancelled before execution; a new agreement may be generated.</td>
                      <td>Funder</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "24px" }}>
          <div className="card">
            <div className="card-h">
              <h3>Tranche (payment)</h3>
              <span className="muted small">10 states · readiness gates Ready → Releasing</span>
            </div>
            <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
              <table className="tbl voc">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Meaning</th>
                    <th>Who moves it</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span className="bdg bdg-neutral">
                        <Calendar className="ic" aria-hidden="true" />
                        Scheduled
                      </span>
                    </td>
                    <td>On the schedule; due date or condition in the future.</td>
                    <td>Time or condition</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-warn">
                        <Clock className="ic" aria-hidden="true" />
                        Due
                      </span>
                    </td>
                    <td>Condition met or date reached; readiness not yet all green.</td>
                    <td>Readiness checklist</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-ok">
                        <CircleCheck className="ic" aria-hidden="true" />
                        Ready
                      </span>
                    </td>
                    <td>Every readiness line passes; Release is enabled.</td>
                    <td>Finance releases</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-warn">
                        <Lock className="ic" aria-hidden="true" />
                        Held
                      </span>
                    </td>
                    <td>
                      Blocked by a hold: destination change, freeze window, level, agreement, or Passport outage. Banner says what clears
                      it.
                    </td>
                    <td>Clearing event</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-prog">
                        <Loader className="ic" aria-hidden="true" />
                        Releasing
                      </span>
                    </td>
                    <td>Release requested; Passport is creating the disbursement.</td>
                    <td>Passport</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-info">
                        <Send className="ic" aria-hidden="true" />
                        Initiated
                      </span>
                    </td>
                    <td>Sent on the rail (ACH / wire); Passport id recorded.</td>
                    <td>Bank network</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-ok">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        Settled
                      </span>
                    </td>
                    <td>Funds confirmed at the destination; grantee notified (bank name + last4).</td>
                    <td>Terminal</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-dng">
                        <CircleX className="ic" aria-hidden="true" />
                        Failed
                      </span>
                    </td>
                    <td>Rail rejected the transfer; reason shown; retry after fix.</td>
                    <td>Finance retries</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-dng">
                        <RotateCcw className="ic" aria-hidden="true" />
                        Returned
                      </span>
                    </td>
                    <td>Funds came back after settlement; destination needs attention.</td>
                    <td>Finance + grantee</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="bdg bdg-neutral">
                        <Ban className="ic" aria-hidden="true" />
                        Cancelled
                      </span>
                    </td>
                    <td>Removed from the schedule (amendment or award cancelled).</td>
                    <td>Terminal</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            <div className="card">
              <div className="card-h">
                <h3>Requirement (report)</h3>
                <span className="muted small">8 states · may release a tranche when Accepted</span>
              </div>
              <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                <table className="tbl voc">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Meaning</th>
                      <th>Who moves it</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <span className="bdg bdg-neutral">
                          <Calendar className="ic" aria-hidden="true" />
                          Scheduled
                        </span>
                      </td>
                      <td>Due date in the future; reminders planned.</td>
                      <td>Time</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-warn">
                          <Clock className="ic" aria-hidden="true" />
                          Due
                        </span>
                      </td>
                      <td>Within the reminder window; not yet submitted.</td>
                      <td>Grantee submits</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-dng">
                          <TriangleExclamationPoint className="ic" aria-hidden="true" />
                          Overdue
                        </span>
                      </td>
                      <td>Past due; linked tranche stays Held.</td>
                      <td>Grantee submits</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-info">
                          <Send className="ic" aria-hidden="true" />
                          Submitted
                        </span>
                      </td>
                      <td>In the funder's Received queue.</td>
                      <td>Funder reviews</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-prog">
                          <Eye className="ic" aria-hidden="true" />
                          Under review
                        </span>
                      </td>
                      <td>Opened by a program officer.</td>
                      <td>Accept or Return</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-ok">
                          <CircleCheck className="ic" aria-hidden="true" />
                          Accepted
                        </span>
                      </td>
                      <td>Done; any tranche it releases moves to Due.</td>
                      <td>Terminal</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-warn">
                          <RotateCcw className="ic" aria-hidden="true" />
                          Returned
                        </span>
                      </td>
                      <td>Sent back with comments; grantee edits and resubmits.</td>
                      <td>Grantee</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="bdg bdg-neutral">
                          <CircleMinus className="ic" aria-hidden="true" />
                          Waived
                        </span>
                      </td>
                      <td>Funder waived it; recorded in the audit ledger.</td>
                      <td>Terminal</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card">
              <div className="card-h">
                <h3>Identity, money and provenance marks</h3>
                <span className="muted small">Chips used beside names and fields</span>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px", fontSize: "13px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "180px minmax(0, 1fr)", gap: "8px 16px", alignItems: "center" }}>
                  <span className="muted b">Passport level</span>
                  <div className="row wrap">
                    <span className="lvl lvl-0">L0</span>
                    <span className="lvl lvl-1">L1</span>
                    <span className="lvl lvl-2">L2</span>
                    <span className="lvl lvl-3">
                      <Shield className="ic" aria-hidden="true" />
                      L3
                    </span>
                    <span className="lvl lvl-na">L? unavailable</span>
                    <span className="muted">L0 claimed · L1 identity verified · L2 documents verified · L3 payee verified</span>
                  </div>
                  <span className="muted b">Payee status</span>
                  <div className="row wrap">
                    <span className="pay pay-active">
                      <Check className="ic" aria-hidden="true" />
                      Payee active
                    </span>
                    <span className="pay pay-pending">
                      <Clock className="ic" aria-hidden="true" />
                      Pending change
                    </span>
                    <span className="pay pay-cooling">
                      <Clock className="ic" aria-hidden="true" />
                      Cooling off
                    </span>
                    <span className="pay pay-held">
                      <Lock className="ic" aria-hidden="true" />
                      Held
                    </span>
                    <span className="pay pay-none">
                      <CircleMinus className="ic" aria-hidden="true" />
                      No destination
                    </span>
                  </div>
                  <span className="muted b">Provenance</span>
                  <div className="row wrap">
                    <span className="prov prov-passport">
                      <BadgeCheck className="ic" aria-hidden="true" />
                      From Passport
                    </span>
                    <span className="prov prov-library">
                      <BookOpen className="ic" aria-hidden="true" />
                      From library
                    </span>
                    <span className="prov prov-report">
                      <File className="ic" aria-hidden="true" />
                      From prior report
                    </span>
                    <span className="prov prov-qb">
                      <Database className="ic" aria-hidden="true" />
                      From QuickBooks
                    </span>
                    <span className="prov prov-entered">
                      <Pencil className="ic" aria-hidden="true" />
                      Entered
                    </span>
                    <span className="prov prov-agent">
                      <Bot className="ic" aria-hidden="true" />
                      By agent · Riverbend Triage Agent
                    </span>
                  </div>
                  <span className="muted b">Eligibility</span>
                  <div className="row wrap">
                    <span className="row" style={{ gap: "5px", color: "#0B5E47", fontWeight: 700 }}>
                      <CircleCheck className="ic" aria-hidden="true" />
                      Pass
                    </span>
                    <span className="row" style={{ gap: "5px", color: "#9B1C1C", fontWeight: 700 }}>
                      <CircleX className="ic" aria-hidden="true" />
                      Fail
                    </span>
                    <span className="row" style={{ gap: "5px", color: "#4A5C5A", fontWeight: 700 }}>
                      <CircleDashed className="ic" aria-hidden="true" />
                      Unknown
                    </span>
                    <span className="muted">
                      Unknown means a rule could not be evaluated (missing field, Passport unreachable); it is never shown as pass.
                    </span>
                  </div>
                  <span className="muted b">Agent proposal</span>
                  <div className="row wrap">
                    <span className="bdg bdg-agent">
                      <Bot className="ic" aria-hidden="true" />
                      Proposed
                    </span>
                    <span className="attrib">
                      <Bot className="ic" aria-hidden="true" />
                      Proposed by<span className="ag">Riverbend Triage Agent (via Claude)</span>· 2 min ago · approved by Dana Ortiz
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
