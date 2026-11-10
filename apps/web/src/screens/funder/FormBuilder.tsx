// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import {
  BadgeCheck,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  DollarSign,
  Eye,
  File,
  Grid3x3,
  GripVertical,
  Hash,
  Info,
  List,
  Mail,
  MapPin,
  PenLine,
  Pencil,
  Phone,
  Plus,
  Rows3,
  Search,
  TextAlignJustify,
  TextAlignStart,
  ToggleRight,
  TriangleExclamationPoint,
  Type,
  Zap,
} from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function FormBuilder() {
  return (
    <>
      <title>{"Form builder — LOI form v2"}</title>
      <FunderShell active="Opportunities">
        <main className="main" style={{ gap: "16px" }}>
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <Link to="/w/riverbend/programs/community-health-2027">Community Health 2027</Link>
            <span>›</span>
            <Link to="/w/riverbend/competitions/community-health-2027">Community Health Grants 2027</Link>
            <span>›</span>
            <span>Forms</span>
            <span>›</span>
            <span>LOI form v2</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>
                  LOI form{" "}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    · v2 (draft)
                  </span>
                </h1>
                <span className="bdg bdg-neutral">
                  <Pencil className="ic" aria-hidden="true" />
                  Draft
                </span>
              </div>
              <div className="meta">
                <span>2 sections · 7 fields · 2 Passport prefills · 1 budget table</span>
                <span>·</span>
                <span className="row" style={{ gap: "5px" }}>
                  <Check className="ic ic-sm" aria-hidden="true" style={{ color: "#0B5E47" }} />
                  Autosaved 4 s ago
                </span>
              </div>
            </div>
            <div className="actions">
              <Link to="/w/alder-creek/applications/app_01HZX4/edit" className="btn btn-secondary">
                <Eye className="ic" aria-hidden="true" />
                Preview as applicant
              </Link>
              <button className="btn btn-secondary">
                <Zap className="ic" aria-hidden="true" />
                Test-fill
              </button>
              <button className="btn btn-secondary">
                <Clock className="ic" aria-hidden="true" />
                Version history
              </button>
              <button className="btn btn-secondary">Save draft</button>
              <Link to="/w/riverbend/competitions/community-health-2027" className="btn btn-primary">
                Publish v2
              </Link>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div className="bnr bnr-info">
              <Info className="ic" aria-hidden="true" />
              <div className="grow">
                <div className="t">You are editing a draft of v2</div>
                <div className="d">
                  v1 stays pinned to Community Health Grants 2027 until you publish. Publishing v2 does not change forms already submitted.
                </div>
              </div>
              <Link to="/w/riverbend/competitions/community-health-2027" className="small b act" style={{ color: "#173F73" }}>
                See where v1 is pinned
              </Link>
            </div>
            <div className="bnr bnr-warn">
              <TriangleExclamationPoint className="ic" aria-hidden="true" />
              <div className="grow">
                <div className="t">A competition using v1 is open</div>
                <div className="d">
                  36 Full-proposal applications were started on v1. Responses already submitted keep v1; drafts not yet submitted will be
                  asked to migrate the 2 changed fields.
                </div>
                <div className="clears">Migration preview: 2 fields renamed, 1 added (Budget table), 0 removed</div>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr) 360px", gap: "20px", alignItems: "start" }}>
            <aside className="card" style={{ padding: "14px 12px" }}>
              <div className="eyebrow" style={{ padding: "0 4px 10px" }}>
                Field palette · drag onto the canvas
              </div>
              <ul className="pal" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <li>
                  <Type className="ic" aria-hidden="true" />
                  Short text
                </li>
                <li>
                  <TextAlignStart className="ic" aria-hidden="true" />
                  Long text{" "}
                  <span className="muted xs" style={{ fontWeight: 400 }}>
                    (word limit)
                  </span>
                </li>
                <li>
                  <Hash className="ic" aria-hidden="true" />
                  Number
                </li>
                <li>
                  <DollarSign className="ic" aria-hidden="true" />
                  Money
                </li>
                <li>
                  <Calendar className="ic" aria-hidden="true" />
                  Date
                </li>
                <li>
                  <ChevronDown className="ic" aria-hidden="true" />
                  Select
                </li>
                <li>
                  <List className="ic" aria-hidden="true" />
                  Multi-select
                </li>
                <li>
                  <ToggleRight className="ic" aria-hidden="true" />
                  Yes / No
                </li>
                <li>
                  <File className="ic" aria-hidden="true" />
                  File
                </li>
                <li>
                  <MapPin className="ic" aria-hidden="true" />
                  Address
                </li>
                <li>
                  <Phone className="ic" aria-hidden="true" />
                  Phone
                </li>
                <li>
                  <Mail className="ic" aria-hidden="true" />
                  Email
                </li>
                <li>
                  <Rows3 className="ic" aria-hidden="true" />
                  Repeating group
                </li>
                <li>
                  <Grid3x3 className="ic" aria-hidden="true" />
                  Budget table
                </li>
                <li>
                  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 4h12" />
                    <path d="M12 4v16" />
                    <path d="M8 20h8" />
                  </svg>
                  Rich text
                </li>
                <li>
                  <PenLine className="ic" aria-hidden="true" />
                  Signature
                </li>
                <li>
                  <TextAlignJustify className="ic" aria-hidden="true" />
                  Section
                </li>
                <li style={{ borderColor: "#C2F0ED", background: "#E1F8F6", color: "#145450" }}>
                  <BadgeCheck className="ic" aria-hidden="true" style={{ color: "#145450" }} />
                  Passport field
                </li>
              </ul>
            </aside>
            <section style={{ display: "flex", flexDirection: "column", gap: "14px", minWidth: "0" }} aria-label="Form canvas">
              <div className="card">
                <div className="card-h" style={{ padding: "12px 16px" }}>
                  <div className="row" style={{ gap: "10px" }}>
                    <GripVertical className="ic" aria-hidden="true" style={{ color: "#9BAAA9" }} />
                    <h3>Section 1 · Organization</h3>
                  </div>
                  <span className="small muted">3 fields · 2 prefilled</span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "14px 16px" }}>
                  <div className="fld-c">
                    <GripVertical className="ic grip" aria-hidden="true" />
                    <div className="grow">
                      <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                        <span className="b" style={{ color: "#0D2A43" }}>
                          Legal name
                        </span>
                        <span className="req" aria-hidden="true">
                          *
                        </span>
                        <span className="prov prov-passport">
                          <BadgeCheck className="ic" aria-hidden="true" />
                          From Passport · organization.legalName
                        </span>
                      </div>
                      <input
                        className="inp"
                        style={{ marginTop: "6px", height: "32px", fontSize: "13px" }}
                        defaultValue="Alder Creek Family Services"
                        readOnly
                        aria-label="Legal name preview"
                      />
                    </div>
                    <span className="tag">Short text</span>
                  </div>
                  <div className="fld-c">
                    <GripVertical className="ic grip" aria-hidden="true" />
                    <div className="grow">
                      <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                        <span className="b" style={{ color: "#0D2A43" }}>
                          Tax status
                        </span>
                        <span className="req" aria-hidden="true">
                          *
                        </span>
                        <span className="prov prov-passport">
                          <BadgeCheck className="ic" aria-hidden="true" />
                          From Passport · organization.taxStatus
                        </span>
                      </div>
                      <input
                        className="inp"
                        style={{ marginTop: "6px", height: "32px", fontSize: "13px" }}
                        defaultValue="501(c)(3) public charity"
                        readOnly
                        aria-label="Tax status preview"
                      />
                    </div>
                    <span className="tag">Select</span>
                  </div>
                  <div className="fld-c">
                    <GripVertical className="ic grip" aria-hidden="true" />
                    <div className="grow">
                      <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                        <span className="b" style={{ color: "#0D2A43" }}>
                          Requested amount
                        </span>
                        <span className="req" aria-hidden="true">
                          *
                        </span>
                        <span className="tag" style={{ background: "#D2E1F9", color: "#1E4F8F" }}>
                          maps to CommonGrants · requestedAmount
                        </span>
                      </div>
                      <input
                        className="inp"
                        style={{ marginTop: "6px", height: "32px", fontSize: "13px", width: "200px" }}
                        placeholder="$50,000 – $150,000"
                        aria-label="Requested amount preview"
                      />
                    </div>
                    <span className="tag">Money</span>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h" style={{ padding: "12px 16px" }}>
                  <div className="row" style={{ gap: "10px" }}>
                    <GripVertical className="ic" aria-hidden="true" style={{ color: "#9BAAA9" }} />
                    <h3>Section 2 · Project</h3>
                  </div>
                  <span className="small muted">4 fields · 1 conditional</span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "14px 16px" }}>
                  <div className="fld-c">
                    <GripVertical className="ic grip" aria-hidden="true" />
                    <div className="grow">
                      <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                        <span className="b" style={{ color: "#0D2A43" }}>
                          Project type
                        </span>
                        <span className="req" aria-hidden="true">
                          *
                        </span>
                      </div>
                      <select
                        className="sel"
                        style={{ marginTop: "6px", height: "32px", fontSize: "13px", width: "240px" }}
                        aria-label="Project type preview"
                      >
                        <option>Direct service</option>
                        <option>Capacity building</option>
                        <option>Planning</option>
                      </select>
                    </div>
                    <span className="tag">Select</span>
                  </div>
                  <div className="fld-c">
                    <GripVertical className="ic grip" aria-hidden="true" />
                    <div className="grow">
                      <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                        <span className="b" style={{ color: "#0D2A43" }}>
                          Summary of intent
                        </span>
                        <span className="req" aria-hidden="true">
                          *
                        </span>
                        <span className="tag">250 words</span>
                      </div>
                      <textarea
                        className="ta"
                        style={{ marginTop: "6px", minHeight: "48px", fontSize: "13px" }}
                        aria-label="Summary preview"
                        placeholder="Applicant writes here"
                      />
                    </div>
                    <span className="tag">Long text</span>
                  </div>
                  <div className="fld-c sel" aria-current="true">
                    <GripVertical className="ic grip" aria-hidden="true" />
                    <div className="grow">
                      <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                        <span className="b" style={{ color: "#0D2A43" }}>
                          Need
                        </span>
                        <span className="req" aria-hidden="true">
                          *
                        </span>
                        <span className="tag">500 words</span>
                        <span className="tag">
                          <Eye className="ic ic-sm" aria-hidden="true" />
                          Reviewers see
                        </span>
                      </div>
                      <div className="small muted" style={{ marginTop: "2px" }}>
                        Describe the community need this project addresses and the evidence for it.
                      </div>
                      <textarea
                        className="ta"
                        style={{ marginTop: "6px", minHeight: "48px", fontSize: "13px" }}
                        aria-label="Need preview"
                        placeholder="Applicant writes here"
                      />
                      <div className="row small" style={{ gap: "6px", marginTop: "6px", color: "#4A5C5A" }}>
                        <Eye className="ic ic-sm" aria-hidden="true" />
                        Shown when<span className="b">Project type = Direct service</span>
                      </div>
                    </div>
                    <span className="tag" style={{ background: "#E1F8F6", color: "#145450" }}>
                      Selected
                    </span>
                  </div>
                  <div className="fld-c">
                    <GripVertical className="ic grip" aria-hidden="true" />
                    <div className="grow">
                      <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                        <span className="b" style={{ color: "#0D2A43" }}>
                          Budget
                        </span>
                        <span className="req" aria-hidden="true">
                          *
                        </span>
                        <span className="tag">Totals must equal Requested amount</span>
                      </div>
                      <div className="tbl-wrap" style={{ marginTop: "6px" }}>
                        <table className="tbl tbl-compact">
                          <thead>
                            <tr>
                              <th>Category</th>
                              <th className="num">Requested</th>
                              <th className="num">Other</th>
                              <th className="num">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>Personnel</td>
                              <td className="num muted">—</td>
                              <td className="num muted">—</td>
                              <td className="num muted">—</td>
                            </tr>
                            <tr>
                              <td>Travel</td>
                              <td className="num muted">—</td>
                              <td className="num muted">—</td>
                              <td className="num muted">—</td>
                            </tr>
                            <tr>
                              <td className="muted">+ category</td>
                              <td></td>
                              <td></td>
                              <td></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <span className="tag">Budget table</span>
                  </div>
                </div>
              </div>
              <button className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
                <Plus className="ic" aria-hidden="true" />
                Add section
              </button>
            </section>
            <aside className="card" style={{ minWidth: "0" }}>
              <div className="card-h" style={{ padding: "12px 16px" }}>
                <h3 style={{ fontSize: "14px" }}>Field properties · Need</h3>
                <span className="tag">Long text</span>
              </div>
              <div className="card-b" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className="fld">
                  <label className="lbl" htmlFor="p-label">
                    Label
                  </label>
                  <input className="inp" id="p-label" defaultValue="Need" />
                </div>
                <div className="fld">
                  <label className="lbl" htmlFor="p-help">
                    Help text
                  </label>
                  <textarea
                    className="ta"
                    id="p-help"
                    style={{ minHeight: "56px" }}
                    defaultValue="Describe the community need this project addresses and the evidence for it."
                  />
                </div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <label className="lbl" htmlFor="p-req">
                    Required
                  </label>
                  <button className="tog on" id="p-req" role="switch" aria-checked="true" aria-label="Required"></button>
                </div>
                <div className="fld-row">
                  <div className="fld">
                    <label className="lbl" htmlFor="p-limit">
                      Word limit
                    </label>
                    <input className="inp" id="p-limit" defaultValue="500" />
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="p-min">
                      Minimum words
                    </label>
                    <input className="inp" id="p-min" defaultValue="50" />
                  </div>
                </div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <label className="lbl" htmlFor="p-rev">
                    Reviewer visibility
                  </label>
                  <button
                    className="tog on"
                    id="p-rev"
                    role="switch"
                    aria-checked="true"
                    aria-label="Reviewers can see this field"
                  ></button>
                </div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <label className="lbl" htmlFor="p-pii">
                      Contains PII
                    </label>
                    <div className="help">Masked for external reviewers and in exports</div>
                  </div>
                  <button className="tog" id="p-pii" role="switch" aria-checked="false" aria-label="Contains PII"></button>
                </div>
                <div className="fld">
                  <label className="lbl" htmlFor="p-cg">
                    Maps to CommonGrants
                  </label>
                  <select className="sel" id="p-cg">
                    <option>None</option>
                    <option>requestedAmount</option>
                    <option>projectTitle</option>
                    <option>projectSummary</option>
                  </select>
                </div>
                <div className="fld" style={{ position: "relative" }}>
                  <label className="lbl" htmlFor="p-prefill">
                    Prefill from Passport
                  </label>
                  <button
                    className="inp"
                    id="p-prefill"
                    style={{
                      textAlign: "left",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      borderColor: "#29A79F",
                    }}
                    aria-expanded="true"
                    aria-haspopup="listbox"
                  >
                    <span className="muted">Choose a Passport field…</span>
                    <ChevronUp className="ic" aria-hidden="true" />
                  </button>
                  <div
                    role="listbox"
                    aria-label="Passport fields"
                    style={{
                      border: "1px solid #D6DEDE",
                      borderRadius: "8px",
                      background: "#fff",
                      boxShadow: "0 12px 32px rgba(13,42,67,.14)",
                      overflow: "hidden",
                    }}
                  >
                    <div className="inp-icon" style={{ padding: "8px", borderBottom: "1px solid #EEF3F3" }}>
                      <Search className="ic" aria-hidden="true" style={{ left: "18px" }} />
                      <input
                        className="inp"
                        style={{ height: "32px", fontSize: "13px" }}
                        aria-label="Filter Passport fields"
                        placeholder="Filter fields"
                      />
                    </div>
                    <ul style={{ display: "flex", flexDirection: "column", maxHeight: "290px", overflowY: "auto", fontSize: "13px" }}>
                      <li
                        role="option"
                        aria-selected="false"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          gap: "10px",
                          padding: "8px 12px",
                          borderBottom: "1px solid #EEF3F3",
                        }}
                      >
                        <div>
                          <div className="mono" style={{ color: "#0D2A43" }}>
                            organization.legalName
                          </div>
                          <div className="muted xs">e.g. Alder Creek Family Services</div>
                        </div>
                        <span className="tag">in use</span>
                      </li>
                      <li
                        role="option"
                        aria-selected="false"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          gap: "10px",
                          padding: "8px 12px",
                          borderBottom: "1px solid #EEF3F3",
                        }}
                      >
                        <div>
                          <div className="mono" style={{ color: "#0D2A43" }}>
                            organization.taxStatus
                          </div>
                          <div className="muted xs">e.g. 501(c)(3) public charity</div>
                        </div>
                        <span className="tag">in use</span>
                      </li>
                      <li
                        role="option"
                        aria-selected="false"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          gap: "10px",
                          padding: "8px 12px",
                          borderBottom: "1px solid #EEF3F3",
                        }}
                      >
                        <div>
                          <div className="mono" style={{ color: "#0D2A43" }}>
                            organization.address
                          </div>
                          <div className="muted xs">e.g. 418 Mill Road, Alder Creek, OR</div>
                        </div>
                        <span></span>
                      </li>
                      <li
                        role="option"
                        aria-selected="true"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          gap: "10px",
                          padding: "8px 12px",
                          borderBottom: "1px solid #EEF3F3",
                          background: "#E1F8F6",
                        }}
                      >
                        <div>
                          <div className="mono" style={{ color: "#145450" }}>
                            organization.annualBudget
                          </div>
                          <div className="xs" style={{ color: "#145450" }}>
                            e.g. $2,400,000 (FY2026)
                          </div>
                          <div className="xs" style={{ color: "#145450", marginTop: "4px" }}>
                            Selecting writes the mapping and adds a{" "}
                            <span className="prov prov-passport">
                              <BadgeCheck className="ic" aria-hidden="true" />
                              From Passport
                            </span>{" "}
                            chip to the field preview.
                          </div>
                        </div>
                        <Check className="ic" aria-hidden="true" style={{ color: "#145450" }} />
                      </li>
                      <li
                        role="option"
                        aria-selected="false"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          gap: "10px",
                          padding: "8px 12px",
                          borderBottom: "1px solid #EEF3F3",
                        }}
                      >
                        <div>
                          <div className="mono" style={{ color: "#0D2A43" }}>
                            representatives.primary
                          </div>
                          <div className="muted xs">e.g. Maria Santos · Executive Director</div>
                        </div>
                        <span></span>
                      </li>
                      <li
                        role="option"
                        aria-selected="false"
                        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "10px", padding: "8px 12px" }}
                      >
                        <div>
                          <div className="mono" style={{ color: "#0D2A43" }}>
                            documents.irsLetter
                          </div>
                          <div className="muted xs">e.g. IRS determination letter.pdf (locker)</div>
                        </div>
                        <span></span>
                      </li>
                    </ul>
                    <div style={{ padding: "8px 12px", borderTop: "1px solid #EEF3F3", fontSize: "12px", color: "#4A5C5A" }}>
                      Prefilled fields are read-only for the applicant with an “Edit in Passport” link.
                    </div>
                  </div>
                </div>
                <div className="divider"></div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <button className="btn btn-sm btn-ghost">
                    <Copy className="ic" aria-hidden="true" />
                    Duplicate
                  </button>
                  <button className="btn btn-sm btn-danger">
                    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                    Remove field
                  </button>
                </div>
              </div>
            </aside>
          </div>
          <div className="notice">
            <Check className="ic ic-sm" aria-hidden="true" style={{ color: "#0B5E47" }} />
            Draft autosaves every change. Keyboard: ↑/↓ move between fields, ⌘D duplicate, Delete removes, Esc closes the picker.
          </div>
        </main>
      </FunderShell>
    </>
  );
}
