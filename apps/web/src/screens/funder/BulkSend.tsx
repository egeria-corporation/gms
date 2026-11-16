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
import { t } from "./i18n.ts";

type Audience = { kind: "application"; status: string } | { kind: "award"; status: string };
const AUDIENCES: { value: string; label: string; audience: Audience }[] = [
  ...["submitted", "under_review", "revision_requested", "waitlisted", "declined"].map((status) => ({ value: `application:${status}`, label: t("bulkSend.applicants", { label: STATUS.application[status as keyof typeof STATUS.application]?.label ?? status }), audience: { kind: "application" as const, status } })),
  ...["offered", "active", "completed"].map((status) => ({ value: `award:${status}`, label: t("bulkSend.granteesAward", { label: STATUS.award[status as keyof typeof STATUS.award]?.label ?? status }), audience: { kind: "award" as const, status } })),
];

export function BulkSend({ templates, onSent }: { templates: Template[]; onSent: () => void }) {
  const emails = templates.filter((item) => item.kind === "email");
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
  const template = emails.find((item) => item.id === chosen);

  return (
    <section className="card" aria-labelledby="bulk-h">
      <div className="card-h">
        <div>
          <h3 id="bulk-h">{t("bulkSend.bulkSend")}</h3>
          <p className="small muted">{t("bulkSend.oneMessageToEveryone")}</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {result && (
          <Notice tone={result.sent === result.requested ? "ok" : "warn"} title={t("bulkSend.ofSent", { sent: result.sent, requested: result.requested })}>
            {result.sent < result.requested ? result.results.filter((r) => !r.sent).map((r) => r.reason ?? t("bulkSend.notSent")).join("; ") : t("bulkSend.eachSendIsIn")}
          </Notice>
        )}
        {recipients.status === "error" && <ErrorBanner error={recipients.error} onRetry={recipients.reload} />}
        <div className="fld-row">
          <Field id="bulk-template" label={t("bulkSend.template")} help={emails.length ? undefined : t("bulkSend.addAnEmailTemplate")}>
            <select className="sel" id="bulk-template" value={chosen} onChange={(e) => setTemplateId(e.target.value)} disabled={!emails.length}>
              {emails.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                  {tpl.builtIn ? t("bulkSend.builtIn") : t("bulkSend.v", { version: tpl.version })}
                </option>
              ))}
            </select>
          </Field>
          <Field id="bulk-audience" label={t("bulkSend.recipients")}>
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
            {recipients.status === "loading" ? t("bulkSend.countingRecipients") : count === 0 ? t("bulkSend.nobodyIsInThis") : t(count > 3 ? "bulkSend.recipientsListMore" : "bulkSend.recipientsList", { count, names: (recipients.data ?? []).slice(0, 3).map((r) => r.name).join(", "), more: count - 3 })}
          </span>
          <button type="button" className="btn btn-primary" disabled={!chosen || count === 0} aria-haspopup="dialog" onClick={() => setConfirming(true)}>
            <Send className="ic" aria-hidden="true" />
            {t("bulkSend.sendTo", { count })}
          </button>
        </div>
      </div>
      {confirming && (
        <Dialog open onClose={() => setConfirming(false)} labelledBy="bulk-confirm-title">
          <div className="hd">
            <div>
              <h2 id="bulk-confirm-title" style={{ fontSize: "16px" }}>
                {t("bulkSend.sendTo2", { name: template?.name, count })} {count === 1 ? t("bulkSend.recipient") : t("bulkSend.recipients2")}?
              </h2>
              <p className="small muted" style={{ marginTop: "4px" }}>
                {t("bulkSend.eachPersonGetsTheir")}
              </p>
            </div>
          </div>
          <div className="bd">{send.error !== null && <ErrorBanner error={send.error} />}</div>
          <div className="ft">
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
              {t("bulkSend.cancel")}
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
              {t("bulkSend.send", { count })}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
