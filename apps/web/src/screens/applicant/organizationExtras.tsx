// SPDX-License-Identifier: AGPL-3.0-only
// The parts of the Organization screen that sit beside the Passport record: representatives, the
// documents locker (references only, read live), the apps that feed the record, and who may read it.
import { BadgeCheck, Check, Cloud, FileSpreadsheet, Landmark, UserCheck } from "lucide-react";
import { Link } from "react-router";
import type { Consent } from "../../api/applicant.ts";
import { useApplicantMutation } from "../../api/applicantHooks.ts";
import { useFullQuery } from "../../api/applicantFullHooks.ts";
import { FunderChip, Loaded, sourceLabel } from "../../components/applicant.tsx";
import { ErrorBanner } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";

const fileTag = (name: string, mime: string | null): { cls: string; text: string } => {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf" || mime === "application/pdf") return { cls: "ft ft-pdf", text: "PDF" };
  if (["xls", "xlsx", "csv"].includes(ext) || mime?.includes("spreadsheet")) return { cls: "ft ft-xls", text: "XLS" };
  if (["doc", "docx"].includes(ext)) return { cls: "ft ft-doc", text: "DOC" };
  return { cls: "ft", text: "FILE" };
};
const kindLabel = (kind: string) => kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Representatives are verified and kept in Passport, which does not share them with other apps. */
export function RepresentativesCard({ editUrl }: { editUrl: string | null }) {
  return (
    <section className="card" aria-labelledby="reps-h">
      <div className="card-h">
        <h2 id="reps-h" style={{ fontSize: "18px" }}>
          Representatives
        </h2>
        {editUrl ? (
          <a href={editUrl} className="small b">
            Manage in Passport
          </a>
        ) : null}
      </div>
      <div className="card-b row" style={{ gap: "12px", alignItems: "flex-start" }}>
        <UserCheck className="ic ic-md" aria-hidden="true" style={{ color: "var(--og-teal-dark)", marginTop: "2px" }} />
        <div>
          <p>The people who can sign and act for your organization are verified and kept in Passport.</p>
          <p className="help" style={{ marginTop: "4px" }}>
            Passport does not share the list with other apps, so it is not shown here. Funders see only that your organization's representatives are verified, as part of its level.
          </p>
        </div>
      </div>
    </section>
  );
}

export function LockerCard({ editUrl }: { editUrl: string | null }) {
  const query = useFullQuery((api) => api.locker(), []);
  return (
    <section className="card" aria-labelledby="locker-h">
      <div className="card-h">
        <h2 id="locker-h" style={{ fontSize: "18px" }}>
          Documents locker
        </h2>
        {editUrl ? (
          <a href={editUrl} className="small b">
            Upload to Passport
          </a>
        ) : null}
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <Loaded query={query} label="Reading your Passport locker">
          {(locker) =>
            locker.state === "unavailable" ? (
              <p className="muted" role="status">
                The locker can't be shown right now. {locker.reason ?? "Passport could not be reached."} Your documents are safe in Passport.
              </p>
            ) : locker.items.length === 0 ? (
              <p className="muted">No documents in your Passport locker yet. Upload them once in Passport and attach them to any application without copying.</p>
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
                            Passport locker
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{d.expiresAt ? `Expires ${formatDate(d.expiresAt)}` : "No expiry"}</span>
                          {d.sha256 ? <span className="mono">sha256 {d.sha256.slice(0, 4)}…{d.sha256.slice(-4)}</span> : null}
                        </div>
                      </div>
                      {d.attachable ? (
                        <span className="bdg bdg-ok">
                          <Check className="ic" aria-hidden="true" />
                          Can be attached
                        </span>
                      ) : (
                        <span className="bdg bdg-neutral" title="Passport holds a link to this file, not a fixed copy">
                          <Cloud className="ic" aria-hidden="true" />
                          Link only
                        </span>
                      )}
                    </div>
                  );
                })}
                <p className="help">Applications reference these files in Passport. The GMS never copies them.</p>
              </>
            )
          }
        </Loaded>
      </div>
    </section>
  );
}

const APP_OF: Record<string, { name: string; detail: string; icon: typeof Cloud }> = {
  qbo: { name: "QuickBooks", detail: "Financial figures in your record", icon: FileSpreadsheet },
  google_drive: { name: "Google Workspace", detail: "Drive files in your locker", icon: Cloud },
  irs_bmf: { name: "IRS records", detail: "Tax status and determination", icon: Landmark },
  irs_990: { name: "Form 990", detail: "Revenue, expenses and assets", icon: Landmark },
  sam: { name: "SAM.gov", detail: "Federal registration", icon: Landmark },
};

/** Apps are connected in Passport; this lists the ones that currently feed the record the GMS reads. */
export function ConnectedAppsCard({ sources, editUrl }: { sources: Record<string, unknown>; editUrl: string | null }) {
  const used = [...new Set(Object.values(sources).filter((v): v is string => typeof v === "string"))].filter((s) => s !== "user" && s !== "member");
  return (
    <section className="card" aria-labelledby="apps-h">
      <div className="card-h">
        <h2 id="apps-h" style={{ fontSize: "18px" }}>
          Connected apps
        </h2>
        {editUrl ? (
          <a href={editUrl} className="small b">
            Connect in Passport
          </a>
        ) : null}
      </div>
      <ul className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {used.length === 0 && <li className="muted">No connected app feeds your record yet. Apps such as QuickBooks and Google Workspace are connected in Passport, never here.</li>}
        {used.map((s) => {
          const app = APP_OF[s] ?? { name: sourceLabel(s), detail: "Feeds your Passport record", icon: Cloud };
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
                Feeding your record
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const SCOPE_WORDS: Record<string, string> = { "org:read": "Profile", "org.documents:read": "Documents", "payee:read": "Payee status", "org.changes:read": "Record changes", "org.changes:write": "Propose changes" };
export const canRead = (c: Consent): string => {
  const words = [...new Set(c.scopes.map((s) => SCOPE_WORDS[s] ?? s))];
  return words.length ? words.join(", ") : "Profile and level";
};
export const grantedVia = (c: Consent): string => `${c.basis === "application" ? "Application" : c.basis === "shared_submission" ? "Shared report" : "Passport grant"} · ${formatDate(c.grantedAt)}`;

export function AccessCard({ consents, base, onChanged }: { consents: Consent[]; base: string; onChanged: () => void }) {
  const revoke = useApplicantMutation((api, id: string) => api.revokeConsent(id));
  const active = consents.filter((c) => !c.revokedAt);
  return (
    <section className="card" aria-labelledby="access-h">
      <div className="card-h">
        <h2 id="access-h" style={{ fontSize: "18px" }}>
          Who has access
        </h2>
        <Link to={`${base}/team`} className="small b">
          Team &amp; access
        </Link>
      </div>
      {active.length === 0 ? (
        <div className="card-b">
          <p className="muted">No funder can read your record yet. Applying to a funder grants it access for that application.</p>
        </div>
      ) : (
        <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }} tabIndex={0} role="region" aria-label="Funders with access, scrollable">
          <table className="tbl" style={{ fontSize: "14px" }}>
            <caption className="sr">Funders that can read your Passport record</caption>
            <thead>
              <tr>
                <th scope="col">Funder</th>
                <th scope="col">Can read</th>
                <th scope="col">Granted via</th>
                <th scope="col">
                  <span className="sr">Actions</span>
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
                        aria-label={`Revoke ${c.funder.name ?? "this funder"}'s access`}
                        onClick={async () => {
                          if (await revoke.run(c.id)) onChanged();
                        }}
                      >
                        Revoke
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
          <ErrorBanner error={revoke.error} title="Access was not revoked" />
        </div>
      ) : null}
    </section>
  );
}
