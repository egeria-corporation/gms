// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { Bot, Check, ChevronDown, CircleCheck, CircleX, Plus, Send, TriangleExclamationPoint } from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

const mergeField = (name: string) => `{{${name}}}`;

const DECLINE_TEMPLATE = `Dear {{applicant.legalName}},

Thank you for submitting “{{application.title}}” to {{opportunity.title}}. After review, {{funder.name}} will not be advancing this application to the next stage.

{{decision.reason}}

We encourage you to review eligibility for our other open opportunities and to apply again in a future cycle. Questions about this decision can be sent to {{funder.contactEmail}}.

Sincerely,
Dana Ortiz
Program Officer, {{funder.name}}`;

export default function Communications() {
  return (
    <>
      <title>{"Communications — Riverbend funder workspace"}</title>
      <FunderShell active="Communications">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <span>Communications</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Communications</h1>
              </div>
              <div className="meta">
                <span>7 templates</span>
                <span>·</span>
                <span>Sending domain riverbendcf.example · verified</span>
                <span>·</span>
                <span>Letters and emails merge fields from the application or award they are sent about</span>
              </div>
            </div>
            <div className="actions">
              <button className="btn btn-secondary">
                <Plus className="ic" aria-hidden="true" />
                New template
              </button>
              <a href="#bulk" className="btn btn-primary">
                <Send className="ic" aria-hidden="true" />
                Bulk send
              </a>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "420px minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <div className="card">
              <div className="card-h">
                <h3>Templates</h3>
                <span className="small muted">Select to edit</span>
              </div>
              <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th>Kind</th>
                      <th>Name</th>
                      <th>Ver.</th>
                      <th>Last used</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="sel">
                      <td>
                        <span className="tag">Letter</span>
                      </td>
                      <td>
                        <Link to="/w/riverbend/communications" className="b" style={{ color: "#0D2A43" }}>
                          Standard decline
                        </Link>
                      </td>
                      <td>v3</td>
                      <td className="muted">Today 10:02</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="tag">Letter</span>
                      </td>
                      <td>
                        <Link to="/w/riverbend/communications" style={{ color: "#1E2D2B" }}>
                          Award letter
                        </Link>
                      </td>
                      <td>v4</td>
                      <td className="muted">May 19</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="tag">Agreement</span>
                      </td>
                      <td>
                        <Link to="/w/riverbend/communications" style={{ color: "#1E2D2B" }}>
                          Standard grant agreement
                        </Link>
                      </td>
                      <td>v4</td>
                      <td className="muted">May 19</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="tag">Email</span>
                      </td>
                      <td>
                        <Link to="/w/riverbend/communications" style={{ color: "#1E2D2B" }}>
                          Acknowledgment
                        </Link>
                      </td>
                      <td>v2</td>
                      <td className="muted">Apr 30</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="tag">Email</span>
                      </td>
                      <td>
                        <Link to="/w/riverbend/communications" style={{ color: "#1E2D2B" }}>
                          Revision request
                        </Link>
                      </td>
                      <td>v2</td>
                      <td className="muted">Apr 18</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="tag">Email</span>
                      </td>
                      <td>
                        <Link to="/w/riverbend/communications" style={{ color: "#1E2D2B" }}>
                          Report reminder (−7 days)
                        </Link>
                      </td>
                      <td>v1</td>
                      <td className="muted">Dec 8, 2026</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="tag">Email</span>
                      </td>
                      <td>
                        <Link to="/w/riverbend/communications" style={{ color: "#1E2D2B" }}>
                          Payment sent
                        </Link>
                      </td>
                      <td>v1</td>
                      <td className="muted">Today 10:41</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="card-f small muted">
                Versions are pinned when sent: a letter already delivered keeps the version it was rendered with.
              </div>
            </div>
            <div className="card">
              <div className="card-h">
                <div className="row" style={{ gap: "10px" }}>
                  <h3>Standard decline</h3>
                  <span className="tag">Letter · v3</span>
                  <span className="bdg bdg-ok">
                    <CircleCheck className="ic" aria-hidden="true" />
                    Published
                  </span>
                </div>
                <div className="row" style={{ gap: "8px" }}>
                  <button className="btn btn-sm btn-secondary">Version history</button>
                  <button className="btn btn-sm btn-secondary">Save draft</button>
                  <button className="btn btn-sm btn-primary">Publish v4</button>
                </div>
              </div>
              <div
                className="card-b"
                style={{ display: "grid", gridTemplateColumns: "180px minmax(0, 1fr) minmax(0, 1fr)", gap: "16px", alignItems: "start" }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span className="eyebrow">Merge fields</span>
                  <p className="small muted">Drag or click to insert at the cursor.</p>
                  <button className="chip" style={{ justifyContent: "flex-start" }}>
                    <span className="mono" style={{ fontSize: "11px" }}>
                      {mergeField("applicant.legalName")}
                    </span>
                  </button>
                  <button className="chip" style={{ justifyContent: "flex-start" }}>
                    <span className="mono" style={{ fontSize: "11px" }}>
                      {mergeField("opportunity.title")}
                    </span>
                  </button>
                  <button className="chip" style={{ justifyContent: "flex-start" }}>
                    <span className="mono" style={{ fontSize: "11px" }}>
                      {mergeField("application.title")}
                    </span>
                  </button>
                  <button className="chip" style={{ justifyContent: "flex-start", borderColor: "#E9C77D", background: "#FCEFD3" }}>
                    <span className="mono" style={{ fontSize: "11px" }}>
                      {mergeField("decision.reason")}
                    </span>
                  </button>
                  <button className="chip" style={{ justifyContent: "flex-start" }}>
                    <span className="mono" style={{ fontSize: "11px" }}>
                      {mergeField("funder.name")}
                    </span>
                  </button>
                  <button className="chip" style={{ justifyContent: "flex-start" }}>
                    <span className="mono" style={{ fontSize: "11px" }}>
                      {mergeField("funder.contactEmail")}
                    </span>
                  </button>
                  <span className="help" style={{ marginTop: "4px" }}>
                    Highlighted fields may be empty for some recipients; the preview and bulk send check this.
                  </span>
                </div>
                <div className="fld">
                  <label className="lbl" htmlFor="tpl-body">
                    Letter body
                  </label>
                  <textarea
                    className="ta"
                    id="tpl-body"
                    style={{ minHeight: "360px", fontSize: "13px", lineHeight: 1.6 }}
                    defaultValue={DECLINE_TEMPLATE}
                  />
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="help">Rendered on the funder letterhead; a PDF copy is attached to the application record.</span>
                    <span className="counter">96 words</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="eyebrow">Preview</span>
                    <span className="small muted">Sample: Pine Ridge Literacy Project</span>
                  </div>
                  <div style={{ border: "1px solid #D6DEDE", borderRadius: "8px", overflow: "hidden", background: "#fff" }}>
                    <div
                      style={{
                        background: "var(--tenant)",
                        color: "var(--on-tenant)",
                        padding: "14px 18px",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        fontFamily: "var(--font-display)",
                        fontWeight: 700,
                      }}
                    >
                      <span
                        style={{
                          width: "28px",
                          height: "28px",
                          borderRadius: "6px",
                          background: "rgba(255,255,255,.18)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "11px",
                        }}
                      >
                        RCF
                      </span>
                      Riverbend Community Foundation
                    </div>
                    <div
                      style={{
                        padding: "18px",
                        fontSize: "12.5px",
                        lineHeight: 1.6,
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                        color: "#1E2D2B",
                      }}
                    >
                      <p>May 25, 2027</p>
                      <p>Dear Pine Ridge Literacy Project,</p>
                      <p>
                        Thank you for submitting “Health Literacy Workshops” to Community Health Grants 2027. After review, Riverbend
                        Community Foundation will not be advancing this application to the next stage.
                      </p>
                      <p>
                        <span className="ins">The proposed service area is outside Riverbend County, which this opportunity requires.</span>
                      </p>
                      <p>
                        We encourage you to review eligibility for our other open opportunities and to apply again in a future cycle.
                        Questions about this decision can be sent to grants@riverbendcf.example.
                      </p>
                      <p>
                        Sincerely,
                        <br />
                        Dana Ortiz
                        <br />
                        Program Officer, Riverbend Community Foundation
                      </p>
                    </div>
                    <div
                      style={{
                        padding: "10px 18px",
                        background: "#F7FAFA",
                        borderTop: "1px solid #D6DEDE",
                        fontSize: "11px",
                        color: "#4A5C5A",
                      }}
                    >
                      Sent by OpenGrants GMS on behalf of Riverbend Community Foundation
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <div className="card">
              <div className="card-h">
                <h3>Send log</h3>
                <div className="row" style={{ gap: "8px" }}>
                  <button className="fchip">
                    Last 30 days
                    <ChevronDown className="ic ic-sm" aria-hidden="true" />
                  </button>
                  <button className="fchip">
                    All templates
                    <ChevronDown className="ic ic-sm" aria-hidden="true" />
                  </button>
                  <button className="btn btn-sm btn-secondary">Export</button>
                </div>
              </div>
              <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Template</th>
                      <th>Recipient</th>
                      <th>Channel</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>May 25, 2027 10:41</td>
                      <td>Payment sent v1</td>
                      <td>
                        <div className="ent">
                          <Link to="/w/riverbend/grantees/org_alder-creek" className="nm">
                            Alder Creek Family Services
                          </Link>
                          <span className="muted xs">finance@aldercreekfs.example</span>
                        </div>
                      </td>
                      <td>Email</td>
                      <td>
                        <span className="bdg bdg-ok">
                          <CircleCheck className="ic" aria-hidden="true" />
                          Delivered
                        </span>
                      </td>
                    </tr>
                    <tr style={{ verticalAlign: "top" }}>
                      <td style={{ height: "auto", paddingTop: "10px", paddingBottom: "10px", whiteSpace: "nowrap" }}>
                        May 25, 2027 10:02
                      </td>
                      <td style={{ height: "auto", paddingTop: "10px", paddingBottom: "10px" }}>Standard decline v3</td>
                      <td style={{ height: "auto", paddingTop: "10px", paddingBottom: "10px", whiteSpace: "normal" }}>
                        <details>
                          <summary className="b" style={{ cursor: "pointer", color: "#0D2A43" }}>
                            14 recipients
                          </summary>
                          <ul className="small muted" style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "3px" }}>
                            <li>Pine Ridge Literacy Project · director@pineridgeliteracy.example</li>
                            <li>Meadowbrook Arts Collective · hello@meadowbrookarts.example</li>
                            <li>Granite Peak Youth Sports · office@granitepeakyouth.example</li>
                            <li>Blue Heron Conservation · grants@blueheron.example</li>
                            <li>Stonebridge Community Kitchen · info@stonebridgekitchen.example</li>
                            <li className="b">… 9 more</li>
                          </ul>
                        </details>
                        <div className="attrib" style={{ marginTop: "6px" }}>
                          <Bot className="ic ic-sm" aria-hidden="true" />
                          Proposed by<span className="ag">Riverbend Triage Agent (via Claude)</span>· approved by Dana Ortiz ·
                          <Link to="/w/riverbend/approvals">agent proposal #a-1042</Link>
                        </div>
                      </td>
                      <td style={{ height: "auto", paddingTop: "10px", paddingBottom: "10px" }}>Email</td>
                      <td style={{ height: "auto", paddingTop: "10px", paddingBottom: "10px" }}>
                        <div className="ent">
                          <span className="bdg bdg-ok">
                            <CircleCheck className="ic" aria-hidden="true" />
                            Delivered 14
                          </span>
                          <span className="muted xs">Opened 9 · letter PDFs attached to each application</span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td>May 19, 2027 16:20</td>
                      <td>Award letter v4</td>
                      <td>
                        <div className="ent">
                          <Link to="/w/riverbend/grantees/org_alder-creek" className="nm">
                            Alder Creek Family Services
                          </Link>
                          <span className="muted xs">maria@aldercreekfs.example</span>
                        </div>
                      </td>
                      <td>Email + letter PDF</td>
                      <td>
                        <span className="bdg bdg-ok">
                          <CircleCheck className="ic" aria-hidden="true" />
                          Delivered · opened
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td>May 19, 2027 16:20</td>
                      <td>Award letter v4</td>
                      <td>
                        <div className="ent">
                          <Link to="/w/riverbend/grantees/org_alder-creek" className="nm">
                            Lakeside Senior Center
                          </Link>
                          <span className="muted xs">grants@lakesideseniors.example</span>
                        </div>
                      </td>
                      <td>Email + letter PDF</td>
                      <td>
                        <span className="bdg bdg-info">
                          <Send className="ic" aria-hidden="true" />
                          Delivered
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td>Apr 18, 2027 09:12</td>
                      <td>Revision request v2</td>
                      <td>
                        <div className="ent">
                          <Link to="/w/riverbend/grantees/org_alder-creek" className="nm">
                            Copper Valley Clinic
                          </Link>
                          <span className="muted xs">admin@coppervalleyclinic.example</span>
                        </div>
                      </td>
                      <td>Email</td>
                      <td>
                        <span className="bdg bdg-dng">
                          <CircleX className="ic" aria-hidden="true" />
                          Bounced · resent 09:30
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="card" id="bulk">
                <div className="card-h">
                  <h3>Bulk send</h3>
                  <span className="small muted">Step 3 of 4</span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div className="stp">
                    <span className="s done">
                      <span className="n">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </span>
                      Filter
                    </span>
                    <span className="ln done"></span>
                    <span className="s done">
                      <span className="n">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </span>
                      Template
                    </span>
                    <span className="ln done"></span>
                    <span className="s on">
                      <span className="n">3</span>Preview
                    </span>
                    <span className="ln"></span>
                    <span className="s">
                      <span className="n">4</span>Send
                    </span>
                  </div>
                  <dl className="kv">
                    <dt>Recipients</dt>
                    <dd>
                      <span className="b">14 applications</span> · Community Health Grants 2027 · status Declined · no letter sent yet
                    </dd>
                    <dt>Template</dt>
                    <dd>Standard decline v3</dd>
                    <dt>Channel</dt>
                    <dd>Email, letter PDF attached to each application record</dd>
                    <dt>Preview</dt>
                    <dd>
                      <Link to="/w/riverbend/communications">Pine Ridge Literacy Project</Link> ·{" "}
                      <Link to="/w/riverbend/communications">next recipient →</Link>
                    </dd>
                  </dl>
                  <div className="bnr bnr-warn" style={{ padding: "10px 12px" }}>
                    <TriangleExclamationPoint className="ic" aria-hidden="true" />
                    <div>
                      <div className="t" style={{ fontSize: "13px" }}>
                        <span className="mono">{mergeField("decision.reason")}</span> is empty for 3 recipients
                      </div>
                      <div className="d" style={{ fontSize: "12px" }}>
                        Those letters would render a blank paragraph. Add a reason on each application or choose a template that does not
                        use this field.
                      </div>
                      <div className="clears">
                        <Link to="/w/riverbend/applications">Show the 3 applications →</Link>
                      </div>
                    </div>
                  </div>
                  <div className="row" style={{ justifyContent: "flex-end", gap: "8px" }}>
                    <button className="btn btn-secondary">Back</button>
                    <button className="btn btn-primary" disabled>
                      Send to 14?
                    </button>
                  </div>
                  <span className="help">
                    Send is enabled when every merge field resolves. Sending is logged to the audit ledger with the approver's name.
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span className="eyebrow">State · missing merge field (editor)</span>
                <div className="bnr bnr-warn">
                  <TriangleExclamationPoint className="ic" aria-hidden="true" />
                  <div>
                    <div className="t">
                      Unknown merge field <span className="mono">{mergeField("applicant.ein")}</span>
                    </div>
                    <div className="d">
                      This field is not available to letters. Identifiers are never merged into outgoing mail; use
                      <span className="mono">{mergeField("applicant.legalName")}</span>instead.
                    </div>
                  </div>
                  <button className="btn btn-sm btn-secondary act">Remove field</button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
