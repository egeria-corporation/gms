// SPDX-License-Identifier: AGPL-3.0-only
// Settings → the people applicants may write to. Each contact is shown to organizations that have
// applied; the ones marked public also appear on the funder's public page.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { FunderContact } from "../../api/launch.ts";
import { useLaunchMutation, useLaunchQuery } from "../../api/launchHooks.ts";
import { ErrorBanner, Loading } from "../../components/ui.tsx";

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
          <h3 id="contacts-h">Contacts for applicants</h3>
          <p className="small muted">Shown to organizations that have applied to you. Tick “On public page” to show a contact on your funder page as well.</p>
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
          {q.status === "loading" && <Loading label="Loading contacts" />}
          {(q.status === "error" || save.error !== null) && <ErrorBanner error={q.error ?? save.error} onRetry={q.reload} />}
          {q.status === "ready" && list.length === 0 && <p className="small muted">No contacts listed. Applicants see only the shared thread on their application.</p>}
          {list.map((c, i) => {
            const n = i + 1;
            return (
              <fieldset key={i} className="cmt" style={{ margin: 0 }} disabled={!canEdit}>
                <legend className="sr">Contact {n}</legend>
                <div className="row wrap" style={{ alignItems: "flex-end", gap: "12px" }}>
                  <div className="fld" style={{ flex: "1 1 180px" }}>
                    <label className="lbl" htmlFor={`contact-name-${i}`}>
                      Name
                    </label>
                    <input id={`contact-name-${i}`} className="inp" value={c.name} onChange={(e) => patch(i, { name: e.target.value })} autoComplete="off" />
                  </div>
                  <div className="fld" style={{ flex: "1 1 160px" }}>
                    <label className="lbl" htmlFor={`contact-title-${i}`}>
                      Role
                    </label>
                    <input id={`contact-title-${i}`} className="inp" value={c.title ?? ""} placeholder="Program officer" onChange={(e) => patch(i, { title: e.target.value || null })} autoComplete="off" />
                  </div>
                  <div className="fld" style={{ flex: "1 1 220px" }}>
                    <label className="lbl" htmlFor={`contact-email-${i}`}>
                      Email
                    </label>
                    <input id={`contact-email-${i}`} className="inp" type="email" value={c.email} onChange={(e) => patch(i, { email: e.target.value })} autoComplete="off" />
                  </div>
                  <div className="fld" style={{ flex: "1 1 150px" }}>
                    <label className="lbl" htmlFor={`contact-phone-${i}`}>
                      Phone (optional)
                    </label>
                    <input id={`contact-phone-${i}`} className="inp" type="tel" value={c.phone ?? ""} onChange={(e) => patch(i, { phone: e.target.value || null })} autoComplete="off" />
                  </div>
                </div>
                <div className="row wrap" style={{ justifyContent: "space-between" }}>
                  <label className="row" style={{ gap: "8px" }}>
                    <input type="checkbox" checked={c.public} onChange={(e) => patch(i, { public: e.target.checked })} />
                    <span>On public page</span>
                  </label>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    aria-label={`Remove contact ${n}${c.name ? `, ${c.name}` : ""}`}
                    onClick={() => {
                      save.reset();
                      setRows(list.filter((_, at) => at !== i));
                    }}
                  >
                    <Trash2 className="ic" aria-hidden="true" />
                    Remove
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
              Add a contact
            </button>
            <button type="submit" className="btn btn-primary" disabled={incomplete || save.state === "saving"}>
              Save contacts
            </button>
            {incomplete && <span className="help">Each contact needs a name and an email address.</span>}
            {save.state === "saved" && (
              <span className="notice" role="status">
                Contacts saved.
              </span>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
