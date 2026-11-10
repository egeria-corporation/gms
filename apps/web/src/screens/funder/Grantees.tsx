// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronDown,
  CircleCheck,
  CircleMinus,
  Clock,
  Download,
  File,
  Lock,
  Plus,
  RefreshCw,
  Send,
  Shield,
  TriangleExclamationPoint,
} from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function Grantees() {
  return (
    <>
      <title>{"Grantees — Riverbend funder workspace"}</title>
      <FunderShell active="Grantees">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <Link to="/w/riverbend/grantees/org_alder-creek">Grantees</Link>
            <span>›</span>
            <span>Alder Creek Family Services</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Grantees</h1>
                <span className="pill-warn">
                  <RefreshCw className="ic ic-sm" aria-hidden="true" />
                  Org changes · 1
                </span>
              </div>
              <div className="meta">
                <span>11 organizations</span>
                <span>·</span>
                <span>$990,000 awarded all time</span>
                <span>·</span>
                <span>Profiles read from Passport with each organization’s consent</span>
              </div>
            </div>
            <div className="actions">
              <div className="filterbar">
                <button className="fchip">
                  Level
                  <ChevronDown className="ic ic-sm" aria-hidden="true" />
                </button>
                <button className="fchip">
                  Program
                  <ChevronDown className="ic ic-sm" aria-hidden="true" />
                </button>
                <button className="fchip">
                  Owner
                  <ChevronDown className="ic ic-sm" aria-hidden="true" />
                </button>
                <button className="fchip">
                  Tags
                  <ChevronDown className="ic ic-sm" aria-hidden="true" />
                </button>
              </div>
              <button className="btn btn-secondary">
                <Download className="ic" aria-hidden="true" />
                Export
              </button>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Level</th>
                  <th>Payee</th>
                  <th>Programs</th>
                  <th className="num">Total awarded</th>
                  <th>Last activity</th>
                  <th>Owner</th>
                  <th>Tags</th>
                </tr>
              </thead>
              <tbody>
                <tr className="sel">
                  <td>
                    <div className="row" style={{ gap: "8px" }}>
                      <Link to="/w/riverbend/grantees/org_alder-creek" className="b" style={{ color: "#0D2A43" }}>
                        Alder Creek Family Services
                      </Link>
                      <span className="pill-warn">
                        <RefreshCw className="ic ic-sm" aria-hidden="true" />
                        Org changes (1)
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="lvl lvl-3">
                      <Shield className="ic" aria-hidden="true" />
                      L3
                    </span>
                  </td>
                  <td>
                    <span className="pay pay-active">
                      <Check className="ic" aria-hidden="true" />
                      Payee active
                    </span>
                  </td>
                  <td>Community Health 2027</td>
                  <td className="num">$150,000</td>
                  <td>2 min ago</td>
                  <td>
                    <span className="av av-sm" title="Dana Ortiz">
                      DO
                    </span>
                  </td>
                  <td>
                    <span className="tag">Health</span> <span className="tag">Rural</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/w/riverbend/grantees/org_alder-creek" className="b" style={{ color: "#0D2A43" }}>
                      Harbor Light Shelter
                    </Link>
                  </td>
                  <td>
                    <span className="lvl lvl-3">
                      <Shield className="ic" aria-hidden="true" />
                      L3
                    </span>
                  </td>
                  <td>
                    <span className="pay pay-pending">
                      <Clock className="ic" aria-hidden="true" />
                      Pending change
                    </span>
                  </td>
                  <td>Community Health 2026</td>
                  <td className="num">$95,000</td>
                  <td>May 20</td>
                  <td>
                    <span className="av av-sm" title="Dana Ortiz">
                      DO
                    </span>
                  </td>
                  <td>
                    <span className="tag">Housing</span> <span className="tag">Health</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <div className="row" style={{ gap: "8px" }}>
                      <Link to="/w/riverbend/grantees/org_alder-creek" className="b" style={{ color: "#0D2A43" }}>
                        Bayview Youth Collective
                      </Link>
                      <span className="tag" style={{ border: "1px dashed #B9C6C6", background: "#fff" }}>
                        Consent missing
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="lvl lvl-2">L2</span>
                  </td>
                  <td>
                    <span className="pay pay-none">
                      <CircleMinus className="ic" aria-hidden="true" />
                      No destination
                    </span>
                  </td>
                  <td>
                    Community Health 2027 <span className="xs muted">(applicant)</span>
                  </td>
                  <td className="num">$0</td>
                  <td>May 19</td>
                  <td>
                    <span className="av av-sm av-t" title="Priya Natarajan">
                      PN
                    </span>
                  </td>
                  <td>
                    <span className="tag">Youth</span> <span className="tag">Mental health</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/w/riverbend/grantees/org_alder-creek" className="b" style={{ color: "#0D2A43" }}>
                      Copper Valley Clinic
                    </Link>
                  </td>
                  <td>
                    <span className="lvl lvl-1">L1</span>
                  </td>
                  <td>
                    <span className="muted">—</span>
                  </td>
                  <td>
                    Community Health 2027 <span className="xs muted">(applicant)</span>
                  </td>
                  <td className="num">$0</td>
                  <td>Apr 30</td>
                  <td>
                    <span className="av av-sm av-t" title="Priya Natarajan">
                      PN
                    </span>
                  </td>
                  <td>
                    <span className="tag">Health</span> <span className="tag">Rural</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/w/riverbend/grantees/org_alder-creek" className="b" style={{ color: "#0D2A43" }}>
                      Lakeside Senior Center
                    </Link>
                  </td>
                  <td>
                    <span className="lvl lvl-2">L2</span>
                  </td>
                  <td>
                    <span className="pay pay-active">
                      <Check className="ic" aria-hidden="true" />
                      Payee active
                    </span>
                  </td>
                  <td>Community Health 2026 · 2027</td>
                  <td className="num">$100,000</td>
                  <td>May 19</td>
                  <td>
                    <span className="av av-sm" title="Dana Ortiz">
                      DO
                    </span>
                  </td>
                  <td>
                    <span className="tag">Seniors</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/w/riverbend/grantees/org_alder-creek" className="b" style={{ color: "#0D2A43" }}>
                      Northgate Housing Trust
                    </Link>
                  </td>
                  <td>
                    <span className="lvl lvl-3">
                      <Shield className="ic" aria-hidden="true" />
                      L3
                    </span>
                  </td>
                  <td>
                    <span className="pay pay-active">
                      <Check className="ic" aria-hidden="true" />
                      Payee active
                    </span>
                  </td>
                  <td>Community Health 2026 · 2027</td>
                  <td className="num">$250,000</td>
                  <td>May 22</td>
                  <td>
                    <span className="av av-sm" title="Dana Ortiz">
                      DO
                    </span>
                  </td>
                  <td>
                    <span className="tag">Housing</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/w/riverbend/grantees/org_alder-creek" className="b" style={{ color: "#0D2A43" }}>
                      Cedar Hollow Food Bank
                    </Link>
                  </td>
                  <td>
                    <span className="lvl lvl-2">L2</span>
                  </td>
                  <td>
                    <span className="pay pay-active">
                      <Check className="ic" aria-hidden="true" />
                      Payee active
                    </span>
                  </td>
                  <td>Community Health 2026</td>
                  <td className="num">$45,000</td>
                  <td>May 17</td>
                  <td>
                    <span className="av av-sm av-n" title="Marcus Lee">
                      ML
                    </span>
                  </td>
                  <td>
                    <span className="tag">Food security</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/w/riverbend/grantees/org_alder-creek" className="b" style={{ color: "#0D2A43" }}>
                      Willow Creek Legal Aid
                    </Link>
                  </td>
                  <td>
                    <span className="lvl lvl-2">L2</span>
                  </td>
                  <td>
                    <span className="pay pay-cooling">
                      <Clock className="ic" aria-hidden="true" />
                      Cooling off
                    </span>
                  </td>
                  <td>Community Health 2027</td>
                  <td className="num">$110,000</td>
                  <td>May 19</td>
                  <td>
                    <span className="av av-sm av-t" title="Priya Natarajan">
                      PN
                    </span>
                  </td>
                  <td>
                    <span className="tag">Legal aid</span> <span className="tag">Health</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                padding: "8px 16px",
                borderTop: "1px solid #D6DEDE",
                fontSize: "12px",
                color: "#4A5C5A",
              }}
            >
              <span>Showing 8 of 11</span>
              <button className="btn btn-sm btn-secondary">Show all</button>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <div className="row" style={{ gap: "12px", flexWrap: "wrap" }}>
                <h2 style={{ fontSize: "18px" }}>Alder Creek Family Services</h2>
                <span className="lvl lvl-3">
                  <Shield className="ic" aria-hidden="true" />
                  L3
                </span>
                <span className="pay pay-active">
                  <Check className="ic" aria-hidden="true" />
                  Payee active
                </span>
                <span className="small muted">Consent granted Jan 12, 2027 · scopes org:read, org.changes:read/write</span>
              </div>
              <div className="row" style={{ gap: "8px" }}>
                <span className="notice">
                  <BadgeCheck className="ic" aria-hidden="true" style={{ color: "#1E4F8F" }} />
                  Passport synced 2 min ago
                </span>
                <Link to="/w/riverbend/communications" className="btn btn-secondary btn-sm">
                  Message
                </Link>
              </div>
            </div>
            <div
              className="card-b"
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr)",
                gap: "24px",
                alignItems: "start",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div>
                  <div className="eyebrow" style={{ marginBottom: "10px" }}>
                    Passport profile · read-only
                  </div>
                  <dl className="kv" style={{ gridTemplateColumns: "130px minmax(0, 1fr)", rowGap: "10px" }}>
                    <dt>Legal name</dt>
                    <dd className="row" style={{ gap: "6px", flexWrap: "wrap" }}>
                      Alder Creek Family Services
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </dd>
                    <dt>Tax status</dt>
                    <dd className="row" style={{ gap: "6px", flexWrap: "wrap" }}>
                      501(c)(3) public charity · verified
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </dd>
                    <dt>Address</dt>
                    <dd className="row" style={{ gap: "6px", flexWrap: "wrap" }}>
                      418 Mill Road, Alder Creek, OR
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </dd>
                    <dt>Primary contact</dt>
                    <dd className="row" style={{ gap: "6px", flexWrap: "wrap" }}>
                      Maria Santos · Executive Director · maria@aldercreekfs.example
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </dd>
                    <dt>Annual budget</dt>
                    <dd className="row" style={{ gap: "6px", flexWrap: "wrap" }}>
                      $2,400,000 (FY2026)
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </dd>
                    <dt>Representatives</dt>
                    <dd>3 · Maria Santos, Jamal Reed, Board chair (name withheld in scope)</dd>
                    <dt>Documents</dt>
                    <dd>4 in locker · determination letter, FY2026 audit, W-9 (verified), board list</dd>
                    <dt>Payee</dt>
                    <dd>River City Credit Union •••• 4821 · active since Nov 2025</dd>
                  </dl>
                </div>
                <div className="divider"></div>
                <dl className="kv" style={{ gridTemplateColumns: "130px minmax(0, 1fr)" }}>
                  <dt>Relationship owner</dt>
                  <dd className="row" style={{ gap: "6px" }}>
                    <span className="av av-sm">DO</span>Dana Ortiz<button className="btn btn-sm btn-ghost">Change</button>
                  </dd>
                  <dt>Tags</dt>
                  <dd className="row" style={{ gap: "6px", flexWrap: "wrap" }}>
                    <span className="tag">Health</span>
                    <span className="tag">Rural</span>
                    <button className="btn btn-sm btn-ghost">
                      <Plus className="ic ic-sm" aria-hidden="true" />
                      Add tag
                    </button>
                  </dd>
                </dl>
                <div className="msg msg-int">
                  <span className="av av-sm">DO</span>
                  <div className="bub">
                    <div className="hd">
                      <span className="who">Dana Ortiz</span>
                      <span>· May 18</span>
                      <span className="int-mark">
                        <Lock className="ic" aria-hidden="true" />
                        Internal
                      </span>
                    </div>
                    <div className="bd">
                      Strong partner for the rural health cohort; board wants a site visit before tranche 2. Not visible to the grantee.
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className="tabs" role="tablist" aria-label="History">
                  <a href="#history" className="tab on" role="tab" aria-selected="true">
                    Applications<span className="n">1</span>
                  </a>
                  <a href="#history" className="tab" role="tab">
                    Awards<span className="n">1</span>
                  </a>
                  <a href="#history" className="tab" role="tab">
                    Reports<span className="n">0</span>
                  </a>
                </div>
                <div className="tbl-wrap" id="history">
                  <table className="tbl tbl-compact">
                    <thead>
                      <tr>
                        <th>Application</th>
                        <th>Stage</th>
                        <th>Status</th>
                        <th className="num">Requested</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <Link to="/w/riverbend/applications/app_01HZX4" className="b">
                            Mobile Health Navigation for Rural Families
                          </Link>
                          <div className="xs muted">app_01HZX4 · Community Health Grants 2027</div>
                        </td>
                        <td>Full proposal</td>
                        <td>
                          <span className="bdg bdg-ok">
                            <CircleCheck className="ic" aria-hidden="true" />
                            Accepted
                          </span>
                        </td>
                        <td className="num">$150,000</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="tbl-wrap">
                  <table className="tbl tbl-compact">
                    <thead>
                      <tr>
                        <th>Award</th>
                        <th>Status</th>
                        <th className="num">Awarded</th>
                        <th className="num">Disbursed</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="b">
                            awd_01J2Q7
                          </Link>
                          <div className="xs muted">Jul 1, 2027 – Jun 30, 2028</div>
                        </td>
                        <td>
                          <span className="bdg bdg-ok">
                            <BadgeCheck className="ic" aria-hidden="true" />
                            Active
                          </span>
                        </td>
                        <td className="num">$150,000</td>
                        <td className="num">$75,000</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="empty card" style={{ padding: "20px" }}>
                  <File className="ic" aria-hidden="true" />
                  <h3 style={{ fontSize: "14px" }}>No reports yet</h3>
                  <p className="small">First requirement is the interim report due Dec 15, 2027.</p>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className="card" style={{ borderColor: "#E9C77D" }}>
                  <div className="card-h">
                    <h3>Pending org changes</h3>
                    <span className="pill-warn">1</span>
                  </div>
                  <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                    <div>
                      <div className="b">Primary contact phone</div>
                      <div className="row" style={{ gap: "8px", marginTop: "4px", flexWrap: "wrap" }}>
                        <span className="del">(555) 0100</span>
                        <ArrowRight className="ic ic-sm" aria-hidden="true" />
                        <span className="ins">(555) 0142</span>
                      </div>
                    </div>
                    <div className="row small muted" style={{ gap: "6px", flexWrap: "wrap" }}>
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        Source: Passport
                      </span>
                      Requested by Maria Santos · May 23
                    </div>
                    <p className="xs muted">
                      Accepting updates Riverbend’s copy of the record. Dismissing keeps the old value here only; Passport itself is
                      unchanged either way.
                    </p>
                    <div className="row" style={{ gap: "8px" }}>
                      <button className="btn btn-primary btn-sm">
                        <Check className="ic ic-sm" aria-hidden="true" />
                        Accept
                      </button>
                      <button className="btn btn-secondary btn-sm">Dismiss</button>
                    </div>
                  </div>
                </div>
                <div className="card">
                  <div className="card-h">
                    <h3>Propose a change</h3>
                    <span className="small muted">Sent to Passport for the org to approve</span>
                  </div>
                  <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div className="fld">
                      <label className="lbl" htmlFor="pc-field">
                        Field
                      </label>
                      <select className="sel" id="pc-field">
                        <option>Mailing address</option>
                        <option>Primary contact</option>
                        <option>Website</option>
                        <option>Mission statement</option>
                        <option>Service area</option>
                      </select>
                    </div>
                    <div className="fld">
                      <label className="lbl" htmlFor="pc-value">
                        Proposed value
                      </label>
                      <input className="inp" id="pc-value" placeholder="New value" />
                    </div>
                    <div className="fld">
                      <label className="lbl" htmlFor="pc-note">
                        Note to the organization
                      </label>
                      <textarea
                        className="ta"
                        id="pc-note"
                        style={{ minHeight: "64px" }}
                        placeholder="Why you believe this should change (e.g. returned mail)"
                      />
                    </div>
                    <button className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
                      <Send className="ic" aria-hidden="true" />
                      Send to Passport
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
              gap: "20px",
              marginTop: "8px",
              alignItems: "start",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · consent missing</span>
              <div className="card">
                <div className="card-h">
                  <div className="row" style={{ gap: "10px" }}>
                    <h3>Bayview Youth Collective</h3>
                    <span className="lvl lvl-2">L2</span>
                    <span className="pay pay-none">
                      <CircleMinus className="ic" aria-hidden="true" />
                      No destination
                    </span>
                  </div>
                  <span className="tag" style={{ border: "1px dashed #B9C6C6", background: "#fff" }}>
                    Consent missing
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="bnr bnr-neu">
                    <Lock className="ic" aria-hidden="true" />
                    <div>
                      <div className="t">This organization has not granted Riverbend access to its Passport profile</div>
                      <div className="d">
                        You can see what Bayview submitted in its application, but not its live profile, documents or org changes.
                        Requesting access asks Bayview’s representative to approve the scopes org:read and org.changes:read/write.
                      </div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: "10px" }}>
                    <button className="btn btn-primary">
                      <Shield className="ic" aria-hidden="true" />
                      Request access
                    </button>
                    <Link to="/w/riverbend/applications/app_01HZX4" className="btn btn-ghost">
                      View application snapshot
                    </Link>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · Passport unavailable</span>
              <div className="card">
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="row" style={{ gap: "10px" }}>
                    <h3>Copper Valley Clinic</h3>
                    <span className="lvl lvl-na">L? unavailable</span>
                  </div>
                  <div className="bnr bnr-warn">
                    <TriangleExclamationPoint className="ic" aria-hidden="true" />
                    <div>
                      <div className="t">Passport could not be reached</div>
                      <div className="d">
                        Showing Riverbend’s last synced copy from Apr 30, 2027. Level and payee status are unknown until Passport responds;
                        readiness checks treat them as blocking.
                      </div>
                      <div className="clears">
                        <RefreshCw className="ic ic-sm" aria-hidden="true" />
                        Retrying automatically · last attempt 40 seconds ago
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
