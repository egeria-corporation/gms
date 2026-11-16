// SPDX-License-Identifier: AGPL-3.0-only
// Settings → Security: single sign-on (SAML 2.0) for the workspace (docs/sso.md). Admins list the
// email domains their staff sign in with, prove each one with a DNS record, give their IT team the
// service-provider values, and may require single sign-on for people on those domains. A domain is
// pending until OpenGrants connects the identity provider, then active.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CircleCheck, Clock, Download, KeyRound, Lock, Mail, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useWorkspace } from "../../app/workspace.tsx";
import type { DnsCheckResult, SsoDomain, SsoSettings } from "../../auth/sso.ts";
import { useSsoApi } from "../../auth/ssoHooks.ts";
import { CopyButton } from "../../components/CopyButton.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { ErrorBanner, Field, Loading, Notice, PageHeader, errorMessage } from "../../components/ui.tsx";
import { downloadBlob } from "../../lib/browser.ts";
import { formatDate } from "../../lib/format.ts";
import { SettingsNav } from "./SettingsPassport.tsx";
import { t, useFunderMessages } from "./i18n.ts";

/** Status is an icon and a label, never colour alone. */
export function DomainStatus({ d }: { d: SsoDomain }) {
  return (
    <span className="row" style={{ gap: "6px", flexWrap: "wrap" }}>
      {d.status === "active" ? (
        <span className="bdg bdg-ok">
          <CircleCheck className="ic" aria-hidden="true" />
          {t("settingsSecurity.active")}
        </span>
      ) : (
        <span className="bdg bdg-warn">
          <Clock className="ic" aria-hidden="true" />
          {t("settingsSecurity.pending")}
        </span>
      )}
      {d.required && (
        <span className="bdg bdg-info">
          <Lock className="ic" aria-hidden="true" />
          {t("settingsSecurity.required")}
        </span>
      )}
    </span>
  );
}

const CHECK_TEXT: Record<Exclude<DnsCheckResult, "matched">, () => string> = {
  not_found: () => t("settingsSecurity.check.notFound"),
  mismatch: () => t("settingsSecurity.check.mismatch"),
  error: () => t("settingsSecurity.check.error"),
};

function DomainRow({ d, onChanged }: { d: SsoDomain; onChanged: () => void }) {
  const api = useSsoApi();
  const [busy, setBusy] = useState<"check" | "remove" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [checked, setChecked] = useState<DnsCheckResult | null>(null);
  const act = async (what: "check" | "remove") => {
    setBusy(what);
    setProblem(null);
    try {
      if (what === "check") setChecked((await api.checkDomain(d.id)).check.result);
      else await api.removeDomain(d.id);
      onChanged();
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  };
  const label = `sso-domain-${d.id}`;
  return (
    <li className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }} aria-labelledby={label}>
      <div className="row" style={{ justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
          <span id={label} className="b mono">
            {d.domain}
          </span>
          <DomainStatus d={d} />
        </div>
        {confirm ? (
          <span className="row" style={{ gap: "8px" }}>
            <span className="small">{t("settingsSecurity.remove", { domain: d.domain })}</span>
            <button type="button" className="btn btn-sm btn-danger" disabled={busy !== null} onClick={() => void act("remove")}>
              {t("settingsSecurity.remove2")}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(false)}>
              {t("settingsSecurity.keepIt")}
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(true)} aria-label={t("settingsSecurity.remove3", { domain: d.domain })}>
            <Trash2 className="ic" aria-hidden="true" />
            {t("settingsSecurity.remove2")}
          </button>
        )}
      </div>

      {d.stage === "add_dns_record" && (
        <>
          <p className="small muted">{t("settingsSecurity.proveTheDomainIs")}</p>
          <dl className="kv">
            <dt>{t("settingsSecurity.type")}</dt>
            <dd className="mono">{d.dns.recordType}</dd>
            <dt>{t("settingsSecurity.name")}</dt>
            <dd className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
              <span className="mono" style={{ overflowWrap: "anywhere" }}>
                {d.dns.recordName}
              </span>
              <CopyButton value={d.dns.recordName} what={t("settingsSecurity.copyWhat.recordName")} className="btn btn-sm btn-secondary" />
            </dd>
            <dt>{t("settingsSecurity.value")}</dt>
            <dd className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
              <span className="mono" style={{ overflowWrap: "anywhere" }}>
                {d.dns.recordValue}
              </span>
              <CopyButton value={d.dns.recordValue} what={t("settingsSecurity.copyWhat.recordValue")} className="btn btn-sm btn-secondary" />
            </dd>
          </dl>
          <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy !== null} onClick={() => void act("check")}>
              <RefreshCw className="ic" aria-hidden="true" />
              {busy === "check" ? t("settingsSecurity.checking") : t("settingsSecurity.checkDnsRecord")}
            </button>
            {d.lastCheckedAt && <span className="small muted">{t("settingsSecurity.lastChecked", { date: formatDate(d.lastCheckedAt) })}</span>}
          </div>
          {(checked ?? d.lastCheckResult) && (checked ?? d.lastCheckResult) !== "matched" && (
            <span className="small" role="status">
              {CHECK_TEXT[(checked ?? d.lastCheckResult) as Exclude<DnsCheckResult, "matched">]?.()}
            </span>
          )}
        </>
      )}
      {d.stage === "waiting_for_provider" && (
        <Notice tone="info" title={t("settingsSecurity.dnsRecordFoundWaiting")}>
          {t("settingsSecurity.giveYourItTeam")}
        </Notice>
      )}
      {d.stage === "active" && (
        <p className="small muted">
          {d.activatedAt ? t("settingsSecurity.connectedSince", { date: formatDate(d.activatedAt), domain: d.domain }) : t("settingsSecurity.connected", { domain: d.domain })}
        </p>
      )}
      {problem && <ErrorBanner error={new Error(problem)} />}
    </li>
  );
}

function AddDomain({ disabled, onAdded }: { disabled: boolean; onAdded: () => void }) {
  const api = useSsoApi();
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await api.addDomain(domain.trim());
      setDomain("");
      onAdded();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="row" style={{ gap: "10px", alignItems: "flex-end", flexWrap: "wrap" }} onSubmit={(e) => void submit(e)}>
      <div style={{ flex: "1 1 260px" }}>
        <Field id="sso-add-domain" label={t("settingsSecurity.emailDomain")} help={t("settingsSecurity.thePartOfYour")} error={problem}>
          <input id="sso-add-domain" className="inp" value={domain} placeholder={t("settingsSecurity.exampleOrg")} disabled={disabled} onChange={(e) => setDomain(e.target.value)} />
        </Field>
      </div>
      <button type="submit" className="btn btn-secondary" disabled={disabled || busy || !domain.trim()}>
        {t("settingsSecurity.addDomain")}
      </button>
    </form>
  );
}

function ServiceProviderValues({ sp, workspaceName }: { sp: NonNullable<SsoSettings["serviceProvider"]>; workspaceName: string }) {
  const rows: [string, string][] = [
    [t("settingsSecurity.sp.entityId"), sp.entityId],
    [t("settingsSecurity.sp.metadataUrl"), sp.metadataUrl],
    [t("settingsSecurity.sp.acsUrl"), sp.acsUrl],
    [t("settingsSecurity.sp.nameIdFormat"), sp.nameIdFormat],
  ];
  const download = () => {
    const text = [t("settingsSecurity.sp.fileTitle", { workspace: workspaceName }), "", ...rows.map(([k, v]) => t("settingsSecurity.sp.fileRow", { name: k, value: v })), t("settingsSecurity.sp.metadataFile", { url: sp.metadataDownloadUrl }), "", t("settingsSecurity.sp.sendEmail")].join("\n");
    downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), "opengrants-gms-sso.txt");
  };
  return (
    <>
      <dl className="kv" style={{ gridTemplateColumns: "160px minmax(0, 1fr)" }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
              <span className="mono" style={{ overflowWrap: "anywhere" }}>
                {v}
              </span>
              {v.startsWith("http") && <CopyButton value={v} what={k.toLowerCase()} className="btn btn-sm btn-secondary" />}
            </dd>
          </div>
        ))}
      </dl>
      <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
        <a className="btn btn-secondary" href={sp.metadataDownloadUrl} download>
          <Download className="ic" aria-hidden="true" />
          {t("settingsSecurity.downloadMetadataFile")}
        </a>
        <button type="button" className="btn btn-secondary" onClick={download}>
          <Download className="ic" aria-hidden="true" />
          {t("settingsSecurity.downloadTheseValues")}
        </button>
      </div>
    </>
  );
}

export default function SettingsSecurity() {
  useFunderMessages();
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const api = useSsoApi();
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; error: unknown } | { status: "ready"; data: SsoSettings }>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    api.settings().then(
      (data) => setState({ status: "ready", data }),
      (error: unknown) => setState({ status: "error", error }),
    );
  }, [api]);
  useEffect(() => load(), [load, ws.id]);

  const setRequirement = async (require: boolean) => {
    setSaving(true);
    setProblem(null);
    try {
      await api.setRequirement(require);
      load();
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const s = state.status === "ready" ? state.data : null;
  const toggleDisabled = !s || saving || (!s.requireSso && !s.canRequire.ok);
  return (
    <FunderShell active="Settings">
      <title>{t("settingsSecurity.securitySettings", { name: ws.name })}</title>
      <main className="main">
        <PageHeader crumbs={[{ label: ws.name, to: base }, { label: t("settingsSecurity.settings") }, { label: t("settingsSecurity.security") }]} title={t("settingsSecurity.settings")} meta={<span>{ws.name}</span>} />
        <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
          <SettingsNav base={base} active="security" />
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {state.status === "loading" && <Loading label={t("settingsSecurity.loadingSingleSignOn")} />}
            {state.status === "error" && <ErrorBanner error={state.error} onRetry={load} />}
            {s && (
              <>
                <section className="card" aria-labelledby="sso-title">
                  <div className="card-h">
                    <div>
                      <h2 id="sso-title">{t("settingsSecurity.singleSignOn")}</h2>
                      <p className="small muted">
                        {t("settingsSecurity.letYourStaffSign")}
                      </p>
                    </div>
                  </div>
                  <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <span className="row small" style={{ gap: "6px" }} role="status">
                      {s.session.signedInThroughSso ? <ShieldCheck className="ic ic-sm" aria-hidden="true" /> : <Mail className="ic ic-sm" aria-hidden="true" />}
                      {s.session.signedInThroughSso ? t("settingsSecurity.youAreSignedIn") : t("settingsSecurity.youAreSignedIn2")}
                    </span>
                    {s.domains.length === 0 ? (
                      <p className="small muted">{t("settingsSecurity.noDomainsYet")}</p>
                    ) : (
                      <ul aria-label={t("settingsSecurity.singleSignOnDomains")} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                        {s.domains.map((d) => (
                          <DomainRow key={d.id} d={d} onChanged={load} />
                        ))}
                      </ul>
                    )}
                    <AddDomain disabled={s.domains.length >= s.maxDomains} onAdded={load} />
                  </div>
                </section>

                <section className="card" aria-labelledby="sso-require-title">
                  <div className="card-h">
                    <div>
                      <h2 id="sso-require-title">{t("settingsSecurity.requireSingleSignOn")}</h2>
                      <p className="small muted">{t("settingsSecurity.onlyActiveDomainsAre")}</p>
                    </div>
                  </div>
                  <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div className="row" style={{ gap: "12px", justifyContent: "space-between" }}>
                      <div>
                        <div className="b" id="sso-require-l">
                          {t("settingsSecurity.requireSingleSignOn2")}
                        </div>
                        <div className="small muted">{t("settingsSecurity.theyMustSignIn")}</div>
                      </div>
                      <button type="button" className={`tog${s.requireSso ? " on" : ""}`} role="switch" aria-checked={s.requireSso} aria-labelledby="sso-require-l" disabled={toggleDisabled} onClick={() => void setRequirement(!s.requireSso)}></button>
                    </div>
                    <span className="row small" style={{ gap: "6px" }}>
                      {s.requireSso ? <Lock className="ic ic-sm" aria-hidden="true" /> : <KeyRound className="ic ic-sm" aria-hidden="true" />}
                      {s.requireSso ? t("settingsSecurity.required") : t("settingsSecurity.notRequired")}
                    </span>
                    {!s.requireSso && !s.canRequire.ok && s.canRequire.reason && <Notice tone="neu" title={t("settingsSecurity.notAvailableYet")}>{s.canRequire.reason}</Notice>}
                    {problem && <ErrorBanner error={new Error(problem)} />}
                    <p className="small muted">
                      {t("settingsSecurity.ifYourIdentityProvider")}
                    </p>
                  </div>
                </section>

                <section className="card" aria-labelledby="sso-it-title">
                  <div className="card-h">
                    <div>
                      <h2 id="sso-it-title">{t("settingsSecurity.forYourItTeam")}</h2>
                      <p className="small muted">{t("settingsSecurity.setUpOpengrantsGms")}</p>
                    </div>
                  </div>
                  <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {s.serviceProvider ? <ServiceProviderValues sp={s.serviceProvider} workspaceName={ws.name} /> : <Notice tone="warn" title={t("settingsSecurity.notConfiguredOnThis")}>{t("settingsSecurity.theServerHasNo")}</Notice>}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </main>
    </FunderShell>
  );
}
