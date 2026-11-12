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

const IRS_SUBSECTION: Record<string, string> = { "03": "501(c)(3) public charity", "04": "501(c)(4) social welfare organization", "06": "501(c)(6) business league" };

function Value({ label, value, source = "From Passport", editUrl }: { label: string; value: string | null; source?: string; editUrl: string | null }) {
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
          Not set{editUrl ? <> · <a href={editUrl}>Add in Passport</a></> : null}
        </div>
      )}
    </div>
  );
}

const STATE = {
  pass: { cls: "rc-pass", icon: CircleCheck, word: "Passes" },
  fail: { cls: "rc-fail", icon: CircleX, word: "Needs attention" },
  unknown: { cls: "rc-unk", icon: CircleDashed, word: "Unknown" },
} as const;

export default function Organization() {
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
      <title>{`Organization — ${ws.name}`}</title>
      <ApplicantShell active="Organization">
        <main className="main">
          <Loaded query={query} label="Loading your Passport record">
            {({ org, readiness, consents }) => {
              const o = org.organization as unknown as Json | null;
              const profile = (org.profile ?? {}) as Json;
              const src = (path: string) => (org.profileSources[path] ? `From Passport · ${sourceLabel(org.profileSources[path])}` : "From Passport");
              const address = [at(o, "addresses.primary.street1"), at(o, "addresses.primary.city"), at(o, "addresses.primary.stateOrProvince"), at(o, "addresses.primary.postalCode")].map(text).filter(Boolean).join(", ") || null;
              const money = (v: unknown) => (typeof v === "number" ? formatMinor(Math.round(v * 100)) : null);
              const subsection = text(at(profile, "commonApp.irs.subsection"));
              const payee = readiness.checks.find((c) => c.key === "payee_verified");
              return (
                <>
                  <div className="ph">
                    <div>
                      <div className="title">
                        <h1>Organization</h1>
                        <LevelBadge level={org.level} />
                        {payee?.state === "pass" && (
                          <span className="pay pay-active">
                            <Check className="ic" aria-hidden="true" />
                            Payee active
                          </span>
                        )}
                      </div>
                      <div className="meta">
                        <span>This is your OpenGrants Passport record as funders see it. Edit it in Passport; every application and report reads from it.</span>
                      </div>
                    </div>
                    <div className="actions">
                      {org.linked && (
                        <button className="btn btn-secondary" type="button" onClick={onRefresh} disabled={refresh.state === "saving"}>
                          <RefreshCw className="ic" aria-hidden="true" />
                          {refresh.state === "saving" ? "Refreshing…" : "Refresh from Passport"}
                        </button>
                      )}
                      {org.editUrl && (
                        <a href={org.editUrl} className="btn btn-secondary">
                          <ExternalLink className="ic" aria-hidden="true" />
                          Open Passport
                        </a>
                      )}
                    </div>
                  </div>

                  {refresh.error ? <ErrorBanner error={refresh.error} title="Passport could not be read" /> : null}
                  {!org.linked && (
                    <Notice tone="info" title="Not verified: this workspace is not linked to Passport">
                      Funders see the details you entered in <Link to={`/w/${ws.handle}/settings#organization-details`}>Settings</Link>, marked as not verified.
                      {passportFlags.linking && (
                        <>
                          {" "}
                          <Link to="/onboarding/applicant">Continue with Passport</Link> to verify your organization and bring in your record.
                        </>
                      )}
                    </Notice>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      <section className="card" aria-labelledby="identity-h">
                        <div className="card-h">
                          <h2 id="identity-h" style={{ fontSize: "18px" }}>
                            Identity
                          </h2>
                          {org.editUrl && (
                            <a href={org.editUrl} className="small b">
                              Edit in Passport
                            </a>
                          )}
                        </div>
                        <div className="card-b" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px 24px" }}>
                          <Value label="Legal name" value={text(at(o, "name"))} editUrl={org.editUrl} />
                          <Value label="Tax status" value={subsection ? (IRS_SUBSECTION[subsection] ?? `IRS subsection ${subsection}`) : null} source={src("/commonApp/irs/subsection")} editUrl={org.editUrl} />
                          <Value label="EIN" value={text(at(o, "identifiers.org:us:ein.id"))?.replace(/^(\d{2})(\d{7})$/, "$1-$2") ?? null} editUrl={org.editUrl} />
                          <Value label="Mailing address" value={address} editUrl={org.editUrl} />
                          <Value label="Website" value={text(at(o, "socials.website"))?.replace(/^https?:\/\//, "") ?? null} editUrl={org.editUrl} />
                          <Value label="Founded" value={text(at(o, "yearFounded"))} editUrl={org.editUrl} />
                        </div>
                      </section>

                      <section className="card" aria-labelledby="mission-h">
                        <div className="card-h">
                          <h2 id="mission-h" style={{ fontSize: "18px" }}>
                            Mission
                          </h2>
                          {org.editUrl && (
                            <a href={org.editUrl} className="small b">
                              Edit in Passport
                            </a>
                          )}
                        </div>
                        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {text(at(o, "mission")) ? (
                            <>
                              <span className="prov prov-passport" style={{ alignSelf: "flex-start" }}>
                                <BadgeCheck className="ic" aria-hidden="true" />
                                From Passport
                              </span>
                              <p>{text(at(o, "mission"))}</p>
                            </>
                          ) : (
                            <p className="muted">No mission statement in Passport yet.</p>
                          )}
                        </div>
                      </section>

                      <section className="card" aria-labelledby="fin-h">
                        <div className="card-h">
                          <div>
                            <h2 id="fin-h" style={{ fontSize: "18px" }}>
                              Common App profile
                            </h2>
                            <p className="small muted">Confirmed values funders can use for prefill and eligibility. Unconfirmed values stay in Passport.</p>
                          </div>
                          {org.editUrl && (
                            <a href={org.editUrl} className="small b">
                              Edit in Passport
                            </a>
                          )}
                        </div>
                        <div className="card-b" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px 24px" }}>
                          <Value label="Annual operating budget" value={money(at(profile, "commonApp.financials.budget"))} source={src("/commonApp/financials/budget")} editUrl={org.editUrl} />
                          <Value label="Total revenue" value={money(at(profile, "commonApp.financials.totalRevenue"))} source={src("/commonApp/financials/totalRevenue")} editUrl={org.editUrl} />
                          <Value label="Total expenses" value={money(at(profile, "commonApp.financials.totalExpenses"))} source={src("/commonApp/financials/totalExpenses")} editUrl={org.editUrl} />
                          <Value label="Staff" value={text(at(profile, "commonApp.staffCount"))} source={src("/commonApp/staffCount")} editUrl={org.editUrl} />
                          <Value label="Fiscal year end" value={text(at(profile, "commonApp.fiscalYearEnd"))} source={src("/commonApp/fiscalYearEnd")} editUrl={org.editUrl} />
                          <Value label="NTEE code" value={text(at(profile, "commonApp.irs.ntee"))} source={src("/commonApp/irs/ntee")} editUrl={org.editUrl} />
                        </div>
                      </section>
                      <LockerCard editUrl={org.editUrl} />
                      <AccessCard consents={consents} base={base} onChanged={query.reload} />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      <section className="card" aria-labelledby="ready-h">
                        <div className="card-h">
                          <h2 id="ready-h" style={{ fontSize: "18px" }}>
                            Readiness
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
                                      Fix →
                                    </a>
                                  ) : (
                                    <span />
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                          <p className="small muted" style={{ marginTop: "10px" }}>
                            {org.syncedAt ? `Record last read from Passport ${timeAgo(org.syncedAt)}.` : "Not read from Passport yet."}
                            {org.verifiedAt ? ` Verified ${formatDate(org.verifiedAt)}.` : ""}
                          </p>
                        </div>
                      </section>

                      <section className="card" aria-labelledby="payee-h">
                        <div className="card-h">
                          <h2 id="payee-h" style={{ fontSize: "18px" }}>
                            Payee status
                          </h2>
                          {payee?.state === "pass" ? (
                            <span className="pay pay-active">
                              <Check className="ic" aria-hidden="true" />
                              Payee active
                            </span>
                          ) : (
                            <span className="pay pay-none">{payee?.state === "unknown" ? "Unknown" : "Not verified"}</span>
                          )}
                        </div>
                        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                          {payee && <div className="b">{payee.reason}</div>}
                          <div className="bnr bnr-neu" style={{ padding: "10px 12px" }}>
                            <Lock className="ic" aria-hidden="true" />
                            <div>
                              <div className="t" style={{ fontSize: "14px" }}>
                                How destination changes work
                              </div>
                              <div className="d" style={{ fontSize: "13px" }}>
                                Destination changes are made in Passport, cool off before they take effect and are visible to funders as “Pending change” while they do. The GMS never edits bank details and only ever shows the bank name and last four digits.
                              </div>
                            </div>
                          </div>
                          {org.editUrl && (
                            <a href={org.editUrl} className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
                              Manage destination in Passport
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
