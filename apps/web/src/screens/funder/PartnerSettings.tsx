// SPDX-License-Identifier: AGPL-3.0-only
// Settings → Partners (E4). For a workspace that runs two or more funds (an intermediary): a
// co-branded onboarding link for its funds' grantees and affiliated funders, with a logo it uploads
// and the logo's alt text, and a request to be listed in the partner directory, which an operator
// approves and the workspace can withdraw at any time. Colours on the page it opens come only from
// the theme. Every change is an admin's, in person.
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { CircleCheck, CircleDashed, CircleX, Handshake, Hourglass, ImageUp, Info, Link2, Link2Off, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { LOGO_MAX_BYTES, LOGO_TYPES, type DirectoryListing, type LogoType, type PartnerSettings as Settings } from "../../api/loops.ts";
import { useLoopsMutation, useLoopsQuery } from "../../api/loopsHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { CopyButton } from "../../components/CopyButton.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { ErrorBanner, Field, Loading, Notice, PageHeader, problemFor } from "../../components/ui.tsx";
import { formatList } from "@gms/i18n";
import { formatDate } from "../../lib/format.ts";
import { SettingsNav } from "./SettingsPassport.tsx";
import { t, useFunderMessages } from "./i18n.ts";

const LISTING = {
  pending: { icon: Hourglass, cls: "bdg bdg-prog", key: "partnerSettings.listing.status.pending" },
  approved: { icon: CircleCheck, cls: "bdg bdg-ok", key: "partnerSettings.listing.status.approved" },
  rejected: { icon: CircleX, cls: "bdg bdg-dng", key: "partnerSettings.listing.status.rejected" },
  withdrawn: { icon: CircleDashed, cls: "bdg bdg-neutral", key: "partnerSettings.listing.status.withdrawn" },
} as const;

function ListingStatus({ status }: { status: DirectoryListing["status"] }) {
  const s = LISTING[status];
  return (
    <span className={s.cls}>
      <s.icon className="ic" aria-hidden="true" />
      {t(s.key)}
    </span>
  );
}

const base64Of = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });

function LinkCard({ settings, workspaceId, onSaved }: { settings: Settings; workspaceId: string; onSaved: (s: Settings) => void }) {
  const make = useLoopsMutation((api) => api.createOnboardingLink(workspaceId));
  const replace = useLoopsMutation((api) => api.replaceOnboardingLink(workspaceId));
  const revoke = useLoopsMutation((api) => api.revokeOnboardingLink(workspaceId));
  const upload = useLoopsMutation((api, input: { mime: LogoType; contentBase64: string; alt: string }) => api.putLogo(workspaceId, input));
  const removeLogo = useLoopsMutation((api) => api.removeLogo(workspaceId));
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState(settings.link?.logo?.alt ?? "");
  const [local, setLocal] = useState<Record<string, string>>({});
  const link = settings.link;
  const error = make.error ?? replace.error ?? revoke.error ?? removeLogo.error;
  const busy = [make, replace, revoke, upload, removeLogo].some((m) => m.state === "saving");
  const done = (s: Settings | undefined) => s && onSaved(s);

  async function submitLogo(e: FormEvent) {
    e.preventDefault();
    const problems: Record<string, string> = {};
    if (!file && !link?.logo) problems.file = t("partnerSettings.logo.chooseFile");
    if (file && !(LOGO_TYPES as readonly string[]).includes(file.type)) problems.file = t("partnerSettings.logo.wrongType");
    if (file && file.size > LOGO_MAX_BYTES) problems.file = t("partnerSettings.logo.tooLarge");
    if (!alt.trim()) problems.alt = t("partnerSettings.logo.altRequired");
    setLocal(problems);
    if (Object.keys(problems).length || !file) return;
    done(await upload.run({ mime: file.type as LogoType, contentBase64: await base64Of(file), alt: alt.trim() }));
    setFile(null);
  }

  return (
    <section className="card" aria-labelledby="partner-link">
      <div className="card-h">
        <h2 id="partner-link" style={{ fontSize: "15px" }} className="row">
          <Link2 className="ic" aria-hidden="true" />
          {t("partnerSettings.link.title")}
        </h2>
        {link && <span className="small muted">{t("partnerSettings.link.joined", { count: link.joined })}</span>}
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p className="small muted">{t("partnerSettings.link.intro")}</p>
        {error !== null && <ErrorBanner error={error} />}
        {!link ? (
          <div>
            <button type="button" className="btn btn-primary" disabled={busy || !settings.canChange} onClick={async () => done(await make.run())}>
              <Link2 className="ic" aria-hidden="true" />
              {t("partnerSettings.link.make")}
            </button>
          </div>
        ) : (
          <>
            <Field id="partner-link-url" label={t("partnerSettings.link.url")} help={t("partnerSettings.link.urlHelp")}>
              <div className="row" style={{ gap: "8px" }}>
                <input id="partner-link-url" className="inp mono" readOnly value={link.url} style={{ flex: 1 }} />
                <CopyButton value={link.url} what={t("partnerSettings.link.url")} />
              </div>
            </Field>
            <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
              <Link to={`/join/${link.token}`} className="btn btn-secondary">
                {t("partnerSettings.link.open")}
              </Link>
              <button type="button" className="btn btn-secondary" disabled={busy || !settings.canChange} onClick={async () => done(await replace.run())}>
                <RefreshCw className="ic" aria-hidden="true" />
                {t("partnerSettings.link.replace")}
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy || !settings.canChange} onClick={async () => done(await revoke.run())}>
                <Link2Off className="ic" aria-hidden="true" />
                {t("partnerSettings.link.turnOff")}
              </button>
            </div>
            <form onSubmit={submitLogo} noValidate style={{ display: "flex", flexDirection: "column", gap: "12px", borderTop: "1px solid var(--og-gray-200)", paddingTop: "14px" }} aria-labelledby="partner-logo">
              <h3 id="partner-logo" style={{ fontSize: "14px" }}>
                {t("partnerSettings.logo.title")}
              </h3>
              {upload.error !== null && <ErrorBanner error={upload.error} title={t("partnerSettings.logo.notSaved")} />}
              {link.logo && (
                <div className="row" style={{ gap: "12px", alignItems: "center" }}>
                  <img src={link.logo.url} alt={link.logo.alt} style={{ maxHeight: "56px", maxWidth: "200px", width: "auto", objectFit: "contain", border: "1px solid var(--og-gray-200)", borderRadius: "6px", padding: "4px", background: "var(--og-white)" }} />
                  <button type="button" className="btn btn-sm btn-secondary" disabled={busy || !settings.canChange} onClick={async () => done(await removeLogo.run())}>
                    <Trash2 className="ic" aria-hidden="true" />
                    {t("partnerSettings.logo.remove")}
                  </button>
                </div>
              )}
              <Field id="partner-logo-file" label={link.logo ? t("partnerSettings.logo.replaceFile") : t("partnerSettings.logo.file")} help={t("partnerSettings.logo.fileHelp")} error={local.file ?? problemFor(upload.error, "contentBase64")}>
                <input id="partner-logo-file" type="file" accept={LOGO_TYPES.join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </Field>
              <Field id="partner-logo-alt" label={t("partnerSettings.logo.alt")} required help={t("partnerSettings.logo.altHelp")} error={local.alt ?? problemFor(upload.error, "alt")}>
                <input id="partner-logo-alt" className="inp" value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} />
              </Field>
              <div>
                <button type="submit" className="btn btn-primary" disabled={busy || !settings.canChange || !file}>
                  <ImageUp className="ic" aria-hidden="true" />
                  {upload.state === "saving" ? t("partnerSettings.logo.uploading") : t("partnerSettings.logo.upload")}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  );
}

function DirectoryCard({ settings, workspaceId, onSaved }: { settings: Settings; workspaceId: string; onSaved: () => void }) {
  const listing = settings.listing;
  const [region, setRegion] = useState(listing?.region ?? "");
  const ask = useLoopsMutation((api, r: string) => api.requestListing(workspaceId, r));
  const withdraw = useLoopsMutation((api) => api.withdrawListing(workspaceId));
  const open = listing && (listing.status === "pending" || listing.status === "approved");
  const busy = ask.state === "saving" || withdraw.state === "saving";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await ask.run(region.trim())) onSaved();
  }

  return (
    <section className="card" aria-labelledby="partner-directory">
      <div className="card-h">
        <h2 id="partner-directory" style={{ fontSize: "15px" }} className="row">
          <Handshake className="ic" aria-hidden="true" />
          {t("partnerSettings.listing.title")}
        </h2>
        {listing && <ListingStatus status={listing.status} />}
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <p className="small muted">{t.rich("partnerSettings.listing.intro", { link: (chunks) => <Link to="/partners">{chunks}</Link> })}</p>
        {(ask.error ?? withdraw.error) !== null && <ErrorBanner error={ask.error ?? withdraw.error} />}
        {listing?.status === "pending" && <Notice tone="info" title={t("partnerSettings.listing.pendingNote", { date: formatDate(listing.submittedAt) })} />}
        {listing?.status === "approved" && <Notice tone="ok" title={t("partnerSettings.listing.approvedNote", { region: listing.region })} />}
        {listing?.status === "rejected" && (
          <Notice tone="warn" title={t("partnerSettings.listing.rejectedNote")}>
            {listing.decisionReason}
          </Notice>
        )}
        {open ? (
          <div>
            <button type="button" className="btn btn-secondary" disabled={busy || !settings.canChange} onClick={async () => (await withdraw.run()) && onSaved()}>
              <Undo2 className="ic" aria-hidden="true" />
              {listing!.status === "approved" ? t("partnerSettings.listing.withdraw") : t("partnerSettings.listing.withdrawRequest")}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <Field id="partner-region" label={t("partnerSettings.listing.region")} required help={t("partnerSettings.listing.regionHelp")} error={problemFor(ask.error, "region")}>
              <input id="partner-region" className="inp" value={region} maxLength={100} onChange={(e) => setRegion(e.target.value)} />
            </Field>
            <div>
              <button type="submit" className="btn btn-primary" disabled={busy || !settings.canChange || region.trim().length < 2}>
                {t("partnerSettings.listing.ask")}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

export default function PartnerSettings() {
  useFunderMessages();
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const isAdmin = (ws.member.role ?? "admin") === "admin";
  const query = useLoopsQuery((api) => (isAdmin ? api.partnerSettings(ws.id) : Promise.resolve(null)), [ws.id, isAdmin]);
  const [version, setVersion] = useState(0);
  const s = query.status === "ready" ? query.data : null;

  return (
    <FunderShell active="Settings">
      <title>{t("partnerSettings.pageTitle", { name: ws.name })}</title>
      <main className="main">
        <PageHeader crumbs={[{ label: ws.name, to: base }, { label: t("partnerSettings.settings") }, { label: t("partnerSettings.title") }]} title={t("partnerSettings.settings")} />
        <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
          <SettingsNav base={base} active="partners" />
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <section className="card" aria-labelledby="partner-intro">
              <div className="card-b row" style={{ gap: "12px", alignItems: "flex-start" }}>
                <Handshake className="ic ic-md" aria-hidden="true" />
                <div>
                  <h2 id="partner-intro" style={{ fontSize: "16px" }}>
                    {t("partnerSettings.title")}
                  </h2>
                  <p className="small muted">{t("partnerSettings.intro")}</p>
                </div>
              </div>
            </section>
            {!isAdmin && <Notice tone="neu" title={t("partnerSettings.adminsOnly")} />}
            {query.status === "loading" && <Loading />}
            {query.status === "error" && <ErrorBanner error={query.error} onRetry={query.reload} />}
            {s && !s.eligible && (
              <Notice tone="neu" title={t("partnerSettings.notEligible", { count: s.minFunds })}>
                {t.rich("partnerSettings.notEligibleNote", { count: s.funds.length, link: (chunks) => <Link to={`${base}/settings/funds`}>{chunks}</Link> })}
              </Notice>
            )}
            {s && s.eligible && (
              <>
                <p className="small muted row" style={{ gap: "6px" }}>
                  <Info className="ic ic-sm" aria-hidden="true" />
                  {t("partnerSettings.fundsShown", { funds: formatList(t.locale, s.funds.map((f) => f.name)) })}
                </p>
                <LinkCard key={`link-${version}`} settings={s} workspaceId={ws.id} onSaved={(next) => (query.set(next), setVersion((v) => v + 1))} />
                <DirectoryCard key={`dir-${version}-${s.listing?.status ?? "none"}`} settings={s} workspaceId={ws.id} onSaved={() => (query.reload(), setVersion((v) => v + 1))} />
              </>
            )}
          </div>
        </div>
      </main>
    </FunderShell>
  );
}
