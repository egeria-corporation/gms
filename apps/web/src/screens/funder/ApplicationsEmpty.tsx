// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { Columns3, Download, Inbox } from "lucide-react";
import { useWorkspace } from "../../app/workspace.tsx";
import { FunderShell } from "../../components/shells.tsx";

/** What Applications shows a funder who has no program yet: the four steps to the first application. */
export default function ApplicationsEmpty() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  return (
    <>
      <title>{`Applications — ${ws.name}`}</title>
      <FunderShell active="Applications" firstRun>
        <main className="main">
          <div className="crumbs">
            <Link to={base}>{ws.name}</Link>
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
          <nav className="tabs" aria-label="Saved views">
            <Link to={`${base}/applications`} className="tab on" aria-current="page">
              All<span className="n">0</span>
            </Link>
            <span className="tab" aria-disabled="true">
              Needs screening<span className="n">0</span>
            </span>
            <span className="tab" aria-disabled="true">
              Review complete<span className="n">0</span>
            </span>
            <span className="tab" aria-disabled="true">
              Flagged<span className="n">0</span>
            </span>
          </nav>
          <div className="card empty" style={{ minHeight: "360px", justifyContent: "center", padding: "64px 24px" }}>
            <Inbox className="ic" aria-hidden="true" />
            <h3 style={{ fontSize: "20px" }}>No applications yet</h3>
            <p style={{ fontSize: "15px" }}>
              Publish an opportunity to start receiving them. Applications arrive here with eligibility, Passport level and payee status
              already evaluated.
            </p>
            <div className="acts" style={{ marginTop: "10px" }}>
              <Link to={`${base}/programs`} className="btn btn-primary btn-lg">
                Create a program
              </Link>
              <Link to={`${base}/analytics`} className="b" style={{ fontSize: "14px" }}>
                Import applications from CSV
              </Link>
            </div>
          </div>
          <div className="card" style={{ padding: "18px 20px", background: "#F7FAFA" }}>
            <div className="eyebrow" style={{ marginBottom: "12px" }}>
              What happens next
            </div>
            <div className="stp" aria-label="Setup steps">
              <Link to={`${base}/programs`} className="s" style={{ textDecoration: "none" }}>
                <span className="n">1</span>
                <div>
                  <div>Program</div>
                  <div className="small muted" style={{ fontWeight: 400 }}>
                    Budget, defaults, owner
                  </div>
                </div>
              </Link>
              <div className="ln"></div>
              <Link to={`${base}/opportunities/new`} className="s" style={{ textDecoration: "none" }}>
                <span className="n">2</span>
                <div>
                  <div>Opportunity</div>
                  <div className="small muted" style={{ fontWeight: 400 }}>
                    Funding, dates, who can apply
                  </div>
                </div>
              </Link>
              <div className="ln"></div>
              <Link to={`${base}/forms`} className="s" style={{ textDecoration: "none" }}>
                <span className="n">3</span>
                <div>
                  <div>Form</div>
                  <div className="small muted" style={{ fontWeight: 400 }}>
                    Fields, Passport prefills, budget table
                  </div>
                </div>
              </Link>
              <div className="ln"></div>
              <Link to={`${base}/opportunities`} className="s" style={{ textDecoration: "none" }}>
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
