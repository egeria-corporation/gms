// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { Bot, Calendar, CircleCheck, CircleX, Download, Eye, GitCompare, Hourglass, Send } from "lucide-react";
import { ApplicantShell } from "../../components/shells.tsx";

export default function ApplicationStatus() {
  return (
    <>
      <title>{"Application status — Mobile Health Navigation for Rural Families"}</title>
      <ApplicantShell active="Applications">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/alder-creek">Dashboard</Link>
            <span>›</span>
            <Link to="/w/alder-creek/applications/app_01HZX4">Applications</Link>
            <span>›</span>
            <span>Mobile Health Navigation for Rural Families</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <span className="chip">
                  <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
                </span>
                <h1>Mobile Health Navigation for Rural Families</h1>
                <span className="bdg bdg-prog bdg-lg">
                  <Eye className="ic" aria-hidden="true" />
                  Under review
                </span>
              </div>
              <div className="meta">
                <span>Community Health Grants 2027 · Full proposal</span>
                <span>·</span>
                <span>Requested $150,000</span>
                <span>·</span>
                <span>Submitted Apr 16, 2027</span>
                <span>·</span>
                <span className="mono">app_01HZX4</span>
              </div>
            </div>
            <div className="actions">
              <Link to="/preview/pdf/application-snapshot" className="btn btn-secondary">
                <Download className="ic" aria-hidden="true" />
                Snapshot PDF
              </Link>
              <button className="btn btn-danger">Withdraw application</button>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <h2 style={{ fontSize: "18px" }}>Timeline</h2>
              <span className="small muted">Every step is attributed: a person, an agent, Passport or the system.</span>
            </div>
            <div className="card-b" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "16px" }}>
              <div className="tl-i tl-person" style={{ paddingBottom: "0" }}>
                <span className="dot">
                  <Send className="ic" aria-hidden="true" />
                </span>
                <div>
                  <div className="what">Submitted · Apr 16</div>
                  <div className="who">Maria Santos · Passport L3 attestation attached</div>
                </div>
              </div>
              <div className="tl-i tl-agent" style={{ paddingBottom: "0" }}>
                <span className="dot">
                  <Bot className="ic" aria-hidden="true" />
                </span>
                <div>
                  <div className="what">Screening passed · Apr 18</div>
                  <div className="who">
                    <span className="attrib">
                      <span className="ag">Riverbend Triage Agent (via Claude)</span>· approved by Dana Ortiz
                    </span>
                  </div>
                </div>
              </div>
              <div className="tl-i" style={{ paddingBottom: "0" }}>
                <span className="dot">
                  <Eye className="ic" aria-hidden="true" />
                </span>
                <div>
                  <div className="what">Under review · since Apr 20</div>
                  <div className="who">System · 3 reviewers assigned</div>
                </div>
              </div>
              <div className="tl-i" style={{ paddingBottom: "0", opacity: ".7" }}>
                <span className="dot">
                  <Calendar className="ic" aria-hidden="true" />
                </span>
                <div>
                  <div className="what">Decision · expected Jun 15</div>
                  <div className="who">Riverbend panel · letter will appear here</div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <section className="card">
              <div className="card-h">
                <div className="row" style={{ gap: "8px" }}>
                  <h2 style={{ fontSize: "18px" }}>Messages</h2>
                  <span className="shared-mark">Shared with Riverbend</span>
                </div>
                <span className="small muted">Both sides see this thread</span>
              </div>
              <div className="card-b th">
                <div className="msg">
                  <span className="av av-n" title="Dana Ortiz">
                    DO
                  </span>
                  <div className="bub">
                    <div className="hd">
                      <span className="who">Dana Ortiz</span>
                      <span>· Riverbend Community Foundation</span>
                      <span>· Apr 18</span>
                    </div>
                    <div className="bd">
                      Thanks, Maria — your application passed screening and is with reviewers. If anything in the budget narrative changes
                      before Apr 30, reply here rather than resubmitting.
                    </div>
                  </div>
                </div>
                <div className="msg">
                  <span className="av av-t" title="Maria Santos">
                    MS
                  </span>
                  <div className="bub">
                    <div className="hd">
                      <span className="who">Maria Santos</span>
                      <span>· Alder Creek Family Services</span>
                      <span>· Apr 19</span>
                    </div>
                    <div className="bd">
                      Understood. The county assessment citation has been added to the need statement as requested in the revision.
                    </div>
                  </div>
                </div>
                <div className="msg">
                  <span className="av av-n" title="Dana Ortiz">
                    DO
                  </span>
                  <div className="bub">
                    <div className="hd">
                      <span className="who">Dana Ortiz</span>
                      <span>· Riverbend Community Foundation</span>
                      <span>· Apr 20</span>
                    </div>
                    <div className="bd">
                      Received. Interview invitations go out the first week of May; you can hold a slot now from this page.
                    </div>
                  </div>
                </div>
                <div className="composer">
                  <label className="sr" htmlFor="reply">
                    Reply
                  </label>
                  <textarea className="ta" id="reply" style={{ minHeight: "56px", flex: 1 }} placeholder="Reply to Riverbend…" />
                  <button className="btn btn-primary" style={{ height: "44px" }}>
                    <Send className="ic" aria-hidden="true" />
                    Send
                  </button>
                </div>
                <p className="small muted">Internal notes the funder writes are never shown here.</p>
              </div>
            </section>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <section className="card">
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Revision requests</h2>
                  <span className="bdg bdg-ok">
                    <CircleCheck className="ic" aria-hidden="true" />1 resolved
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div>
                    <div className="b">Add source for county assessment</div>
                    <div className="small muted">Requested by Dana Ortiz · Apr 17 · responded Apr 19</div>
                  </div>
                  <div className="diff">
                    <div className="hd">
                      <span>Need statement · sentence 7</span>
                      <span>Inline diff</span>
                    </div>
                    <div style={{ padding: "10px 12px", fontSize: "14px", lineHeight: 1.6 }}>
                      The <span className="del">2026 county health assessment</span>
                      <span className="ins">Riverbend County Community Health Assessment (2026, p. 14)</span> ranks transportation access as
                      the top barrier to care for rural families.
                    </div>
                    <div className="sum">
                      <GitCompare className="ic" aria-hidden="true" />1 field changed · +6 words · attachments unchanged
                    </div>
                  </div>
                  <button className="btn btn-secondary" disabled>
                    Respond
                  </button>
                </div>
              </section>
              <section className="card">
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Interview scheduling</h2>
                  <span className="bdg bdg-info">
                    <Calendar className="ic" aria-hidden="true" />
                    Pick a slot
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <p className="small muted">30-minute video interview with the Riverbend panel. Pacific time.</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
                    <label className="radio card" style={{ padding: "10px 12px", cursor: "pointer" }}>
                      <span className="r"></span>
                      <span>Tue May 4 · 10:00 AM</span>
                    </label>
                    <label
                      className="radio card"
                      style={{ padding: "10px 12px", cursor: "pointer", borderColor: "#29A79F", background: "#E1F8F6" }}
                    >
                      <span className="r on"></span>
                      <span className="b">Wed May 5 · 2:30 PM</span>
                    </label>
                    <label className="radio card" style={{ padding: "10px 12px", cursor: "pointer" }}>
                      <span className="r"></span>
                      <span>Thu May 6 · 9:00 AM</span>
                    </label>
                    <label className="radio card" style={{ padding: "10px 12px", cursor: "pointer" }}>
                      <span className="r"></span>
                      <span>Mon May 10 · 1:00 PM</span>
                    </label>
                  </div>
                  <button className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
                    Confirm Wed May 5, 2:30 PM
                  </button>
                </div>
              </section>
              <section className="card" style={{ background: "#F7FAFA" }}>
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Decision</h2>
                </div>
                <div className="card-b">
                  <p className="muted">
                    No decision yet. Riverbend expects to decide by Jun 15, 2027; the letter will appear here and by email.
                  </p>
                </div>
              </section>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "20px", marginTop: "8px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · declined</span>
              <div className="card">
                <div className="card-h">
                  <h3>Decision</h3>
                  <span className="bdg bdg-dng">
                    <CircleX className="ic" aria-hidden="true" />
                    Declined
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <p style={{ fontSize: "15px" }}>
                    Riverbend decided on Jun 12, 2027. The letter explains the decision and how feedback can be requested.
                  </p>
                  <Link to="/preview/email/decline" className="doc" style={{ textDecoration: "none", color: "inherit" }}>
                    <span className="ft ft-pdf">PDF</span>
                    <div className="grow">
                      <div className="nm">Decision letter</div>
                      <div className="mt">Standard decline v3 · Jun 12</div>
                    </div>
                  </Link>
                  <Link to="/w/alder-creek/find" className="small b">
                    Find other funding
                  </Link>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · waitlisted</span>
              <div className="card">
                <div className="card-h">
                  <h3>Decision</h3>
                  <span className="bdg bdg-neutral">
                    <Hourglass className="ic" aria-hidden="true" />
                    Waitlisted
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <p style={{ fontSize: "15px" }}>
                    Your application is held for funding if budget frees up before the cycle closes on Sep 30, 2027. No action is needed.
                  </p>
                  <div className="small muted">Letter sent Jun 12 · you will be told either way</div>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · accepted</span>
              <div className="card">
                <div className="card-h">
                  <h3>Decision</h3>
                  <span className="bdg bdg-ok">
                    <CircleCheck className="ic" aria-hidden="true" />
                    Accepted
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <p style={{ fontSize: "15px" }}>
                    Riverbend awarded <span className="b">$150,000</span> on May 18, 2027. Accept the award and sign the agreement from the
                    grant page.
                  </p>
                  <Link to="/preview/email/award" className="small b">
                    Award letter
                  </Link>
                  <Link to="/w/alder-creek/grants/awd_01J2Q7/offer" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
                    Go to grant
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </main>
      </ApplicantShell>
    </>
  );
}
