// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock,
  Download,
  Hourglass,
  Info,
  Lock,
  Shield,
  Star,
  TriangleExclamationPoint,
} from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function Panel() {
  return (
    <>
      <title>{"Panel and decisions — Community Health Grants 2027"}</title>
      <FunderShell active="Reviews">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <Link to="/w/riverbend/competitions/community-health-2027">Community Health Grants 2027</Link>
            <span>›</span>
            <span>Panel</span>
          </div>
          <div
            className="card"
            style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px", position: "sticky", top: "0", zIndex: 2 }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
              <div>
                <div className="title" style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <h1>Panel · decisions</h1>
                  <span className="bdg bdg-prog">
                    <Star className="ic" aria-hidden="true" />
                    Full proposal · panel open
                  </span>
                </div>
                <div className="meta">
                  <span>Community Health Grants 2027</span>
                  <span>·</span>
                  <span>Program: Community Health 2027</span>
                  <span>·</span>
                  <span>10 applications · 30 of 30 reviews in</span>
                  <span>·</span>
                  <span>Panel May 18, 2027</span>
                </div>
              </div>
              <div className="actions">
                <button className="btn btn-secondary">
                  <Download className="ic" aria-hidden="true" />
                  Export ranking
                </button>
                <button className="btn btn-secondary">Sort: weighted mean</button>
              </div>
            </div>
            <div className="mtr" aria-label="Program budget headroom">
              <div className="lbls">
                <span>
                  Available <b>$1,200,000</b>
                </span>
                <span>
                  Allocated <b>$720,000</b> · 60%
                </span>
                <span>
                  Pending <b>$0</b>
                </span>
                <span>
                  Remaining <b>$480,000</b>
                </span>
              </div>
              <div className="track">
                <div className="fill" style={{ width: "60%" }}></div>
                <div className="fill pend" style={{ width: "0%" }}></div>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: "20px", alignItems: "start" }}>
            <div className="tbl-wrap">
              <table className="tbl" style={{ minWidth: "920px" }}>
                <thead>
                  <tr>
                    <th style={{ width: "44px" }}>#</th>
                    <th>Applicant</th>
                    <th className="num">Requested</th>
                    <th className="num">Mean</th>
                    <th className="num">Median</th>
                    <th className="num">Spread</th>
                    <th className="num">n</th>
                    <th className="num">Allocation</th>
                    <th>Decision</th>
                    <th style={{ width: "36px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span className="rk">1</span>
                    </td>
                    <td>
                      <div className="ent">
                        <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                          Lakeside Senior Center
                        </Link>
                        <span className="sub">
                          <span className="lvl lvl-2">L2</span>
                          <span className="muted">Fall Prevention Program</span>
                        </span>
                      </div>
                    </td>
                    <td className="num">$70,000</td>
                    <td className="num b">4.6</td>
                    <td className="num">4.7</td>
                    <td className="num">0.3</td>
                    <td className="num">3</td>
                    <td className="num">
                      <input className="inp alloc" defaultValue="$70,000" aria-label="Allocation for Lakeside Senior Center" />
                    </td>
                    <td>
                      <div className="seg" role="radiogroup" aria-label="Decision for Lakeside Senior Center">
                        <button className="on" role="radio" aria-checked="true">
                          Approve
                        </button>
                        <button role="radio" aria-checked="false">
                          Decline
                        </button>
                        <button role="radio" aria-checked="false">
                          Waitlist
                        </button>
                        <button role="radio" aria-checked="false">
                          Defer
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        className="iconbtn"
                        style={{ width: "28px", height: "28px" }}
                        aria-label="Expand reviews for Lakeside Senior Center"
                      >
                        <ChevronDown className="ic" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                  <tr className="sel">
                    <td>
                      <span className="rk">2</span>
                    </td>
                    <td>
                      <div className="ent">
                        <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                          Alder Creek Family Services
                        </Link>
                        <span className="sub">
                          <span className="lvl lvl-3">
                            <Shield className="ic" aria-hidden="true" />
                            L3
                          </span>
                          <span className="muted">Mobile Health Navigation for Rural Families</span>
                        </span>
                      </div>
                    </td>
                    <td className="num">$150,000</td>
                    <td className="num b">4.4</td>
                    <td className="num">4.5</td>
                    <td className="num">0.4</td>
                    <td className="num">3</td>
                    <td className="num">
                      <input className="inp alloc" defaultValue="$150,000" aria-label="Allocation for Alder Creek Family Services" />
                    </td>
                    <td>
                      <div className="seg" role="radiogroup" aria-label="Decision for Alder Creek Family Services">
                        <button className="on" role="radio" aria-checked="true">
                          Approve
                        </button>
                        <button role="radio" aria-checked="false">
                          Decline
                        </button>
                        <button role="radio" aria-checked="false">
                          Waitlist
                        </button>
                        <button role="radio" aria-checked="false">
                          Defer
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        className="iconbtn"
                        style={{ width: "28px", height: "28px" }}
                        aria-label="Collapse reviews for Alder Creek Family Services"
                        aria-expanded="true"
                      >
                        <ChevronUp className="ic" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                  <tr className="sel">
                    <td colSpan={10} style={{ height: "auto", padding: "0 12px 14px 56px", whiteSpace: "normal" }}>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
                          gap: "16px",
                          alignItems: "start",
                        }}
                      >
                        <table className="tbl tbl-compact" style={{ background: "#fff", border: "1px solid #D6DEDE", borderRadius: "8px" }}>
                          <thead>
                            <tr>
                              <th>Reviewer</th>
                              <th className="num">Need</th>
                              <th className="num">Approach</th>
                              <th className="num">Feasib.</th>
                              <th className="num">Budget</th>
                              <th className="num">Outcomes</th>
                              <th className="num">Weighted</th>
                              <th>Recommendation</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>
                                <span className="row" style={{ gap: "6px" }}>
                                  <span className="av av-sm av-t">PN</span>Priya Natarajan
                                </span>
                              </td>
                              <td className="num">5</td>
                              <td className="num">4</td>
                              <td className="num">4</td>
                              <td className="num">3</td>
                              <td className="num">4</td>
                              <td className="num b">4.1</td>
                              <td>
                                <span className="bdg bdg-ok">
                                  <Check className="ic" aria-hidden="true" />
                                  Fund
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td>
                                <span className="row" style={{ gap: "6px" }}>
                                  <span className="av av-sm">ML</span>Marcus Lee
                                </span>
                              </td>
                              <td className="num">5</td>
                              <td className="num">5</td>
                              <td className="num">3</td>
                              <td className="num">4</td>
                              <td className="num">4</td>
                              <td className="num b">4.3</td>
                              <td>
                                <span className="bdg bdg-ok">
                                  <Check className="ic" aria-hidden="true" />
                                  Fund
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td>
                                <span className="row" style={{ gap: "6px" }}>
                                  <span className="av av-sm av-g">HG</span>Dr. Hollis Grant<span className="tag">External</span>
                                </span>
                              </td>
                              <td className="num">4</td>
                              <td className="num">4</td>
                              <td className="num">5</td>
                              <td className="num">4</td>
                              <td className="num">5</td>
                              <td className="num b">4.4</td>
                              <td>
                                <span className="bdg bdg-warn">
                                  <Info className="ic" aria-hidden="true" />
                                  Fund with reservations
                                </span>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px" }}>
                          <div className="cmt" style={{ padding: "8px 10px" }}>
                            <div className="hd">
                              <span className="who">PN</span>
                            </div>
                            <div className="bd">
                              Strong evidence base and a tested pilot. Hiring two navigators by July is the main risk; recommend a 90-day
                              hiring milestone tied to tranche 2.
                            </div>
                          </div>
                          <div className="cmt" style={{ padding: "8px 10px" }}>
                            <div className="hd">
                              <span className="who">HG</span>
                            </div>
                            <div className="bd">
                              Clinically sound hand-off model. Reservation: one van for six stops; winter weather will erode coverage.
                            </div>
                          </div>
                          <Link to="/w/riverbend/applications/app_01HZX4" className="b">
                            Open full application →
                          </Link>
                        </div>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className="rk">3</span>
                    </td>
                    <td>
                      <div className="ent">
                        <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                          Willow Creek Legal Aid
                        </Link>
                        <span className="sub">
                          <span className="lvl lvl-2">L2</span>
                          <span className="muted">Medical-Legal Partnership</span>
                        </span>
                      </div>
                    </td>
                    <td className="num">$110,000</td>
                    <td className="num b">4.2</td>
                    <td className="num">4.2</td>
                    <td className="num">0.2</td>
                    <td className="num">3</td>
                    <td className="num">
                      <input className="inp alloc" defaultValue="$110,000" aria-label="Allocation for Willow Creek Legal Aid" />
                    </td>
                    <td>
                      <div className="seg" role="radiogroup" aria-label="Decision for Willow Creek Legal Aid">
                        <button className="on" role="radio" aria-checked="true">
                          Approve
                        </button>
                        <button role="radio" aria-checked="false">
                          Decline
                        </button>
                        <button role="radio" aria-checked="false">
                          Waitlist
                        </button>
                        <button role="radio" aria-checked="false">
                          Defer
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        className="iconbtn"
                        style={{ width: "28px", height: "28px" }}
                        aria-label="Expand reviews for Willow Creek Legal Aid"
                      >
                        <ChevronDown className="ic" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className="rk">4</span>
                    </td>
                    <td>
                      <div className="ent">
                        <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                          Harbor Light Shelter
                        </Link>
                        <span className="sub">
                          <span className="lvl lvl-3">
                            <Shield className="ic" aria-hidden="true" />
                            L3
                          </span>
                          <span className="pay pay-pending">
                            <Clock className="ic" aria-hidden="true" />
                            Pending change
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="num">$95,000</td>
                    <td className="num b">4.1</td>
                    <td className="num">4.0</td>
                    <td className="num">0.6</td>
                    <td className="num">3</td>
                    <td className="num">
                      <input className="inp alloc" defaultValue="$95,000" aria-label="Allocation for Harbor Light Shelter" />
                    </td>
                    <td>
                      <div className="seg" role="radiogroup" aria-label="Decision for Harbor Light Shelter">
                        <button className="on" role="radio" aria-checked="true">
                          Approve
                        </button>
                        <button role="radio" aria-checked="false">
                          Decline
                        </button>
                        <button role="radio" aria-checked="false">
                          Waitlist
                        </button>
                        <button role="radio" aria-checked="false">
                          Defer
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        className="iconbtn"
                        style={{ width: "28px", height: "28px" }}
                        aria-label="Expand reviews for Harbor Light Shelter"
                      >
                        <ChevronDown className="ic" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className="rk">5</span>
                    </td>
                    <td>
                      <div className="ent">
                        <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                          Northgate Housing Trust
                        </Link>
                        <span className="sub">
                          <span className="lvl lvl-3">
                            <Shield className="ic" aria-hidden="true" />
                            L3
                          </span>
                          <span className="bdg bdg-warn">
                            <TriangleExclamationPoint className="ic" aria-hidden="true" />
                            Spread 1.2 · discuss
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="num">$150,000</td>
                    <td className="num b">4.0</td>
                    <td className="num">4.1</td>
                    <td className="num" style={{ color: "#7A4A00", fontWeight: 700 }}>
                      1.2
                    </td>
                    <td className="num">3</td>
                    <td className="num">
                      <input className="inp alloc" defaultValue="$150,000" aria-label="Allocation for Northgate Housing Trust" />
                    </td>
                    <td>
                      <div className="seg" role="radiogroup" aria-label="Decision for Northgate Housing Trust">
                        <button className="on" role="radio" aria-checked="true">
                          Approve
                        </button>
                        <button role="radio" aria-checked="false">
                          Decline
                        </button>
                        <button role="radio" aria-checked="false">
                          Waitlist
                        </button>
                        <button role="radio" aria-checked="false">
                          Defer
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        className="iconbtn"
                        style={{ width: "28px", height: "28px" }}
                        aria-label="Expand reviews for Northgate Housing Trust"
                      >
                        <ChevronDown className="ic" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className="rk">6</span>
                    </td>
                    <td>
                      <div className="ent">
                        <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                          Bayview Youth Collective
                        </Link>
                        <span className="sub">
                          <span className="lvl lvl-2">L2</span>
                          <span className="pay pay-none">
                            <CircleMinus className="ic" aria-hidden="true" />
                            No destination
                          </span>
                          <span className="muted xs">award can be offered; payment will hold until a payee is verified</span>
                        </span>
                      </div>
                    </td>
                    <td className="num">$85,000</td>
                    <td className="num b">3.9</td>
                    <td className="num">3.9</td>
                    <td className="num">0.5</td>
                    <td className="num">3</td>
                    <td className="num">
                      <input className="inp alloc" defaultValue="$85,000" aria-label="Allocation for Bayview Youth Collective" />
                    </td>
                    <td>
                      <div className="seg" role="radiogroup" aria-label="Decision for Bayview Youth Collective">
                        <button className="on" role="radio" aria-checked="true">
                          Approve
                        </button>
                        <button role="radio" aria-checked="false">
                          Decline
                        </button>
                        <button role="radio" aria-checked="false">
                          Waitlist
                        </button>
                        <button role="radio" aria-checked="false">
                          Defer
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        className="iconbtn"
                        style={{ width: "28px", height: "28px" }}
                        aria-label="Expand reviews for Bayview Youth Collective"
                      >
                        <ChevronDown className="ic" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className="rk">7</span>
                    </td>
                    <td>
                      <div className="ent">
                        <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                          Cedar Hollow Food Bank
                        </Link>
                        <span className="sub">
                          <span className="lvl lvl-2">L2</span>
                          <span className="muted">Healthy Pantry Expansion</span>
                        </span>
                      </div>
                    </td>
                    <td className="num">$60,000</td>
                    <td className="num b">3.6</td>
                    <td className="num">3.7</td>
                    <td className="num">0.4</td>
                    <td className="num">3</td>
                    <td className="num">
                      <input className="inp alloc" defaultValue="$60,000" aria-label="Allocation for Cedar Hollow Food Bank" />
                    </td>
                    <td>
                      <div className="seg" role="radiogroup" aria-label="Decision for Cedar Hollow Food Bank">
                        <button className="on" role="radio" aria-checked="true">
                          Approve
                        </button>
                        <button role="radio" aria-checked="false">
                          Decline
                        </button>
                        <button role="radio" aria-checked="false">
                          Waitlist
                        </button>
                        <button role="radio" aria-checked="false">
                          Defer
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        className="iconbtn"
                        style={{ width: "28px", height: "28px" }}
                        aria-label="Expand reviews for Cedar Hollow Food Bank"
                      >
                        <ChevronDown className="ic" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className="rk">8</span>
                    </td>
                    <td>
                      <div className="ent">
                        <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                          Copper Valley Clinic
                        </Link>
                        <span className="sub">
                          <span className="lvl lvl-1">L1</span>
                          <span className="muted">Rural Telehealth Expansion</span>
                        </span>
                      </div>
                    </td>
                    <td className="num">$120,000</td>
                    <td className="num b">3.1</td>
                    <td className="num">3.0</td>
                    <td className="num">0.7</td>
                    <td className="num">3</td>
                    <td className="num">
                      <input className="inp alloc" defaultValue="$0" aria-label="Allocation for Copper Valley Clinic" />
                    </td>
                    <td>
                      <div className="seg" role="radiogroup" aria-label="Decision for Copper Valley Clinic">
                        <button role="radio" aria-checked="false">
                          Approve
                        </button>
                        <button role="radio" aria-checked="false">
                          Decline
                        </button>
                        <button className="on" role="radio" aria-checked="true">
                          Waitlist
                        </button>
                        <button role="radio" aria-checked="false">
                          Defer
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        className="iconbtn"
                        style={{ width: "28px", height: "28px" }}
                        aria-label="Expand reviews for Copper Valley Clinic"
                      >
                        <ChevronDown className="ic" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className="rk">9</span>
                    </td>
                    <td>
                      <div className="ent">
                        <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                          Granite Peak Youth Sports
                        </Link>
                        <span className="sub">
                          <span className="lvl lvl-1">L1</span>
                          <span className="muted">Concussion Safety Clinics</span>
                        </span>
                      </div>
                    </td>
                    <td className="num">$35,000</td>
                    <td className="num b">2.8</td>
                    <td className="num">2.7</td>
                    <td className="num">0.5</td>
                    <td className="num">3</td>
                    <td className="num">
                      <input className="inp alloc" defaultValue="$0" aria-label="Allocation for Granite Peak Youth Sports" />
                    </td>
                    <td>
                      <div className="seg" role="radiogroup" aria-label="Decision for Granite Peak Youth Sports">
                        <button role="radio" aria-checked="false">
                          Approve
                        </button>
                        <button className="on" role="radio" aria-checked="true" style={{ background: "#FBE3E3", color: "#9B1C1C" }}>
                          Decline
                        </button>
                        <button role="radio" aria-checked="false">
                          Waitlist
                        </button>
                        <button role="radio" aria-checked="false">
                          Defer
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        className="iconbtn"
                        style={{ width: "28px", height: "28px" }}
                        aria-label="Expand reviews for Granite Peak Youth Sports"
                      >
                        <ChevronDown className="ic" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className="rk">10</span>
                    </td>
                    <td>
                      <div className="ent">
                        <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                          Pine Ridge Literacy Project
                        </Link>
                        <span className="sub">
                          <span className="lvl lvl-1">L1</span>
                          <span className="muted">Health Literacy Workshops</span>
                        </span>
                      </div>
                    </td>
                    <td className="num">$40,000</td>
                    <td className="num b">2.4</td>
                    <td className="num">2.3</td>
                    <td className="num">0.6</td>
                    <td className="num">3</td>
                    <td className="num">
                      <input className="inp alloc" defaultValue="$0" aria-label="Allocation for Pine Ridge Literacy Project" />
                    </td>
                    <td>
                      <div className="seg" role="radiogroup" aria-label="Decision for Pine Ridge Literacy Project">
                        <button role="radio" aria-checked="false">
                          Approve
                        </button>
                        <button className="on" role="radio" aria-checked="true" style={{ background: "#FBE3E3", color: "#9B1C1C" }}>
                          Decline
                        </button>
                        <button role="radio" aria-checked="false">
                          Waitlist
                        </button>
                        <button role="radio" aria-checked="false">
                          Defer
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        className="iconbtn"
                        style={{ width: "28px", height: "28px" }}
                        aria-label="Expand reviews for Pine Ridge Literacy Project"
                      >
                        <ChevronDown className="ic" aria-hidden="true" />
                      </button>
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
                  padding: "12px 16px",
                  borderTop: "1px solid #D6DEDE",
                  flexWrap: "wrap",
                }}
              >
                <span className="small muted">
                  10 of 10 decided · allocations typed here are pending until committed · Tab moves across allocation inputs, arrow keys
                  change the decision
                </span>
                <div className="row">
                  <button className="btn btn-secondary">Save as draft</button>
                  <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="btn btn-primary">
                    Commit decisions…
                  </Link>
                </div>
              </div>
            </div>
            <aside style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="card">
                <div className="card-h">
                  <h3>Decision summary</h3>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="row" style={{ gap: "6px" }}>
                      <span className="bdg bdg-ok">
                        <CircleCheck className="ic" aria-hidden="true" />
                        Approve
                      </span>
                    </span>
                    <span>
                      <b>7</b> · $720,000
                    </span>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="bdg bdg-neutral">
                      <Hourglass className="ic" aria-hidden="true" />
                      Waitlist
                    </span>
                    <span>
                      <b>1</b> · $120,000 if funded
                    </span>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="bdg bdg-dng">
                      <CircleX className="ic" aria-hidden="true" />
                      Decline
                    </span>
                    <span>
                      <b>2</b>
                    </span>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="bdg bdg-neutral">
                      <Clock className="ic" aria-hidden="true" />
                      Defer
                    </span>
                    <span>
                      <b>0</b>
                    </span>
                  </div>
                  <div className="divider"></div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="muted">Remaining after commit</span>
                    <span className="b">$480,000</span>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Discussion notes</h3>
                  <span className="int-mark">
                    <Lock className="ic" aria-hidden="true" />
                    Internal
                  </span>
                </div>
                <div className="card-b th">
                  <div className="msg msg-int">
                    <span className="av av-sm">DO</span>
                    <div className="bub">
                      <div className="hd">
                        <span className="who">Dana Ortiz</span>
                        <span>10:14 AM</span>
                      </div>
                      <div className="bd">
                        Northgate spread is Marcus recused → Hollis scored 5, Priya 3 on feasibility. Discuss before we lock at $150k.
                      </div>
                    </div>
                  </div>
                  <div className="msg msg-int">
                    <span className="av av-sm">ML</span>
                    <div className="bub">
                      <div className="hd">
                        <span className="who">Marcus Lee</span>
                        <span>10:21 AM</span>
                      </div>
                      <div className="bd">
                        Finance is fine with $720k committed this round; it leaves $480k for the fall cycle as planned.
                      </div>
                    </div>
                  </div>
                  <div className="composer">
                    <textarea
                      className="ta"
                      style={{ minHeight: "40px" }}
                      aria-label="Add an internal note"
                      placeholder="Add an internal note…"
                    />
                    <button className="btn btn-sm btn-primary">Post</button>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Letter preview</h3>
                </div>
                <div className="tabs" style={{ padding: "0 12px" }}>
                  <button className="tab on" role="tab" aria-selected="true">
                    Approve
                  </button>
                  <button className="tab" role="tab">
                    Decline
                  </button>
                  <button className="tab" role="tab">
                    Waitlist
                  </button>
                </div>
                <div className="card-b" style={{ fontSize: "13px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div className="small muted">Award letter v4 · merge fields resolved per applicant</div>
                  <p>Dear Maria Santos,</p>
                  <p>
                    On behalf of Riverbend Community Foundation, I am pleased to inform you that <b>Alder Creek Family Services</b> has been
                    awarded <b>$150,000</b> under Community Health Grants 2027 for <i>Mobile Health Navigation for Rural Families</i>…
                  </p>
                  <Link to="/w/riverbend/communications" className="b">
                    Edit template →
                  </Link>
                </div>
              </div>
            </aside>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
            <span className="eyebrow">States</span>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, .8fr)",
                gap: "16px",
                alignItems: "start",
              }}
            >
              <div className="mdl" style={{ width: "auto", boxShadow: "none", border: "1px solid #D6DEDE" }}>
                <div className="hd">
                  <div>
                    <h3 style={{ fontSize: "16px" }}>Commit 10 decisions?</h3>
                    <p className="small muted" style={{ marginTop: "4px" }}>
                      Decisions are final once committed. Letters are queued, not sent, until Communications confirms the batch.
                    </p>
                  </div>
                </div>
                <div className="bd" style={{ fontSize: "13px", gap: "8px" }}>
                  <div className="row" style={{ gap: "8px" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />7 awards created (Offered)
                  </div>
                  <div className="row" style={{ gap: "8px" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />
                    10 letters queued (7 award, 2 decline, 1 waitlist)
                  </div>
                  <div className="row" style={{ gap: "8px" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />7 agreements generated from “Standard grant
                    agreement v2”
                  </div>
                  <div className="row" style={{ gap: "8px" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />
                    Community Health 2027 committed → $720,000 of $1,200,000
                  </div>
                  <div className="row" style={{ gap: "8px" }}>
                    <Info className="ic" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                    Logged in the audit ledger · mirrored to Passport
                  </div>
                </div>
                <div className="ft">
                  <button className="btn btn-secondary">Cancel</button>
                  <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="btn btn-primary">
                    Commit decisions
                  </Link>
                </div>
              </div>
              <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="row" style={{ gap: "8px" }}>
                  <span className="bdg bdg-dng">
                    <TriangleExclamationPoint className="ic" aria-hidden="true" />
                    Over-allocated
                  </span>
                </div>
                <div className="mtr mtr-over">
                  <div className="lbls">
                    <span>
                      Available <b>$1,200,000</b>
                    </span>
                    <span>
                      Allocated <b>$1,260,000</b> · 105%
                    </span>
                  </div>
                  <div className="track">
                    <div className="fill" style={{ width: "100%" }}></div>
                  </div>
                  <div className="over-msg">
                    <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                    Over by $60,000 — reduce an allocation or waitlist one application
                  </div>
                </div>
                <button className="btn btn-primary" disabled aria-disabled="true">
                  Commit decisions — over by $60,000
                </button>
                <div className="small muted">
                  Partially decided variant: 8 of 10 decided · Commit disabled with “2 applications have no decision”.
                </div>
              </div>
              <div
                className="card"
                style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px", background: "#F7FAFA" }}
              >
                <span className="bdg bdg-done">
                  <Lock className="ic" aria-hidden="true" />
                  Committed · locked
                </span>
                <p className="small muted">
                  Committed May 18, 2027 2:36 PM by Dana Ortiz. Allocations and decisions are read-only; changes go through an amendment.
                </p>
                <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="b small">
                  View 7 awards →
                </Link>
              </div>
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
