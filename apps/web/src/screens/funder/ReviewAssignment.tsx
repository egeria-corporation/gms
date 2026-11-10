// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { Ban, ChartColumn, Check, CircleX, Eye, Info, TriangleExclamationPoint, UserPlus, Zap } from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function ReviewAssignment() {
  return (
    <>
      <title>{"Review assignment — Community Health Grants 2027"}</title>
      <FunderShell active="Reviews">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <Link to="/w/riverbend/reviews/assign">Reviews</Link>
            <span>›</span>
            <span>Assign reviewers</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Assign reviewers</h1>
                <span className="bdg bdg-prog">
                  <Eye className="ic" aria-hidden="true" />
                  Full proposal · 10 applications
                </span>
              </div>
              <div className="meta">
                <span>Community Health Grants 2027</span>
                <span>·</span>
                <span>Rubric: Community Health rubric v3</span>
                <span>·</span>
                <span>Target: 3 reviewers per application</span>
              </div>
            </div>
            <div className="actions">
              <div className="fld" style={{ flexDirection: "row", alignItems: "center", gap: "8px" }}>
                <label className="lbl" htmlFor="due">
                  Due date
                </label>
                <input className="inp" id="due" type="text" defaultValue="May 7, 2027" style={{ width: "140px" }} />
              </div>
              <button className="btn btn-secondary">
                <Zap className="ic" aria-hidden="true" />
                Auto-assign…
              </button>
              <button className="btn btn-secondary">
                <UserPlus className="ic" aria-hidden="true" />
                Invite external reviewer…
              </button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: "20px", alignItems: "start" }}>
            <div className="tbl-wrap">
              <table className="tbl mx" style={{ minWidth: "1180px" }}>
                <thead>
                  <tr>
                    <th>Reviewer</th>
                    <th>
                      <div className="col" style={{ gap: "2px", alignItems: "center" }}>
                        <span>Alder Creek</span>
                        <span className="xs muted" style={{ textTransform: "none", letterSpacing: "0" }}>
                          3 assigned
                        </span>
                      </div>
                    </th>
                    <th>
                      <div className="col" style={{ gap: "2px", alignItems: "center" }}>
                        <span>Bayview</span>
                        <span className="xs muted" style={{ textTransform: "none", letterSpacing: "0" }}>
                          3
                        </span>
                      </div>
                    </th>
                    <th>
                      <div className="col" style={{ gap: "2px", alignItems: "center" }}>
                        <span>Copper Valley</span>
                        <span className="xs muted" style={{ textTransform: "none", letterSpacing: "0" }}>
                          3
                        </span>
                      </div>
                    </th>
                    <th>
                      <div className="col" style={{ gap: "2px", alignItems: "center" }}>
                        <span>Harbor Light</span>
                        <span className="xs muted" style={{ textTransform: "none", letterSpacing: "0" }}>
                          3
                        </span>
                      </div>
                    </th>
                    <th>
                      <div className="col" style={{ gap: "2px", alignItems: "center" }}>
                        <span>Lakeside</span>
                        <span className="xs muted" style={{ textTransform: "none", letterSpacing: "0" }}>
                          3
                        </span>
                      </div>
                    </th>
                    <th>
                      <div className="col" style={{ gap: "2px", alignItems: "center" }}>
                        <span>Northgate</span>
                        <span className="xs muted" style={{ textTransform: "none", letterSpacing: "0" }}>
                          3
                        </span>
                      </div>
                    </th>
                    <th>
                      <div className="col" style={{ gap: "2px", alignItems: "center" }}>
                        <span>Cedar Hollow</span>
                        <span className="xs muted" style={{ textTransform: "none", letterSpacing: "0" }}>
                          3
                        </span>
                      </div>
                    </th>
                    <th>
                      <div className="col" style={{ gap: "2px", alignItems: "center" }}>
                        <span>Willow Creek</span>
                        <span className="xs muted" style={{ textTransform: "none", letterSpacing: "0" }}>
                          3
                        </span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <div className="row" style={{ gap: "10px" }}>
                        <span className="av av-t">PN</span>
                        <div className="ent">
                          <span className="nm">Priya Natarajan</span>
                          <span className="sub">
                            <span className="muted">9 of 12</span>
                            <span className="tag">Health</span>
                            <span className="tag">Rural</span>
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Priya Natarajan reviews Alder Creek">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Priya Natarajan reviews Bayview">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Priya Natarajan reviews Copper Valley">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell" aria-pressed="false" aria-label="Priya Natarajan reviews Harbor Light"></button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Priya Natarajan reviews Lakeside">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Priya Natarajan reviews Northgate">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Priya Natarajan reviews Cedar Hollow">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Priya Natarajan reviews Willow Creek">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <div className="row" style={{ gap: "10px" }}>
                        <span className="av">ML</span>
                        <div className="ent">
                          <span className="nm">Marcus Lee</span>
                          <span className="sub">
                            <span className="muted">6 of 8</span>
                            <span className="tag">Finance</span>
                            <span className="bdg bdg-dng" style={{ height: "18px", fontSize: "11px" }}>
                              <Ban className="ic" aria-hidden="true" />
                              COI · Northgate (board member)
                            </span>
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Marcus Lee reviews Alder Creek">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell" aria-pressed="false" aria-label="Marcus Lee reviews Bayview"></button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Marcus Lee reviews Copper Valley">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Marcus Lee reviews Harbor Light">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Marcus Lee reviews Lakeside">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button
                        className="cell coi"
                        disabled
                        aria-label="Conflict of interest: Marcus Lee is a board member of Northgate Housing Trust"
                      >
                        <Ban className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Marcus Lee reviews Cedar Hollow">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Marcus Lee reviews Willow Creek">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <div className="row" style={{ gap: "10px" }}>
                        <span className="av av-g">HG</span>
                        <div className="ent">
                          <span className="nm">
                            Dr. Hollis Grant{" "}
                            <span className="tag" style={{ marginLeft: "4px" }}>
                              External
                            </span>
                          </span>
                          <span className="sub">
                            <span className="muted">7 of 10</span>
                            <span className="tag">Clinical</span>
                            <span className="tag">Public health</span>
                            <span className="muted">· expires Jul 6</span>
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Hollis Grant reviews Alder Creek">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Hollis Grant reviews Bayview">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Hollis Grant reviews Copper Valley">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Hollis Grant reviews Harbor Light">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell" aria-pressed="false" aria-label="Hollis Grant reviews Lakeside"></button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Hollis Grant reviews Northgate">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Hollis Grant reviews Cedar Hollow">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Hollis Grant reviews Willow Creek">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <div className="row" style={{ gap: "10px" }}>
                        <span className="av">DO</span>
                        <div className="ent">
                          <span className="nm">Dana Ortiz</span>
                          <span className="sub">
                            <span className="muted">2 of 4</span>
                            <span className="tag">Program</span>
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <button className="cell" aria-pressed="false" aria-label="Dana Ortiz reviews Alder Creek"></button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Dana Ortiz reviews Bayview">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell" aria-pressed="false" aria-label="Dana Ortiz reviews Copper Valley"></button>
                    </td>
                    <td>
                      <button className="cell on" aria-pressed="true" aria-label="Dana Ortiz reviews Harbor Light">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <button className="cell" aria-pressed="false" aria-label="Dana Ortiz reviews Lakeside"></button>
                    </td>
                    <td>
                      <button className="cell" aria-pressed="false" aria-label="Dana Ortiz reviews Northgate"></button>
                    </td>
                    <td>
                      <button className="cell" aria-pressed="false" aria-label="Dana Ortiz reviews Cedar Hollow"></button>
                    </td>
                    <td>
                      <button className="cell" aria-pressed="false" aria-label="Dana Ortiz reviews Willow Creek"></button>
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
                  padding: "10px 16px",
                  borderTop: "1px solid #D6DEDE",
                  fontSize: "12px",
                  color: "#4A5C5A",
                  flexWrap: "wrap",
                }}
              >
                <div className="row wrap" style={{ gap: "14px" }}>
                  <span className="row" style={{ gap: "6px" }}>
                    <span className="cell on" style={{ width: "16px", height: "16px", borderRadius: "4px" }}></span>Assigned
                  </span>
                  <span className="row" style={{ gap: "6px" }}>
                    <span className="cell" style={{ width: "16px", height: "16px", borderRadius: "4px" }}></span>Available
                  </span>
                  <span className="row" style={{ gap: "6px" }}>
                    <span className="cell coi" style={{ width: "16px", height: "16px", borderRadius: "4px" }}></span>Conflict of interest
                  </span>
                  <span>Scroll right for Granite Peak and Pine Ridge</span>
                </div>
                <span>Space toggles a cell · arrow keys move</span>
              </div>
            </div>
            <aside className="drawer" style={{ border: "1px solid #D6DEDE", borderRadius: "12px", overflow: "hidden" }}>
              <div className="hd">
                <h3>Coverage</h3>
                <span className="small muted">target 3 per application</span>
              </div>
              <div className="bd">
                <div className="bnr bnr-dng" style={{ padding: "10px 12px" }}>
                  <TriangleExclamationPoint className="ic" aria-hidden="true" />
                  <div>
                    <div className="t">2 applications have fewer than 2 reviewers</div>
                    <div className="d" style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "6px" }}>
                      <a href="#granite" style={{ color: "inherit", fontWeight: 700 }}>
                        Granite Peak Youth Sports · 1 reviewer → fix
                      </a>
                      <a href="#pine" style={{ color: "inherit", fontWeight: 700 }}>
                        Pine Ridge Literacy Project · 0 reviewers → fix
                      </a>
                    </div>
                  </div>
                </div>
                <div className="bnr bnr-warn" style={{ padding: "10px 12px" }}>
                  <ChartColumn className="ic" aria-hidden="true" />
                  <div>
                    <div className="t">Uneven load</div>
                    <div className="d">Priya has 9 assignments, Dana has 2. Auto-assign can rebalance within capacity.</div>
                  </div>
                </div>
                <div>
                  <div className="eyebrow" style={{ marginBottom: "8px" }}>
                    Per application
                  </div>
                  <table className="tbl tbl-compact" style={{ fontSize: "12px" }}>
                    <tbody>
                      <tr>
                        <td>Alder Creek</td>
                        <td className="num">3</td>
                        <td>
                          <span className="row" style={{ gap: "4px", color: "#0B5E47" }}>
                            <Check className="ic ic-sm" aria-hidden="true" />
                            ok
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Bayview</td>
                        <td className="num">3</td>
                        <td>
                          <span className="row" style={{ gap: "4px", color: "#0B5E47" }}>
                            <Check className="ic ic-sm" aria-hidden="true" />
                            ok
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Copper Valley</td>
                        <td className="num">3</td>
                        <td>
                          <span className="row" style={{ gap: "4px", color: "#0B5E47" }}>
                            <Check className="ic ic-sm" aria-hidden="true" />
                            ok
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Harbor Light</td>
                        <td className="num">3</td>
                        <td>
                          <span className="row" style={{ gap: "4px", color: "#0B5E47" }}>
                            <Check className="ic ic-sm" aria-hidden="true" />
                            ok
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Lakeside</td>
                        <td className="num">2</td>
                        <td>
                          <span className="row" style={{ gap: "4px", color: "#7A4A00" }}>
                            <Info className="ic ic-sm" aria-hidden="true" />
                            below target
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Northgate</td>
                        <td className="num">2</td>
                        <td>
                          <span className="row" style={{ gap: "4px", color: "#7A4A00" }}>
                            <Info className="ic ic-sm" aria-hidden="true" />
                            below target
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Cedar Hollow</td>
                        <td className="num">3</td>
                        <td>
                          <span className="row" style={{ gap: "4px", color: "#0B5E47" }}>
                            <Check className="ic ic-sm" aria-hidden="true" />
                            ok
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Willow Creek</td>
                        <td className="num">3</td>
                        <td>
                          <span className="row" style={{ gap: "4px", color: "#0B5E47" }}>
                            <Check className="ic ic-sm" aria-hidden="true" />
                            ok
                          </span>
                        </td>
                      </tr>
                      <tr id="granite">
                        <td>Granite Peak</td>
                        <td className="num">1</td>
                        <td>
                          <span className="row" style={{ gap: "4px", color: "#9B1C1C" }}>
                            <CircleX className="ic ic-sm" aria-hidden="true" />
                            under 2
                          </span>
                        </td>
                      </tr>
                      <tr id="pine">
                        <td>Pine Ridge</td>
                        <td className="num">0</td>
                        <td>
                          <span className="row" style={{ gap: "4px", color: "#9B1C1C" }}>
                            <CircleX className="ic ic-sm" aria-hidden="true" />
                            under 2
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </aside>
          </div>
          <div
            className="card"
            style={{
              padding: "12px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <span className="small muted">
              24 assignments · 4 reviewers · due May 7, 2027 · reviewers are emailed a link to the reviewer portal
            </span>
            <div className="row">
              <button className="btn btn-secondary">Save without notifying</button>
              <Link to="/review/assignments" className="btn btn-primary">
                Save assignments and notify
              </Link>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
            <span className="eyebrow">States</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px" }}>
              <div className="mdl" style={{ width: "auto", boxShadow: "none", border: "1px solid #D6DEDE" }}>
                <div className="hd">
                  <div>
                    <h3 style={{ fontSize: "16px" }}>Auto-assign reviewers</h3>
                    <p className="small muted" style={{ marginTop: "4px" }}>
                      Fills gaps to the target of 3 per application. Existing assignments are kept.
                    </p>
                  </div>
                </div>
                <div className="bd">
                  <div className="fld">
                    <label className="lbl" htmlFor="max">
                      Per-reviewer maximum
                    </label>
                    <input className="inp" id="max" type="number" defaultValue="12" style={{ width: "120px" }} />
                  </div>
                  <div className="cb">
                    <span className="c on" aria-hidden="true">
                      <Check className="ic ic-sm" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="b">Match expertise tags</div>
                      <div className="help">Prefer reviewers whose tags overlap the application's PCS subjects</div>
                    </div>
                  </div>
                  <div className="cb">
                    <span className="c on" aria-hidden="true">
                      <Check className="ic ic-sm" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="b">Exclude declared conflicts of interest</div>
                      <div className="help">1 conflict on file: Marcus Lee × Northgate Housing Trust</div>
                    </div>
                  </div>
                  <div className="cb">
                    <span className="c" aria-hidden="true"></span>
                    <div>
                      <div className="b">Balance load evenly</div>
                      <div className="help">Spread assignments so no reviewer carries more than 40% of the total</div>
                    </div>
                  </div>
                </div>
                <div className="ft">
                  <button className="btn btn-secondary">Cancel</button>
                  <button className="btn btn-primary">Preview 6 new assignments</button>
                </div>
              </div>
              <div className="mdl" style={{ width: "auto", boxShadow: "none", border: "1px solid #D6DEDE" }}>
                <div className="hd">
                  <div>
                    <h3 style={{ fontSize: "16px" }}>Invite an external reviewer</h3>
                    <p className="small muted" style={{ marginTop: "4px" }}>
                      External reviewers see a single-purpose portal with masked applicant details.
                    </p>
                  </div>
                </div>
                <div className="bd">
                  <div className="fld">
                    <label className="lbl" htmlFor="ext-email">
                      Email
                    </label>
                    <input className="inp" id="ext-email" type="email" defaultValue="h.grant@valleyhealth.example" />
                  </div>
                  <div className="fld-row">
                    <div className="fld">
                      <label className="lbl" htmlFor="ext-scope">
                        Scope
                      </label>
                      <select className="sel" id="ext-scope">
                        <option>Community Health Grants 2027 · Full proposal</option>
                        <option>All stages of this competition</option>
                      </select>
                    </div>
                    <div className="fld">
                      <label className="lbl" htmlFor="ext-exp">
                        Access expires
                      </label>
                      <select className="sel" id="ext-exp">
                        <option>60 days after invite</option>
                        <option>When the competition closes</option>
                        <option>Custom date</option>
                      </select>
                    </div>
                  </div>
                  <div className="cb">
                    <span className="c on" aria-hidden="true">
                      <Check className="ic ic-sm" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="b">Require a conflict-of-interest declaration before each application</div>
                    </div>
                  </div>
                </div>
                <div className="ft">
                  <button className="btn btn-secondary">Cancel</button>
                  <button className="btn btn-primary">Send invitation</button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
