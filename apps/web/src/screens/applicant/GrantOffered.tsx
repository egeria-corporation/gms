// SPDX-License-Identifier: AGPL-3.0-only
// Awarded funding: every award on record, and for the open one the offer, acceptance and the grant
// agreement with click-to-sign. Signing is a human gate: the Sign button needs the typed legal
// name and the attestation, and the server refuses agent tokens.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Award as AwardIcon, Check, Clock, Globe, Hash, Lock, Mail, PenLine, User, X } from "lucide-react";
import type { Agreement, ApplicantApi, Award, AwardDetail } from "../../api/applicant.ts";
import { useApplicantMutation, useApplicantQuery } from "../../api/applicantHooks.ts";
import { useLaunchQuery } from "../../api/launchHooks.ts";
import { minorOf } from "../../api/outside.ts";
import type { OutsideAward } from "../../api/writeKeep.ts";
import { useWKQuery } from "../../api/writeKeepHooks.ts";
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

/** One row of Awarded funding: an award on this GMS, or one the organization records from a funder elsewhere. */
type GrantRow = { kind: "gms"; key: string; w: Award } | { kind: "outside"; key: string; o: OutsideAward };
const rowFunder = (r: GrantRow) => (r.kind === "gms" ? r.w.funder.name : r.o.funderName);
const rowTitle = (r: GrantRow) => (r.kind === "gms" ? r.w.title : r.o.title);
const rowAwarded = (r: GrantRow) => (r.kind === "gms" ? r.w.awardedAmountMinor : minorOf(r.o.awardedAmount));
const rowReceived = (r: GrantRow) => (r.kind === "gms" ? (r.w.disbursedAmountMinor ?? 0) : (minorOf(r.o.receivedAmount) ?? 0));
const rowCurrency = (r: GrantRow) => (r.kind === "gms" ? r.w.currency : (r.o.awardedAmount?.currency ?? "USD"));

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
  const reps = useLaunchQuery((api) => api.representatives(), []);
  const verified = reps.data?.state === "ok" ? reps.data.items.filter((r) => r.verified).map((r) => r.name) : [];
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
            <span className="help">{verified.length > 0 ? `Signing is for a verified representative. The name must match one in Passport: ${verified.join(", ")}.` : "Signing is for a workspace admin who is authorized to bind the organization."}</span>
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
  // Awards from funders outside this GMS, listed beside the built-in ones (v1.7).
  const outside = useWKQuery((api) => api.outsideAwards().catch(() => [] as OutsideAward[]), [ws.id]);
  const outsideAwards = outside.status === "ready" ? outside.data : [];
  const [signing, setSigning] = useState(false);
  // Where Passport lists verified representatives, the person accepting types their legal name and it must match one.
  const reps = useLaunchQuery((api) => api.representatives(), [ws.id]);
  const verified = reps.data?.state === "ok" ? reps.data.items.filter((r) => r.verified).map((r) => r.name) : [];
  const [acceptName, setAcceptName] = useState("");
  const accept = useApplicantMutation((api, id: string) => api.acceptAward(id, acceptName.trim() || undefined));
  if (query.status === "error" && isNotFound(query.error)) return <NotFound />;

  return (
    <>
      <title>{`Awarded funding — ${ws.name}`}</title>
      <ApplicantShell active="Awarded funding">
        <main className="main">
          <Loaded query={query} label="Loading your grants">
            {({ awards, award, agreement }) => {
              const rows: GrantRow[] = [...awards.map((w): GrantRow => ({ kind: "gms", key: `gms:${w.id}`, w })), ...outsideAwards.map((o): GrantRow => ({ kind: "outside", key: `outside:${o.id}`, o }))];
              const total = rows.reduce((n, r) => n + (rowAwarded(r) ?? 0), 0);
              const received = rows.reduce((n, r) => n + rowReceived(r), 0);
              const columns: Column<GrantRow>[] = [
                { key: "funder", header: "Funder", cell: (r) => (r.kind === "gms" ? <FunderChip name={r.w.funder.name} accent={accentOf(r.w.funder.brand)} /> : <FunderChip name={r.o.funderName} accent={accentOf(undefined)} />), sort: rowFunder },
                {
                  key: "title",
                  header: "Title",
                  sort: rowTitle,
                  cell: (r) => (
                    <div className="ent">
                      <Link to={r.kind === "gms" ? `${base}/grants/${r.w.id}/offer` : `${base}/grants/outside/${r.o.id}`} className="nm">
                        {rowTitle(r)}
                      </Link>
                      <span className="small">
                        <span className="tag">{r.kind === "gms" ? "On this GMS" : "Outside award"}</span>
                      </span>
                    </div>
                  ),
                },
                { key: "awarded", header: "Awarded", numeric: true, cell: (r) => formatMinor(rowAwarded(r), rowCurrency(r)), sort: rowAwarded },
                { key: "received", header: "Received", numeric: true, cell: (r) => formatMinor(rowReceived(r), rowCurrency(r)), sort: rowReceived },
                { key: "remaining", header: "Remaining", numeric: true, cell: (r) => formatMinor((rowAwarded(r) ?? 0) - rowReceived(r), rowCurrency(r)) },
                {
                  key: "status",
                  header: "Status",
                  cell: (r) =>
                    r.kind === "gms" ? (
                      <StatusBadge kind="award" status={r.w.status} />
                    ) : (
                      <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <StatusBadge kind="outside" status="awarded" label={r.o.closedOutAt ? "Closed out" : undefined} />
                        {r.o.nextDue && !r.o.closedOutAt && (
                          <span className="small muted">
                            Next: {r.o.nextDue.title}, {formatDate(r.o.nextDue.dueOn)}
                          </span>
                        )}
                      </span>
                    ),
                },
              ];
              const step = agreement ? AGREEMENT_STEPS.indexOf(agreement.status as (typeof AGREEMENT_STEPS)[number]) : -1;
              const first = award?.tranches.find((t) => t.seq === 1);
              return (
                <>
                  <div className="ph">
                    <div>
                      <h1>Awarded funding</h1>
                      <div className="meta">
                        <span>
                          {rows.length} grant{rows.length === 1 ? "" : "s"} · {formatMinor(total)} awarded · {formatMinor(received)} received
                        </span>
                        <span aria-hidden="true">·</span>
                        <Link to={`${base}/summary`}>Funding summary</Link>
                      </div>
                    </div>
                  </div>

                  <DataTable
                    label="Grants"
                    columns={columns}
                    rows={rows}
                    rowKey={(r) => r.key}
                    selectedKey={award ? `gms:${award.id}` : null}
                    empty={
                      <EmptyState icon={AwardIcon} title="No grants yet">
                        An award appears here when a funder on this GMS offers one, or when you record an award on an application to a funder anywhere else.
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
                        {award.status === "offered" && verified.length > 0 && (
                          <div className="fld" style={{ maxWidth: "460px" }}>
                            <label className="lbl" htmlFor="accept-name">
                              Your full legal name
                            </label>
                            <input className="inp" id="accept-name" value={acceptName} onChange={(e) => setAcceptName(e.target.value)} autoComplete="name" aria-describedby="accept-name-help" />
                            <span className="help" id="accept-name-help">
                              Accepting is for a verified representative of your organization. The name must match one in Passport: {verified.join(", ")}.
                            </span>
                          </div>
                        )}
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
                              disabled={accept.state === "saving" || (verified.length > 0 && acceptName.trim().length < 2)}
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
