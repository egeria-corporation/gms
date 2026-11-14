// SPDX-License-Identifier: AGPL-3.0-only
// A grant after acceptance: what was awarded and received, the payment schedule with what each
// payment waits on, where payments go (bank name and last four only, managed in Passport), the
// budget against actuals, amendments and what closes the grant out.
import { BudgetMappingForm } from "./grantBudgetMapping.tsx";
import { Link, useParams } from "react-router";
import { Award as AwardIcon, CircleCheck, CircleDashed, Info } from "lucide-react";
import { useWorkspace } from "../../app/workspace.tsx";
import { accentOf, FunderChip, isNotFound } from "../../components/applicant.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Loading } from "../../components/ui.tsx";
import { formatDate, formatMinor } from "../../lib/format.ts";
import {
  ActualsForm,
  AmendmentsCard,
  BudgetTable,
  conditionText,
  DestinationCard,
  DisbursementTimeline,
  expectedText,
  HoldBanner,
  IN_FLIGHT,
  periodOf,
  periodProgress,
  SETTLED,
  totals,
  useGrant,
  type GrantData,
} from "./grant.tsx";
import { GrantDocuments, GrantMessages } from "./grantExtras.tsx";

const OPEN_REPORT: readonly string[] = ["due", "overdue", "returned", "scheduled"];

function Closeout({ data }: { data: GrantData }) {
  const t = totals(data);
  const final = data.requirements.filter((r) => r.type === "report").at(-1);
  const live = data.schedule.filter((x) => x.status !== "cancelled");
  const items = [
    { label: "Final report accepted", reason: final ? (final.status === "accepted" ? "Accepted" : `Due ${formatDate(final.dueAt)}`) : "No report required", done: !final || final.status === "accepted" },
    { label: "All tranches settled or cancelled", reason: `${t.settledCount} of ${live.length} settled`, done: live.length > 0 && t.settledCount === live.length },
    { label: "Award completed by your funder", reason: data.award.status === "completed" ? "Completed" : "After the items above", done: data.award.status === "completed" },
  ];
  return (
    <div className="card" id="closeout">
      <div className="card-h">
        <div>
          <h2>Closeout</h2>
          <p className="small muted">What completes the grant.</p>
        </div>
      </div>
      <div className="card-b">
        <ul className="rc">
          {items.map((i) => (
            <li key={i.label} className={`rc-row ${i.done ? "rc-pass" : "rc-unk"}`}>
              {i.done ? <CircleCheck className="ic" role="img" aria-label="Done" /> : <CircleDashed className="ic" role="img" aria-label="Pending" />}
              <div>
                <div className="l">{i.label}</div>
                <div className="r">{i.reason}</div>
              </div>
              <span className="fix muted">{i.done ? "Done" : "Pending"}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Grant({ data, base, reload }: { data: GrantData; base: string; reload: () => void }) {
  const { award, schedule, requirements } = data;
  const t = totals(data);
  const period = periodOf(award.keyDates);
  const progress = periodProgress(award.keyDates);
  const funder = award.funder.name ?? "your funder";
  const openReports = requirements.filter((r) => OPEN_REPORT.includes(r.status) && r.status !== "scheduled").length;
  const sent = [...schedule].reverse().find((x) => SETTLED.includes(x.status) || IN_FLIGHT.includes(x.status) || x.status === "failed" || x.status === "returned");
  const nextReport = requirements.find((r) => t.next && r.releasesTrancheId === t.next.id);
  return (
    <>
      <div className="ph">
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <FunderChip name={award.funder.name} accent={accentOf(award.funder.brand)} style={{ alignSelf: "flex-start" }} />
          <div className="title">
            <h1>{award.title}</h1>
            <StatusBadge kind="award" status={award.status} large />
          </div>
          <div className="meta">
            {period && (
              <span>
                Grant period {formatDate(period.start)} – {formatDate(period.end)}
              </span>
            )}
            {award.agreement && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Agreement <StatusBadge kind="agreement" status={award.agreement.status} />
                </span>
              </>
            )}
          </div>
        </div>
        <div className="actions">
          <Link to={`${base}/reports`} className="btn btn-secondary">
            Open reports
          </Link>
          <Link to={`${base}/grants/${award.id}/offer`} className="btn btn-secondary">
            Agreement
          </Link>
        </div>
      </div>

      <HoldBanner data={data} />

      <div className="amounts">
        <div>
          <div className="stat-l">Awarded</div>
          <div className="stat-v">{formatMinor(t.awarded, award.currency)}</div>
        </div>
        <div>
          <div className="stat-l">Received</div>
          <div className="stat-v">{formatMinor(t.received, award.currency)}</div>
          <div className="stat-d">
            {t.settledCount} of {schedule.length} tranches settled
          </div>
        </div>
        <div>
          <div className="stat-l">Remaining</div>
          <div className="stat-v">{formatMinor(t.remaining, award.currency)}</div>
          {t.next && <div className="stat-d">Next: {formatMinor(t.next.amountMinor, t.next.currency)} · {conditionText(t.next, requirements).toLowerCase()}</div>}
        </div>
        <div>
          <div className="stat-l">Period</div>
          {period && progress !== null ? (
            <div className="mtr" style={{ marginTop: "8px" }}>
              <div className="track" style={{ height: "8px" }} role="img" aria-label={`${progress}% of the grant period has passed`}>
                <div className="fill" style={{ width: `${progress}%` }}></div>
              </div>
              <div className="lbls">
                <span>{formatDate(period.start)}</span>
                <span>{formatDate(period.end)}</span>
              </div>
            </div>
          ) : (
            <div className="stat-d">Not set</div>
          )}
        </div>
      </div>

      <nav className="tabs" aria-label="Grant sections">
        <Link to={`${base}/grants/${award.id}/offer`} className="tab">
          Agreement
        </Link>
        <a href="#payments" className="tab on" aria-current="true">
          Payments
        </a>
        <Link to={`${base}/reports`} className="tab">
          Reports{openReports > 0 && <span className="n">{openReports} due</span>}
        </Link>
        <a href="#budget" className="tab">
          Budget
        </a>
        <a href="#amendments" className="tab">
          Amendments
        </a>
        <a href="#closeout" className="tab">
          Closeout
        </a>
      </nav>

      <div id="payments" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
        <div className="card">
          <div className="card-h">
            <div>
              <h2>Payment schedule</h2>
              <p className="small muted">Expected dates follow your funder's conditions. Money only moves after {funder}'s readiness check passes.</p>
            </div>
          </div>
          {schedule.length === 0 ? (
            <p className="small muted" style={{ padding: "16px 20px" }}>
              {funder} has not set a payment schedule for this grant yet.
            </p>
          ) : (
            <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }} tabIndex={0} role="region" aria-label="Payment schedule, scrollable">
              <table className="tbl" style={{ fontSize: "15px" }}>
                <caption className="sr">Payment schedule</caption>
                <thead>
                  <tr>
                    <th scope="col">Tranche</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">Condition</th>
                    <th scope="col">Expected</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((x) => (
                    <tr key={x.id}>
                      <td className="b">{x.seq}</td>
                      <td className="num b">{formatMinor(x.amountMinor, x.currency)}</td>
                      <td>{conditionText(x, requirements)}</td>
                      <td>{expectedText(x, requirements)}</td>
                      <td>
                        <StatusBadge kind="tranche" status={x.status} {...(x.status === "held" ? { label: "Paused" } : {})} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="card-f" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
            <span className="notice">
              <Info className="ic" aria-hidden="true" />
              {award.status === "active" || award.status === "completed" ? "Payments are sent through Passport to your verified destination." : "Payments start once the agreement is executed and the grant is active."}
            </span>
            {nextReport && (
              <Link to={`${base}/reports`} className="small b">
                Submit the {nextReport.title.toLowerCase()} to unlock tranche {t.next!.seq} →
              </Link>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <DestinationCard payee={data.payee} destination={data.destination} orgHref={`${base}/organization`} />
          {sent && (
            <div className="card">
              <div className="card-h">
                <h3>Tranche {sent.seq} · disbursement</h3>
                <StatusBadge kind="tranche" status={sent.status} />
              </div>
              <div className="card-b">
                <DisbursementTimeline tranche={sent} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px", alignItems: "start" }}>
        <div className="card" id="budget">
          <div className="card-h">
            <div>
              <h2>Budget</h2>
              <p className="small muted">Approved by {funder}, against the actuals you have reported.</p>
            </div>
          </div>
          <BudgetTable book={data.budget} />
          <BudgetMappingForm awardId={award.id} categories={[...new Set((data.budget.approved?.lines ?? []).map((l) => l.category))]} />
          {award.status === "active" && <ActualsForm data={data} onSaved={reload} />}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <AmendmentsCard data={data} onSaved={reload} />
          <Closeout data={data} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px", alignItems: "start" }}>
        <GrantDocuments award={award} base={base} />
        <GrantMessages award={award} />
      </div>
    </>
  );
}

export default function GrantPayments() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const { awardId } = useParams();
  const query = useGrant(awardId, ws.id);
  if (query.status === "error" && isNotFound(query.error)) return <NotFound />;
  const title = query.status === "ready" && query.data ? query.data.award.title : "Grant";
  return (
    <>
      <title>{`${title} — Payments — ${ws.name}`}</title>
      <ApplicantShell active="Awarded funding">
        <main className="main">
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link to={base}>Dashboard</Link>
            <span aria-hidden="true">›</span>
            <Link to={`${base}/grants`}>Awarded funding</Link>
            <span aria-hidden="true">›</span>
            <span aria-current="page">{title}</span>
          </nav>
          {query.status === "loading" && <Loading label="Loading the grant" />}
          {query.status === "error" && <ErrorBanner error={query.error} onRetry={query.reload} />}
          {query.status === "ready" &&
            (query.data ? (
              <Grant data={query.data} base={base} reload={query.reload} />
            ) : (
              <EmptyState icon={AwardIcon} title="No grants yet" actions={<Link to={`${base}/find`} className="btn btn-primary">Find funding</Link>}>
                When a funder makes an award, the offer, the agreement and the payment schedule appear here.
              </EmptyState>
            ))}
        </main>
      </ApplicantShell>
    </>
  );
}
