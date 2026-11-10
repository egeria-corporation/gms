// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import {
  ArrowRight,
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
  Clock,
  Clock4,
  Database,
  Eye,
  File,
  GitCompare,
  Landmark,
  Lock,
  Mail,
  MessageSquare,
  PenLine,
  Pencil,
  RotateCcw,
  Send,
  Shield,
  ShieldCheck,
  TriangleExclamationPoint,
} from "lucide-react";

export default function ComponentsA() {
  return (
    <>
      <title>{"Component additions A"}</title>
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
          <h1 style={{ fontSize: "28px" }}>Component Additions A</h1>
          <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
            Eleven components added to the OpenGrants Design System for the GMS, each rendered once in every state. Tokens come from the
            system unchanged; the semantic status tones are the only new colors. The tenant accent never appears in any of these.
          </p>
        </div>
        <div className="card">
          <div className="card-h">
            <div>
              <h3>Status badge</h3>
              <p className="small muted">
                Every lifecycle state. Icon + label, 22 px tall, radius 8. Full list of 41 states with meanings on C1 Status vocabulary.
              </p>
            </div>
            <Link to="/styleguide/status" className="small b">
              Open C1 →
            </Link>
          </div>
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <div className="spec">
              <span className="cap">Tones</span>
              <div className="row wrap" style={{ gap: "10px" }}>
                <span className="bdg bdg-neutral">
                  <Circle className="ic" aria-hidden="true" />
                  Neutral
                </span>
                <span className="bdg bdg-info">
                  <Circle className="ic" aria-hidden="true" />
                  Info
                </span>
                <span className="bdg bdg-prog">
                  <Circle className="ic" aria-hidden="true" />
                  In progress
                </span>
                <span className="bdg bdg-ok">
                  <Circle className="ic" aria-hidden="true" />
                  Good
                </span>
                <span className="bdg bdg-warn">
                  <Circle className="ic" aria-hidden="true" />
                  Needs attention
                </span>
                <span className="bdg bdg-dng">
                  <Circle className="ic" aria-hidden="true" />
                  Stopped
                </span>
                <span className="bdg bdg-done">
                  <Circle className="ic" aria-hidden="true" />
                  Closed
                </span>
                <span className="bdg bdg-agent">
                  <Circle className="ic" aria-hidden="true" />
                  Agent
                </span>
                <span className="bdg bdg-lg bdg-ok">
                  <CircleCheck className="ic" aria-hidden="true" />
                  Large variant (page headers)
                </span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "16px" }}>
              <div className="spec">
                <span className="cap">Application</span>
                <span className="bdg bdg-neutral">
                  <Pencil className="ic" aria-hidden="true" />
                  Draft
                </span>
                <span className="bdg bdg-prog">
                  <Eye className="ic" aria-hidden="true" />
                  Under review
                </span>
                <span className="bdg bdg-warn">
                  <RotateCcw className="ic" aria-hidden="true" />
                  Revision requested
                </span>
                <span className="bdg bdg-dng">
                  <CircleX className="ic" aria-hidden="true" />
                  Declined
                </span>
              </div>
              <div className="spec">
                <span className="cap">Award</span>
                <span className="bdg bdg-info">
                  <Mail className="ic" aria-hidden="true" />
                  Offered
                </span>
                <span className="bdg bdg-ok">
                  <BadgeCheck className="ic" aria-hidden="true" />
                  Active
                </span>
                <span className="bdg bdg-warn">
                  <CirclePause className="ic" aria-hidden="true" />
                  Suspended
                </span>
                <span className="bdg bdg-done">
                  <CircleCheck className="ic" aria-hidden="true" />
                  Completed
                </span>
              </div>
              <div className="spec">
                <span className="cap">Tranche</span>
                <span className="bdg bdg-warn">
                  <Clock className="ic" aria-hidden="true" />
                  Due
                </span>
                <span className="bdg bdg-ok">
                  <CircleCheck className="ic" aria-hidden="true" />
                  Ready
                </span>
                <span className="bdg bdg-warn">
                  <Lock className="ic" aria-hidden="true" />
                  Held
                </span>
                <span className="bdg bdg-ok">
                  <BadgeCheck className="ic" aria-hidden="true" />
                  Settled
                </span>
              </div>
              <div className="spec">
                <span className="cap">Requirement</span>
                <span className="bdg bdg-neutral">
                  <Calendar className="ic" aria-hidden="true" />
                  Scheduled
                </span>
                <span className="bdg bdg-dng">
                  <TriangleExclamationPoint className="ic" aria-hidden="true" />
                  Overdue
                </span>
                <span className="bdg bdg-info">
                  <Send className="ic" aria-hidden="true" />
                  Submitted
                </span>
                <span className="bdg bdg-neutral">
                  <CircleMinus className="ic" aria-hidden="true" />
                  Waived
                </span>
              </div>
              <div className="spec">
                <span className="cap">Agreement</span>
                <span className="bdg bdg-info">
                  <Send className="ic" aria-hidden="true" />
                  Sent
                </span>
                <span className="bdg bdg-prog">
                  <PenLine className="ic" aria-hidden="true" />
                  Signed by grantee
                </span>
                <span className="bdg bdg-ok">
                  <ShieldCheck className="ic" aria-hidden="true" />
                  Executed
                </span>
                <span className="bdg bdg-dng">
                  <Ban className="ic" aria-hidden="true" />
                  Voided
                </span>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "24px" }}>
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Passport level badge</h3>
                <p className="small muted">
                  L0–L3 beside every organization name. Tooltip explains what the level proves and links to the attestation.
                </p>
              </div>
            </div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "12px" }}>
                <div className="spec">
                  <span className="cap">L0 · muted</span>
                  <span className="lvl lvl-0" style={{ alignSelf: "flex-start" }}>
                    L0
                  </span>
                  <span className="xs muted">Claimed, nothing verified</span>
                </div>
                <div className="spec">
                  <span className="cap">L1 · outline</span>
                  <span className="lvl lvl-1" style={{ alignSelf: "flex-start" }}>
                    L1
                  </span>
                  <span className="xs muted">Identity verified</span>
                </div>
                <div className="spec">
                  <span className="cap">L2 · filled</span>
                  <span className="lvl lvl-2" style={{ alignSelf: "flex-start" }}>
                    L2
                  </span>
                  <span className="xs muted">Documents verified</span>
                </div>
                <div className="spec">
                  <span className="cap">L3 · filled + shield</span>
                  <span className="lvl lvl-3" style={{ alignSelf: "flex-start" }}>
                    <Shield className="ic" aria-hidden="true" />
                    L3
                  </span>
                  <span className="xs muted">Payee verified</span>
                </div>
                <div className="spec">
                  <span className="cap">Unavailable</span>
                  <span className="lvl lvl-na" style={{ alignSelf: "flex-start" }}>
                    L? unavailable
                  </span>
                  <span className="xs muted">Passport unreachable</span>
                </div>
              </div>
              <div className="row" style={{ alignItems: "flex-start", gap: "16px" }}>
                <div className="spec">
                  <span className="cap">Tooltip on hover / focus</span>
                  <div className="tip" role="tooltip">
                    <div className="b" style={{ marginBottom: "4px" }}>
                      Level 3 · Payee verified
                    </div>
                    <div>
                      Alder Creek Family Services has verified its identity, its governing documents, and a payment destination in
                      OpenGrants Passport. Attested Mar 4, 2027.
                    </div>
                    <div style={{ marginTop: "8px" }}>
                      <Link to="/w/alder-creek/organization">View attestation →</Link>
                    </div>
                  </div>
                </div>
                <div className="spec" style={{ flex: 1 }}>
                  <span className="cap">In context</span>
                  <div className="row" style={{ gap: "8px", padding: "10px 12px", border: "1px solid #D6DEDE", borderRadius: "8px" }}>
                    <span className="b">Copper Valley Clinic</span>
                    <span className="lvl lvl-1">L1</span>
                    <span className="pill-warn">
                      <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                      Level dropped from L2
                    </span>
                  </div>
                  <span className="xs muted">A downgrade keeps the badge honest and adds the warning pill until the org re-verifies.</span>
                </div>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Payee status chip</h3>
                <p className="small muted">
                  Destination state from the PayeeCredential. Shows bank name + last4 at most; never other bank data.
                </p>
              </div>
            </div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "12px" }}>
                <div className="spec">
                  <span className="cap">Active</span>
                  <span className="pay pay-active" style={{ alignSelf: "flex-start" }}>
                    <Check className="ic" aria-hidden="true" />
                    Payee active
                  </span>
                  <span className="xs muted">Can be paid</span>
                </div>
                <div className="spec">
                  <span className="cap">Pending change</span>
                  <span className="pay pay-pending" style={{ alignSelf: "flex-start" }}>
                    <Clock className="ic" aria-hidden="true" />
                    Pending change
                  </span>
                  <span className="xs muted">New destination awaiting verification</span>
                </div>
                <div className="spec">
                  <span className="cap">Cooling off</span>
                  <span className="pay pay-cooling" style={{ alignSelf: "flex-start" }}>
                    <Clock className="ic" aria-hidden="true" />
                    Cooling off
                  </span>
                  <span className="xs muted">Verified; freeze window running</span>
                </div>
                <div className="spec">
                  <span className="cap">Held</span>
                  <span className="pay pay-held" style={{ alignSelf: "flex-start" }}>
                    <Lock className="ic" aria-hidden="true" />
                    Held
                  </span>
                  <span className="xs muted">Return or dispute on file</span>
                </div>
                <div className="spec">
                  <span className="cap">No destination</span>
                  <span className="pay pay-none" style={{ alignSelf: "flex-start" }}>
                    <CircleMinus className="ic" aria-hidden="true" />
                    No destination
                  </span>
                  <span className="xs muted">Below L3</span>
                </div>
              </div>
              <div className="spec">
                <span className="cap">Expanded (destination card)</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
                  <div className="row" style={{ gap: "12px", padding: "10px 12px", border: "1px solid #D6DEDE", borderRadius: "8px" }}>
                    <Landmark className="ic ic-md" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                    <div className="grow">
                      <div className="b" style={{ fontSize: "13px" }}>
                        River City Credit Union •••• 4821
                      </div>
                      <div className="xs muted">Alder Creek Family Services · ACH · verified Mar 4, 2027</div>
                    </div>
                    <span className="pay pay-active">
                      <Check className="ic" aria-hidden="true" />
                      Payee active
                    </span>
                  </div>
                  <div className="row" style={{ gap: "12px", padding: "10px 12px", border: "1px solid #D6DEDE", borderRadius: "8px" }}>
                    <Landmark className="ic ic-md" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                    <div className="grow">
                      <div className="b" style={{ fontSize: "13px" }}>
                        Harbor Bank •••• 0937 → new destination pending
                      </div>
                      <div className="xs muted">Harbor Light Shelter · change requested May 20 · freeze until Jun 3, 2027</div>
                    </div>
                    <span className="pay pay-pending">
                      <Clock className="ic" aria-hidden="true" />
                      Pending change
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <div>
              <h3>Provenance chip</h3>
              <p className="small muted">
                Marks where a field value came from. Hover shows the source and timestamp; Passport fields add an “Edit in Passport” link.
              </p>
            </div>
          </div>
          <div className="card-b" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "24px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "14px" }}>
              <div className="spec">
                <span className="cap">From Passport</span>
                <span className="prov prov-passport" style={{ alignSelf: "flex-start" }}>
                  <BadgeCheck className="ic" aria-hidden="true" />
                  From Passport
                </span>
                <span className="xs muted">Read-only in forms</span>
              </div>
              <div className="spec">
                <span className="cap">From library</span>
                <span className="prov prov-library" style={{ alignSelf: "flex-start" }}>
                  <BookOpen className="ic" aria-hidden="true" />
                  From library · “Need”
                </span>
                <span className="xs muted">Names the answer key</span>
              </div>
              <div className="spec">
                <span className="cap">From prior report</span>
                <span className="prov prov-report" style={{ alignSelf: "flex-start" }}>
                  <File className="ic" aria-hidden="true" />
                  From prior report
                </span>
                <span className="xs muted">Interim → final</span>
              </div>
              <div className="spec">
                <span className="cap">From QuickBooks</span>
                <span className="prov prov-qb" style={{ alignSelf: "flex-start" }}>
                  <Database className="ic" aria-hidden="true" />
                  From QuickBooks
                </span>
                <span className="xs muted">Actuals, synced</span>
              </div>
              <div className="spec">
                <span className="cap">Entered</span>
                <span className="prov prov-entered" style={{ alignSelf: "flex-start" }}>
                  <Pencil className="ic" aria-hidden="true" />
                  Entered
                </span>
                <span className="xs muted">Typed by a person</span>
              </div>
              <div className="spec">
                <span className="cap">By agent</span>
                <span className="prov prov-agent" style={{ alignSelf: "flex-start" }}>
                  <Bot className="ic" aria-hidden="true" />
                  By agent · Riverbend Triage Agent
                </span>
                <span className="xs muted">Names the agent</span>
              </div>
            </div>
            <div className="spec">
              <span className="cap">Hover card</span>
              <div className="fld" style={{ maxWidth: "360px" }}>
                <label className="lbl" htmlFor="pv-legal">
                  Legal name
                  <span className="prov prov-passport">
                    <BadgeCheck className="ic" aria-hidden="true" />
                    From Passport
                  </span>
                </label>
                <input className="inp" id="pv-legal" defaultValue="Alder Creek Family Services" readOnly />
              </div>
              <div className="tip" role="tooltip" style={{ maxWidth: "360px" }}>
                <div className="b" style={{ marginBottom: "4px" }}>
                  Source: OpenGrants Passport · org.legalName
                </div>
                <div>Imported Apr 16, 2027 at 9:12 AM PT from the record consented to Riverbend on Jan 20, 2027 (scope org:read).</div>
                <div style={{ marginTop: "8px" }}>
                  <Link to="/w/alder-creek/organization">Edit in Passport →</Link>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "24px" }}>
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Readiness checklist</h3>
                <p className="small muted">
                  Pre-flight for money and launch. Each line: state icon, label, reason, fix link. Primary actions stay disabled while any
                  line fails.
                </p>
              </div>
            </div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="row wrap" style={{ gap: "8px" }}>
                <span className="cap">Used by</span>
                <Link to="/w/riverbend/payments/due" className="chip">
                  Payments · Release tranche
                </Link>
                <Link to="/w/riverbend/competitions/community-health-2027" className="chip">
                  Competition · Launch
                </Link>
                <Link to="/w/alder-creek/applications/app_01HZX4/edit/submit" className="chip">
                  Application · Submit
                </Link>
              </div>
              <div className="rc" style={{ border: "1px solid #D6DEDE", borderRadius: "8px", padding: "4px 16px" }}>
                <div className="rc-sum">
                  <CircleX className="ic ic-md" aria-hidden="true" style={{ color: "#9B1C1C" }} />
                  <span>Release tranche 2 · Harbor Light Shelter</span>
                  <span className="muted" style={{ marginLeft: "auto", fontWeight: 400, fontSize: "12px" }}>
                    3 pass · 1 fail · 1 unknown
                  </span>
                </div>
                <div className="rc-row rc-pass">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Agreement executed</div>
                    <div className="r">Executed Jul 8, 2026 · both signatures recorded</div>
                  </div>
                  <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="fix">
                    View
                  </Link>
                </div>
                <div className="rc-row rc-pass">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Passport level L3</div>
                    <div className="r">Attested Mar 4, 2027</div>
                  </div>
                  <Link to="/w/riverbend/grantees/org_alder-creek" className="fix">
                    View
                  </Link>
                </div>
                <div className="rc-row rc-pass">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Interim report accepted</div>
                    <div className="r">Accepted May 18, 2027 by Dana Ortiz</div>
                  </div>
                  <Link to="/w/riverbend/reporting" className="fix">
                    View
                  </Link>
                </div>
                <div className="rc-row rc-fail">
                  <CircleX className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Destination change pending</div>
                    <div className="r">New destination requested May 20 · freeze until Jun 3, 2027</div>
                  </div>
                  <Link to="/w/riverbend/payments/in-flight" className="fix">
                    See alert →
                  </Link>
                </div>
                <div className="rc-row rc-unk">
                  <CircleDashed className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Source account balance</div>
                    <div className="r">Passport funder console unreachable · retrying</div>
                  </div>
                  <Link to="/w/riverbend/payments/due" className="fix">
                    Retry
                  </Link>
                </div>
              </div>
              <div className="row" style={{ gap: "10px" }}>
                <button className="btn btn-primary" disabled>
                  Release $38,000
                </button>
                <span className="small muted">Disabled: 1 line fails, 1 unknown. Unknown is never treated as pass.</span>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Hold / freeze banner</h3>
                <p className="small muted">Anything blocking money. Always says what is blocked, why, and what clears it.</p>
              </div>
            </div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="bnr bnr-warn">
                <Clock className="ic" aria-hidden="true" />
                <div className="grow">
                  <div className="t">Pending destination change</div>
                  <div className="d">Harbor Light Shelter requested a new payment destination on May 20. Tranche 2 ($38,000) is held.</div>
                  <div className="clears">
                    <ArrowRight className="ic ic-sm" aria-hidden="true" />
                    Clears when Passport verifies the new destination
                  </div>
                </div>
                <Link to="/w/riverbend/payments/in-flight" className="btn btn-sm btn-secondary act">
                  Open alert
                </Link>
              </div>
              <div className="bnr bnr-warn">
                <Lock className="ic" aria-hidden="true" />
                <div className="grow">
                  <div className="t">Freeze window until Jun 3, 2027</div>
                  <div className="d">
                    A verified destination change is cooling off. No disbursement can be released to this payee during the window.
                  </div>
                  <div className="clears">
                    <ArrowRight className="ic ic-sm" aria-hidden="true" />
                    Clears automatically on Jun 3, 2027
                  </div>
                </div>
              </div>
              <div className="bnr bnr-warn">
                <Shield className="ic" aria-hidden="true" />
                <div className="grow">
                  <div className="t">Passport level below L3</div>
                  <div className="d">Copper Valley Clinic is at L1. Payments require a verified payee (L3).</div>
                  <div className="clears">
                    <ArrowRight className="ic ic-sm" aria-hidden="true" />
                    Clears when the organization verifies documents and a payee in Passport
                  </div>
                </div>
                <Link to="/w/riverbend/grantees/org_alder-creek" className="btn btn-sm btn-secondary act">
                  Message grantee
                </Link>
              </div>
              <div className="bnr bnr-warn">
                <PenLine className="ic" aria-hidden="true" />
                <div className="grow">
                  <div className="t">Agreement not executed</div>
                  <div className="d">Signed by grantee May 21; Riverbend’s countersignature is missing. Tranche 1 cannot be released.</div>
                  <div className="clears">
                    <ArrowRight className="ic ic-sm" aria-hidden="true" />
                    Clears when an authorized signer countersigns
                  </div>
                </div>
                <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="btn btn-sm btn-primary act">
                  Countersign
                </Link>
              </div>
              <div className="bnr bnr-neu">
                <CircleDashed className="ic" aria-hidden="true" />
                <div className="grow">
                  <div className="t">Passport unavailable</div>
                  <div className="d">Payee status cannot be confirmed right now. Releases are paused; nothing has been lost.</div>
                  <div className="clears">
                    <ArrowRight className="ic ic-sm" aria-hidden="true" />
                    Clears when Passport responds · last check 2 min ago
                  </div>
                </div>
                <button className="btn btn-sm btn-secondary act">Retry</button>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr)", gap: "24px" }}>
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Section rail</h3>
                <p className="small muted">Form navigation with completion and assignee. Becomes a top stepper at phone width.</p>
              </div>
            </div>
            <div className="card-b">
              <nav className="sec" aria-label="Sections (example)">
                <Link to="/w/alder-creek/applications/app_01HZX4/edit" className="s-todo">
                  <Circle className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Outcomes & evaluation</div>
                    <div className="st">Not started</div>
                  </div>
                  <span className="meta">
                    <span className="muted xs">Unassigned</span>
                  </span>
                </Link>
                <Link to="/w/alder-creek/applications/app_01HZX4/edit" className="s-prog on" aria-current="true">
                  <Clock4 className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Need statement</div>
                    <div className="st">In progress · 412 / 500 words</div>
                  </div>
                  <span className="meta">
                    <MessageSquare className="ic ic-sm" aria-hidden="true" />2<span className="av av-sm">JR</span>
                  </span>
                </Link>
                <Link to="/w/alder-creek/applications/app_01HZX4/edit" className="s-done">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Organization</div>
                    <div className="st">Complete · from Passport</div>
                  </div>
                  <span className="meta">
                    <span className="av av-sm av-t">MS</span>
                  </span>
                </Link>
                <Link to="/w/alder-creek/applications/app_01HZX4/edit" className="s-lock">
                  <Lock className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">LOI responses</div>
                    <div className="st">Locked · prior stage</div>
                  </div>
                  <span className="meta"></span>
                </Link>
              </nav>
              <div className="row wrap" style={{ gap: "12px", marginTop: "12px", fontSize: "11px", color: "#4A5C5A" }}>
                <span className="cap">States</span>
                <span>Not started</span>
                <span>In progress (selected)</span>
                <span>Complete</span>
                <span>Locked</span>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Presence avatars</h3>
                <p className="small muted">Who is editing now. Stack of 1–5, overflow count, live ring in the editor’s cursor color.</p>
              </div>
            </div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="spec">
                <span className="cap">One editor</span>
                <div className="pres" aria-label="Editing now: Maria Santos">
                  <span className="av av-t live" title="Maria Santos (you)">
                    MS
                  </span>
                </div>
              </div>
              <div className="spec">
                <span className="cap">Three editors, two live cursors</span>
                <div className="pres" aria-label="Editing now: Maria Santos, Jamal Reed, Lena Fischer">
                  <span className="av av-t live" title="Maria Santos (you)">
                    MS
                  </span>
                  <span className="av live-b" title="Jamal Reed">
                    JR
                  </span>
                  <span className="av av-g" title="Lena Fischer (consultant)">
                    LF
                  </span>
                </div>
              </div>
              <div className="spec">
                <span className="cap">Five shown, overflow</span>
                <div className="pres" aria-label="Editing now: 7 people">
                  <span className="av av-t live" title="Maria Santos">
                    MS
                  </span>
                  <span className="av live-b" title="Jamal Reed">
                    JR
                  </span>
                  <span className="av av-g" title="Lena Fischer">
                    LF
                  </span>
                  <span className="av av-n" title="Dana Ortiz">
                    DO
                  </span>
                  <span className="av" title="Priya Natarajan">
                    PN
                  </span>
                  <span className="av more">+2</span>
                </div>
              </div>
              <div className="spec">
                <span className="cap">Live cursor label (in a field)</span>
                <div style={{ position: "relative", height: "44px", border: "1px solid #4A86E8", borderRadius: "6px", background: "#fff" }}>
                  <span
                    style={{
                      position: "absolute",
                      top: "-10px",
                      left: "12px",
                      background: "#4A86E8",
                      color: "#fff",
                      fontSize: "10px",
                      fontWeight: 800,
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    Jamal Reed
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Inline comment</h3>
                <p className="small muted">
                  Field-level discussion. Unresolved vs resolved; shared (visible to both sides) vs internal (one side only).
                </p>
              </div>
            </div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="cmt">
                <div className="hd">
                  <span className="av av-sm">JR</span>
                  <span className="who">Jamal Reed</span>
                  <span>· 1 hour ago</span>
                  <span className="fld-ref">on “Need statement”</span>
                  <span className="shared-mark">Team</span>
                </div>
                <div className="bd">Can we cite the county assessment by name and year?</div>
                <div className="row small">
                  <Link to="/w/alder-creek/applications/app_01HZX4/edit">Reply</Link>
                  <Link to="/w/alder-creek/applications/app_01HZX4/edit">Resolve</Link>
                </div>
              </div>
              <div className="cmt">
                <div className="hd">
                  <span className="av av-sm av-n">DO</span>
                  <span className="who">Dana Ortiz</span>
                  <span>· Apr 2</span>
                  <span className="fld-ref">on “Budget › Indirect”</span>
                  <span className="shared-mark" style={{ background: "#D2E1F9", color: "#1E4F8F" }}>
                    Shared with applicant
                  </span>
                </div>
                <div className="bd">Indirect is capped at 10% for this opportunity. Please revise before resubmitting.</div>
                <div className="row small">
                  <Link to="/w/riverbend/applications/app_01HZX4">Reply</Link>
                </div>
              </div>
              <div className="cmt msg-int" style={{ background: "#EEF3F3", borderStyle: "dashed" }}>
                <div className="hd">
                  <span className="av av-sm av-t">PN</span>
                  <span className="who">Priya Natarajan</span>
                  <span>· Apr 3</span>
                  <span className="fld-ref">on “Approach”</span>
                  <span className="int-mark">
                    <Lock className="ic" aria-hidden="true" />
                    Internal
                  </span>
                </div>
                <div className="bd">Strong fit with the rural access priority. Flagging for panel discussion.</div>
              </div>
              <div className="cmt cmt-res">
                <div className="hd">
                  <span className="av av-sm av-t">MS</span>
                  <span className="who">Maria Santos</span>
                  <span>· Mar 28</span>
                  <span className="fld-ref">on “Project summary”</span>
                  <span className="bdg bdg-ok" style={{ height: "18px", fontSize: "10px" }}>
                    <Check className="ic" aria-hidden="true" />
                    Resolved
                  </span>
                </div>
                <div className="bd">Shortened to 150 words per the limit.</div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)", gap: "24px" }}>
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Revision diff</h3>
                <p className="small muted">
                  Funder asked for changes; the applicant responded. Side-by-side at desktop, inline at phone width, with a “what changed”
                  summary.
                </p>
              </div>
            </div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="spec">
                <span className="cap">Side-by-side</span>
                <div className="diff">
                  <div className="hd">
                    <span>Budget › Indirect costs</span>
                    <span>v1 · Apr 2 → v2 · Apr 9</span>
                  </div>
                  <div className="cols">
                    <div>
                      Indirect costs are requested at <span className="del">$18,000 (12%)</span> to cover administrative overhead for the
                      navigator program.
                    </div>
                    <div>
                      Indirect costs are requested at <span className="ins">$15,000 (10%)</span> to cover administrative overhead for the
                      navigator program<span className="ins">, within the opportunity’s cap</span>.
                    </div>
                  </div>
                  <div className="sum">
                    <GitCompare className="ic" aria-hidden="true" />
                    What changed: 2 fields · Indirect amount $18,000 → $15,000 · Budget total $153,000 → $150,000 · +6 words
                  </div>
                </div>
              </div>
              <div className="spec">
                <span className="cap">Inline (phone)</span>
                <div className="diff" style={{ maxWidth: "360px" }}>
                  <div className="hd">
                    <span>Budget › Indirect costs</span>
                    <span>v1 → v2</span>
                  </div>
                  <div style={{ padding: "10px 12px", fontSize: "13px", lineHeight: 1.6 }}>
                    Indirect costs are requested at <span className="del">$18,000 (12%)</span> <span className="ins">$15,000 (10%)</span> to
                    cover administrative overhead<span className="ins">, within the opportunity’s cap</span>.
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Budget table</h3>
                <p className="small muted">
                  Proposed / approved / actual by category, totals, variance column, over-limit state. Actuals can carry a QuickBooks source
                  chip.
                </p>
              </div>
            </div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="tbl-wrap">
                <table className="tbl bud">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th className="num">Proposed</th>
                      <th className="num">Approved</th>
                      <th className="num">
                        Actual{" "}
                        <span className="prov prov-qb" style={{ marginLeft: "4px" }}>
                          <Database className="ic" aria-hidden="true" />
                          QuickBooks
                        </span>
                      </th>
                      <th className="num">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Personnel</td>
                      <td className="num">$96,000</td>
                      <td className="num">$96,000</td>
                      <td className="num">$47,210</td>
                      <td className="num var-pos">−$48,790</td>
                    </tr>
                    <tr>
                      <td>Travel & vehicle</td>
                      <td className="num">$28,000</td>
                      <td className="num">$28,000</td>
                      <td className="num over">$31,400</td>
                      <td className="num var-neg">+$3,400 · over</td>
                    </tr>
                    <tr>
                      <td>Supplies</td>
                      <td className="num">$11,000</td>
                      <td className="num">$11,000</td>
                      <td className="num">$6,120</td>
                      <td className="num var-pos">−$4,880</td>
                    </tr>
                    <tr>
                      <td>Indirect (10% cap)</td>
                      <td className="num">$15,000</td>
                      <td className="num">$15,000</td>
                      <td className="num">$8,473</td>
                      <td className="num var-pos">−$6,527</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num">$150,000</td>
                      <td className="num">$150,000</td>
                      <td className="num">$93,203</td>
                      <td className="num var-pos">−$56,797</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="row wrap" style={{ gap: "14px", fontSize: "12px", color: "#4A5C5A" }}>
                <span className="row" style={{ gap: "5px" }}>
                  <span className="over">Red + bold</span>= over the approved line
                </span>
                <span className="row" style={{ gap: "5px" }}>
                  <span className="var-pos b">Green</span>= under
                </span>
                <span>
                  Negative variance is spend remaining; positive is overspend. Reallocation requests (≥10% of a line) go through Amendments.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
