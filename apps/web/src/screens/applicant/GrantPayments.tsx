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
import { ShareAwardPanel } from "../../components/ShareAwardPanel.tsx";
import { SocialPanel } from "../../components/SocialPanel.tsx";
import { t, useApplicantText } from "./i18n.ts";

const OPEN_REPORT: readonly string[] = ["due", "overdue", "returned", "scheduled"];

function Closeout({ data }: { data: GrantData }) {
  const tot = totals(data);
  const final = data.requirements.filter((r) => r.type === "report").at(-1);
  const live = data.schedule.filter((x) => x.status !== "cancelled");
  const items = [
    { key: "report", label: t("grantPayments.close.report"), reason: final ? (final.status === "accepted" ? t("grantPayments.close.accepted") : t("grantPayments.close.dueOn", { date: formatDate(final.dueAt) })) : t("grantPayments.close.noReport"), done: !final || final.status === "accepted" },
    { key: "tranches", label: t("grantPayments.close.tranches"), reason: t("grantPayments.close.settledOf", { settled: tot.settledCount, total: live.length }), done: live.length > 0 && tot.settledCount === live.length },
    { key: "completed", label: t("grantPayments.close.completed"), reason: data.award.status === "completed" ? t("grantPayments.close.completedReason") : t("grantPayments.close.afterAbove"), done: data.award.status === "completed" },
  ];
  return (
    <div className="card" id="closeout">
      <div className="card-h">
        <div>
          <h2>{t("grantPayments.closeout")}</h2>
          <p className="small muted">{t("grantPayments.whatCompletesTheGrant")}</p>
        </div>
      </div>
      <div className="card-b">
        <ul className="rc">
          {items.map((i) => (
            <li key={i.key} className={`rc-row ${i.done ? "rc-pass" : "rc-unk"}`}>
              {i.done ? <CircleCheck className="ic" role="img" aria-label={t("grantPayments.done")} /> : <CircleDashed className="ic" role="img" aria-label={t("grantPayments.pending")} />}
              <div>
                <div className="l">{i.label}</div>
                <div className="r">{i.reason}</div>
              </div>
              <span className="fix muted">{i.done ? t("grantPayments.done") : t("grantPayments.pending")}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Grant({ data, base, reload }: { data: GrantData; base: string; reload: () => void }) {
  const { award, schedule, requirements } = data;
  const tot = totals(data);
  const period = periodOf(award.keyDates);
  const progress = periodProgress(award.keyDates);
  const funder = award.funder.name ?? null;
  const openReports = requirements.filter((r) => OPEN_REPORT.includes(r.status) && r.status !== "scheduled").length;
  const sent = [...schedule].reverse().find((x) => SETTLED.includes(x.status) || IN_FLIGHT.includes(x.status) || x.status === "failed" || x.status === "returned");
  const nextReport = requirements.find((r) => tot.next && r.releasesTrancheId === tot.next.id);
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
              <span>{t("grantPayments.grantPeriod", { start: formatDate(period.start), end: formatDate(period.end) })}</span>
            )}
            {award.agreement && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t("grantPayments.agreement")} <StatusBadge kind="agreement" status={award.agreement.status} />
                </span>
              </>
            )}
          </div>
        </div>
        <div className="actions">
          <Link to={`${base}/reports`} className="btn btn-secondary">
            {t("grantPayments.openReports")}
          </Link>
          <Link to={`${base}/grants/${award.id}/offer`} className="btn btn-secondary">
            {t("grantPayments.agreement")}
          </Link>
        </div>
      </div>

      <HoldBanner data={data} />

      <div className="amounts">
        <div>
          <div className="stat-l">{t("grantPayments.awarded")}</div>
          <div className="stat-v">{formatMinor(tot.awarded, award.currency)}</div>
        </div>
        <div>
          <div className="stat-l">{t("grantPayments.received")}</div>
          <div className="stat-v">{formatMinor(tot.received, award.currency)}</div>
          <div className="stat-d">
            {t("grantPayments.tranchesSettled", { settled: tot.settledCount, total: schedule.length })}
          </div>
        </div>
        <div>
          <div className="stat-l">{t("grantPayments.remaining")}</div>
          <div className="stat-v">{formatMinor(tot.remaining, award.currency)}</div>
          {tot.next && <div className="stat-d">{t("grantPayments.next", { amount: formatMinor(tot.next.amountMinor, tot.next.currency), condition: conditionText(tot.next, requirements).toLowerCase() })}</div>}
        </div>
        <div>
          <div className="stat-l">{t("grantPayments.period")}</div>
          {period && progress !== null ? (
            <div className="mtr" style={{ marginTop: "8px" }}>
              <div className="track" style={{ height: "8px" }} role="img" aria-label={t("grantPayments.progress", { pct: progress })}>
                <div className="fill" style={{ width: `${progress}%` }}></div>
              </div>
              <div className="lbls">
                <span>{formatDate(period.start)}</span>
                <span>{formatDate(period.end)}</span>
              </div>
            </div>
          ) : (
            <div className="stat-d">{t("grantPayments.notSet")}</div>
          )}
        </div>
      </div>

      <nav className="tabs" aria-label={t("grantPayments.grantSections")}>
        <Link to={`${base}/grants/${award.id}/offer`} className="tab">
          {t("grantPayments.agreement")}
        </Link>
        <a href="#payments" className="tab on" aria-current="true">
          {t("grantPayments.payments")}
        </a>
        <Link to={`${base}/reports`} className="tab">
          {t("grantPayments.reports")}{openReports > 0 && <span className="n">{t("grantPayments.dueCount", { count: openReports })}</span>}
        </Link>
        <a href="#budget" className="tab">
          {t("grantPayments.budget")}
        </a>
        <a href="#amendments" className="tab">
          {t("grantPayments.amendments")}
        </a>
        <a href="#closeout" className="tab">
          {t("grantPayments.closeout")}
        </a>
      </nav>

      <div id="payments" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
        <div className="card">
          <div className="card-h">
            <div>
              <h2>{t("grantPayments.paymentSchedule")}</h2>
              <p className="small muted">{funder ? t("grantPayments.expectedNote", { funder }) : t("grantPayments.expectedNoteYourFunder")}</p>
            </div>
          </div>
          {schedule.length === 0 ? (
            <p className="small muted" style={{ padding: "16px 20px" }}>
              {funder ? t("grantPayments.noSchedule", { funder }) : t("grantPayments.noScheduleYourFunder")}
            </p>
          ) : (
            <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }} tabIndex={0} role="region" aria-label={t("grantPayments.paymentScheduleScrollable")}>
              <table className="tbl" style={{ fontSize: "15px" }}>
                <caption className="sr">{t("grantPayments.paymentSchedule")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("grantPayments.tranche")}</th>
                    <th scope="col" className="num">
                      {t("grantPayments.amount")}
                    </th>
                    <th scope="col">{t("grantPayments.condition")}</th>
                    <th scope="col">{t("grantPayments.expected")}</th>
                    <th scope="col">{t("grantPayments.status")}</th>
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
                        <StatusBadge kind="tranche" status={x.status} {...(x.status === "held" ? { label: t("grantPayments.paused") } : {})} />
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
              {award.status === "active" || award.status === "completed" ? t("grantPayments.paymentsAreSentThroughPassportTo") : t("grantPayments.paymentsStartOnceTheAgreementIs")}
            </span>
            {nextReport && (
              <Link to={`${base}/reports`} className="small b">
                {t("grantPayments.submitToUnlock", { report: nextReport.title.toLowerCase(), seq: tot.next!.seq })}
              </Link>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <DestinationCard payee={data.payee} destination={data.destination} orgHref={`${base}/organization`} />
          {sent && (
            <div className="card">
              <div className="card-h">
                <h3>{t("grantPayments.trancheDisbursement", { seq: sent.seq })}</h3>
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
              <h2>{t("grantPayments.budget")}</h2>
              <p className="small muted">{funder ? t("grantPayments.approvedBy", { funder }) : t("grantPayments.approvedByYourFunder")}</p>
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
      <ShareAwardPanel awardId={award.id} side="grantee" funderName={funder ?? t("grantPayments.yourFunder")} />
      <SocialPanel subject={{ type: "award", id: award.id }} />
    </>
  );
}

export default function GrantPayments() {
  useApplicantText();
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const { awardId } = useParams();
  const query = useGrant(awardId, ws.id);
  if (query.status === "error" && isNotFound(query.error)) return <NotFound />;
  const title = query.status === "ready" && query.data ? query.data.award.title : t("grantPayments.grant");
  return (
    <>
      <title>{t("grantPayments.pageTitle", { title, workspace: ws.name })}</title>
      <ApplicantShell active="Awarded funding">
        <main className="main">
          <nav className="crumbs" aria-label={t("grantPayments.breadcrumb")}>
            <Link to={base}>{t("grantPayments.dashboard")}</Link>
            <span aria-hidden="true">›</span>
            <Link to={`${base}/grants`}>{t("grantPayments.awardedFunding")}</Link>
            <span aria-hidden="true">›</span>
            <span aria-current="page">{title}</span>
          </nav>
          {query.status === "loading" && <Loading label={t("grantPayments.loadingTheGrant")} />}
          {query.status === "error" && <ErrorBanner error={query.error} onRetry={query.reload} />}
          {query.status === "ready" &&
            (query.data ? (
              <Grant data={query.data} base={base} reload={query.reload} />
            ) : (
              <EmptyState icon={AwardIcon} title={t("grantPayments.noGrantsYet")} actions={<Link to={`${base}/find`} className="btn btn-primary">{t("grantPayments.findFunding")}</Link>}>
                {t("grantPayments.whenAFunderMakesAnAward")}
              </EmptyState>
            ))}
        </main>
      </ApplicantShell>
    </>
  );
}
