// SPDX-License-Identifier: AGPL-3.0-only
// The parts of the Organization screen that sit beside the Passport record: representatives, the
// documents locker (references only, read live), the apps that feed the record, and who may read it.
import { BadgeCheck, Check, CircleDashed, Cloud, FileSpreadsheet, Landmark, UserCheck } from "lucide-react";
import { Link } from "react-router";
import type { Consent } from "../../api/applicant.ts";
import { useApplicantMutation } from "../../api/applicantHooks.ts";
import { useFullQuery } from "../../api/applicantFullHooks.ts";
import { useLaunchQuery } from "../../api/launchHooks.ts";
import { FunderChip, Loaded, sourceLabel } from "../../components/applicant.tsx";
import { ErrorBanner } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { DOC_TYPES, type DocType } from "../../lib/writeKeep.ts";
import { t } from "./i18n.ts";
import { docTypeLabel } from "./labels.ts";

const fileTag = (name: string, mime: string | null): { cls: string; text: string } => {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf" || mime === "application/pdf") return { cls: "ft ft-pdf", text: "PDF" };
  if (["xls", "xlsx", "csv"].includes(ext) || mime?.includes("spreadsheet")) return { cls: "ft ft-xls", text: "XLS" };
  if (["doc", "docx"].includes(ext)) return { cls: "ft ft-doc", text: "DOC" };
  return { cls: "ft", text: t("form.file") };
};
/** A locker document's kind: the vault's name for it when it is one of its types. */
const kindLabel = (kind: string) => ((DOC_TYPES as readonly string[]).includes(kind) ? docTypeLabel(kind as DocType) : kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** Representatives are verified and kept in Passport; the list is read from there and never stored here. */
export function RepresentativesCard({ editUrl }: { editUrl: string | null }) {
  const reps = useLaunchQuery((api) => api.representatives(), []);
  const data = reps.data;
  const manage = data?.manageUrl ?? editUrl;
  return (
    <section className="card" aria-labelledby="reps-h">
      <div className="card-h">
        <h2 id="reps-h" style={{ fontSize: "18px" }}>
          {t("organizationExtras.representatives")}
        </h2>
        {manage ? (
          <a href={manage} className="small b">
            {t("organizationExtras.manageInPassport")}
          </a>
        ) : null}
      </div>
      {reps.status === "error" && (
        <div className="card-b">
          <ErrorBanner error={reps.error} onRetry={reps.reload} />
        </div>
      )}
      {data && data.state === "ok" && data.items.length > 0 && (
        <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label={t("organizationExtras.representativesScrollable")}>
          <table className="tbl" style={{ fontSize: "14px" }} aria-label={t("organizationExtras.representatives")}>
            <thead>
              <tr>
                <th scope="col">{t("organizationExtras.person")}</th>
                <th scope="col">{t("organizationExtras.title")}</th>
                <th scope="col">{t("organizationExtras.verified")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.name}>
                  <td>
                    <span className="row" style={{ gap: "8px" }}>
                      <span className="av av-sm av-t" aria-hidden="true">
                        {initials(r.name)}
                      </span>
                      <span className="b">{r.name}</span>
                    </span>
                  </td>
                  <td>{r.title ?? <span className="muted">—</span>}</td>
                  <td>
                    {r.verified ? (
                      <span className="row" style={{ gap: "5px", color: "#0B5E47", fontWeight: 700 }}>
                        <BadgeCheck className="ic" aria-hidden="true" />
                        {r.verifiedAt ? t("organizationExtras.verifiedOn", { date: formatDate(r.verifiedAt) }) : t("organizationExtras.verified")}
                      </span>
                    ) : (
                      <span className="row muted" style={{ gap: "5px" }}>
                        <CircleDashed className="ic" aria-hidden="true" />
                        {t("organizationExtras.notVerifiedYet")}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(!data || data.state !== "ok" || data.items.length === 0) && reps.status !== "error" && (
        <div className="card-b row" style={{ gap: "12px", alignItems: "flex-start" }}>
          <UserCheck className="ic ic-md" aria-hidden="true" style={{ color: "var(--og-teal-dark)", marginTop: "2px" }} />
          <div>
            <p>{t("organizationExtras.thePeopleWhoCanSignAnd")}</p>
            <p className="help" style={{ marginTop: "4px" }}>
              {!data
                ? t("organizationExtras.loadingTheListFromPassport")
                : data.state === "unknown"
                  ? t("organizationExtras.passportCouldNotBeReachedJust")
                  : data.state === "not_linked"
                    ? t("organizationExtras.connectYourOrganizationsPassportRecordTo")
                    : data.state === "not_shared"
                      ? t("organizationExtras.yourOrganizationsConsentDoesNotShare")
                      : t("organizationExtras.noRepresentativesAreRecordedInPassport")}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export function LockerCard({ editUrl }: { editUrl: string | null }) {
  const query = useFullQuery((api) => api.locker(), []);
  return (
    <section className="card" aria-labelledby="locker-h">
      <div className="card-h">
        <h2 id="locker-h" style={{ fontSize: "18px" }}>
          {t("organizationExtras.documentsLocker")}
        </h2>
        {editUrl ? (
          <a href={editUrl} className="small b">
            {t("organizationExtras.uploadToPassport")}
          </a>
        ) : null}
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <Loaded query={query} label={t("organizationExtras.readingYourPassportLocker")}>
          {(locker) =>
            locker.state === "unavailable" ? (
              <p className="muted" role="status">
                {t("organizationExtras.lockerUnavailable", { reason: locker.reason ?? t("organizationExtras.passportCouldNotBeReached") })}
              </p>
            ) : locker.items.length === 0 ? (
              <p className="muted">{t("organizationExtras.noDocumentsInYourPassportLocker")}</p>
            ) : (
              <>
                {locker.items.map((d) => {
                  const tag = fileTag(d.name, d.mimeType);
                  return (
                    <div className="doc" key={d.id}>
                      <span className={tag.cls}>{tag.text}</span>
                      <div className="grow">
                        <div className="nm">{d.name}</div>
                        <div className="mt">
                          <span>{kindLabel(d.kind)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="prov prov-passport">
                            <BadgeCheck className="ic" aria-hidden="true" />
                            {t("organizationExtras.passportLocker")}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{d.expiresAt ? t("organizationExtras.expiresOn", { date: formatDate(d.expiresAt) }) : t("organizationExtras.noExpiry")}</span>
                          {d.sha256 ? <samp className="mono">sha256 {d.sha256.slice(0, 4)}…{d.sha256.slice(-4)}</samp> : null}
                        </div>
                      </div>
                      {d.attachable ? (
                        <span className="bdg bdg-ok">
                          <Check className="ic" aria-hidden="true" />
                          {t("organizationExtras.canBeAttached")}
                        </span>
                      ) : (
                        <span className="bdg bdg-neutral" title={t("organizationExtras.passportHoldsALinkToThis")}>
                          <Cloud className="ic" aria-hidden="true" />
                          {t("organizationExtras.linkOnly")}
                        </span>
                      )}
                    </div>
                  );
                })}
                <p className="help">{t("organizationExtras.applicationsReferenceTheseFilesInPassport")}</p>
              </>
            )
          }
        </Loaded>
      </div>
    </section>
  );
}

// Getters, so the words follow the page's language (docs/i18n.md).
const APP_OF: Record<string, { readonly name: string; readonly detail: string; icon: typeof Cloud }> = {
  qbo: { name: "QuickBooks", get detail() { return t("organizationExtras.app.qbo"); }, icon: FileSpreadsheet },
  google_drive: { name: "Google Workspace", get detail() { return t("organizationExtras.app.drive"); }, icon: Cloud },
  irs_bmf: { get name() { return t("organizationExtras.app.irsName"); }, get detail() { return t("organizationExtras.app.irs"); }, icon: Landmark },
  irs_990: { get name() { return t("organizationExtras.app.form990Name"); }, get detail() { return t("organizationExtras.app.form990"); }, icon: Landmark },
  sam: { name: "SAM.gov", get detail() { return t("organizationExtras.app.sam"); }, icon: Landmark },
};

/** Apps are connected in Passport; this lists the ones that currently feed the record the GMS reads. */
export function ConnectedAppsCard({ sources, editUrl }: { sources: Record<string, unknown>; editUrl: string | null }) {
  const used = [...new Set(Object.values(sources).filter((v): v is string => typeof v === "string"))].filter((s) => s !== "user" && s !== "member");
  return (
    <section className="card" aria-labelledby="apps-h">
      <div className="card-h">
        <h2 id="apps-h" style={{ fontSize: "18px" }}>
          {t("organizationExtras.connectedApps")}
        </h2>
        {editUrl ? (
          <a href={editUrl} className="small b">
            {t("organizationExtras.connectInPassport")}
          </a>
        ) : null}
      </div>
      <ul className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {used.length === 0 && <li className="muted">{t("organizationExtras.noConnectedAppFeedsYourRecord")}</li>}
        {used.map((s) => {
          const app = APP_OF[s] ?? { name: sourceLabel(s), detail: t("organizationExtras.app.feeds"), icon: Cloud };
          const Icon = app.icon;
          return (
            <li className="row" style={{ gap: "12px" }} key={s}>
              <span style={{ width: "36px", height: "36px", borderRadius: "8px", background: "var(--og-blue-light)", color: "var(--s-info-fg)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <Icon className="ic" aria-hidden="true" />
              </span>
              <div className="grow">
                <div className="b">{app.name}</div>
                <div className="small muted">{app.detail}</div>
              </div>
              <span className="bdg bdg-ok">
                <Check className="ic" aria-hidden="true" />
                {t("organizationExtras.feedingYourRecord")}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** What a scope lets a funder read, in words. */
const scopeWord = (s: string): string =>
  s === "org:read" ? t("organizationExtras.scope.profile") : s === "org.documents:read" ? t("organizationExtras.scope.documents") : s === "payee:read" ? t("organizationExtras.scope.payee") : s === "org.changes:read" ? t("organizationExtras.scope.changesRead") : s === "org.changes:write" ? t("organizationExtras.scope.changesWrite") : s;
export const canRead = (c: Consent): string => {
  const words = [...new Set(c.scopes.map(scopeWord))];
  return words.length ? words.join(", ") : t("organizationExtras.scope.profileLevel");
};
export const grantedVia = (c: Consent): string => `${c.basis === "application" ? t("organizationExtras.via.application") : c.basis === "shared_submission" ? t("organizationExtras.via.sharedReport") : t("organizationExtras.via.passport")} · ${formatDate(c.grantedAt)}`;

export function AccessCard({ consents, base, onChanged }: { consents: Consent[]; base: string; onChanged: () => void }) {
  const revoke = useApplicantMutation((api, id: string) => api.revokeConsent(id));
  const active = consents.filter((c) => !c.revokedAt);
  return (
    <section className="card" aria-labelledby="access-h">
      <div className="card-h">
        <h2 id="access-h" style={{ fontSize: "18px" }}>
          {t("organizationExtras.whoHasAccess")}
        </h2>
        <Link to={`${base}/team`} className="small b">
          {t("organizationExtras.teamAccess")}
        </Link>
      </div>
      {active.length === 0 ? (
        <div className="card-b">
          <p className="muted">{t("organizationExtras.noFunderCanReadYourRecord")}</p>
        </div>
      ) : (
        <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }} tabIndex={0} role="region" aria-label={t("organizationExtras.fundersWithAccessScrollable")}>
          <table className="tbl" style={{ fontSize: "14px" }}>
            <caption className="sr">{t("organizationExtras.fundersThatCanReadYourPassport")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("organizationExtras.funder")}</th>
                <th scope="col">{t("organizationExtras.canRead")}</th>
                <th scope="col">{t("organizationExtras.grantedVia")}</th>
                <th scope="col">
                  <span className="sr">{t("organizationExtras.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {active.map((c) => (
                <tr key={c.id}>
                  <td>
                    <FunderChip name={c.funder.name} />
                  </td>
                  <td style={{ whiteSpace: "normal" }}>{canRead(c)}</td>
                  <td style={{ whiteSpace: "normal" }}>{grantedVia(c)}</td>
                  <td>
                    <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        aria-label={c.funder.name ? t("organizationExtras.revokeAccess", { funder: c.funder.name }) : t("organizationExtras.revokeAccessThisFunder")}
                        onClick={async () => {
                          if (await revoke.run(c.id)) onChanged();
                        }}
                      >
                        {t("organizationExtras.revoke")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {revoke.error ? (
        <div style={{ padding: "0 20px 12px" }}>
          <ErrorBanner error={revoke.error} title={t("organizationExtras.accessWasNotRevoked")} />
        </div>
      ) : null}
    </section>
  );
}
