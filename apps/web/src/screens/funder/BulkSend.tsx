// SPDX-License-Identifier: AGPL-3.0-only
// Bulk send: one templated message to a set of applicants or grantees. The audience is chosen by
// what the people have in common (an application status, or awards in a status), the count is
// shown before anything goes out, and a person confirms. Each send lands in the send log; an agent
// asking for the same thing gets an approval request instead.
import { useState } from "react";
import { Send } from "lucide-react";
import type { SendResult, Template } from "../../api/funder.ts";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { STATUS } from "../../components/status.tsx";
import { ErrorBanner, Field, Notice } from "../../components/ui.tsx";

type Audience = { kind: "application"; status: string } | { kind: "award"; status: string };
const AUDIENCES: { value: string; label: string; audience: Audience }[] = [
  ...["submitted", "under_review", "revision_requested", "waitlisted", "declined"].map((status) => ({ value: `application:${status}`, label: `Applicants · ${STATUS.application[status as keyof typeof STATUS.application]?.label ?? status}`, audience: { kind: "application" as const, status } })),
  ...["offered", "active", "completed"].map((status) => ({ value: `award:${status}`, label: `Grantees · award ${STATUS.award[status as keyof typeof STATUS.award]?.label ?? status}`, audience: { kind: "award" as const, status } })),
];

export function BulkSend({ templates, onSent }: { templates: Template[]; onSent: () => void }) {
  const emails = templates.filter((t) => t.kind === "email");
  const [templateId, setTemplateId] = useState("");
  const [audienceKey, setAudienceKey] = useState(AUDIENCES[0]!.value);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const chosen = templateId || emails[0]?.id || "";
  const audience = AUDIENCES.find((a) => a.value === audienceKey)!.audience;
  const recipients = useApiQuery(
    async (api) => {
      if (audience.kind === "application") return (await api.listApplications({ status: audience.status, pageSize: 100 })).items.map((a) => ({ id: a.id, name: a.applicant.name ?? a.title, recipient: { applicationId: a.id } }));
      return (await api.listAwards({ status: audience.status })).map((a) => ({ id: a.id, name: a.recipient?.name ?? a.title, recipient: { awardId: a.id } }));
    },
    [audienceKey],
  );
  const send = useApiMutation((api) => api.sendCommunication({ templateId: chosen, recipients: (recipients.data ?? []).map((r) => r.recipient) }));
  const count = recipients.data?.length ?? 0;
  const template = emails.find((t) => t.id === chosen);

  return (
    <section className="card" aria-labelledby="bulk-h">
      <div className="card-h">
        <div>
          <h3 id="bulk-h">Bulk send</h3>
          <p className="small muted">One message to everyone in a group. Review the count before it goes out.</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {result && (
          <Notice tone={result.sent === result.requested ? "ok" : "warn"} title={`${result.sent} of ${result.requested} sent`}>
            {result.sent < result.requested ? result.results.filter((r) => !r.sent).map((r) => r.reason ?? "Not sent").join("; ") : "Each send is in the log below."}
          </Notice>
        )}
        {recipients.status === "error" && <ErrorBanner error={recipients.error} onRetry={recipients.reload} />}
        <div className="fld-row">
          <Field id="bulk-template" label="Template" help={emails.length ? undefined : "Add an email template first."}>
            <select className="sel" id="bulk-template" value={chosen} onChange={(e) => setTemplateId(e.target.value)} disabled={!emails.length}>
              {emails.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.builtIn ? " (built in)" : ` v${t.version}`}
                </option>
              ))}
            </select>
          </Field>
          <Field id="bulk-audience" label="Recipients">
            <select
              className="sel"
              id="bulk-audience"
              value={audienceKey}
              onChange={(e) => {
                setAudienceKey(e.target.value);
                setResult(null);
              }}
            >
              {AUDIENCES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="row wrap" style={{ justifyContent: "space-between", gap: "12px" }}>
          <span className="small muted" role="status">
            {recipients.status === "loading" ? "Counting recipients…" : count === 0 ? "Nobody is in this group right now." : `${count} ${count === 1 ? "recipient" : "recipients"}: ${(recipients.data ?? []).slice(0, 3).map((r) => r.name).join(", ")}${count > 3 ? ` and ${count - 3} more` : ""}`}
          </span>
          <button type="button" className="btn btn-primary" disabled={!chosen || count === 0} aria-haspopup="dialog" onClick={() => setConfirming(true)}>
            <Send className="ic" aria-hidden="true" />
            Send to {count}
          </button>
        </div>
      </div>
      {confirming && (
        <Dialog open onClose={() => setConfirming(false)} labelledBy="bulk-confirm-title">
          <div className="hd">
            <div>
              <h2 id="bulk-confirm-title" style={{ fontSize: "16px" }}>
                Send “{template?.name}” to {count} {count === 1 ? "recipient" : "recipients"}?
              </h2>
              <p className="small muted" style={{ marginTop: "4px" }}>
                Each person gets their own copy with their own merge fields. A recipient whose fields are incomplete is skipped and listed afterwards.
              </p>
            </div>
          </div>
          <div className="bd">{send.error !== null && <ErrorBanner error={send.error} />}</div>
          <div className="ft">
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={send.state === "saving"}
              onClick={async () => {
                const r = await send.run();
                if (r) {
                  setResult(r);
                  setConfirming(false);
                  onSent();
                }
              }}
            >
              <Send className="ic" aria-hidden="true" />
              Send {count}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
