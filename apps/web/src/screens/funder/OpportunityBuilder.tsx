// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  CircleDashed,
  Clock,
  Eye,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Shield,
  TriangleExclamationPoint,
  X,
} from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function OpportunityBuilder() {
  return (
    <>
      <title>{"Opportunity builder — Who can apply"}</title>
      <FunderShell active="Opportunities">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <Link to="/w/riverbend/programs/community-health-2027">Community Health 2027</Link>
            <span>›</span>
            <span>Community Health Grants 2027</span>
            <span>›</span>
            <span>Edit</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Opportunity builder</h1>
                <span className="bdg bdg-neutral">
                  <Pencil className="ic" aria-hidden="true" />
                  Draft
                </span>
                <span className="pill-warn">
                  <Clock className="ic ic-sm" aria-hidden="true" />
                  Unpublished changes
                </span>
              </div>
              <div className="meta">
                <span>Community Health Grants 2027</span>
                <span>·</span>
                <span>Program: Community Health 2027</span>
                <span>·</span>
                <span className="row" style={{ gap: "5px" }}>
                  <Check className="ic ic-sm" aria-hidden="true" style={{ color: "#0B5E47" }} />
                  Saved 8 s ago
                </span>
              </div>
            </div>
            <div className="actions">
              <Link to="/f/riverbend/o/community-health-2027" className="btn btn-secondary">
                <Eye className="ic" aria-hidden="true" />
                Preview public page
              </Link>
              <button className="btn btn-secondary">Save draft</button>
              <Link to="/w/riverbend/forms/loi-v2/edit" className="btn btn-primary">
                Continue to forms
                <ArrowRight className="ic" aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr) 360px", gap: "20px", alignItems: "start" }}>
            <aside className="card" style={{ padding: "18px 16px" }}>
              <div className="eyebrow" style={{ marginBottom: "14px" }}>
                Steps
              </div>
              <div className="stp-v" aria-label="Builder steps">
                <a href="#basics" className="s done" style={{ textDecoration: "none" }}>
                  <span className="n">
                    <Check className="ic ic-sm" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="t">Basics</div>
                    <div className="d">Title, summary, program</div>
                  </div>
                </a>
                <a href="#funding" className="s done" style={{ textDecoration: "none" }}>
                  <span className="n">
                    <Check className="ic ic-sm" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="t">Funding</div>
                    <div className="d">$50,000–$150,000 · 8–12 awards</div>
                  </div>
                </a>
                <a href="#dates" className="s done" style={{ textDecoration: "none" }}>
                  <span className="n">
                    <Check className="ic ic-sm" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="t">Dates</div>
                    <div className="d">Opens Jan 15 · decision Jun 15</div>
                  </div>
                </a>
                <a href="#who" className="s on" style={{ textDecoration: "none" }} aria-current="step">
                  <span className="n">4</span>
                  <div>
                    <div className="t">Who can apply</div>
                    <div className="d">Applicant types and rules</div>
                  </div>
                </a>
                <Link to="/w/riverbend/competitions/community-health-2027" className="s" style={{ textDecoration: "none" }}>
                  <span className="n">5</span>
                  <div>
                    <div className="t">Competition & stages</div>
                    <div className="d">LOI → Full → Interview</div>
                  </div>
                </Link>
                <a href="#publish" className="s" style={{ textDecoration: "none" }}>
                  <span className="n">6</span>
                  <div>
                    <div className="t">Publish</div>
                    <div className="d">Targets and launch checklist</div>
                  </div>
                </a>
              </div>
            </aside>
            <section className="card" id="who" style={{ minWidth: "0" }}>
              <div className="card-h">
                <div>
                  <h2 style={{ fontSize: "18px" }}>Who can apply</h2>
                  <p className="small muted">
                    Applicant types come from the CommonGrants list. Rules are evaluated against each organization’s Passport record and
                    shown to applicants in plain language.
                  </p>
                </div>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
                <div className="fld">
                  <span className="lbl">
                    Applicant types
                    <span className="muted" style={{ fontWeight: 400 }}>
                      · multiselect
                    </span>
                  </span>
                  <div className="row wrap" style={{ gap: "8px" }} role="group" aria-label="Applicant types">
                    <button className="fchip on" aria-pressed="true">
                      <Check className="ic ic-sm" aria-hidden="true" />
                      Nonprofit 501(c)(3)
                    </button>
                    <button className="fchip on" aria-pressed="true">
                      <Check className="ic ic-sm" aria-hidden="true" />
                      Tribal government
                    </button>
                    <button className="fchip on" aria-pressed="true">
                      <Check className="ic ic-sm" aria-hidden="true" />
                      Local government
                    </button>
                    <button className="fchip" aria-pressed="false">
                      Small business
                    </button>
                    <button className="fchip" aria-pressed="false">
                      Individual
                    </button>
                    <button className="fchip" aria-pressed="false">
                      School district
                    </button>
                    <button className="fchip" aria-pressed="false">
                      Higher education
                    </button>
                  </div>
                  <span className="help">
                    Maps to CommonGrants <span className="mono">applicantTypes</span>. Organizations of other types see “Not eligible:
                    applicant type” on the public page.
                  </span>
                </div>
                <div className="fld">
                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                    <span className="lbl">Eligibility rules</span>
                    <div className="seg" role="group" aria-label="Rule grouping">
                      <button className="on">All of these</button>
                      <button>Any of these</button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div
                      style={{
                        border: "1px solid #D6DEDE",
                        borderRadius: "8px",
                        padding: "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        background: "#fff",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) 32px",
                          gap: "8px",
                          alignItems: "center",
                        }}
                      >
                        <select className="sel" aria-label="Source field, rule 1">
                          <option>Passport · organization.annualBudget</option>
                        </select>
                        <select className="sel" aria-label="Operator, rule 1">
                          <option>is under</option>
                        </select>
                        <input className="inp" aria-label="Value, rule 1" defaultValue="$5,000,000" />
                        <button className="iconbtn" style={{ width: "32px", height: "32px" }} aria-label="Remove rule 1">
                          <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3 6h18" />
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                      <div className="row small" style={{ gap: "6px", color: "#145450" }}>
                        <MessageSquare className="ic ic-sm" aria-hidden="true" />
                        <span>
                          Applicants read:{" "}
                          <span className="b" style={{ color: "#1E2D2B" }}>
                            “Your organization’s annual budget is under $5,000,000.”
                          </span>
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        border: "1px solid #D6DEDE",
                        borderRadius: "8px",
                        padding: "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        background: "#fff",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) 32px",
                          gap: "8px",
                          alignItems: "center",
                        }}
                      >
                        <select className="sel" aria-label="Source field, rule 2">
                          <option>Passport · organization.serviceArea</option>
                        </select>
                        <select className="sel" aria-label="Operator, rule 2">
                          <option>includes</option>
                        </select>
                        <input className="inp" aria-label="Value, rule 2" defaultValue="Riverbend County" />
                        <button className="iconbtn" style={{ width: "32px", height: "32px" }} aria-label="Remove rule 2">
                          <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3 6h18" />
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                      <div className="row small" style={{ gap: "6px", color: "#145450" }}>
                        <MessageSquare className="ic ic-sm" aria-hidden="true" />
                        <span>
                          Applicants read:{" "}
                          <span className="b" style={{ color: "#1E2D2B" }}>
                            “Your service area includes Riverbend County.”
                          </span>
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        border: "1px solid #D6DEDE",
                        borderRadius: "8px",
                        padding: "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        background: "#fff",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) 32px",
                          gap: "8px",
                          alignItems: "center",
                        }}
                      >
                        <select className="sel" aria-label="Source field, rule 3">
                          <option>Passport · organization.taxStatus</option>
                        </select>
                        <select className="sel" aria-label="Operator, rule 3">
                          <option>is</option>
                        </select>
                        <select className="sel" aria-label="Value, rule 3">
                          <option>501(c)(3), in good standing</option>
                        </select>
                        <button className="iconbtn" style={{ width: "32px", height: "32px" }} aria-label="Remove rule 3">
                          <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3 6h18" />
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                      <div className="row small" style={{ gap: "6px", color: "#145450" }}>
                        <MessageSquare className="ic ic-sm" aria-hidden="true" />
                        <span>
                          Applicants read:{" "}
                          <span className="b" style={{ color: "#1E2D2B" }}>
                            “Your tax status is 501(c)(3) in good standing.”
                          </span>
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        border: "1px solid #D6DEDE",
                        borderRadius: "8px",
                        padding: "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        background: "#fff",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) 32px",
                          gap: "8px",
                          alignItems: "center",
                        }}
                      >
                        <select className="sel" aria-label="Source field, rule 4">
                          <option>GMS · awards.active (this funder)</option>
                        </select>
                        <select className="sel" aria-label="Operator, rule 4">
                          <option>has none in program</option>
                        </select>
                        <select className="sel" aria-label="Value, rule 4">
                          <option>Community Health</option>
                        </select>
                        <button className="iconbtn" style={{ width: "32px", height: "32px" }} aria-label="Remove rule 4">
                          <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3 6h18" />
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                      <div className="row small" style={{ gap: "6px", color: "#145450" }}>
                        <MessageSquare className="ic ic-sm" aria-hidden="true" />
                        <span>
                          Applicants read:{" "}
                          <span className="b" style={{ color: "#1E2D2B" }}>
                            “You have no active award in Riverbend’s Community Health program.”
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: "12px" }}>
                    <button className="btn btn-sm btn-secondary">
                      <Plus className="ic" aria-hidden="true" />
                      Add rule
                    </button>
                    <button className="btn btn-sm btn-ghost">Add rule group</button>
                    <span className="help" style={{ marginLeft: "auto" }}>
                      Unknown values never pass: a missing field shows Unknown and the applicant is told what to add in Passport.
                    </span>
                  </div>
                </div>
              </div>
              <div className="card-f" style={{ justifyContent: "space-between" }}>
                <a href="#dates" className="btn btn-ghost">
                  <ArrowLeft className="ic" aria-hidden="true" />
                  Dates
                </a>
                <div className="row" style={{ gap: "8px" }}>
                  <button className="btn btn-secondary">Save draft</button>
                  <Link to="/w/riverbend/forms/loi-v2/edit" className="btn btn-primary">
                    Continue to forms
                    <ArrowRight className="ic" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </section>
            <aside style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: "0" }}>
              <div className="card">
                <div className="card-h" style={{ padding: "12px 16px" }}>
                  <h3 style={{ fontSize: "14px" }}>Live preview · public card on /f/riverbend</h3>
                </div>
                <div className="card-b" style={{ padding: "16px", background: "#F7FAFA", borderRadius: "0 0 12px 12px" }}>
                  <div className="pub" style={{ fontSize: "15px", "--tenant": "#1F6F8B", "--on-tenant": "#FFFFFF" } as CSSProperties}>
                    <div className="oc" style={{ padding: "18px", gap: "8px" }}>
                      <span className="eyebrow">Open · closes in 10 days</span>
                      <h3 style={{ fontSize: "16px" }}>Community Health Grants 2027</h3>
                      <div className="amt" style={{ fontSize: "17px" }}>
                        $50,000 – $150,000
                      </div>
                      <div className="meta" style={{ fontSize: "13px" }}>
                        <span>8–12 awards</span>
                        <span>Nonprofits, tribal & local governments</span>
                        <span>Decision Jun 15</span>
                      </div>
                      <Link
                        to="/f/riverbend/o/community-health-2027"
                        className="btn btn-tenant btn-sm"
                        style={{ alignSelf: "flex-start", marginTop: "4px" }}
                      >
                        Apply with Passport
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
              <div className="card drawer" style={{ borderLeft: "1px solid #D6DEDE" }}>
                <div className="hd" style={{ padding: "12px 16px" }}>
                  <h3 style={{ fontSize: "14px" }}>Test against an org</h3>
                  <button className="iconbtn" style={{ width: "28px", height: "28px" }} aria-label="Close drawer">
                    <X className="ic" aria-hidden="true" />
                  </button>
                </div>
                <div className="bd" style={{ padding: "16px", gap: "14px" }}>
                  <div className="inp-icon">
                    <Search className="ic" aria-hidden="true" />
                    <input className="inp" aria-label="Search organizations in Passport" defaultValue="Alder Creek Family Services" />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="b" style={{ color: "#0D2A43" }}>
                        Alder Creek Family Services{" "}
                        <span className="lvl lvl-3">
                          <Shield className="ic" aria-hidden="true" />
                          L3
                        </span>
                      </span>
                      <span className="bdg bdg-ok">
                        <CircleCheck className="ic" aria-hidden="true" />
                        Eligible
                      </span>
                    </div>
                    <div className="rc" style={{ fontSize: "13px" }}>
                      <div className="rc-row rc-pass">
                        <CircleCheck className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">Annual budget under $5,000,000</div>
                          <div className="r">$2,400,000 (FY2026)</div>
                        </div>
                        <span></span>
                      </div>
                      <div className="rc-row rc-pass">
                        <CircleCheck className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">Service area includes Riverbend County</div>
                          <div className="r">Riverbend, Alder, Copper counties</div>
                        </div>
                        <span></span>
                      </div>
                      <div className="rc-row rc-pass">
                        <CircleCheck className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">501(c)(3) in good standing</div>
                          <div className="r">Verified by Passport Mar 2027</div>
                        </div>
                        <span></span>
                      </div>
                      <div className="rc-row rc-pass">
                        <CircleCheck className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">No active Community Health award</div>
                          <div className="r">Last award closed Jun 2026</div>
                        </div>
                        <span></span>
                      </div>
                    </div>
                  </div>
                  <div className="divider"></div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="b" style={{ color: "#0D2A43" }}>
                        Copper Valley Clinic <span className="lvl lvl-1">L1</span>
                      </span>
                      <span className="bdg bdg-neutral">
                        <CircleDashed className="ic" aria-hidden="true" />
                        Unknown
                      </span>
                    </div>
                    <div className="rc" style={{ fontSize: "13px" }}>
                      <div className="rc-row rc-unk">
                        <CircleDashed className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">Annual budget under $5,000,000</div>
                          <div className="r">No budget on the Passport record (L1 orgs haven’t verified documents)</div>
                        </div>
                        <span className="fix">3 pass</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "20px",
              marginTop: "8px",
              alignItems: "start",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · validation error</span>
              <div
                style={{
                  border: "1px solid #C53030",
                  borderRadius: "8px",
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  background: "#fff",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr)",
                    gap: "8px",
                    alignItems: "center",
                  }}
                >
                  <select className="sel" aria-label="Source field, new rule">
                    <option>Passport · organization.foundedYear</option>
                  </select>
                  <select className="sel" aria-label="Operator, new rule">
                    <option>is before</option>
                  </select>
                  <input className="inp err" aria-label="Value, new rule" placeholder="Year" defaultValue="" />
                </div>
                <span className="err-msg">
                  <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                  Enter a value or remove this rule. Rules with no value can’t be published.
                </span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · unpublished changes</span>
              <div className="bnr bnr-warn">
                <Clock className="ic" aria-hidden="true" />
                <div className="grow">
                  <div className="t">3 unpublished changes</div>
                  <div className="d">Applicant types, rule 4 and the decision date differ from the published version (Mar 2).</div>
                  <div className="clears">
                    Review diff ·<a href="#publish">Publish</a>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }} id="publish">
              <span className="eyebrow">State · published</span>
              <div className="bnr bnr-ok">
                <CircleCheck className="ic" aria-hidden="true" />
                <div className="grow">
                  <div className="t">
                    Published · live at{" "}
                    <Link to="/f/riverbend/o/community-health-2027" className="mono" style={{ color: "#0B5E47" }}>
                      gms.opengrants.io/f/riverbend/o/community-health-2027
                    </Link>
                  </div>
                  <div className="d">Publish targets: public page · OpenGrants index · sitemap. CommonGrants JSON valid.</div>
                  <div className="clears">
                    <Link to="/f/riverbend/o/community-health-2027">Open public page</Link>·
                    <Link to="/w/riverbend/competitions/community-health-2027">Competition</Link>
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
