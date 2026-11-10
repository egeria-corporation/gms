// SPDX-License-Identifier: AGPL-3.0-only
// My grants: every award on record, and for the open one the offer, acceptance and the grant
// agreement with click-to-sign. Signing is a human gate: the Sign button needs the typed legal
// name and the attestation, and the server refuses agent tokens.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Award as AwardIcon, Check, Clock, Globe, Hash, Lock, Mail, PenLine, User, X } from "lucide-react";
import type { Agreement, ApplicantApi, Award, AwardDetail } from "../../api/applicant.ts";
import { useApplicantMutation, useApplicantQuery } from "../../api/applicantHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { accentOf, FunderChip, isNotFound, Loaded } from "../../components/applicant.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { DataTable, EmptyState, ErrorBanner, type Column } from "../../components/ui.tsx";
import { formatDate, formatMinor } from "../../lib/format.ts";
import { BeforeYouSign, GrantDocuments, GrantMessages } from "./grantExtras.tsx";

interface GrantsData {
  awards: Award[];
  award: AwardDetail | null;
  agreement: Agreement | null;
}

async function load(api: ApplicantApi, awardId: string | undefined): Promise<GrantsData> {
  const awards = await api.awards();
  const id = awardId ?? awards.find((w) => w.status === "offered" || w.status === "accepted")?.id ?? awards[0]?.id;
  const award = id ? await api.award(id) : null;
  const agreement = award?.agreement ? await api.agreement(award.agreement.id) : null;
  return { awards, award, agreement };
}

const AGREEMENT_STEPS = ["draft", "sent", "signed_by_grantee", "countersigned", "executed"] as const;
const AGREEMENT_LABELS: Record<(typeof AGREEMENT_STEPS)[number], string> = { draft: "Draft", sent: "Sent", signed_by_grantee: "Signed by grantee", countersigned: "Countersigned", executed: "Executed" };
const period = (keyDates: Record<string, unknown>) => {
  const p = keyDates.periodOfPerformance as { startDate?: string; endDate?: string } | undefined;
  return p?.startDate && p.endDate ? `${formatDate(p.startDate)} – ${formatDate(p.endDate)}` : null;
};
const shortHash = (h: string | null | undefined) => (h ? `${h.slice(0, 4)}…${h.slice(-4)}` : "—");

function SignDialog({ award, agreement, open, onClose, onSigned }: { award: AwardDetail; agreement: Agreement; open: boolean; onClose: () => void; onSigned: (a: Agreement) => void }) {
  const ws = useWorkspace("applicant");
  const [name, setName] = useState("");
  const [attest, setAttest] = useState(false);
  const sign = useApplicantMutation((api) => api.signAgreement(agreement.id, { name: name.trim(), attest: true, ...(agreement.documentSha256 ? { documentSha256: agreement.documentSha256 } : {}) }));
  return (
    <Dialog open={open} onClose={onClose} labelledBy="sign-title" size="lg">
      <div className="hd">
        <div>
          <h2 id="sign-title" style={{ fontSize: "20px" }}>
            Sign the grant agreement
          </h2>
          <p className="small muted" style={{ marginTop: "4px" }}>
            {award.funder.name} · {award.title} · {formatMinor(award.awardedAmountMinor, award.currency)}
          </p>
        </div>
        <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: "20px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span className="eyebrow">Document</span>
          <div className="card" style={{ padding: "16px 18px", fontSize: "14px", lineHeight: 1.6, display: "flex", flexDirection: "column", gap: "8px" }}>
            <div className="b" style={{ fontFamily: "var(--font-display)", fontSize: "16px" }}>
              Grant Agreement — {award.title}
            </div>
            <p>
              Between {award.funder.name} and {award.recipient?.name ?? ws.name}, for {formatMinor(award.awardedAmountMinor, award.currency)}
              {period(award.keyDates) ? `, ${period(award.keyDates)}` : ""}.
            </p>
            <p className="small muted">Read the full agreement before signing. What you sign is the exact document with the hash below.</p>
          </div>
          <div className="row small muted" style={{ gap: "6px", flexWrap: "wrap" }}>
            <Hash className="ic" aria-hidden="true" />
            Document hash <span className="mono">sha256 {shortHash(agreement.documentSha256)}</span> · version {agreement.version}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="fld">
            <label className="lbl" htmlFor="sign-name">
              Type your full legal name
            </label>
            <input className="inp" id="sign-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" style={{ fontFamily: "var(--font-emphasis)", fontStyle: "italic", fontSize: "20px", height: "48px" }} />
            <span className="help">Signing is for a workspace admin who is authorized to bind the organization.</span>
          </div>
          <label className="cb" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} style={{ width: "18px", height: "18px", marginTop: "2px" }} />
            <span>
              I am authorized to sign for {award.recipient?.name ?? ws.name} and agree to the terms above.
            </span>
          </label>
          <div className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px" }}>
            <span className="eyebrow">What is recorded</span>
            <span className="row" style={{ gap: "8px" }}>
              <User className="ic" aria-hidden="true" />
              Typed name{name.trim() ? ` · ${name.trim()}` : ""}
            </span>
            <span className="row" style={{ gap: "8px" }}>
              <Clock className="ic" aria-hidden="true" />
              Time of signing (UTC)
            </span>
            <span className="row" style={{ gap: "8px" }}>
              <Globe className="ic" aria-hidden="true" />
              IP address of this session
            </span>
            <span className="row" style={{ gap: "8px" }}>
              <Hash className="ic" aria-hidden="true" />
              Document hash · sha256 {shortHash(agreement.documentSha256)}
            </span>
          </div>
          <div className="notice" style={{ alignItems: "flex-start" }}>
            <Lock className="ic" aria-hidden="true" />
            Signing is a human gate: a connected agent can prepare this agreement but can never sign it.
          </div>
          {sign.error ? <ErrorBanner error={sign.error} title="The agreement was not signed" /> : null}
        </div>
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary btn-lg"
          type="button"
          disabled={!name.trim() || !attest || sign.state === "saving"}
          onClick={async () => {
            const signed = await sign.run();
            if (signed) onSigned(signed);
          }}
        >
          <PenLine className="ic" aria-hidden="true" />
          {sign.state === "saving" ? "Signing…" : "Sign agreement"}
        </button>
      </div>
    </Dialog>
  );
}

export default function GrantOffered() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const navigate = useNavigate();
  const { awardId } = useParams();
  const query = useApplicantQuery((api) => load(api, awardId), [awardId, ws.id]);
  const [signing, setSigning] = useState(false);
  const accept = useApplicantMutation((api, id: string) => api.acceptAward(id));
  if (query.status === "error" && isNotFound(query.error)) return <NotFound />;

  return (
    <>
      <title>{`My grants — ${ws.name}`}</title>
      <ApplicantShell active="My grants">
        <main className="main">
          <Loaded query={query} label="Loading your grants">
            {({ awards, award, agreement }) => {
              const total = awards.reduce((n, w) => n + (w.awardedAmountMinor ?? 0), 0);
              const received = awards.reduce((n, w) => n + (w.disbursedAmountMinor ?? 0), 0);
              const columns: Column<Award>[] = [
                { key: "funder", header: "Funder", cell: (w) => <FunderChip name={w.funder.name} accent={accentOf(w.funder.brand)} />, sort: (w) => w.funder.name },
                {
                  key: "title",
                  header: "Title",
                  sort: (w) => w.title,
                  cell: (w) => (
                    <Link to={`${base}/grants/${w.id}/offer`} className="b">
                      {w.title}
                    </Link>
                  ),
                },
                { key: "awarded", header: "Awarded", numeric: true, cell: (w) => formatMinor(w.awardedAmountMinor, w.currency), sort: (w) => w.awardedAmountMinor },
                { key: "received", header: "Received", numeric: true, cell: (w) => formatMinor(w.disbursedAmountMinor ?? 0, w.currency), sort: (w) => w.disbursedAmountMinor },
                { key: "remaining", header: "Remaining", numeric: true, cell: (w) => formatMinor((w.awardedAmountMinor ?? 0) - (w.disbursedAmountMinor ?? 0), w.currency) },
                { key: "status", header: "Status", cell: (w) => <StatusBadge kind="award" status={w.status} /> },
              ];
              const step = agreement ? AGREEMENT_STEPS.indexOf(agreement.status as (typeof AGREEMENT_STEPS)[number]) : -1;
              const first = award?.tranches.find((t) => t.seq === 1);
              return (
                <>
                  <div className="ph">
                    <div>
                      <h1>My grants</h1>
                      <div className="meta">
                        <span>
                          {awards.length} grant{awards.length === 1 ? "" : "s"} · {formatMinor(total)} awarded · {formatMinor(received)} received
                        </span>
                      </div>
                    </div>
                  </div>

                  <DataTable
                    label="Grants"
                    columns={columns}
                    rows={awards}
                    rowKey={(w) => w.id}
                    selectedKey={award?.id ?? null}
                    empty={
                      <EmptyState icon={AwardIcon} title="No grants yet">
                        An award appears here when a funder offers one.
                      </EmptyState>
                    }
                  />

                  {award && (
                    <>
                      <div className="card" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: "14px" }}>
                        <div className="row" style={{ gap: "14px", flexWrap: "wrap" }}>
                          <FunderChip name={award.funder.name} accent={accentOf(award.funder.brand)} />
                          <h2 style={{ fontSize: "20px" }}>{award.title}</h2>
                          <StatusBadge kind="award" status={award.status} large />
                          <span className="small muted" style={{ marginLeft: "auto" }}>
                            Award <span className="mono">{award.id}</span>
                            {period(award.keyDates) ? ` · period ${period(award.keyDates)}` : ""}
                          </span>
                        </div>
                        <div className="amounts" style={{ flexWrap: "wrap" }}>
                          <div>
                            <div className="stat-l">Awarded</div>
                            <div className="stat-v">{formatMinor(award.awardedAmountMinor, award.currency)}</div>
                          </div>
                          <div>
                            <div className="stat-l">Disbursed</div>
                            <div className="stat-v">{formatMinor(award.disbursedAmountMinor ?? 0, award.currency)}</div>
                          </div>
                          <div>
                            <div className="stat-l">Remaining</div>
                            <div className="stat-v">{formatMinor((award.awardedAmountMinor ?? 0) - (award.disbursedAmountMinor ?? 0), award.currency)}</div>
                          </div>
                        </div>
                        {accept.error ? <ErrorBanner error={accept.error} title="The award was not accepted" /> : null}
                        {award.status === "offered" && (
                          <div className="bnr bnr-info">
                            <Mail className="ic" aria-hidden="true" />
                            <div>
                              <div className="t">
                                {award.funder.name} offered this award on {formatDate(award.createdAt)}.
                              </div>
                              <div className="d">
                                Accepting opens the grant agreement for signature.
                                {first ? ` The first tranche (${formatMinor(first.amountMinor, first.currency)}) is released after both signatures and a readiness check.` : ""}
                              </div>
                            </div>
                            <button
                              className="btn btn-primary act"
                              type="button"
                              disabled={accept.state === "saving"}
                              onClick={async () => {
                                const next = await accept.run(award.id);
                                if (next) query.set({ awards: awards.map((w) => (w.id === next.id ? { ...w, status: next.status } : w)), award: next, agreement });
                              }}
                            >
                              {accept.state === "saving" ? "Accepting…" : "Accept award"}
                            </button>
                          </div>
                        )}
                        <div className="row" style={{ gap: "14px", flexWrap: "wrap" }}>
                          <Link to={`${base}/grants/${award.id}`} className="small b">
                            Payments and schedule
                          </Link>
                          <Link to={`${base}/reports`} className="small b">
                            Reports
                          </Link>
                        </div>
                      </div>

                      <section className="card" aria-labelledby="agr-h">
                        <div className="card-h">
                          <div>
                            <h2 id="agr-h" style={{ fontSize: "18px" }}>
                              Grant agreement
                            </h2>
                            {agreement && (
                              <p className="small muted">
                                {award.funder.name} · version {agreement.version} · generated {formatDate(agreement.createdAt)}
                              </p>
                            )}
                          </div>
                          {agreement && <StatusBadge kind="agreement" status={agreement.status} />}
                        </div>
                        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                          {!agreement ? (
                            <p className="muted">{award.funder.name} has not sent an agreement for this award.</p>
                          ) : (
                            <>
                              <ol className="stp" aria-label="Agreement status" style={{ flexWrap: "wrap", rowGap: "8px" }}>
                                {AGREEMENT_STEPS.map((s, i) => (
                                  <li key={s} style={{ display: "contents" }}>
                                    {i > 0 && <span className={i <= step ? "ln done" : "ln"} aria-hidden="true"></span>}
                                    <div className={i < step || (i === step && s === "executed") ? "s done" : i === step ? "s on" : "s"} aria-current={i === step ? "step" : undefined}>
                                      <span className="n">{i < step ? <Check className="ic ic-sm" aria-hidden="true" /> : i + 1}</span>
                                      {AGREEMENT_LABELS[s]}
                                    </div>
                                  </li>
                                ))}
                              </ol>
                              <div className="row small muted" style={{ gap: "6px", flexWrap: "wrap" }}>
                                <Hash className="ic" aria-hidden="true" />
                                Document hash <span className="mono">sha256 {shortHash(agreement.documentSha256)}</span>
                                {agreement.granteeSignature && (
                                  <span>
                                    · signed by {agreement.granteeSignature.name} on {formatDate(agreement.granteeSignature.at)}
                                  </span>
                                )}
                                {agreement.funderSignature && (
                                  <span>
                                    · countersigned by {agreement.funderSignature.name} on {formatDate(agreement.funderSignature.at)}
                                  </span>
                                )}
                              </div>
                              {agreement.status === "sent" && award.status === "offered" && <p className="small muted">Accept the award to sign the agreement.</p>}
                              {agreement.status === "sent" && (
                                <button className="btn btn-primary btn-lg" type="button" aria-haspopup="dialog" style={{ alignSelf: "flex-start" }} onClick={() => setSigning(true)}>
                                  <PenLine className="ic" aria-hidden="true" />
                                  Review and sign
                                </button>
                              )}
                              {agreement.status === "signed_by_grantee" && <p className="small muted">Waiting for {award.funder.name} to countersign. You will be told when the agreement is executed.</p>}
                            </>
                          )}
                        </div>
                      </section>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px", alignItems: "start" }}>
                        <BeforeYouSign award={award} />
                        <GrantDocuments award={award} base={base} />
                      </div>
                      <GrantMessages award={award} />

                      {agreement && (
                        <SignDialog
                          award={award}
                          agreement={agreement}
                          open={signing}
                          onClose={() => setSigning(false)}
                          onSigned={(signed) => {
                            setSigning(false);
                            query.set({ awards, award: { ...award, agreement: award.agreement ? { ...award.agreement, status: signed.status, granteeSignedAt: signed.granteeSignedAt } : null }, agreement: signed });
                            navigate(`${base}/grants/${award.id}/offer`, { replace: true });
                          }}
                        />
                      )}
                    </>
                  )}
                </>
              );
            }}
          </Loaded>
        </main>
      </ApplicantShell>
    </>
  );
}
