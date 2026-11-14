// SPDX-License-Identifier: AGPL-3.0-only
// "New application": start from an OpenGrants listing (Find funding), from a pasted link, or from
// details typed in. A link to an opportunity on this GMS goes to the built-in application; any
// other link becomes an outside application that keeps the link.
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { FileText, Link2, Search, X } from "lucide-react";
import type { FunderRecord, OutsideApi, OutsideCreateInput } from "../../../api/outside.ts";
import { isAccepting } from "../../../api/outside.ts";
import { useApplicantApi } from "../../../api/applicantHooks.ts";
import { useOutsideApi } from "../../../api/outsideHooks.ts";
import { Dialog } from "../../../components/Dialog.tsx";
import { ErrorBanner, Field, Notice, problemFor } from "../../../components/ui.tsx";
import { gmsOpportunityOf, webAddress } from "../../../lib/outside.ts";
import { moneyFrom } from "./shared.tsx";

type Mode = "choose" | "link" | "details";

/** Hosts whose `/f/{handle}/o/{slug}` pages are opportunities on this GMS. */
export const ownHosts = () => [...new Set([globalThis.location?.host, "gms.opengrants.io"].filter((h): h is string => !!h))];

/** Creates the application, then links it to the funder record whose name it carries, if the server did not. */
export async function createLinked(api: OutsideApi, input: OutsideCreateInput, records: FunderRecord[]) {
  const made = await api.create(input);
  const rec = records.find((r) => r.name.trim().toLowerCase() === input.funderName.trim().toLowerCase());
  return rec && made.funderRecordId !== rec.id ? api.update(made.id, { funderRecordId: rec.id }) : made;
}

function Choice({ icon: Icon, title, detail, onClick }: { icon: typeof Search; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" className="card" onClick={onClick} style={{ padding: "14px 16px", display: "flex", gap: "12px", alignItems: "flex-start", textAlign: "left", cursor: "pointer", font: "inherit", width: "100%" }}>
      <Icon className="ic ic-md" aria-hidden="true" style={{ color: "var(--og-teal-dark)", flex: "none", marginTop: "2px" }} />
      <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <span className="b" style={{ color: "var(--og-navy-dark)" }}>
          {title}
        </span>
        <span className="small muted">{detail}</span>
      </span>
    </button>
  );
}

export function NewApplicationDialog({ base, records, openGrants, onClose }: { base: string; records: FunderRecord[]; openGrants: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const api = useOutsideApi();
  const applicant = useApplicantApi();
  const [mode, setMode] = useState<Mode>("choose");
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [funder, setFunder] = useState("");
  const [program, setProgram] = useState("");
  const [stage, setStage] = useState<"drafting" | "prospect">("drafting");
  const [loi, setLoi] = useState("");
  const [full, setFull] = useState("");
  const [internal, setInternal] = useState("");
  const [rolling, setRolling] = useState(false);
  const [ask, setAsk] = useState("");
  const [portal, setPortal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [tried, setTried] = useState(false);

  const gms = link.trim() ? gmsOpportunityOf(link, ownHosts()) : null;
  const linkUrl = webAddress(link);
  const askMoney = ask.trim() ? moneyFrom(ask) : null;
  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      navigate(await work());
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const openBuiltIn = () =>
    run(async () => {
      const found = (await applicant.discover()).find((d) => d.funder.handle === gms!.handle && d.opportunity.slug === gms!.slug);
      if (found?.application) return `${base}/applications/${found.application.id}${found.application.status === "draft" || found.application.status === "revision_requested" ? "/edit" : ""}`;
      if (found && isAccepting(found)) return `${base}/applications/${(await applicant.startApplication(found.competitionId)).id}/edit`;
      // Not open yet, or not listed: Find funding shows it first and says where it stands.
      return `${base}/find?funder=${encodeURIComponent(gms!.handle)}&opportunity=${encodeURIComponent(gms!.slug)}`;
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (mode === "link") {
      if (gms) return void openBuiltIn();
      if (!linkUrl || !title.trim() || !funder.trim()) return;
      return void run(async () => `${base}/outside/${(await createLinked(api, { source: "link", listingUrl: linkUrl, title: title.trim(), funderName: funder.trim(), stage: "drafting" }, records)).id}`);
    }
    if (!title.trim() || !funder.trim() || (ask.trim() && !askMoney) || (portal.trim() && !webAddress(portal))) return;
    void run(async () => {
      const input: OutsideCreateInput = {
        source: "manual",
        title: title.trim(),
        funderName: funder.trim(),
        stage,
        rolling,
        ...(program.trim() ? { programName: program.trim() } : {}),
        ...(loi ? { loiDue: loi } : {}),
        ...(full ? { fullDue: full } : {}),
        ...(internal ? { internalDue: internal } : {}),
        ...(askMoney ? { askAmount: askMoney } : {}),
        ...(portal.trim() ? { portalUrl: webAddress(portal)! } : {}),
      };
      return `${base}/outside/${(await createLinked(api, input, records)).id}`;
    });
  };

  const need = (v: string, message: string) => (tried && !v.trim() ? message : null);
  const funderField = (
    <Field id="na-funder" label="Funder" required error={need(funder, "Name the funder") ?? problemFor(error, "funderName")} help={records.length ? "Pick one of your funder records, or type a new name." : undefined}>
      <input id="na-funder" className="inp" list="na-funder-records" autoComplete="off" value={funder} onChange={(e) => setFunder(e.target.value)} />
      <datalist id="na-funder-records">
        {records.map((r) => (
          <option key={r.id} value={r.name} />
        ))}
      </datalist>
    </Field>
  );

  return (
    <Dialog open onClose={onClose} labelledBy="na-title" size={mode === "details" ? "lg" : "md"}>
      <form onSubmit={submit}>
        <div className="hd">
          <div>
            <h3 id="na-title" style={{ fontSize: "16px" }}>
              New application
            </h3>
            <p className="small muted">{mode === "choose" ? "Track an application to any funder, on this GMS or anywhere else." : mode === "link" ? "Paste the funder’s page for the opportunity." : "Enter what you know now; you can add the rest later."}</p>
          </div>
          <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
            <X className="ic ic-md" aria-hidden="true" />
          </button>
        </div>
        <div className="bd">
          {mode === "choose" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {openGrants && <Choice icon={Search} title="From an OpenGrants listing" detail="Search OpenGrants in Find funding, then choose Start application." onClick={() => navigate(`${base}/find?tab=index`)} />}
              <Choice icon={Link2} title="Paste a link" detail="The funder’s page for the opportunity. A link to this GMS opens the application here." onClick={() => setMode("link")} />
              <Choice icon={FileText} title="Enter the details" detail="Funder, title, deadlines and the amount you plan to ask for." onClick={() => setMode("details")} />
            </div>
          )}
          {mode === "link" && (
            <>
              <Field id="na-link" label="Link" required error={tried && !linkUrl ? "Enter a full web address, starting with https://" : null}>
                <input id="na-link" className="inp" type="url" inputMode="url" autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
              </Field>
              {gms ? (
                <Notice tone="info" title="This opportunity is on this GMS">
                  You apply to it here, with your organization’s details filled in for you.
                </Notice>
              ) : (
                linkUrl && (
                  <>
                    <Field id="na-t" label="Title" required error={need(title, "Give the application a title") ?? problemFor(error, "title")}>
                      <input id="na-t" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} />
                    </Field>
                    {funderField}
                  </>
                )
              )}
            </>
          )}
          {mode === "details" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
                <Field id="na-t" label="Title" required error={need(title, "Give the application a title") ?? problemFor(error, "title")}>
                  <input id="na-t" className="inp" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
                </Field>
                {funderField}
                <Field id="na-p" label="Program">
                  <input id="na-p" className="inp" value={program} onChange={(e) => setProgram(e.target.value)} />
                </Field>
                <Field id="na-a" label="Ask (USD)" error={ask.trim() && !askMoney ? "Enter the amount in dollars, such as 25000" : null}>
                  <input id="na-a" className="inp" inputMode="decimal" value={ask} onChange={(e) => setAsk(e.target.value)} />
                </Field>
                <Field id="na-loi" label="Letter of inquiry due">
                  <input id="na-loi" className="inp" type="date" value={loi} onChange={(e) => setLoi(e.target.value)} />
                </Field>
                <Field id="na-full" label="Full application due">
                  <input id="na-full" className="inp" type="date" value={full} onChange={(e) => setFull(e.target.value)} />
                </Field>
                <Field id="na-int" label="Internal deadline" help="When your team wants it finished.">
                  <input id="na-int" className="inp" type="date" value={internal} onChange={(e) => setInternal(e.target.value)} />
                </Field>
                <Field id="na-portal" label="Funder’s portal link" error={portal.trim() && !webAddress(portal) ? "Enter a full web address, starting with https://" : null}>
                  <input id="na-portal" className="inp" type="url" value={portal} onChange={(e) => setPortal(e.target.value)} />
                </Field>
              </div>
              <label className="row" style={{ gap: "8px", fontSize: "14px" }}>
                <input type="checkbox" checked={rolling} onChange={(e) => setRolling(e.target.checked)} />
                The funder takes applications on a rolling basis
              </label>
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: "16px", flexWrap: "wrap" }}>
                <legend className="lbl">Where you are</legend>
                <label className="row" style={{ gap: "6px", fontSize: "14px" }}>
                  <input type="radio" name="na-stage" checked={stage === "drafting"} onChange={() => setStage("drafting")} />
                  Writing it now
                </label>
                <label className="row" style={{ gap: "6px", fontSize: "14px" }}>
                  <input type="radio" name="na-stage" checked={stage === "prospect"} onChange={() => setStage("prospect")} />
                  Just a prospect for now
                </label>
              </fieldset>
            </>
          )}
          {error ? <ErrorBanner error={error} title="The application was not started" /> : null}
        </div>
        {mode !== "choose" && (
          <div className="ft">
            <button className="btn btn-secondary" type="button" onClick={() => setMode("choose")}>
              Back
            </button>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Starting…" : gms ? "Go to the application" : "Start application"}
            </button>
          </div>
        )}
      </form>
    </Dialog>
  );
}
