// SPDX-License-Identifier: AGPL-3.0-only
// The organization screen at phone width, as the 390px artboard draws it: an identity card with
// level and payee status, the profile as a stacked list with its source on every row, payee
// status with the change-control note, readiness, and who has access. Everything is read from
// Passport and edited there.
import { Link } from "react-router";
import { BadgeCheck, Check, CircleCheck, CircleDashed, CircleX, Clock, Landmark, Pencil } from "lucide-react";
import type { ApplicantApi } from "../../../api/applicant.ts";
import { useApplicantMutation, useApplicantQuery } from "../../../api/applicantHooks.ts";
import { initialsOf } from "../../../api/client.ts";
import { usePassportFlags } from "../../../api/launchHooks.ts";
import { useWorkspace } from "../../../app/workspace.tsx";
import { Loaded, sourceLabel } from "../../../components/applicant.tsx";
import { PhoneShell } from "../../../components/PhoneShell.tsx";
import { LevelBadge } from "../../../components/status.tsx";
import { ErrorBanner, Notice } from "../../../components/ui.tsx";
import { formatDate, formatMinor } from "../../../lib/format.ts";
import { ConnectedAppsCard, LockerCard, RepresentativesCard } from "../organizationExtras.tsx";
import { VaultCard } from "../outside/keep.tsx";
import { t, useApplicantText } from "../i18n.ts";
import { readinessWords } from "../../../lib/readinessText.ts";
import { declaredFacts } from "../../../lib/selfDeclared.ts";

const load = async (api: ApplicantApi) => {
  const [org, readiness, consents] = await Promise.all([api.organization(), api.readiness(), api.consents()]);
  return { org, readiness, consents };
};

type Json = Record<string, unknown>;
const at = (obj: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Json)[k] : undefined), obj);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null);
/** An IRS subsection's name, in the page's language. */
const irsSubsection = (code: string): string =>
  code === "03" ? t("organization.irs.c3") : code === "04" ? t("organization.irs.c4") : code === "06" ? t("organization.irs.c6") : t("organization.irs.other", { code });
const STATE = {
  pass: { cls: "rc-pass", icon: CircleCheck, get word() { return t("organization.state.pass"); } },
  fail: { cls: "rc-fail", icon: CircleX, get word() { return t("organization.state.fail"); } },
  unknown: { cls: "rc-unk", icon: CircleDashed, get word() { return t("organization.state.unknown"); } },
};
const BASIS: Record<string, string> = {
  get application() { return t("organizationPhone.basis.application"); },
  get passport_grant() { return t("teamAccess.basis.passport"); },
  get shared_submission() { return t("organizationPhone.basis.shared"); },
};

function Row({ label, value, source, entered = false, last = false }: { label: string; value: string | null; source: string; entered?: boolean; last?: boolean }) {
  const Icon = entered ? Pencil : BadgeCheck;
  return (
    <div style={{ padding: "12px 16px", ...(last ? {} : { borderBottom: "1px solid var(--og-gray-100)" }), display: "flex", flexDirection: "column", gap: "4px" }}>
      <dt className="row small muted" style={{ gap: "8px", flexWrap: "wrap" }}>
        {label}
        {value !== null && (
          <span className={entered ? "prov prov-entered" : "prov prov-passport"}>
            <Icon className="ic" aria-hidden="true" />
            {source}
          </span>
        )}
      </dt>
      <dd style={{ margin: "0", fontSize: "16px", wordBreak: "break-word" }}>{value ?? <span className="muted">{t("organizationPhone.notSet")}</span>}</dd>
    </div>
  );
}

export default function OrganizationPhone() {
  useApplicantText();
  const ws = useWorkspace("applicant");
  const passportFlags = usePassportFlags();
  const base = `/w/${ws.handle}`;
  const query = useApplicantQuery(load, [ws.id]);
  const refresh = useApplicantMutation((api) => api.refreshOrganization());
  return (
    <>
      <title>{t("organization.pageTitle", { workspace: ws.name })}</title>
      <PhoneShell title={t("organizationPhone.organization")} active="Organization">
        <main className="main" style={{ flex: 1 }}>
          <Loaded query={query} label={t("organizationPhone.loadingYourPassportRecord")}>
            {({ org, readiness, consents }) => {
              const o = org.organization as unknown as Json | null;
              const profile = (org.profile ?? {}) as Json;
              const src = (path: string) => (org.profileSources[path] ? t("organization.fromPassportVia", { source: sourceLabel(org.profileSources[path]) }) : t("organization.fromPassport"));
              const address = [at(o, "addresses.primary.street1"), at(o, "addresses.primary.city"), at(o, "addresses.primary.stateOrProvince"), at(o, "addresses.primary.postalCode")].map(text).filter(Boolean).join(", ") || null;
              const subsection = text(at(profile, "commonApp.irs.subsection"));
              const budget = at(profile, "commonApp.financials.budget");
              const payee = readiness.checks.find((c) => c.key === "payee_verified");
              const declared = org.linked ? null : (declaredFacts(org.selfDeclared) ?? { legalName: null, ein: null, address: null, website: null, mission: null });
              const entered = t("organization.enteredByYou");
              const passport = t("organization.fromPassport");
              const active = consents.filter((c) => !c.revokedAt);
              const done = readiness.summary.pass;
              const total = readiness.checks.length || 1;
              return (
                <>
                  <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div className="row" style={{ gap: "12px", alignItems: "flex-start" }}>
                      <span className="av av-xl av-t" aria-hidden="true">
                        {initialsOf(org.displayName)}
                      </span>
                      <div className="grow" style={{ minWidth: "0" }}>
                        <h2 style={{ fontSize: "20px", lineHeight: 1.25 }}>{org.displayName}</h2>
                        <div className="row wrap" style={{ gap: "6px", marginTop: "6px" }}>
                          {org.level ? <LevelBadge level={org.level} /> : null}
                          {payee?.state === "pass" && (
                            <span className="pay pay-active">
                              <Check className="ic" aria-hidden="true" />
                              {t("organizationPhone.payeeActive")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mtr">
                      <div className="lbls">
                        <span>{t("organizationPhone.passportReadiness")}</span>
                        <b>{t("organizationPhone.doneOf", { done, total })}</b>
                      </div>
                      <div className="track" role="img" aria-label={t("organizationPhone.checksPass", { done, total })}>
                        <div className="fill" style={{ width: `${Math.round((done / total) * 100)}%` }}></div>
                      </div>
                    </div>
                    <p className="small muted">{org.linked ? t("organizationPhone.everythingHereIsReadFromYour") : t("organization.enteredByYouNotVerified")}</p>
                    {org.linked && (
                      <button
                        className="btn btn-secondary btn-lg btn-block"
                        type="button"
                        disabled={refresh.state === "saving"}
                        onClick={async () => {
                          const next = await refresh.run();
                          if (next) query.set({ org: next, readiness, consents });
                        }}
                      >
                        {refresh.state === "saving" ? t("organizationPhone.refreshing") : t("organizationPhone.refreshFromPassport")}
                      </button>
                    )}
                  </div>
                  {refresh.error ? <ErrorBanner error={refresh.error} title={t("organizationPhone.passportCouldNotBeRead")} /> : null}
                  {!org.linked && (
                    <Notice tone="info" title={t("organizationPhone.notVerifiedThisWorkspaceIsNot")}>
                      {t.rich("organization.selfDeclaredNote", { link: (chunks) => <Link to={`/w/${ws.handle}/settings#organization-details`}>{chunks}</Link> })}
                      {passportFlags.linking && (
                        <>
                          {" "}
                          {t.rich("organization.continueNote", { link: (chunks) => <Link to="/onboarding/applicant">{chunks}</Link> })}
                        </>
                      )}
                    </Notice>
                  )}

                  <section className="card" aria-labelledby="prof-h">
                    <div className="card-h" style={{ padding: "14px 16px" }}>
                      <h3 id="prof-h" style={{ fontSize: "16px" }}>
                        {t("organizationPhone.profile")}
                      </h3>
                      {org.editUrl && (
                        <a href={org.editUrl} className="small b">
                          {t("organizationPhone.editInPassport")}
                        </a>
                      )}
                    </div>
                    <dl style={{ margin: "0", display: "flex", flexDirection: "column" }}>
                      <Row label={t("organizationPhone.legalName")} value={declared ? declared.legalName : text(at(o, "name"))} source={declared ? entered : passport} entered={!!declared} />
                      <Row label={t("organizationPhone.taxStatus")} value={declared ? null : subsection ? irsSubsection(subsection) : null} source={src("/commonApp/irs/subsection")} />
                      <Row label="EIN" value={declared ? declared.ein : text(at(o, "identifiers.org:us:ein.id"))} source={declared ? entered : passport} entered={!!declared} />
                      <Row label={t("organizationPhone.mailingAddress")} value={declared ? declared.address : address} source={declared ? entered : passport} entered={!!declared} />
                      <Row label={t("organizationPhone.website")} value={declared ? declared.website : text(at(o, "socials.website"))} source={declared ? entered : passport} entered={!!declared} />
                      <Row label={t("organizationPhone.annualOperatingBudget")} value={declared ? null : typeof budget === "number" ? formatMinor(Math.round(budget * 100)) : null} source={src("/commonApp/financials/budget")} />
                      <Row label={t("organizationPhone.mission")} value={declared ? declared.mission : text(at(o, "mission"))} source={declared ? entered : passport} entered={!!declared} last />
                    </dl>
                  </section>

                  <section className="card" aria-labelledby="payee-h">
                    <div className="card-h" style={{ padding: "14px 16px" }}>
                      <h3 id="payee-h" style={{ fontSize: "16px" }}>
                        {t("organizationPhone.payeeStatus")}
                      </h3>
                      {payee?.state === "pass" ? (
                        <span className="pay pay-active">
                          <Check className="ic" aria-hidden="true" />
                          {t("organizationPhone.active")}
                        </span>
                      ) : (
                        <span className="pay pay-none">
                          <Clock className="ic" aria-hidden="true" />
                          {payee?.state === "unknown" ? t("organizationPhone.unknown") : t("organizationPhone.notVerified")}
                        </span>
                      )}
                    </div>
                    <div className="card-b" style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                      <div className="row" style={{ gap: "10px" }}>
                        <Landmark className="ic ic-md" aria-hidden="true" style={{ color: "var(--og-teal-dark)" }} />
                        <div>
                          <div className="b" style={{ fontSize: "15px" }}>
                            {payee?.reason ?? t("organizationPhone.verifyAPayoutDestinationInPassport")}
                          </div>
                          <div className="small muted">{t("organizationPhone.theDestinationItselfIsShownAnd")}</div>
                        </div>
                      </div>
                      <div className="bnr bnr-neu" style={{ padding: "10px 12px" }}>
                        <Clock className="ic" aria-hidden="true" />
                        <div>
                          <div className="t" style={{ fontSize: "14px" }}>
                            {t("organizationPhone.changeControl")}
                          </div>
                          <div className="d" style={{ fontSize: "13px" }}>
                            {t("organizationPhone.destinationChangesAreMadeInPassport")}
                          </div>
                        </div>
                      </div>
                      {org.editUrl && (
                        <a href={org.editUrl} className="btn btn-secondary btn-lg btn-block">
                          {t("organizationPhone.manageDestinationInPassport")}
                        </a>
                      )}
                    </div>
                  </section>

                  <section className="card" aria-labelledby="ready-h">
                    <div className="card-h" style={{ padding: "14px 16px" }}>
                      <h3 id="ready-h" style={{ fontSize: "16px" }}>
                        {t("organizationPhone.readiness")}
                      </h3>
                      <span className="small muted">{org.syncedAt ? t("organizationPhone.syncedOn", { date: formatDate(org.syncedAt) }) : t("organizationPhone.notSynced")}</span>
                    </div>
                    <ul className="rc" style={{ padding: "4px 16px 12px", fontSize: "15px" }}>
                      {readiness.checks.map((c, i) => {
                        const look = STATE[c.state];
                        return (
                          <li key={c.key} className={`rc-row ${look.cls}`} style={i === 0 ? { borderTop: 0 } : undefined}>
                            <look.icon className="ic" role="img" aria-label={look.word} />
                            <div>
                              <div className="l">{readinessWords(c).label}</div>
                              <div className="r">{readinessWords(c).reason}</div>
                            </div>
                            <span></span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>

                  <section className="card" aria-labelledby="access-h">
                    <div className="card-h" style={{ padding: "14px 16px" }}>
                      <h3 id="access-h" style={{ fontSize: "16px" }}>
                        {t("organizationPhone.whoHasAccess")}
                      </h3>
                      <Link to={`${base}/team`} className="small b">
                        {t("organizationPhone.manage")}
                      </Link>
                    </div>
                    {active.length === 0 ? (
                      <p className="small muted" style={{ padding: "12px 16px 16px" }}>
                        {t("organizationPhone.noFunderCanReadYourRecord")}
                      </p>
                    ) : (
                      <ul style={{ display: "flex", flexDirection: "column" }}>
                        {active.map((c, i) => (
                          <li key={c.id} className="row" style={{ padding: "12px 16px", gap: "12px", minHeight: "56px", ...(i < active.length - 1 ? { borderBottom: "1px solid var(--og-gray-100)" } : {}) }}>
                            <div className="grow">
                              <div className="b" style={{ fontSize: "15px" }}>
                                {c.funder.name ?? t("organizationPhone.funder")}
                              </div>
                              <div className="small muted">
                                {BASIS[c.basis] ?? c.basis} · {t("organizationPhone.since", { date: formatDate(c.grantedAt) })}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <VaultCard base={base} />
                  <LockerCard editUrl={org.editUrl} linked={org.linked} />
                  <ConnectedAppsCard sources={(org.profileSources ?? {}) as Record<string, unknown>} editUrl={org.editUrl} />
                  <RepresentativesCard editUrl={org.editUrl} />
                </>
              );
            }}
          </Loaded>
        </main>
      </PhoneShell>
    </>
  );
}
