// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { Columns3, Download, Inbox } from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function ApplicationsEmpty() {
  return (
    <>
      <title>{"Applications — first run (empty)"}</title>
      <FunderShell active="Applications" firstRun>
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
              </div>
              <div className="meta">
                <span>No competitions yet</span>
              </div>
            </div>
            <div className="actions">
              <button className="btn btn-secondary" disabled aria-disabled="true">
                <Columns3 className="ic" aria-hidden="true" />
                Columns
              </button>
              <button className="btn btn-secondary" disabled aria-disabled="true">
                <Download className="ic" aria-hidden="true" />
                Export
              </button>
            </div>
          </div>
          <div className="tabs" role="tablist" aria-label="Saved views">
            <Link to="/w/riverbend/applications/first-run" className="tab on" role="tab" aria-selected="true">
              All<span className="n">0</span>
            </Link>
            <span className="tab" style={{ opacity: ".5" }}>
              Needs screening<span className="n">0</span>
            </span>
            <span className="tab" style={{ opacity: ".5" }}>
              Review complete<span className="n">0</span>
            </span>
            <span className="tab" style={{ opacity: ".5" }}>
              Flagged<span className="n">0</span>
            </span>
          </div>
          <div className="card empty" style={{ minHeight: "360px", justifyContent: "center", padding: "64px 24px" }}>
            <Inbox className="ic" aria-hidden="true" />
            <h3 style={{ fontSize: "20px" }}>No applications yet</h3>
            <p style={{ fontSize: "15px" }}>
              Publish an opportunity to start receiving them. Applications arrive here with eligibility, Passport level and payee status
              already evaluated.
            </p>
            <div className="acts" style={{ marginTop: "10px" }}>
              <Link to="/w/riverbend/programs/community-health-2027" className="btn btn-primary btn-lg">
                Create a program
              </Link>
              <Link to="/w/riverbend/settings/mcp" className="b" style={{ fontSize: "14px" }}>
                Import applications from CSV
              </Link>
            </div>
          </div>
          <div className="card" style={{ padding: "18px 20px", background: "#F7FAFA" }}>
            <div className="eyebrow" style={{ marginBottom: "12px" }}>
              What happens next
            </div>
            <div className="stp" aria-label="Setup steps">
              <Link to="/w/riverbend/programs/community-health-2027" className="s" style={{ textDecoration: "none" }}>
                <span className="n">1</span>
                <div>
                  <div>Program</div>
                  <div className="small muted" style={{ fontWeight: 400 }}>
                    Budget, defaults, owner
                  </div>
                </div>
              </Link>
              <div className="ln"></div>
              <Link to="/w/riverbend/opportunities/community-health-2027/edit" className="s" style={{ textDecoration: "none" }}>
                <span className="n">2</span>
                <div>
                  <div>Opportunity</div>
                  <div className="small muted" style={{ fontWeight: 400 }}>
                    Funding, dates, who can apply
                  </div>
                </div>
              </Link>
              <div className="ln"></div>
              <Link to="/w/riverbend/forms/loi-v2/edit" className="s" style={{ textDecoration: "none" }}>
                <span className="n">3</span>
                <div>
                  <div>Form</div>
                  <div className="small muted" style={{ fontWeight: 400 }}>
                    Fields, Passport prefills, budget table
                  </div>
                </div>
              </Link>
              <div className="ln"></div>
              <Link to="/w/riverbend/competitions/community-health-2027" className="s" style={{ textDecoration: "none" }}>
                <span className="n">4</span>
                <div>
                  <div>Launch</div>
                  <div className="small muted" style={{ fontWeight: 400 }}>
                    Stages, reviewers, checklist → public page
                  </div>
                </div>
              </Link>
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
