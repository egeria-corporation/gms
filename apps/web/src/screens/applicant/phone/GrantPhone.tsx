// SPDX-License-Identifier: AGPL-3.0-only
// A grant at phone width, as the 390px artboard draws it: a summary card, stacked amounts, a
// scrolling tab row, one card per tranche, the payment destination and the agreement. Same data as
// the desktop screen (../grant.tsx).
import { Link, useParams } from "react-router";
import { Award as AwardIcon, Download, Info, Landmark } from "lucide-react";
import { useWorkspace } from "../../../app/workspace.tsx";
import { accentOf, FunderChip, isNotFound } from "../../../components/applicant.tsx";
import { NotFound } from "../../../components/NotFound.tsx";
import { PhoneShell } from "../../../components/PhoneShell.tsx";
import { StatusBadge } from "../../../components/status.tsx";
import { EmptyState, ErrorBanner, Loading } from "../../../components/ui.tsx";
import { formatDate, formatMinor } from "../../../lib/format.ts";
import { AmendmentsCard, BudgetTable, conditionText, expectedText, HoldBanner, PayeeChip, periodOf, totals, useGrant, type GrantData } from "../grant.tsx";
import { GrantDocuments, GrantMessages } from "../grantExtras.tsx";

function Grant({ data, base, reload }: { data: GrantData; base: string; reload: () => void }) {
  const { award, schedule, requirements, payee } = data;
  const t = totals(data);
  const period = periodOf(award.keyDates);
  const destination = payee.bankName && payee.last4 ? `${payee.bankName} •••• ${payee.last4}` : payee.status === "active" ? "Verified destination on file in Passport" : "No verified destination";
  return (
    <>
      <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <FunderChip name={award.funder.name} accent={accentOf(award.funder.brand)} style={{ alignSelf: "flex-start" }} />
        <h2 style={{ fontSize: "20px", lineHeight: 1.3 }}>{award.title}</h2>
        <div className="row wrap" style={{ gap: "8px" }}>
          <StatusBadge kind="award" status={award.status} large />
          {period && (
            <span className="small muted">
              {formatDate(period.start)} – {formatDate(period.end)}
            </span>
          )}
        </div>
      </div>

      <HoldBanner data={data} />

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div className="stat" style={{ padding: "14px 16px" }}>
          <span className="stat-l">Awarded</span>
          <span className="stat-v" style={{ fontSize: "26px" }}>
            {formatMinor(t.awarded, award.currency)}
          </span>
        </div>
        <div className="stat" style={{ padding: "14px 16px" }}>
          <span className="stat-l">Received</span>
          <span className="stat-v" style={{ fontSize: "26px" }}>
            {formatMinor(t.received, award.currency)}
          </span>
          <span className="stat-d">
            {t.settledCount} of {schedule.length} tranches settled
          </span>
        </div>
        <div className="stat" style={{ padding: "14px 16px" }}>
          <span className="stat-l">Remaining</span>
          <span className="stat-v" style={{ fontSize: "26px" }}>
            {formatMinor(t.remaining, award.currency)}
          </span>
          <span className="stat-d">Released as conditions are met</span>
        </div>
      </div>

      <nav className="tabs tabrow" aria-label="Grant sections" style={{ scrollbarWidth: "none", margin: "0 -16px", padding: "0 16px" }}>
        <Link to={`${base}/grants/${award.id}/offer`} className="tab" style={{ minHeight: "44px" }}>
          Agreement
        </Link>
        <a href="#sched-h" className="tab on" aria-current="true" style={{ minHeight: "44px" }}>
          Payments
        </a>
        <Link to={`${base}/reports`} className="tab" style={{ minHeight: "44px" }}>
          Reports
        </Link>
        <a href="#budget-h" className="tab" style={{ minHeight: "44px" }}>
          Budget
        </a>
        <a href="#amendments" className="tab" style={{ minHeight: "44px" }}>
          Amendments
        </a>
      </nav>

      <section style={{ display: "flex", flexDirection: "column", gap: "10px" }} aria-labelledby="sched-h">
        <h3 id="sched-h" style={{ fontSize: "16px" }}>
          Payment schedule
        </h3>
        {schedule.length === 0 && <p className="small muted">{award.funder.name ?? "Your funder"} has not set a payment schedule yet.</p>}
        {schedule.map((x) => {
          const req = requirements.find((r) => r.releasesTrancheId === x.id);
          return (
            <div key={x.id} className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                <span className="b" style={{ fontSize: "15px" }}>
                  Tranche {x.seq} of {schedule.length}
                </span>
                <span className="b" style={{ fontSize: "17px", fontVariantNumeric: "tabular-nums" }}>
                  {formatMinor(x.amountMinor, x.currency)}
                </span>
              </div>
              <div className="small muted">Condition: {conditionText(x, requirements).replace(/^(On|When) /, (m) => m.toLowerCase())}</div>
              <div className="row wrap" style={{ gap: "8px" }}>
                <StatusBadge kind="tranche" status={x.status} {...(x.status === "held" ? { label: "Paused" } : {})} />
                <span className="small muted">
                  {expectedText(x, requirements)}
                  {x.bankName && x.last4 ? <span className="userback-block">{` · ${x.bankName} •••• ${x.last4}`}</span> : ""}
                  {req && x.status === "scheduled" ? (
                    <>
                      {" · "}
                      <Link to={`${base}/reports`}>{req.title.toLowerCase()}</Link>
                    </>
                  ) : null}
                </span>
              </div>
            </div>
          );
        })}
      </section>

      <section className="card" aria-labelledby="dest-h">
        <div className="card-h" style={{ padding: "14px 16px" }}>
          <h3 id="dest-h" style={{ fontSize: "16px" }}>
            Payment destination
          </h3>
          <PayeeChip payee={payee} />
        </div>
        <div className="card-b" style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="row" style={{ gap: "10px" }}>
            <Landmark className="ic ic-md" aria-hidden="true" style={{ color: "var(--og-teal-dark)" }} />
            <div>
              <div className="b userback-block" style={{ fontSize: "15px" }}>
                {destination}
              </div>
              <div className="small muted">From Passport</div>
            </div>
          </div>
          <div className="bnr bnr-info" style={{ padding: "10px 12px" }}>
            <Info className="ic" aria-hidden="true" />
            <div className="d" style={{ fontSize: "13px", margin: "0" }}>
              Expecting a payment? Changes to your bank account take 5 business days. <Link to={`${base}/organization`}>Manage in Passport</Link>.
            </div>
          </div>
        </div>
      </section>

      {award.agreement && (
        <section className="card" aria-labelledby="agr-h">
          <div className="card-h" style={{ padding: "14px 16px" }}>
            <h3 id="agr-h" style={{ fontSize: "16px" }}>
              Agreement
            </h3>
            <StatusBadge kind="agreement" status={award.agreement.status} />
          </div>
          <div className="card-b" style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div className="small muted">
              {award.agreement.granteeSignedAt ? `Signed ${formatDate(award.agreement.granteeSignedAt)}` : "Not signed yet"}
              {award.agreement.funderSignedAt ? ` · countersigned ${formatDate(award.agreement.funderSignedAt)}` : ""}
            </div>
            <Link to={`${base}/grants/${award.id}/offer`} className="btn btn-secondary btn-lg btn-block">
              <Download className="ic" aria-hidden="true" />
              {award.agreement.status === "executed" ? "Open the executed agreement" : "Review the agreement"}
            </Link>
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="budget-h">
        <div className="card-h" style={{ padding: "14px 16px" }}>
          <h3 id="budget-h" style={{ fontSize: "16px" }}>
            Budget
          </h3>
        </div>
        <BudgetTable book={data.budget} compact />
      </section>

      <AmendmentsCard data={data} onSaved={reload} />
      <GrantDocuments award={award} base={base} />
      <GrantMessages award={award} />
    </>
  );
}

export default function GrantPhone() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const { awardId } = useParams();
  const query = useGrant(awardId, ws.id);
  if (query.status === "error" && isNotFound(query.error)) return <NotFound />;
  return (
    <>
      <title>{`Awarded funding — ${ws.name}`}</title>
      <PhoneShell title="Awarded funding" active="Awarded funding">
        <main className="main" style={{ flex: 1 }}>
          {query.status === "loading" && <Loading label="Loading the grant" />}
          {query.status === "error" && <ErrorBanner error={query.error} onRetry={query.reload} />}
          {query.status === "ready" &&
            (query.data ? (
              <Grant data={query.data} base={base} reload={query.reload} />
            ) : (
              <EmptyState icon={AwardIcon} title="No grants yet" actions={<Link to={`${base}/find`} className="btn btn-primary">Find funding</Link>}>
                When a funder makes an award, the offer and the payment schedule appear here.
              </EmptyState>
            ))}
        </main>
      </PhoneShell>
    </>
  );
}
