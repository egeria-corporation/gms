// SPDX-License-Identifier: AGPL-3.0-only
// The applicant's own light record of one funder: contacts, notes, who on the team holds the portal
// login, and every ask made to it. Private to this workspace; the funder never sees it.
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ExternalLink, Plus, Trash, X } from "lucide-react";
import type { FunderContact, FunderRecord as Record_, FunderRecordApplication } from "../../api/outside.ts";
import { useOutsideMutation, useOutsideQuery } from "../../api/outsideHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { isNotFound, Loaded } from "../../components/applicant.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { DataTable, ErrorBanner, Field, PageHeader, SaveNote, type Column } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { webAddress } from "../../lib/outside.ts";
import { moneyText } from "./outside/shared.tsx";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_CONTACTS = 20;

function DetailsCard({ record, onSaved }: { record: Record_; onSaved: (r: Record_) => void }) {
  const [f, setF] = useState({ name: record.name, website: record.website ?? "", portalUrl: record.portalUrl ?? "", portalLoginHolder: record.portalLoginHolder ?? "", notes: record.notes ?? "" });
  const save = useOutsideMutation((api) =>
    api.updateFunderRecord(record.id, { name: f.name.trim(), website: f.website.trim() ? webAddress(f.website) : null, portalUrl: f.portalUrl.trim() ? webAddress(f.portalUrl) : null, portalLoginHolder: f.portalLoginHolder.trim() || null, notes: f.notes.trim() || null }),
  );
  const bad = (v: string) => (v.trim() && !webAddress(v) ? "Enter a full web address, starting with https://" : null);
  const dirty = f.name !== record.name || f.website !== (record.website ?? "") || f.portalUrl !== (record.portalUrl ?? "") || f.portalLoginHolder !== (record.portalLoginHolder ?? "") || f.notes !== (record.notes ?? "");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await save.run();
    if (r) onSaved(r);
  };
  return (
    <section className="card" aria-labelledby="fr-details">
      <div className="card-h">
        <h2 id="fr-details" style={{ fontSize: "18px" }}>
          Details
        </h2>
        <SaveNote state={save.state === "saved" && !dirty ? "saved" : "idle"} />
      </div>
      <form className="card-b" onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <Field id="fr-name" label="Name" required>
          <input id="fr-name" className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
          <Field id="fr-web" label="Website" error={bad(f.website)}>
            <input id="fr-web" className="inp" type="url" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
          </Field>
          <Field id="fr-portal" label="Application portal" error={bad(f.portalUrl)}>
            <input id="fr-portal" className="inp" type="url" value={f.portalUrl} onChange={(e) => setF({ ...f, portalUrl: e.target.value })} />
          </Field>
        </div>
        <Field id="fr-holder" label="Who holds the portal login" help="A person’s name only. Never write a password here.">
          <input id="fr-holder" className="inp" autoComplete="off" value={f.portalLoginHolder} onChange={(e) => setF({ ...f, portalLoginHolder: e.target.value })} />
        </Field>
        <Field id="fr-notes" label="Notes">
          <textarea id="fr-notes" className="ta" style={{ minHeight: "100px" }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <button type="submit" className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={!dirty || !f.name.trim() || !!bad(f.website) || !!bad(f.portalUrl) || save.state === "saving"}>
          {save.state === "saving" ? "Saving…" : "Save details"}
        </button>
        {save.error ? <ErrorBanner error={save.error} title="The details were not saved" /> : null}
      </form>
    </section>
  );
}

function ContactsCard({ record, onSaved }: { record: Record_; onSaved: (r: Record_) => void }) {
  const [rows, setRows] = useState<FunderContact[]>(record.contacts);
  const save = useOutsideMutation((api) => api.updateFunderRecord(record.id, { contacts: rows.map((c) => ({ name: c.name.trim(), ...(c.role?.trim() ? { role: c.role.trim() } : {}), ...(c.email?.trim() ? { email: c.email.trim() } : {}), ...(c.phone?.trim() ? { phone: c.phone.trim() } : {}) })) }));
  const dirty = JSON.stringify(rows) !== JSON.stringify(record.contacts);
  const badEmail = rows.some((c) => c.email?.trim() && !EMAIL.test(c.email.trim()));
  const noName = rows.some((c) => !c.name.trim());
  const set = (i: number, patch: Partial<FunderContact>) => setRows(rows.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <section className="card" aria-labelledby="fr-contacts">
      <div className="card-h">
        <div>
          <h2 id="fr-contacts" style={{ fontSize: "18px" }}>
            Contacts
          </h2>
          <p className="small muted">Up to {MAX_CONTACTS} people at this funder.</p>
        </div>
        <SaveNote state={save.state === "saved" && !dirty ? "saved" : "idle"} />
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {rows.length === 0 && <p className="muted">No contacts yet.</p>}
        {rows.map((c, i) => (
          <fieldset key={i} style={{ border: "1px solid var(--og-gray-200)", borderRadius: "8px", padding: "10px 12px", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
            <legend className="small b">Contact {i + 1}</legend>
            <Field id={`frc-n-${i}`} label="Name" required>
              <input id={`frc-n-${i}`} className="inp" value={c.name} onChange={(e) => set(i, { name: e.target.value })} />
            </Field>
            <Field id={`frc-r-${i}`} label="Role">
              <input id={`frc-r-${i}`} className="inp" value={c.role ?? ""} onChange={(e) => set(i, { role: e.target.value })} />
            </Field>
            <Field id={`frc-e-${i}`} label="Email" error={c.email?.trim() && !EMAIL.test(c.email.trim()) ? "Enter a full email address" : null}>
              <input id={`frc-e-${i}`} className="inp" type="email" value={c.email ?? ""} onChange={(e) => set(i, { email: e.target.value })} />
            </Field>
            <Field id={`frc-p-${i}`} label="Phone">
              <input id={`frc-p-${i}`} className="inp" type="tel" value={c.phone ?? ""} onChange={(e) => set(i, { phone: e.target.value })} />
            </Field>
            <button type="button" className="btn btn-sm btn-ghost" style={{ justifySelf: "start" }} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              <X className="ic" aria-hidden="true" />
              Remove {c.name || `contact ${i + 1}`}
            </button>
          </fieldset>
        ))}
        <div className="row" style={{ gap: "8px" }}>
          <button type="button" className="btn btn-sm btn-secondary" disabled={rows.length >= MAX_CONTACTS} onClick={() => setRows([...rows, { name: "" }])}>
            <Plus className="ic" aria-hidden="true" />
            Add a contact
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!dirty || badEmail || noName || save.state === "saving"}
            onClick={async () => {
              const r = await save.run();
              if (r) {
                setRows(r.contacts);
                onSaved(r);
              }
            }}
          >
            Save contacts
          </button>
        </div>
        {save.error ? <ErrorBanner error={save.error} title="The contacts were not saved" /> : null}
      </div>
    </section>
  );
}

function PastAsks({ record, base }: { record: Record_; base: string }) {
  const columns: Column<FunderRecordApplication>[] = [
    {
      key: "title",
      header: "Application",
      cell: (a) => (
        <div className="ent">
          <Link className="nm" to={a.kind === "outside_application" ? `${base}/outside/${a.id}` : `${base}/applications/${a.id}`}>
            {a.title}
          </Link>
          {a.kind === "gms_application" && <span className="small muted">On this GMS{a.nameMatch ? " · matched by the funder’s name" : ""}</span>}
        </div>
      ),
    },
    { key: "stage", header: "Stage", cell: (a) => (a.kind === "outside_application" && a.stage ? <StatusBadge kind="outside" status={a.stage} /> : a.status ? <StatusBadge kind="application" status={a.status} /> : "—") },
    { key: "ask", header: "Ask", numeric: true, cell: (a) => moneyText(a.askAmount) },
    { key: "awarded", header: "Awarded", numeric: true, cell: (a) => moneyText(a.awardedAmount) },
    { key: "when", header: "Submitted", cell: (a) => formatDate(a.submittedAt) },
  ];
  return (
    <section className="card" aria-labelledby="fr-asks">
      <div className="card-h">
        <div>
          <h2 id="fr-asks" style={{ fontSize: "18px" }}>
            Past asks
          </h2>
          <p className="small muted">Every application you have tracked to {record.name}.</p>
        </div>
      </div>
      <DataTable label="Past asks" columns={columns} rows={record.applications} rowKey={(a) => `${a.kind}:${a.id}`} empty={<p className="muted" style={{ padding: "16px 20px" }}>No applications to this funder yet.</p>} />
    </section>
  );
}

export default function FunderRecord() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const navigate = useNavigate();
  const { recordId = "" } = useParams();
  const query = useOutsideQuery((api) => api.funderRecord(recordId), [recordId]);
  const [confirm, setConfirm] = useState(false);
  const remove = useOutsideMutation(async (api) => {
    await api.deleteFunderRecord(recordId);
    return true;
  });
  if (query.status === "error" && isNotFound(query.error)) return <NotFound />;
  return (
    <>
      <title>{query.status === "ready" ? `${query.data.name} — ${ws.name}` : `Funder — ${ws.name}`}</title>
      <ApplicantShell active="Funders">
        <main className="main">
          <Loaded query={query} label="Loading the funder">
            {(record) => (
              <>
                <PageHeader
                  crumbs={[{ label: "Funders", to: `${base}/funders` }, { label: record.name }]}
                  title={record.name}
                  meta={
                    <>
                      <span>Your own record. The funder does not see it.</span>
                      {record.website && (
                        <>
                          <span aria-hidden="true">·</span>
                          <a href={record.website} target="_blank" rel="noreferrer noopener">
                            Website <ExternalLink className="ic ic-sm" aria-hidden="true" />
                            <span className="sr"> (opens in a new tab)</span>
                          </a>
                        </>
                      )}
                    </>
                  }
                  actions={
                    confirm ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={async () => {
                            if (await remove.run()) navigate(`${base}/funders`);
                          }}
                        >
                          Delete this record
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => setConfirm(false)}>
                          Keep it
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-ghost" onClick={() => setConfirm(true)}>
                        <Trash className="ic" aria-hidden="true" />
                        Delete record
                      </button>
                    )
                  }
                />
                {confirm && <p className="small muted">Applications to this funder are kept; they just lose the link to this record.</p>}
                {remove.error ? <ErrorBanner error={remove.error} title="The record was not deleted" /> : null}
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                    <DetailsCard record={record} onSaved={(r) => query.set(r)} />
                    <ContactsCard record={record} onSaved={(r) => query.set(r)} />
                  </div>
                  <PastAsks record={record} base={base} />
                </div>
              </>
            )}
          </Loaded>
        </main>
      </ApplicantShell>
    </>
  );
}
