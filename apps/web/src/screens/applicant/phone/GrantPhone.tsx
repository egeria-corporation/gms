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
import { ShareAwardPanel } from "../../../components/ShareAwardPanel.tsx";
import { t, useApplicantText } from "../i18n.ts";

function Grant({ data, base, reload }: { data: GrantData; base: string; reload: () => void }) {
  const { award, schedule, requirements, payee } = data;
  const tot = totals(data);
  const period = periodOf(award.keyDates);
  const destination = payee.bankName && payee.last4 ? `${payee.bankName} •••• ${payee.last4}` : payee.status === "active" ? t("grant.verifiedDestinationOnFileInPassport") : t("grant.noVerifiedDestination");
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
          <span className="stat-l">{t("grantPhone.awarded")}</span>
          <span className="stat-v" style={{ fontSize: "26px" }}>
            {formatMinor(tot.awarded, award.currency)}
          </span>
        </div>
        <div className="stat" style={{ padding: "14px 16px" }}>
          <span className="stat-l">{t("grantPhone.received")}</span>
          <span className="stat-v" style={{ fontSize: "26px" }}>
            {formatMinor(tot.received, award.currency)}
          </span>
          <span className="stat-d">
            {t("grantPayments.tranchesSettled", { settled: tot.settledCount, total: schedule.length })}
          </span>
        </div>
        <div className="stat" style={{ padding: "14px 16px" }}>
          <span className="stat-l">{t("grantPhone.remaining")}</span>
          <span className="stat-v" style={{ fontSize: "26px" }}>
            {formatMinor(tot.remaining, award.currency)}
          </span>
          <span className="stat-d">{t("grantPhone.releasedAsConditionsAreMet")}</span>
        </div>
      </div>

      <nav className="tabs tabrow" aria-label={t("grantPhone.grantSections")} style={{ scrollbarWidth: "none", margin: "0 -16px", padding: "0 16px" }}>
        <Link to={`${base}/grants/${award.id}/offer`} className="tab" style={{ minHeight: "44px" }}>
          {t("grantPhone.agreement")}
        </Link>
        <a href="#sched-h" className="tab on" aria-current="true" style={{ minHeight: "44px" }}>
          {t("grantPhone.payments")}
        </a>
        <Link to={`${base}/reports`} className="tab" style={{ minHeight: "44px" }}>
          {t("grantPhone.reports")}
        </Link>
        <a href="#budget-h" className="tab" style={{ minHeight: "44px" }}>
          {t("grantPhone.budget")}
        </a>
        <a href="#amendments" className="tab" style={{ minHeight: "44px" }}>
          {t("grantPhone.amendments")}
        </a>
      </nav>

      <section style={{ display: "flex", flexDirection: "column", gap: "10px" }} aria-labelledby="sched-h">
        <h3 id="sched-h" style={{ fontSize: "16px" }}>
          {t("grantPhone.paymentSchedule")}
        </h3>
        {schedule.length === 0 && <p className="small muted">{award.funder.name ? t("grantPhone.noSchedule", { funder: award.funder.name }) : t("grantPhone.noScheduleYourFunder")}</p>}
        {schedule.map((x) => {
          const req = requirements.find((r) => r.releasesTrancheId === x.id);
          return (
            <div key={x.id} className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                <span className="b" style={{ fontSize: "15px" }}>
                  {t("dashboard.trancheOf", { seq: x.seq, total: schedule.length })}
                </span>
                <span className="b" style={{ fontSize: "17px", fontVariantNumeric: "tabular-nums" }}>
                  {formatMinor(x.amountMinor, x.currency)}
                </span>
              </div>
              <div className="small muted">{t("grantPhone.condition", { condition: conditionText(x, requirements).replace(/^(On|When) /, (m) => m.toLowerCase()) })}</div>
              <div className="row wrap" style={{ gap: "8px" }}>
                <StatusBadge kind="tranche" status={x.status} {...(x.status === "held" ? { label: t("grantPayments.paused") } : {})} />
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
            {t("grantPhone.paymentDestination")}
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
              <div className="small muted">{t("grantPhone.fromPassport")}</div>
            </div>
          </div>
          <div className="bnr bnr-info" style={{ padding: "10px 12px" }}>
            <Info className="ic" aria-hidden="true" />
            <div className="d" style={{ fontSize: "13px", margin: "0" }}>
              {t.rich("grantPhone.expecting", { link: (chunks) => <Link to={`${base}/organization`}>{chunks}</Link> })}
            </div>
          </div>
        </div>
      </section>

      {award.agreement && (
        <section className="card" aria-labelledby="agr-h">
          <div className="card-h" style={{ padding: "14px 16px" }}>
            <h3 id="agr-h" style={{ fontSize: "16px" }}>
              {t("grantPhone.agreement")}
            </h3>
            <StatusBadge kind="agreement" status={award.agreement.status} />
          </div>
          <div className="card-b" style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div className="small muted">
              {award.agreement.granteeSignedAt ? t("grantPhone.signedOn", { date: formatDate(award.agreement.granteeSignedAt) }) : t("grantPhone.notSignedYet")}
              {award.agreement.funderSignedAt ? ` · ${t("grantPhone.countersignedOn", { date: formatDate(award.agreement.funderSignedAt) })}` : ""}
            </div>
            <Link to={`${base}/grants/${award.id}/offer`} className="btn btn-secondary btn-lg btn-block">
              <Download className="ic" aria-hidden="true" />
              {award.agreement.status === "executed" ? t("grantPhone.openTheExecutedAgreement") : t("grantPhone.reviewTheAgreement")}
            </Link>
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="budget-h">
        <div className="card-h" style={{ padding: "14px 16px" }}>
          <h3 id="budget-h" style={{ fontSize: "16px" }}>
            {t("grantPhone.budget")}
          </h3>
        </div>
        <BudgetTable book={data.budget} compact />
      </section>

      <AmendmentsCard data={data} onSaved={reload} />
      <GrantDocuments award={award} base={base} />
      <GrantMessages award={award} />
      <ShareAwardPanel awardId={award.id} side="grantee" funderName={award.funder.name ?? undefined} />
    </>
  );
}

export default function GrantPhone() {
  useApplicantText();
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const { awardId } = useParams();
  const query = useGrant(awardId, ws.id);
  if (query.status === "error" && isNotFound(query.error)) return <NotFound />;
  return (
    <>
      <title>{t("grantOffered.pageTitle", { workspace: ws.name })}</title>
      <PhoneShell title={t("grantPhone.awardedFunding")} active="Awarded funding">
        <main className="main" style={{ flex: 1 }}>
          {query.status === "loading" && <Loading label={t("grantPhone.loadingTheGrant")} />}
          {query.status === "error" && <ErrorBanner error={query.error} onRetry={query.reload} />}
          {query.status === "ready" &&
            (query.data ? (
              <Grant data={query.data} base={base} reload={query.reload} />
            ) : (
              <EmptyState icon={AwardIcon} title={t("grantPhone.noGrantsYet")} actions={<Link to={`${base}/find`} className="btn btn-primary">{t("grantPhone.findFunding")}</Link>}>
                {t("grantPhone.whenAFunderMakesAnAward")}
              </EmptyState>
            ))}
        </main>
      </PhoneShell>
    </>
  );
}
