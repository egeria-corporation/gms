// SPDX-License-Identifier: AGPL-3.0-only
// The organization screen at phone width, as the 390px artboard draws it: an identity card with
// level and payee status, the profile as a stacked list with its source on every row, payee
// status with the change-control note, readiness, and who has access. Everything is read from
// Passport and edited there.
import { Link } from "react-router";
import { BadgeCheck, Check, CircleCheck, CircleDashed, CircleX, Clock, Landmark } from "lucide-react";
import type { ApplicantApi } from "../../../api/applicant.ts";
import { useApplicantMutation, useApplicantQuery } from "../../../api/applicantHooks.ts";
import { initialsOf } from "../../../api/client.ts";
import { useWorkspace } from "../../../app/workspace.tsx";
import { Loaded, sourceLabel } from "../../../components/applicant.tsx";
import { PhoneShell } from "../../../components/PhoneShell.tsx";
import { LevelBadge } from "../../../components/status.tsx";
import { ErrorBanner, Notice } from "../../../components/ui.tsx";
import { formatDate, formatMinor } from "../../../lib/format.ts";
import { ConnectedAppsCard, LockerCard, RepresentativesCard } from "../organizationExtras.tsx";

const load = async (api: ApplicantApi) => {
  const [org, readiness, consents] = await Promise.all([api.organization(), api.readiness(), api.consents()]);
  return { org, readiness, consents };
};

type Json = Record<string, unknown>;
const at = (obj: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Json)[k] : undefined), obj);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null);
const IRS_SUBSECTION: Record<string, string> = { "03": "501(c)(3) public charity", "04": "501(c)(4) social welfare organization", "06": "501(c)(6) business league" };
const STATE = {
  pass: { cls: "rc-pass", icon: CircleCheck, word: "Passes" },
  fail: { cls: "rc-fail", icon: CircleX, word: "Needs attention" },
  unknown: { cls: "rc-unk", icon: CircleDashed, word: "Unknown" },
} as const;
const BASIS: Record<string, string> = { application: "Because you applied", passport_grant: "Granted in Passport", shared_submission: "Because you shared a report" };

function Row({ label, value, source, last = false }: { label: string; value: string | null; source: string; last?: boolean }) {
  return (
    <div style={{ padding: "12px 16px", ...(last ? {} : { borderBottom: "1px solid var(--og-gray-100)" }), display: "flex", flexDirection: "column", gap: "4px" }}>
      <dt className="row small muted" style={{ gap: "8px", flexWrap: "wrap" }}>
        {label}
        {value !== null && (
          <span className="prov prov-passport">
            <BadgeCheck className="ic" aria-hidden="true" />
            {source}
          </span>
        )}
      </dt>
      <dd style={{ margin: "0", fontSize: "16px", wordBreak: "break-word" }}>{value ?? <span className="muted">Not set</span>}</dd>
    </div>
  );
}

export default function OrganizationPhone() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const query = useApplicantQuery(load, [ws.id]);
  const refresh = useApplicantMutation((api) => api.refreshOrganization());
  return (
    <>
      <title>{`Organization — ${ws.name}`}</title>
      <PhoneShell title="Organization" active="Organization">
        <main className="main" style={{ flex: 1 }}>
          <Loaded query={query} label="Loading your Passport record">
            {({ org, readiness, consents }) => {
              const o = org.organization as unknown as Json | null;
              const profile = (org.profile ?? {}) as Json;
              const src = (path: string) => (org.profileSources[path] ? `From Passport · ${sourceLabel(org.profileSources[path])}` : "From Passport");
              const address = [at(o, "addresses.primary.street1"), at(o, "addresses.primary.city"), at(o, "addresses.primary.stateOrProvince"), at(o, "addresses.primary.postalCode")].map(text).filter(Boolean).join(", ") || null;
              const subsection = text(at(profile, "commonApp.irs.subsection"));
              const budget = at(profile, "commonApp.financials.budget");
              const payee = readiness.checks.find((c) => c.key === "payee_verified");
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
                          <LevelBadge level={org.level} />
                          {payee?.state === "pass" && (
                            <span className="pay pay-active">
                              <Check className="ic" aria-hidden="true" />
                              Payee active
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mtr">
                      <div className="lbls">
                        <span>Passport readiness</span>
                        <b>
                          {done} of {total}
                        </b>
                      </div>
                      <div className="track" role="img" aria-label={`${done} of ${total} readiness checks pass`}>
                        <div className="fill" style={{ width: `${Math.round((done / total) * 100)}%` }}></div>
                      </div>
                    </div>
                    <p className="small muted">Everything here is read from your OpenGrants Passport record. Edit it there and every funder sees the change.</p>
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
                        {refresh.state === "saving" ? "Refreshing…" : "Refresh from Passport"}
                      </button>
                    )}
                  </div>
                  {refresh.error ? <ErrorBanner error={refresh.error} title="Passport could not be read" /> : null}
                  {!org.linked && (
                    <Notice tone="warn" title="This workspace is not connected to Passport">
                      <Link to="/onboarding/applicant">Continue with Passport</Link> to bring in your record.
                    </Notice>
                  )}

                  <section className="card" aria-labelledby="prof-h">
                    <div className="card-h" style={{ padding: "14px 16px" }}>
                      <h3 id="prof-h" style={{ fontSize: "16px" }}>
                        Profile
                      </h3>
                      {org.editUrl && (
                        <a href={org.editUrl} className="small b">
                          Edit in Passport
                        </a>
                      )}
                    </div>
                    <dl style={{ margin: "0", display: "flex", flexDirection: "column" }}>
                      <Row label="Legal name" value={text(at(o, "name")) ?? org.displayName} source="From Passport" />
                      <Row label="Tax status" value={subsection ? (IRS_SUBSECTION[subsection] ?? `IRS subsection ${subsection}`) : null} source={src("/commonApp/irs/subsection")} />
                      <Row label="EIN" value={text(at(o, "identifiers.org:us:ein.id"))} source="From Passport" />
                      <Row label="Mailing address" value={address} source="From Passport" />
                      <Row label="Website" value={text(at(o, "socials.website"))} source="From Passport" />
                      <Row label="Annual operating budget" value={typeof budget === "number" ? formatMinor(Math.round(budget * 100)) : null} source={src("/commonApp/financials/budget")} />
                      <Row label="Mission" value={text(at(o, "mission"))} source="From Passport" last />
                    </dl>
                  </section>

                  <section className="card" aria-labelledby="payee-h">
                    <div className="card-h" style={{ padding: "14px 16px" }}>
                      <h3 id="payee-h" style={{ fontSize: "16px" }}>
                        Payee status
                      </h3>
                      {payee?.state === "pass" ? (
                        <span className="pay pay-active">
                          <Check className="ic" aria-hidden="true" />
                          Active
                        </span>
                      ) : (
                        <span className="pay pay-none">
                          <Clock className="ic" aria-hidden="true" />
                          {payee?.state === "unknown" ? "Unknown" : "Not verified"}
                        </span>
                      )}
                    </div>
                    <div className="card-b" style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                      <div className="row" style={{ gap: "10px" }}>
                        <Landmark className="ic ic-md" aria-hidden="true" style={{ color: "var(--og-teal-dark)" }} />
                        <div>
                          <div className="b" style={{ fontSize: "15px" }}>
                            {payee?.reason ?? "Verify a payout destination in Passport"}
                          </div>
                          <div className="small muted">The destination itself is shown and changed only in Passport</div>
                        </div>
                      </div>
                      <div className="bnr bnr-neu" style={{ padding: "10px 12px" }}>
                        <Clock className="ic" aria-hidden="true" />
                        <div>
                          <div className="t" style={{ fontSize: "14px" }}>
                            Change control
                          </div>
                          <div className="d" style={{ fontSize: "13px" }}>
                            Destination changes are made in Passport by an authorized signer, take 5 business days to cool off, and pause any payment due in that window. Funders see the status, never the account details.
                          </div>
                        </div>
                      </div>
                      {org.editUrl && (
                        <a href={org.editUrl} className="btn btn-secondary btn-lg btn-block">
                          Manage destination in Passport
                        </a>
                      )}
                    </div>
                  </section>

                  <section className="card" aria-labelledby="ready-h">
                    <div className="card-h" style={{ padding: "14px 16px" }}>
                      <h3 id="ready-h" style={{ fontSize: "16px" }}>
                        Readiness
                      </h3>
                      <span className="small muted">{org.syncedAt ? `Synced ${formatDate(org.syncedAt)}` : "Not synced"}</span>
                    </div>
                    <ul className="rc" style={{ padding: "4px 16px 12px", fontSize: "15px" }}>
                      {readiness.checks.map((c, i) => {
                        const look = STATE[c.state];
                        return (
                          <li key={c.key} className={`rc-row ${look.cls}`} style={i === 0 ? { borderTop: 0 } : undefined}>
                            <look.icon className="ic" role="img" aria-label={look.word} />
                            <div>
                              <div className="l">{c.label}</div>
                              <div className="r">{c.reason}</div>
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
                        Who has access
                      </h3>
                      <Link to={`${base}/team`} className="small b">
                        Manage
                      </Link>
                    </div>
                    {active.length === 0 ? (
                      <p className="small muted" style={{ padding: "12px 16px 16px" }}>
                        No funder can read your record yet. Applying to a funder shares it with that funder.
                      </p>
                    ) : (
                      <ul style={{ display: "flex", flexDirection: "column" }}>
                        {active.map((c, i) => (
                          <li key={c.id} className="row" style={{ padding: "12px 16px", gap: "12px", minHeight: "56px", ...(i < active.length - 1 ? { borderBottom: "1px solid var(--og-gray-100)" } : {}) }}>
                            <div className="grow">
                              <div className="b" style={{ fontSize: "15px" }}>
                                {c.funder.name ?? "Funder"}
                              </div>
                              <div className="small muted">
                                {BASIS[c.basis] ?? c.basis} · since {formatDate(c.grantedAt)}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <LockerCard editUrl={org.editUrl} />
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
