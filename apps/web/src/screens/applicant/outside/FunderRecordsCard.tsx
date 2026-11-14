// SPDX-License-Identifier: AGPL-3.0-only
// The applicant's own funder records on the Funders screen: every funder it tracks, on this GMS or
// not, with a way to add one. Private to the workspace.
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Landmark, Plus, X } from "lucide-react";
import type { FunderRecord } from "../../../api/outside.ts";
import { useOutsideMutation, useOutsideQuery } from "../../../api/outsideHooks.ts";
import { Dialog } from "../../../components/Dialog.tsx";
import { Loaded } from "../../../components/applicant.tsx";
import { DataTable, EmptyState, ErrorBanner, Field, type Column } from "../../../components/ui.tsx";
import { formatDate } from "../../../lib/format.ts";
import { webAddress } from "../../../lib/outside.ts";

function AddFunderDialog({ base, onClose }: { base: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const create = useOutsideMutation((api) => api.createFunderRecord({ name: name.trim(), ...(website.trim() ? { website: webAddress(website) } : {}) }));
  const bad = website.trim() && !webAddress(website) ? "Enter a full web address, starting with https://" : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || bad) return;
    const r = await create.run();
    if (r) navigate(`${base}/funders/${r.id}`);
  };
  return (
    <Dialog open onClose={onClose} labelledBy="addf-title">
      <form onSubmit={submit}>
        <div className="hd">
          <div>
            <h3 id="addf-title" style={{ fontSize: "16px" }}>
              Add a funder
            </h3>
            <p className="small muted">A private record for a funder you apply to: contacts, notes, who holds the portal login.</p>
          </div>
          <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
            <X className="ic ic-md" aria-hidden="true" />
          </button>
        </div>
        <div className="bd">
          <Field id="addf-name" label="Name" required>
            <input id="addf-name" className="inp" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="addf-web" label="Website" error={bad}>
            <input id="addf-web" className="inp" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </Field>
          {create.error ? <ErrorBanner error={create.error} title="The funder was not added" /> : null}
        </div>
        <div className="ft">
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={!name.trim() || !!bad || create.state === "saving"}>
            {create.state === "saving" ? "Adding…" : "Add funder"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function FunderRecordsCard({ base }: { base: string }) {
  const query = useOutsideQuery((api) => api.funderRecords(), []);
  const [adding, setAdding] = useState(false);
  const columns: Column<FunderRecord>[] = [
    {
      key: "name",
      header: "Funder",
      sort: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <Link to={`${base}/funders/${r.id}`} className="nm b">
          {r.name}
        </Link>
      ),
    },
    { key: "contacts", header: "Contacts", numeric: true, cell: (r) => r.contacts.length, sort: (r) => r.contacts.length },
    { key: "apps", header: "Applications", numeric: true, cell: (r) => r.applications.length, sort: (r) => r.applications.length },
    { key: "login", header: "Portal login held by", cell: (r) => r.portalLoginHolder ?? <span className="muted">—</span> },
    { key: "updated", header: "Updated", cell: (r) => formatDate(r.updatedAt), sort: (r) => r.updatedAt },
  ];
  return (
    <section className="card" aria-labelledby="frc-h">
      <div className="card-h">
        <div>
          <h2 id="frc-h" style={{ fontSize: "18px" }}>
            Your funder records
          </h2>
          <p className="small muted">Every funder you track, on this GMS or not. Only your team sees these.</p>
        </div>
        <button type="button" className="btn btn-sm btn-primary" aria-haspopup="dialog" onClick={() => setAdding(true)}>
          <Plus className="ic" aria-hidden="true" />
          Add a funder
        </button>
      </div>
      <Loaded query={query} label="Loading funder records">
        {(records) => (
          <DataTable
            label="Your funder records"
            columns={columns}
            rows={records}
            rowKey={(r) => r.id}
            empty={
              <EmptyState icon={Landmark} title="No funder records yet">
                Add a funder to keep its contacts, notes and past asks together.
              </EmptyState>
            }
          />
        )}
      </Loaded>
      {adding && <AddFunderDialog base={base} onClose={() => setAdding(false)} />}
    </section>
  );
}
