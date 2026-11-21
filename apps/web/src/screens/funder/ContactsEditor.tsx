// SPDX-License-Identifier: AGPL-3.0-only
// Settings → the people applicants may write to. Each contact is shown to organizations that have
// applied; the ones marked public also appear on the funder's public page.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { FunderContact } from "../../api/launch.ts";
import { useLaunchMutation, useLaunchQuery } from "../../api/launchHooks.ts";
import { ErrorBanner, Loading } from "../../components/ui.tsx";
import { t } from "./i18n.ts";

const blank = (): FunderContact => ({ name: "", title: null, email: "", phone: null, public: false });
const valid = (c: FunderContact) => c.name.trim() !== "" && /^\S+@\S+\.\S+$/.test(c.email.trim());

export function ContactsEditor({ canEdit = true }: { canEdit?: boolean }) {
  const q = useLaunchQuery((api) => api.contacts(), []);
  const [rows, setRows] = useState<FunderContact[] | null>(null);
  const save = useLaunchMutation((api, next: FunderContact[]) => api.putContacts(next));
  useEffect(() => {
    if (q.status === "ready") setRows(q.data);
  }, [q.status, q.data]);
  const patch = (i: number, change: Partial<FunderContact>) => {
    save.reset();
    setRows((prev) => (prev ?? []).map((r, at) => (at === i ? { ...r, ...change } : r)));
  };
  const list = rows ?? [];
  const incomplete = list.some((c) => !valid(c));

  return (
    <section id="contacts" className="card" aria-labelledby="contacts-h">
      <div className="card-h">
        <div>
          <h3 id="contacts-h">{t("contactsEditor.contactsForApplicants")}</h3>
          <p className="small muted">{t("contactsEditor.shownToOrganizationsThat")}</p>
        </div>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const saved = await save.run(list);
          if (saved) setRows(saved);
        }}
      >
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {!canEdit && <p className="small muted">{t("contactsEditor.adminsOnly")}</p>}
          {q.status === "loading" && <Loading label={t("contactsEditor.loadingContacts")} />}
          {(q.status === "error" || save.error !== null) && <ErrorBanner error={q.error ?? save.error} onRetry={q.reload} />}
          {q.status === "ready" && list.length === 0 && <p className="small muted">{t("contactsEditor.noContactsListedApplicants")}</p>}
          {list.map((c, i) => {
            const n = i + 1;
            return (
              <fieldset key={i} className="cmt" style={{ margin: 0 }} disabled={!canEdit}>
                <legend className="sr">{t("contactsEditor.contact", { n })}</legend>
                <div className="row wrap" style={{ alignItems: "flex-end", gap: "12px" }}>
                  <div className="fld" style={{ flex: "1 1 180px" }}>
                    <label className="lbl" htmlFor={`contact-name-${i}`}>
                      {t("contactsEditor.name")}
                    </label>
                    <input id={`contact-name-${i}`} className="inp" value={c.name} onChange={(e) => patch(i, { name: e.target.value })} autoComplete="off" />
                  </div>
                  <div className="fld" style={{ flex: "1 1 160px" }}>
                    <label className="lbl" htmlFor={`contact-title-${i}`}>
                      {t("contactsEditor.role")}
                    </label>
                    <input id={`contact-title-${i}`} className="inp" value={c.title ?? ""} placeholder={t("contactsEditor.programOfficer")} onChange={(e) => patch(i, { title: e.target.value || null })} autoComplete="off" />
                  </div>
                  <div className="fld" style={{ flex: "1 1 220px" }}>
                    <label className="lbl" htmlFor={`contact-email-${i}`}>
                      {t("contactsEditor.email")}
                    </label>
                    <input id={`contact-email-${i}`} className="inp" type="email" value={c.email} onChange={(e) => patch(i, { email: e.target.value })} autoComplete="off" />
                  </div>
                  <div className="fld" style={{ flex: "1 1 150px" }}>
                    <label className="lbl" htmlFor={`contact-phone-${i}`}>
                      {t("contactsEditor.phoneOptional")}
                    </label>
                    <input id={`contact-phone-${i}`} className="inp" type="tel" value={c.phone ?? ""} onChange={(e) => patch(i, { phone: e.target.value || null })} autoComplete="off" />
                  </div>
                </div>
                <div className="row wrap" style={{ justifyContent: "space-between" }}>
                  <label className="row" style={{ gap: "8px" }}>
                    <input type="checkbox" checked={c.public} onChange={(e) => patch(i, { public: e.target.checked })} />
                    <span>{t("contactsEditor.onPublicPage")}</span>
                  </label>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    aria-label={c.name ? t("contactsEditor.removeContactNamed", { n, name: c.name }) : t("contactsEditor.removeContact", { n })}
                    onClick={() => {
                      save.reset();
                      setRows(list.filter((_, at) => at !== i));
                    }}
                  >
                    <Trash2 className="ic" aria-hidden="true" />
                    {t("contactsEditor.remove")}
                  </button>
                </div>
              </fieldset>
            );
          })}
        </div>
        {canEdit && q.status === "ready" && (
          <div className="card-f" style={{ flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                save.reset();
                setRows([...list, blank()]);
              }}
            >
              <Plus className="ic" aria-hidden="true" />
              {t("contactsEditor.addAContact")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={incomplete || save.state === "saving"}>
              {t("contactsEditor.saveContacts")}
            </button>
            {incomplete && <span className="help">{t("contactsEditor.eachContactNeedsA")}</span>}
            {save.state === "saved" && (
              <span className="notice" role="status">
                {t("contactsEditor.contactsSaved")}
              </span>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
