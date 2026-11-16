// SPDX-License-Identifier: AGPL-3.0-only
// Organization: the Passport record as funders on the GMS see it. Read-only here; every field
// links to Passport, where it is edited once and read by every application and report.
import { Link } from "react-router";
import { BadgeCheck, Check, CircleCheck, CircleDashed, CircleX, ExternalLink, Lock, RefreshCw } from "lucide-react";
import type { ApplicantApi, ApplicantReadiness, Consent, MyOrganization } from "../../api/applicant.ts";
import { useApplicantMutation, useApplicantQuery } from "../../api/applicantHooks.ts";
import { usePassportFlags } from "../../api/launchHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Loaded, sourceLabel, timeAgo } from "../../components/applicant.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { LevelBadge } from "../../components/status.tsx";
import { ErrorBanner, Notice } from "../../components/ui.tsx";
import { formatDate, formatMinor } from "../../lib/format.ts";
import { AccessCard, ConnectedAppsCard, LockerCard, RepresentativesCard } from "./organizationExtras.tsx";
import { VaultCard } from "./outside/keep.tsx";
import { t, useApplicantText } from "./i18n.ts";

interface OrgData {
  org: MyOrganization;
  readiness: ApplicantReadiness;
  consents: Consent[];
}

const load = async (api: ApplicantApi): Promise<OrgData> => {
  const [org, readiness, consents] = await Promise.all([api.organization(), api.readiness(), api.consents()]);
  return { org, readiness, consents };
};

type Json = Record<string, unknown>;
const at = (obj: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Json)[k] : undefined), obj);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null);

/** An IRS subsection's name, in the page's language. */
const irsSubsection = (code: string): string =>
  code === "03" ? t("organization.irs.c3") : code === "04" ? t("organization.irs.c4") : code === "06" ? t("organization.irs.c6") : t("organization.irs.other", { code });

function Value({ label, value, source = t("organization.fromPassport"), editUrl }: { label: string; value: string | null; source?: string; editUrl: string | null }) {
  return (
    <div className="fld">
      <span className="lbl">
        {label}
        {value !== null && (
          <span className="prov prov-passport">
            <BadgeCheck className="ic" aria-hidden="true" />
            {source}
          </span>
        )}
      </span>
      {value !== null ? (
        <div>{value}</div>
      ) : (
        <div className="row muted" style={{ gap: "8px" }}>
          <CircleDashed className="ic" aria-hidden="true" />
          {t("organization.notSet")}{editUrl ? <> · <a href={editUrl}>{t("organization.addInPassport")}</a></> : null}
        </div>
      )}
    </div>
  );
}

const STATE = {
  pass: { cls: "rc-pass", icon: CircleCheck, get word() { return t("organization.state.pass"); } },
  fail: { cls: "rc-fail", icon: CircleX, get word() { return t("organization.state.fail"); } },
  unknown: { cls: "rc-unk", icon: CircleDashed, get word() { return t("organization.state.unknown"); } },
};

export default function Organization() {
  useApplicantText();
  const ws = useWorkspace("applicant");
  const passportFlags = usePassportFlags();
  const base = `/w/${ws.handle}`;
  const query = useApplicantQuery(load, [ws.id]);
  const refresh = useApplicantMutation((api) => api.refreshOrganization());

  const onRefresh = async () => {
    const org = await refresh.run();
    if (org && query.status === "ready") query.set({ ...query.data, org });
  };

  return (
    <>
      <title>{t("organization.pageTitle", { workspace: ws.name })}</title>
      <ApplicantShell active="Organization">
        <main className="main">
          <Loaded query={query} label={t("organization.loadingYourPassportRecord")}>
            {({ org, readiness, consents }) => {
              const o = org.organization as unknown as Json | null;
              const profile = (org.profile ?? {}) as Json;
              const src = (path: string) => (org.profileSources[path] ? t("organization.fromPassportVia", { source: sourceLabel(org.profileSources[path]) }) : t("organization.fromPassport"));
              const address = [at(o, "addresses.primary.street1"), at(o, "addresses.primary.city"), at(o, "addresses.primary.stateOrProvince"), at(o, "addresses.primary.postalCode")].map(text).filter(Boolean).join(", ") || null;
              const money = (v: unknown) => (typeof v === "number" ? formatMinor(Math.round(v * 100)) : null);
              const subsection = text(at(profile, "commonApp.irs.subsection"));
              const payee = readiness.checks.find((c) => c.key === "payee_verified");
              return (
                <>
                  <div className="ph">
                    <div>
                      <div className="title">
                        <h1>{t("organization.organization")}</h1>
                        <LevelBadge level={org.level} />
                        {payee?.state === "pass" && (
                          <span className="pay pay-active">
                            <Check className="ic" aria-hidden="true" />
                            {t("organization.payeeActive")}
                          </span>
                        )}
                      </div>
                      <div className="meta">
                        <span>{t("organization.thisIsYourOpengrantsPassportRecord")}</span>
                      </div>
                    </div>
                    <div className="actions">
                      {org.linked && (
                        <button className="btn btn-secondary" type="button" onClick={onRefresh} disabled={refresh.state === "saving"}>
                          <RefreshCw className="ic" aria-hidden="true" />
                          {refresh.state === "saving" ? t("organization.refreshing") : t("organization.refreshFromPassport")}
                        </button>
                      )}
                      {org.editUrl && (
                        <a href={org.editUrl} className="btn btn-secondary">
                          <ExternalLink className="ic" aria-hidden="true" />
                          {t("organization.openPassport")}
                        </a>
                      )}
                    </div>
                  </div>

                  {refresh.error ? <ErrorBanner error={refresh.error} title={t("organization.passportCouldNotBeRead")} /> : null}
                  {!org.linked && (
                    <Notice tone="info" title={t("organization.notVerifiedThisWorkspaceIsNot")}>
                      {t.rich("organization.selfDeclaredNote", { link: (chunks) => <Link to={`/w/${ws.handle}/settings#organization-details`}>{chunks}</Link> })}
                      {passportFlags.linking && (
                        <>
                          {" "}
                          {t.rich("organization.continueNote", { link: (chunks) => <Link to="/onboarding/applicant">{chunks}</Link> })}
                        </>
                      )}
                    </Notice>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      <section className="card" aria-labelledby="identity-h">
                        <div className="card-h">
                          <h2 id="identity-h" style={{ fontSize: "18px" }}>
                            {t("organization.identity")}
                          </h2>
                          {org.editUrl && (
                            <a href={org.editUrl} className="small b">
                              {t("organization.editInPassport")}
                            </a>
                          )}
                        </div>
                        <div className="card-b" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px 24px" }}>
                          <Value label={t("organization.legalName")} value={text(at(o, "name"))} editUrl={org.editUrl} />
                          <Value label={t("organization.taxStatus")} value={subsection ? irsSubsection(subsection) : null} source={src("/commonApp/irs/subsection")} editUrl={org.editUrl} />
                          <Value label="EIN" value={text(at(o, "identifiers.org:us:ein.id"))?.replace(/^(\d{2})(\d{7})$/, "$1-$2") ?? null} editUrl={org.editUrl} />
                          <Value label={t("organization.mailingAddress")} value={address} editUrl={org.editUrl} />
                          <Value label={t("organization.website")} value={text(at(o, "socials.website"))?.replace(/^https?:\/\//, "") ?? null} editUrl={org.editUrl} />
                          <Value label={t("organization.founded")} value={text(at(o, "yearFounded"))} editUrl={org.editUrl} />
                        </div>
                      </section>

                      <section className="card" aria-labelledby="mission-h">
                        <div className="card-h">
                          <h2 id="mission-h" style={{ fontSize: "18px" }}>
                            {t("organization.mission")}
                          </h2>
                          {org.editUrl && (
                            <a href={org.editUrl} className="small b">
                              {t("organization.editInPassport")}
                            </a>
                          )}
                        </div>
                        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {text(at(o, "mission")) ? (
                            <>
                              <span className="prov prov-passport" style={{ alignSelf: "flex-start" }}>
                                <BadgeCheck className="ic" aria-hidden="true" />
                                {t("organization.fromPassport")}
                              </span>
                              <p>{text(at(o, "mission"))}</p>
                            </>
                          ) : (
                            <p className="muted">{t("organization.noMissionStatementInPassportYet")}</p>
                          )}
                        </div>
                      </section>

                      <section className="card" aria-labelledby="fin-h">
                        <div className="card-h">
                          <div>
                            <h2 id="fin-h" style={{ fontSize: "18px" }}>
                              {t("organization.commonAppProfile")}
                            </h2>
                            <p className="small muted">{t("organization.confirmedValuesFundersCanUseFor")}</p>
                          </div>
                          {org.editUrl && (
                            <a href={org.editUrl} className="small b">
                              {t("organization.editInPassport")}
                            </a>
                          )}
                        </div>
                        <div className="card-b" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px 24px" }}>
                          <Value label={t("organization.annualOperatingBudget")} value={money(at(profile, "commonApp.financials.budget"))} source={src("/commonApp/financials/budget")} editUrl={org.editUrl} />
                          <Value label={t("organization.totalRevenue")} value={money(at(profile, "commonApp.financials.totalRevenue"))} source={src("/commonApp/financials/totalRevenue")} editUrl={org.editUrl} />
                          <Value label={t("organization.totalExpenses")} value={money(at(profile, "commonApp.financials.totalExpenses"))} source={src("/commonApp/financials/totalExpenses")} editUrl={org.editUrl} />
                          <Value label={t("organization.staff")} value={text(at(profile, "commonApp.staffCount"))} source={src("/commonApp/staffCount")} editUrl={org.editUrl} />
                          <Value label={t("organization.fiscalYearEnd")} value={text(at(profile, "commonApp.fiscalYearEnd"))} source={src("/commonApp/fiscalYearEnd")} editUrl={org.editUrl} />
                          <Value label={t("organization.nteeCode")} value={text(at(profile, "commonApp.irs.ntee"))} source={src("/commonApp/irs/ntee")} editUrl={org.editUrl} />
                        </div>
                      </section>
                      <VaultCard base={base} />
                      <LockerCard editUrl={org.editUrl} />
                      <AccessCard consents={consents} base={base} onChanged={query.reload} />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      <section className="card" aria-labelledby="ready-h">
                        <div className="card-h">
                          <h2 id="ready-h" style={{ fontSize: "18px" }}>
                            {t("organization.readiness")}
                          </h2>
                          <LevelBadge level={readiness.level} />
                        </div>
                        <div className="card-b">
                          <ul className="rc">
                            {readiness.checks.map((c, i) => {
                              const look = STATE[c.state];
                              return (
                                <li key={c.key} className={`rc-row ${look.cls}`} style={i === 0 ? { borderTop: 0 } : undefined}>
                                  <look.icon className="ic" role="img" aria-label={look.word} />
                                  <div>
                                    <div className="l">{c.label}</div>
                                    <div className="r">{c.reason}</div>
                                  </div>
                                  {c.fixHref ? (
                                    <a href={c.fixHref} className="fix">
                                      {t("organization.fix")}
                                    </a>
                                  ) : (
                                    <span />
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                          <p className="small muted" style={{ marginTop: "10px" }}>
                            {org.syncedAt ? t("organization.lastRead", { ago: timeAgo(org.syncedAt) }) : t("organization.notReadFromPassportYet")}
                            {org.verifiedAt ? ` ${t("organization.verifiedOn", { date: formatDate(org.verifiedAt) })}` : ""}
                          </p>
                        </div>
                      </section>

                      <section className="card" aria-labelledby="payee-h">
                        <div className="card-h">
                          <h2 id="payee-h" style={{ fontSize: "18px" }}>
                            {t("organization.payeeStatus")}
                          </h2>
                          {payee?.state === "pass" ? (
                            <span className="pay pay-active">
                              <Check className="ic" aria-hidden="true" />
                              {t("organization.payeeActive")}
                            </span>
                          ) : (
                            <span className="pay pay-none">{payee?.state === "unknown" ? t("organization.unknown") : t("organization.notVerified")}</span>
                          )}
                        </div>
                        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                          {payee && <div className="b">{payee.reason}</div>}
                          <div className="bnr bnr-neu" style={{ padding: "10px 12px" }}>
                            <Lock className="ic" aria-hidden="true" />
                            <div>
                              <div className="t" style={{ fontSize: "14px" }}>
                                {t("organization.howDestinationChangesWork")}
                              </div>
                              <div className="d" style={{ fontSize: "13px" }}>
                                {t("organization.destinationChangesAreMadeInPassport")}
                              </div>
                            </div>
                          </div>
                          {org.editUrl && (
                            <a href={org.editUrl} className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
                              {t("organization.manageDestinationInPassport")}
                            </a>
                          )}
                        </div>
                      </section>

                      <ConnectedAppsCard sources={(org.profileSources ?? {}) as Record<string, unknown>} editUrl={org.editUrl} />
                      <RepresentativesCard editUrl={org.editUrl} />
                    </div>
                  </div>
                </>
              );
            }}
          </Loaded>
        </main>
      </ApplicantShell>
    </>
  );
}
