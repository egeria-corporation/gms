// SPDX-License-Identifier: AGPL-3.0-only
// "Request a free migration": a person tells OpenGrants what they use today and roughly how much
// there is to move. The preview shows exactly what will be sent (the email to OpenGrants and the
// confirmation to the person); any edit clears it, so what is sent is always what was last shown.
// The hidden field and the form token protect a form anyone can use; neither is visible.
import { useEffect, useId, useState } from "react";
import { Eye, PencilLine, Send } from "lucide-react";
import { ApiError } from "../../../api/client.ts";
import type { MigrationPastAwards, MigrationPrograms, MigrationRequestInput, MigrationRequestPreview, MigrationRequestSent, MigrationSystem, MigrationTiming } from "../../../api/migrationRequest.ts";
import { useMigrationRequestApi } from "../../../api/migrationRequestHooks.ts";
import { ErrorBanner, Field, Notice, problemFor } from "../../../components/ui.tsx";
import { NOTE_MAX, PAST_AWARD_OPTIONS, PROGRAM_OPTIONS, SYSTEM_OPTIONS, TIMING_OPTIONS } from "../../../content/switch.ts";

type Fields = { name: string; email: string; organization: string; system: MigrationSystem | ""; programs: MigrationPrograms | ""; pastAwards: MigrationPastAwards | ""; timing: MigrationTiming | ""; note: string };
type Required = Exclude<keyof Fields, "note">;
const REQUIRED: Record<Required, string> = {
  name: "Give your name",
  email: "Give your work email",
  organization: "Give your organization's name",
  system: "Choose the system you use today",
  programs: "Choose about how many programs",
  pastAwards: "Choose about how many past awards",
  timing: "Choose when you hope to move",
};

const codeOf = (e: unknown) => (e instanceof ApiError ? (e.errors.find((x) => typeof (x as { code?: unknown }).code === "string") as { code: string } | undefined)?.code : undefined);

/** `labelledBy` is the id of the heading the page puts above the form. */
export function MigrationRequestForm({ defaultSystem, labelledBy }: { defaultSystem?: MigrationSystem; labelledBy: string }) {
  const api = useMigrationRequestApi();
  const id = useId().replace(/:/g, "");
  const f = (name: string) => `mig-${id}-${name}`;
  const [fields, setFields] = useState<Fields>({ name: "", email: "", organization: "", system: defaultSystem ?? "", programs: "", pastAwards: "", timing: "", note: "" });
  const [website, setWebsite] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [missing, setMissing] = useState<Partial<Record<Required, string>>>({});
  const [preview, setPreview] = useState<MigrationRequestPreview | null>(null);
  const [sent, setSent] = useState<MigrationRequestSent | null>(null);
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [error, setError] = useState<unknown>(null);

  const fetchToken = () =>
    api.form().then(
      (t) => (setToken(t.formToken), t.formToken),
      () => null,
    );
  useEffect(() => {
    // Once per form shown.
    void fetchToken();
  }, [api]); // fetchToken only reads `api`

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setPreview(null);
    setError(null);
    if (key in missing) setMissing((m) => ({ ...m, [key]: undefined }));
  };
  const input = (): MigrationRequestInput => ({
    name: fields.name.trim(),
    email: fields.email.trim(),
    organization: fields.organization.trim(),
    system: fields.system as MigrationSystem,
    programs: fields.programs as MigrationPrograms,
    pastAwards: fields.pastAwards as MigrationPastAwards,
    timing: fields.timing as MigrationTiming,
    ...(fields.note.trim() ? { note: fields.note } : {}),
  });
  const fieldError = (key: keyof Fields): string | null => (key === "note" ? null : missing[key]) ?? problemFor(error, key);

  async function doPreview() {
    const gaps = Object.fromEntries((Object.keys(REQUIRED) as Required[]).filter((k) => !fields[k].trim()).map((k) => [k, REQUIRED[k]]));
    setMissing(gaps);
    if (Object.keys(gaps).length) return;
    setBusy("preview");
    setError(null);
    try {
      setPreview(await api.preview(input()));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function doSend() {
    setBusy("send");
    setError(null);
    try {
      const formToken = token ?? (await fetchToken()) ?? undefined;
      setSent(await api.send({ ...input(), website, ...(formToken ? { formToken } : {}) }));
    } catch (e) {
      setError(e);
      // An expired form gets a fresh token, so sending again works.
      if (codeOf(e) === "form_expired") void fetchToken();
    } finally {
      setBusy(null);
    }
  }

  if (sent)
    return (
      <div className="landing-stack" style={{ gap: "12px" }}>
        <Notice tone="ok" title="Request sent">
          {sent.message}
        </Notice>
        {!sent.confirmationSent && (
          <Notice tone="warn" title="The confirmation email could not be sent">
            Your request reached OpenGrants all the same, and the reply will go to {sent.replyTo}.
          </Notice>
        )}
      </div>
    );

  const noteLeft = NOTE_MAX - fields.note.length;
  return (
    <form
      className="card"
      aria-labelledby={labelledBy}
      noValidate
      style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "14px", maxWidth: "760px" }}
      onSubmit={(e) => {
        e.preventDefault();
        void (preview ? doSend() : doPreview());
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
        <Field id={f("name")} label="Your name" required error={fieldError("name")}>
          <input id={f("name")} className="inp" autoComplete="name" maxLength={200} value={fields.name} aria-invalid={!!fieldError("name")} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field id={f("email")} label="Work email" required error={fieldError("email")}>
          <input id={f("email")} type="email" className="inp" autoComplete="email" maxLength={320} value={fields.email} aria-invalid={!!fieldError("email")} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field id={f("organization")} label="Organization" required error={fieldError("organization")}>
          <input id={f("organization")} className="inp" autoComplete="organization" maxLength={200} value={fields.organization} aria-invalid={!!fieldError("organization")} onChange={(e) => set("organization", e.target.value)} />
        </Field>
        <Field id={f("system")} label="Current system" required error={fieldError("system")}>
          <select id={f("system")} className="sel" value={fields.system} aria-invalid={!!fieldError("system")} onChange={(e) => set("system", e.target.value as MigrationSystem)}>
            <option value="">Choose…</option>
            {SYSTEM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={f("programs")} label="Programs, about how many" required error={fieldError("programs")}>
          <select id={f("programs")} className="sel" value={fields.programs} aria-invalid={!!fieldError("programs")} onChange={(e) => set("programs", e.target.value as MigrationPrograms)}>
            <option value="">Choose…</option>
            {PROGRAM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={f("pastAwards")} label="Past awards, about how many" required error={fieldError("pastAwards")}>
          <select id={f("pastAwards")} className="sel" value={fields.pastAwards} aria-invalid={!!fieldError("pastAwards")} onChange={(e) => set("pastAwards", e.target.value as MigrationPastAwards)}>
            <option value="">Choose…</option>
            {PAST_AWARD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={f("timing")} label="When you hope to move" required error={fieldError("timing")}>
          <select id={f("timing")} className="sel" value={fields.timing} aria-invalid={!!fieldError("timing")} onChange={(e) => set("timing", e.target.value as MigrationTiming)}>
            <option value="">Choose…</option>
            {TIMING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field
        id={f("note")}
        label="Note (optional)"
        error={fieldError("note")}
        help={
          <>
            Anything that helps us plan: how many forms, which years matter. Numbers that look like a bank account, routing or identity number are removed before anything is sent; the preview shows the note as it will go. {noteLeft.toLocaleString("en-US")} characters left.
          </>
        }
      >
        <textarea id={f("note")} className="ta" maxLength={NOTE_MAX} aria-describedby={fieldError("note") ? `${f("note")}-err` : `${f("note")}-help`} value={fields.note} onChange={(e) => set("note", e.target.value)} />
      </Field>
      {/* The hidden field: people never see it or reach it; a send with anything in it is refused. */}
      <div className="sr" aria-hidden="true">
        <label htmlFor={f("website")}>Leave this field empty</label>
        <input id={f("website")} name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      {preview ? <PreviewView p={preview} /> : <p className="muted">Preview the request to see exactly what will be sent.</p>}
      {error ? <ErrorBanner error={error} title={preview ? "The request was not sent" : "The preview could not be made"} /> : null}

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {preview ? (
          <>
            <button className="btn btn-primary" type="submit" disabled={busy !== null}>
              <Send className="ic" aria-hidden="true" />
              {busy === "send" ? "Sending…" : "Send the request"}
            </button>
            <button className="btn btn-secondary" type="button" disabled={busy !== null} onClick={() => setPreview(null)}>
              <PencilLine className="ic" aria-hidden="true" />
              Edit
            </button>
          </>
        ) : (
          <button className="btn btn-primary" type="submit" disabled={busy !== null}>
            <Eye className="ic" aria-hidden="true" />
            {busy === "preview" ? "Preparing…" : "Preview what will be sent"}
          </button>
        )}
      </div>
    </form>
  );
}

function PreviewView({ p }: { p: MigrationRequestPreview }) {
  return (
    <section aria-label="What will be sent" style={{ border: "1px solid var(--og-gray-200)", borderRadius: "8px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px", background: "var(--og-gray-50)" }}>
      <dl className="kv" style={{ fontSize: "14px", overflowWrap: "anywhere" }}>
        <dt>To</dt>
        <dd>{p.to}</dd>
        <dt>Replies go to</dt>
        <dd>{p.replyTo}</dd>
        <dt>Subject</dt>
        <dd>{p.subject}</dd>
      </dl>
      <pre data-testid="migration-email-text" tabIndex={0} aria-label="The email's text" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "14px", margin: 0, background: "#fff", border: "1px solid var(--og-gray-200)", borderRadius: "6px", padding: "10px 12px" }}>
        {p.text}
      </pre>
      {p.numbersRemoved > 0 && (
        <p className="small" style={{ margin: 0 }}>
          {p.numbersRemoved === 1 ? "One number was" : `${p.numbersRemoved} numbers were`} removed from your note because {p.numbersRemoved === 1 ? "it looked" : "they looked"} like a bank or identity number.
        </p>
      )}
      <details>
        <summary>The confirmation you will get at {p.confirmation.to}</summary>
        <dl className="kv" style={{ fontSize: "14px", overflowWrap: "anywhere", marginTop: "8px" }}>
          <dt>Subject</dt>
          <dd>{p.confirmation.subject}</dd>
        </dl>
        <pre tabIndex={0} aria-label="The confirmation's text" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "14px", margin: "8px 0 0" }}>
          {p.confirmation.text}
        </pre>
      </details>
    </section>
  );
}
