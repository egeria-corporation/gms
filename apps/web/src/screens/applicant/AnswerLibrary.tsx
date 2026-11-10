// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { BookOpen, Bot, Ellipsis, Pencil, Plus, Sparkles } from "lucide-react";
import { ApplicantShell } from "../../components/shells.tsx";

export default function AnswerLibrary() {
  return (
    <>
      <title>{"Answer library — Alder Creek Family Services"}</title>
      <ApplicantShell active="Answer library">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/alder-creek">Dashboard</Link>
            <span>›</span>
            <span>Answer library</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Answer library</h1>
              </div>
              <div className="meta">
                <span>5 answers</span>
                <span>·</span>
                <span>Reused in 20 applications</span>
                <span>·</span>
                <span>Each answer keeps its own version history</span>
              </div>
            </div>
            <div className="actions">
              <button className="btn btn-primary">
                <Plus className="ic" aria-hidden="true" />
                New answer
              </button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1.4fr)", gap: "20px", alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="tbl-wrap">
                <table className="tbl" style={{ fontSize: "15px" }}>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Key</th>
                      <th className="num">Words</th>
                      <th className="num">Used in</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="b">
                        <a href="#editor">Mission</a>
                      </td>
                      <td className="mono">mission</td>
                      <td className="num">118</td>
                      <td className="num">6 applications</td>
                      <td>Mar 3, 2027</td>
                    </tr>
                    <tr className="sel">
                      <td className="b">
                        <a href="#editor">Need</a>
                      </td>
                      <td className="mono">need</td>
                      <td className="num">412</td>
                      <td className="num">3 applications</td>
                      <td>Apr 15, 2027</td>
                    </tr>
                    <tr>
                      <td className="b">
                        <a href="#editor">Programs</a>
                      </td>
                      <td className="mono">programs</td>
                      <td className="num">260</td>
                      <td className="num">5 applications</td>
                      <td>Feb 11, 2027</td>
                    </tr>
                    <tr>
                      <td className="b">
                        <a href="#editor">Capacity</a>
                      </td>
                      <td className="mono">capacity</td>
                      <td className="num">190</td>
                      <td className="num">4 applications</td>
                      <td>Jan 28, 2027</td>
                    </tr>
                    <tr>
                      <td className="b">
                        <a href="#editor">Outcomes</a>
                      </td>
                      <td className="mono">outcomes</td>
                      <td className="num">230</td>
                      <td className="num">2 applications</td>
                      <td>Dec 9, 2026</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>How “Insert” appears in the editor</h3>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "15px" }}>
                  <p className="muted">
                    Every long-text field in an application or report shows{" "}
                    <span className="btn btn-sm btn-secondary" style={{ pointerEvents: "none", verticalAlign: "middle" }}>
                      <BookOpen className="ic" aria-hidden="true" />
                      Insert from answer library
                    </span>{" "}
                    beside its label. Inserting pastes the current version and marks the field{" "}
                    <span className="prov prov-library">
                      <BookOpen className="ic" aria-hidden="true" />
                      From library · “Need”
                    </span>
                    . Later edits in the application never change the library; use “Save back to library” to make them a new version.
                  </p>
                  <Link to="/w/alder-creek/applications/app_01HZX4/edit" className="small b">
                    See it in the application editor →
                  </Link>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span className="eyebrow">State · empty library</span>
                <div className="card empty">
                  <BookOpen className="ic" aria-hidden="true" />
                  <h3>No answers yet</h3>
                  <p>Start with the five answers almost every funder asks for; you can rename or delete any of them.</p>
                  <div className="row wrap" style={{ justifyContent: "center", gap: "6px" }}>
                    <span className="chip">Mission</span>
                    <span className="chip">Need</span>
                    <span className="chip">Programs</span>
                    <span className="chip">Capacity</span>
                    <span className="chip">Outcomes</span>
                  </div>
                  <div className="acts">
                    <button className="btn btn-primary">Create starter set</button>
                    <a href="#editor" className="small b">
                      Write one from scratch
                    </a>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="card" id="editor">
                <div className="card-h">
                  <div>
                    <h2 style={{ fontSize: "18px" }}>Need</h2>
                    <p className="small muted">Version 4 · edited by Jamal Reed · Apr 15, 2027</p>
                  </div>
                  <div className="row" style={{ gap: "8px" }}>
                    <button className="btn btn-sm btn-secondary">Save as new version</button>
                    <button className="btn btn-sm btn-ghost" aria-label="More actions">
                      <Ellipsis className="ic" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div className="fld-row">
                    <div className="fld">
                      <label className="lbl" htmlFor="a-title">
                        Title
                      </label>
                      <input className="inp" id="a-title" defaultValue="Need" />
                    </div>
                    <div className="fld">
                      <label className="lbl" htmlFor="a-key">
                        Key
                      </label>
                      <input className="inp mono" id="a-key" defaultValue="need" style={{ fontSize: "14px" }} />
                      <span className="help">
                        Used by agents and the API: <span className="mono">library.need</span>
                      </span>
                    </div>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="a-text">
                      Answer
                    </label>
                    <textarea
                      className="ta"
                      id="a-text"
                      style={{ minHeight: "200px", fontSize: "16px" }}
                      defaultValue={"Families in the Alder Creek valley travel an average of 46 miles to reach a primary care provider, and one in four households has no reliable vehicle. Over the last three years our intake data shows that missed appointments, not lack of coverage, is the leading reason children in our programs fall behind on well-child visits and immunizations.\n\nMobile Health Navigation pairs a community health navigator with a scheduled van route across the six unincorporated communities we serve. Navigators schedule visits, arrange rides, and follow up on referrals so that a family's first contact with the clinic is not an emergency room visit. The 2026 county health assessment ranks transportation access as the top barrier to care for rural families, and our pilot with 38 families cut missed appointments by 41 percent."}
                    />
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="help">Plain text. Funders' word limits are applied when you insert.</span>
                      <span className="counter">412 words</span>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px" }}>
                    <div>
                      <div className="eyebrow">Version history</div>
                      <div className="tl tl-sm" style={{ marginTop: "10px" }}>
                        <div className="tl-i tl-person">
                          <span className="dot">
                            <Pencil className="ic" aria-hidden="true" />
                          </span>
                          <div>
                            <div className="what">v4 · current</div>
                            <div className="who">Jamal Reed · Apr 15, 2027 · added pilot result</div>
                          </div>
                        </div>
                        <div className="tl-i tl-person">
                          <span className="dot">
                            <Pencil className="ic" aria-hidden="true" />
                          </span>
                          <div>
                            <div className="what">v3</div>
                            <div className="who">
                              Maria Santos · Feb 20, 2027 ·<a href="#editor">Restore</a>
                            </div>
                          </div>
                        </div>
                        <div className="tl-i tl-person">
                          <span className="dot">
                            <Pencil className="ic" aria-hidden="true" />
                          </span>
                          <div>
                            <div className="what">v2</div>
                            <div className="who">
                              Maria Santos · Nov 4, 2026 ·<a href="#editor">Restore</a>
                            </div>
                          </div>
                        </div>
                        <div className="tl-i tl-person">
                          <span className="dot">
                            <Plus className="ic" aria-hidden="true" />
                          </span>
                          <div>
                            <div className="what">v1 · created</div>
                            <div className="who">Maria Santos · Sep 12, 2026</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="eyebrow">Where it is used</div>
                      <ul style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px", fontSize: "14px" }}>
                        <li className="row" style={{ gap: "8px" }}>
                          <span className="chip">
                            <span className="tdot" aria-hidden="true"></span>Riverbend
                          </span>
                          <Link to="/w/alder-creek/applications/app_01HZX4/edit">Mobile Health Navigation · Full proposal</Link>
                          <span className="muted small">v4</span>
                        </li>
                        <li className="row" style={{ gap: "8px" }}>
                          <span className="chip" style={{ "--tenant": "#7A4F01" } as CSSProperties}>
                            <span className="tdot" aria-hidden="true"></span>Cascade County
                          </span>
                          <Link to="/w/alder-creek/applications/app_01HZX4/edit">Rural Immunization Outreach 2027</Link>
                          <span className="muted small">v3</span>
                        </li>
                        <li className="row" style={{ gap: "8px" }}>
                          <span className="chip" style={{ "--tenant": "#4A5C5A" } as CSSProperties}>
                            <span className="tdot" aria-hidden="true"></span>Northwind
                          </span>
                          <Link to="/w/alder-creek/applications/app_01HZX4/edit">Family Resource Hub</Link>
                          <span className="muted small">v2</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
              <div className="drawer" style={{ border: "1px solid #D6DEDE", borderRadius: "12px", borderLeft: "1px solid #D6DEDE" }}>
                <div className="hd">
                  <div className="row" style={{ gap: "8px" }}>
                    <Sparkles className="ic" aria-hidden="true" style={{ color: "#4B2E9E" }} />
                    <h3>Adapt “Need” to a question</h3>
                    <span className="draft-mark">Draft — review before use</span>
                  </div>
                  <span className="quota">14 of 40 this month</span>
                </div>
                <div className="bd">
                  <div className="kv" style={{ fontSize: "14px" }}>
                    <dt>Target question</dt>
                    <dd className="b">What need does this project address? — Riverbend · Community Health Grants 2027</dd>
                    <dt>Limits</dt>
                    <dd>500 words · must cite a source · reviewers see it</dd>
                    <dt>Source</dt>
                    <dd>Need v4 (412 words)</dd>
                  </div>
                  <div className="row" style={{ gap: "10px" }}>
                    <button className="btn btn-primary">
                      <Sparkles className="ic" aria-hidden="true" />
                      Adapt
                    </button>
                    <span className="help">Nothing is written into the application until you insert it.</span>
                  </div>
                  <div
                    style={{
                      border: "1px dashed #CDBFF0",
                      borderRadius: "8px",
                      padding: "14px 16px",
                      background: "#FBFAFE",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      fontSize: "15px",
                    }}
                  >
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="attrib">
                        <Bot className="ic" aria-hidden="true" />
                        Draft by<span className="ag">GMS Assistant</span>· 486 words
                      </span>
                      <span className="counter">486 / 500</span>
                    </div>
                    <p>
                      Riverbend County's 2026 Community Health Assessment names transportation as the single largest barrier to care for
                      rural families. In the Alder Creek valley the average trip to a primary care provider is 46 miles, and one in four
                      households has no reliable vehicle…
                    </p>
                    <p className="muted small">
                      Changes from v4: adds the assessment citation the rubric asks for, trims the pilot paragraph to stay under 500 words.
                    </p>
                    <div className="row" style={{ gap: "10px" }}>
                      <Link to="/w/alder-creek/applications/app_01HZX4/edit" className="btn btn-sm btn-primary">
                        Insert into application
                      </Link>
                      <button className="btn btn-sm btn-secondary">Discard</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </ApplicantShell>
    </>
  );
}
