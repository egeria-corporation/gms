// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { Link } from "react-router";
import {
  Bot,
  Calendar,
  Check,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  Clock,
  Columns3,
  Download,
  Eye,
  Funnel,
  Info,
  LogOut,
  Plus,
  RotateCcw,
  Search,
  Send,
  Shield,
  Star,
  TriangleExclamationPoint,
  X,
} from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function Applications() {
  const [compact, setCompact] = useState(false);
  return (
    <>
      <title>{"Applications — Riverbend funder workspace"}</title>
      <FunderShell active="Applications">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <span>Applications</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Applications</h1>
                <span className="bdg bdg-prog">
                  <Eye className="ic" aria-hidden="true" />
                  Full proposal stage open
                </span>
              </div>
              <div className="meta">
                <span>Community Health Grants 2027</span>
                <span>·</span>
                <span>36 applications in stage</span>
                <span>·</span>
                <span>Full proposal closes Apr 30, 2027</span>
              </div>
            </div>
            <div className="actions">
              <div className="seg" role="group" aria-label="Row density">
                <button className={compact ? "" : "on"} aria-pressed={!compact} onClick={() => setCompact(false)}>
                  Comfortable
                </button>
                <button className={compact ? "on" : ""} aria-pressed={compact} onClick={() => setCompact(true)}>
                  Compact
                </button>
              </div>
              <button className="btn btn-secondary">
                <Columns3 className="ic" aria-hidden="true" />
                Columns
              </button>
              <button className="btn btn-secondary">
                <Download className="ic" aria-hidden="true" />
                Export
              </button>
            </div>
          </div>
          <div className="tabs" role="tablist" aria-label="Saved views">
            <Link to="/w/riverbend/applications" className="tab on" role="tab" aria-selected="true">
              All<span className="n">36</span>
            </Link>
            <Link to="/w/riverbend/applications" className="tab" role="tab">
              Needs screening<span className="n">4</span>
            </Link>
            <Link to="/w/riverbend/applications" className="tab" role="tab">
              Review complete<span className="n">9</span>
            </Link>
            <Link to="/w/riverbend/applications" className="tab" role="tab">
              Flagged<span className="n">2</span>
            </Link>
            <Link to="/w/riverbend/applications" className="tab" role="tab">
              Agent proposals<span className="n">1</span>
            </Link>
            <button className="tab">
              <Plus className="ic" aria-hidden="true" />
              Save view
            </button>
          </div>
          <div className="filterbar">
            <button className="fchip on">
              Competition:<span className="v">Community Health Grants 2027</span>
            </button>
            <button className="fchip on">
              Stage:<span className="v">Full proposal</span>
            </button>
            <button className="fchip">
              Status
              <ChevronDown className="ic ic-sm" aria-hidden="true" />
            </button>
            <button className="fchip">
              Eligibility
              <ChevronDown className="ic ic-sm" aria-hidden="true" />
            </button>
            <button className="fchip">
              Level
              <ChevronDown className="ic ic-sm" aria-hidden="true" />
            </button>
            <button className="fchip">
              Score range
              <ChevronDown className="ic ic-sm" aria-hidden="true" />
            </button>
            <button className="fchip">
              Tags
              <ChevronDown className="ic ic-sm" aria-hidden="true" />
            </button>
            <button className="fchip">
              Assignee
              <ChevronDown className="ic ic-sm" aria-hidden="true" />
            </button>
            <button className="fchip">
              Geography
              <ChevronDown className="ic ic-sm" aria-hidden="true" />
            </button>
            <Link to="/w/riverbend/applications" className="small b" style={{ marginLeft: "4px" }}>
              Clear filters
            </Link>
          </div>
          <div className="bulkbar" role="status">
            <span>2 selected</span>
            <span style={{ opacity: ".4" }}>|</span>
            <button className="btn">
              Advance
              <ChevronDown className="ic ic-sm" aria-hidden="true" />
            </button>
            <button className="btn">Request revision</button>
            <button className="btn">
              Decline
              <ChevronDown className="ic ic-sm" aria-hidden="true" />
            </button>
            <Link to="/w/riverbend/reviews/assign" className="btn">
              Assign reviewers
            </Link>
            <button className="btn">Tag</button>
            <button className="btn">Export</button>
            <button className="iconbtn" style={{ marginLeft: "auto", color: "#fff" }} aria-label="Clear selection">
              <X className="ic" aria-hidden="true" />
            </button>
          </div>
          <div className="tbl-wrap">
            <table className={compact ? "tbl tbl-compact" : "tbl"}>
              <thead>
                <tr>
                  <th style={{ width: "36px" }}>
                    <span className="ck" role="checkbox" aria-checked="mixed" aria-label="Select all"></span>
                  </th>
                  <th>Applicant</th>
                  <th>Title</th>
                  <th>Stage</th>
                  <th>Status</th>
                  <th>Eligibility</th>
                  <th className="num">Requested</th>
                  <th>Score</th>
                  <th className="num">Days in stage</th>
                  <th>Assignee</th>
                </tr>
              </thead>
              <tbody>
                <tr className="sel">
                  <td>
                    <span className="ck on" role="checkbox" aria-checked="true" aria-label="Select Alder Creek Family Services"></span>
                  </td>
                  <td>
                    <div className="ent">
                      <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                        Alder Creek Family Services
                      </Link>
                      <div className="sub">
                        <span className="lvl lvl-3">
                          <Shield className="ic" aria-hidden="true" />
                          L3
                        </span>
                        <span className="pay pay-active">
                          <Check className="ic" aria-hidden="true" />
                          Payee active
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <Link to="/w/riverbend/applications/app_01HZX4" style={{ color: "#1E2D2B" }}>
                      Mobile Health Navigation for Rural Families
                    </Link>
                  </td>
                  <td>Full proposal</td>
                  <td>
                    <span className="bdg bdg-prog">
                      <Eye className="ic" aria-hidden="true" />
                      Under review
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: "5px", color: "#0B5E47", fontWeight: 700 }}>
                      <CircleCheck className="ic" aria-hidden="true" />
                      Pass
                    </span>
                  </td>
                  <td className="num">$150,000</td>
                  <td>
                    <span className="b">4.4</span> <span className="muted">· n 3</span>
                  </td>
                  <td className="num">12</td>
                  <td>
                    <span className="av av-sm" title="Dana Ortiz">
                      DO
                    </span>
                  </td>
                </tr>
                <tr className="sel">
                  <td>
                    <span className="ck on" role="checkbox" aria-checked="true" aria-label="Select Bayview Youth Collective"></span>
                  </td>
                  <td>
                    <div className="ent">
                      <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                        Bayview Youth Collective
                      </Link>
                      <div className="sub">
                        <span className="lvl lvl-2">L2</span>
                        <span className="pay pay-none">
                          <CircleMinus className="ic" aria-hidden="true" />
                          No destination
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>Youth Mental Health Peer Program</td>
                  <td>Full proposal</td>
                  <td>
                    <span className="bdg bdg-prog">
                      <Eye className="ic" aria-hidden="true" />
                      Under review
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: "5px", color: "#0B5E47", fontWeight: 700 }}>
                      <CircleCheck className="ic" aria-hidden="true" />
                      Pass
                    </span>
                  </td>
                  <td className="num">$85,000</td>
                  <td>
                    <span className="b">3.9</span> <span className="muted">· n 2</span>
                  </td>
                  <td className="num">12</td>
                  <td>
                    <span className="av av-sm" title="Dana Ortiz">
                      DO
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="ck" role="checkbox" aria-checked="false" aria-label="Select Copper Valley Clinic"></span>
                  </td>
                  <td>
                    <div className="ent">
                      <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                        Copper Valley Clinic
                      </Link>
                      <div className="sub">
                        <span className="lvl lvl-1">L1</span>
                        <span className="pill-warn">
                          <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                          Level dropped from L2
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>Rural Telehealth Expansion</td>
                  <td>Full proposal</td>
                  <td>
                    <span className="bdg bdg-warn">
                      <RotateCcw className="ic" aria-hidden="true" />
                      Revision requested
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: "5px", color: "#4A5C5A", fontWeight: 700 }}>
                      <CircleDashed className="ic" aria-hidden="true" />
                      Unknown
                    </span>
                  </td>
                  <td className="num">$120,000</td>
                  <td>
                    <span className="muted">—</span>
                  </td>
                  <td className="num">5</td>
                  <td>
                    <span className="av av-sm av-t" title="Priya Natarajan">
                      PN
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="ck" role="checkbox" aria-checked="false" aria-label="Select Harbor Light Shelter"></span>
                  </td>
                  <td>
                    <div className="ent">
                      <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                        Harbor Light Shelter
                      </Link>
                      <div className="sub">
                        <span className="lvl lvl-3">
                          <Shield className="ic" aria-hidden="true" />
                          L3
                        </span>
                        <span className="pay pay-pending">
                          <Clock className="ic" aria-hidden="true" />
                          Pending change
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>Shelter Health Clinic Hours</td>
                  <td>Full proposal</td>
                  <td>
                    <span className="bdg bdg-info">
                      <Calendar className="ic" aria-hidden="true" />
                      Interview
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: "5px", color: "#0B5E47", fontWeight: 700 }}>
                      <CircleCheck className="ic" aria-hidden="true" />
                      Pass
                    </span>
                  </td>
                  <td className="num">$95,000</td>
                  <td>
                    <span className="b">4.1</span> <span className="muted">· n 3</span>
                  </td>
                  <td className="num">3</td>
                  <td>
                    <span className="av av-sm" title="Dana Ortiz">
                      DO
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="ck" role="checkbox" aria-checked="false" aria-label="Select Lakeside Senior Center"></span>
                  </td>
                  <td>
                    <div className="ent">
                      <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                        Lakeside Senior Center
                      </Link>
                      <div className="sub">
                        <span className="lvl lvl-2">L2</span>
                        <span className="pay pay-active">
                          <Check className="ic" aria-hidden="true" />
                          Payee active
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>Fall Prevention Program</td>
                  <td>Full proposal</td>
                  <td>
                    <span className="bdg bdg-prog">
                      <Star className="ic" aria-hidden="true" />
                      Recommended
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: "5px", color: "#0B5E47", fontWeight: 700 }}>
                      <CircleCheck className="ic" aria-hidden="true" />
                      Pass
                    </span>
                  </td>
                  <td className="num">$70,000</td>
                  <td>
                    <span className="b">4.6</span> <span className="muted">· n 3</span>
                  </td>
                  <td className="num">12</td>
                  <td>
                    <span className="av av-sm" title="Dana Ortiz">
                      DO
                    </span>
                  </td>
                </tr>
                <tr className="agent">
                  <td>
                    <span className="ck" role="checkbox" aria-checked="false" aria-label="Select Pine Ridge Literacy Project"></span>
                  </td>
                  <td>
                    <div className="ent">
                      <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                        Pine Ridge Literacy Project
                      </Link>
                      <div className="sub">
                        <span className="lvl lvl-1">L1</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="ent">
                      <span>Health Literacy Workshops</span>
                      <span className="attrib">
                        <Bot className="ic ic-sm" aria-hidden="true" />
                        Decline proposed by<span className="ag">Riverbend Triage Agent (via Claude)</span>· 2 min ago · awaiting approval
                      </span>
                    </div>
                  </td>
                  <td>Full proposal</td>
                  <td>
                    <div className="row" style={{ gap: "6px" }}>
                      <span className="bdg bdg-info">
                        <Send className="ic" aria-hidden="true" />
                        Submitted
                      </span>
                      <span className="bdg bdg-agent">
                        <Bot className="ic" aria-hidden="true" />
                        Proposed: Decline
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="row" style={{ gap: "5px", color: "#9B1C1C", fontWeight: 700 }}>
                      <CircleX className="ic" aria-hidden="true" />
                      Fail
                    </span>
                  </td>
                  <td className="num">$40,000</td>
                  <td>
                    <span className="muted">—</span>
                  </td>
                  <td className="num">1</td>
                  <td>
                    <Link to="/w/riverbend/approvals" className="btn btn-sm btn-primary">
                      Approve proposal
                    </Link>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="ck" role="checkbox" aria-checked="false" aria-label="Select Northgate Housing Trust"></span>
                  </td>
                  <td>
                    <div className="ent">
                      <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                        Northgate Housing Trust
                      </Link>
                      <div className="sub">
                        <span className="lvl lvl-3">
                          <Shield className="ic" aria-hidden="true" />
                          L3
                        </span>
                        <span className="pay pay-active">
                          <Check className="ic" aria-hidden="true" />
                          Payee active
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>Housing-First Health Navigators</td>
                  <td>Full proposal</td>
                  <td>
                    <span className="bdg bdg-prog">
                      <Eye className="ic" aria-hidden="true" />
                      Under review
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: "5px", color: "#0B5E47", fontWeight: 700 }}>
                      <CircleCheck className="ic" aria-hidden="true" />
                      Pass
                    </span>
                  </td>
                  <td className="num">$150,000</td>
                  <td>
                    <span className="b">4.0</span> <span className="muted">· n 2</span>
                  </td>
                  <td className="num">12</td>
                  <td>
                    <span className="av av-sm av-t" title="Priya Natarajan">
                      PN
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="ck" role="checkbox" aria-checked="false" aria-label="Select Cedar Hollow Food Bank"></span>
                  </td>
                  <td>
                    <div className="ent">
                      <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                        Cedar Hollow Food Bank
                      </Link>
                      <div className="sub">
                        <span className="lvl lvl-2">L2</span>
                        <span className="pay pay-active">
                          <Check className="ic" aria-hidden="true" />
                          Payee active
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>Healthy Pantry Expansion</td>
                  <td>Full proposal</td>
                  <td>
                    <span className="bdg bdg-prog">
                      <Eye className="ic" aria-hidden="true" />
                      Under review
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: "5px", color: "#0B5E47", fontWeight: 700 }}>
                      <CircleCheck className="ic" aria-hidden="true" />
                      Pass
                    </span>
                  </td>
                  <td className="num">$60,000</td>
                  <td>
                    <span className="b">3.6</span> <span className="muted">· n 3</span>
                  </td>
                  <td className="num">12</td>
                  <td>
                    <span className="av av-sm" title="Dana Ortiz">
                      DO
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="ck" role="checkbox" aria-checked="false" aria-label="Select Granite Peak Youth Sports"></span>
                  </td>
                  <td>
                    <div className="ent">
                      <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                        Granite Peak Youth Sports
                      </Link>
                      <div className="sub">
                        <span className="lvl lvl-1">L1</span>
                      </div>
                    </div>
                  </td>
                  <td>Concussion Safety Clinics</td>
                  <td>Full proposal</td>
                  <td>
                    <span className="bdg bdg-info">
                      <Search className="ic" aria-hidden="true" />
                      Screening
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: "5px", color: "#4A5C5A", fontWeight: 700 }}>
                      <CircleDashed className="ic" aria-hidden="true" />
                      Unknown
                    </span>
                  </td>
                  <td className="num">$35,000</td>
                  <td>
                    <span className="muted">—</span>
                  </td>
                  <td className="num">2</td>
                  <td>
                    <span className="muted">Unassigned</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="ck" role="checkbox" aria-checked="false" aria-label="Select Willow Creek Legal Aid"></span>
                  </td>
                  <td>
                    <div className="ent">
                      <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                        Willow Creek Legal Aid
                      </Link>
                      <div className="sub">
                        <span className="lvl lvl-2">L2</span>
                        <span className="pay pay-cooling">
                          <Clock className="ic" aria-hidden="true" />
                          Cooling off
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>Medical-Legal Partnership</td>
                  <td>Full proposal</td>
                  <td>
                    <span className="bdg bdg-prog">
                      <Eye className="ic" aria-hidden="true" />
                      Under review
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: "5px", color: "#0B5E47", fontWeight: 700 }}>
                      <CircleCheck className="ic" aria-hidden="true" />
                      Pass
                    </span>
                  </td>
                  <td className="num">$110,000</td>
                  <td>
                    <span className="b">4.2</span> <span className="muted">· n 3</span>
                  </td>
                  <td className="num">12</td>
                  <td>
                    <span className="av av-sm av-t" title="Priya Natarajan">
                      PN
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="ck" role="checkbox" aria-checked="false" aria-label="Select Meadowbrook Arts Collective"></span>
                  </td>
                  <td>
                    <div className="ent">
                      <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                        Meadowbrook Arts Collective
                      </Link>
                      <div className="sub">
                        <span className="lvl lvl-0">L0</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="ent">
                      <span>Arts for Wellbeing</span>
                      <span className="attrib">
                        <Bot className="ic ic-sm" aria-hidden="true" />
                        Declined by<span className="ag">Riverbend Triage Agent</span>· Mar 2 · approved by Dana Ortiz
                      </span>
                    </div>
                  </td>
                  <td>LOI</td>
                  <td>
                    <span className="bdg bdg-dng">
                      <CircleX className="ic" aria-hidden="true" />
                      Declined
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: "5px", color: "#9B1C1C", fontWeight: 700 }}>
                      <CircleX className="ic" aria-hidden="true" />
                      Fail
                    </span>
                  </td>
                  <td className="num">$25,000</td>
                  <td>
                    <span className="muted">—</span>
                  </td>
                  <td className="num">—</td>
                  <td>
                    <span className="av av-sm" title="Dana Ortiz">
                      DO
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="ck" role="checkbox" aria-checked="false" aria-label="Select Sunrise Recovery Network"></span>
                  </td>
                  <td>
                    <div className="ent">
                      <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                        Sunrise Recovery Network
                      </Link>
                      <div className="sub">
                        <span className="lvl lvl-2">L2</span>
                        <span className="pay pay-active">
                          <Check className="ic" aria-hidden="true" />
                          Payee active
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>Peer Recovery Coaching</td>
                  <td>Full proposal</td>
                  <td>
                    <span className="bdg bdg-neutral">
                      <LogOut className="ic" aria-hidden="true" />
                      Withdrawn
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: "5px", color: "#0B5E47", fontWeight: 700 }}>
                      <CircleCheck className="ic" aria-hidden="true" />
                      Pass
                    </span>
                  </td>
                  <td className="num">$55,000</td>
                  <td>
                    <span className="muted">—</span>
                  </td>
                  <td className="num">—</td>
                  <td>
                    <span className="muted">—</span>
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
              }}
            >
              <span>Showing 1–11 of 36 · rows load as you scroll (virtualized to 10,000)</span>
              <div className="row">
                <button className="btn btn-sm btn-secondary" disabled>
                  Previous
                </button>
                <button className="btn btn-sm btn-secondary">Next</button>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: "20px", marginTop: "8px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · bulk confirmation</span>
              <div className="mdl" style={{ width: "auto", boxShadow: "none", border: "1px solid #D6DEDE" }}>
                <div className="hd">
                  <div>
                    <h3 style={{ fontSize: "16px" }}>Decline 14 applications?</h3>
                    <p className="small muted" style={{ marginTop: "4px" }}>
                      Each applicant receives the letter below from Riverbend Community Foundation. This cannot be undone.
                    </p>
                  </div>
                </div>
                <div className="bd">
                  <div className="fld">
                    <label className="lbl" htmlFor="tpl">
                      Letter template
                    </label>
                    <select className="sel" id="tpl">
                      <option>Standard decline v3</option>
                      <option>Decline — eligibility v2</option>
                      <option>Decline — budget exhausted v1</option>
                    </select>
                  </div>
                  <div className="row" style={{ gap: "14px", fontSize: "13px" }}>
                    <span className="row" style={{ gap: "5px" }}>
                      <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />
                      14 letters will be queued
                    </span>
                    <span className="row" style={{ gap: "5px" }}>
                      <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />
                      Status → Declined
                    </span>
                    <span className="row" style={{ gap: "5px" }}>
                      <Info className="ic" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                      Logged in the audit ledger
                    </span>
                  </div>
                </div>
                <div className="ft">
                  <button className="btn btn-secondary">Cancel</button>
                  <button className="btn btn-danger-solid">Decline 14 and send “Standard decline v3”</button>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · filtered to zero</span>
              <div className="card empty" style={{ minHeight: "232px", justifyContent: "center" }}>
                <Funnel className="ic" aria-hidden="true" />
                <h3>No applications match these filters</h3>
                <p>Level L0 and Score above 4.5 exclude every application in the Full proposal stage.</p>
                <div className="acts">
                  <Link to="/w/riverbend/applications" className="btn btn-primary">
                    Clear filters
                  </Link>
                  <Link to="/w/riverbend/applications" className="small b">
                    Save this as an alert instead
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
