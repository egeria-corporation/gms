// SPDX-License-Identifier: AGPL-3.0-only
// The document vault (v1.6.0) through the real routes: typed, expiring documents private to the
// applicant workspace, the filename block on every upload, the expiry warning job, and an outside
// application's required documents matched against the vault ("Use from vault").
import { beforeEach, describe, expect, it } from "vitest";
import { sendDocumentExpiryWarnings } from "../src/jobs.ts";
import { SENSITIVE_FILENAME } from "../src/services/vault.ts";
import { WS_APPLICANT, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, USER_APPLICANT_EDITOR, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
type Data<T> = { data: T };
type Err = { message: string; errors: { code: string }[] };
type VDoc = { id: string; name: string; docType: string; docTypeLabel: string; expiresOn: string | null; expiry: { state: string; daysLeft: number | null } };
type Req = { label: string; docType: string | null; status: string; document: VDoc | null; matches: VDoc[] };

const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await s.call<Data<T>>(who, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const inDays = (n: number) => new Date(h.clock.now.getTime() + n * 86_400_000).toISOString().slice(0, 10);
const upload = (name: string, docType: string, expiresOn?: string) => data<VDoc>(s.applicant, "POST", "/gms/vault", { name, mime: "application/pdf", contentBase64: btoa(`%PDF-1.4 ${name}`), docType, ...(expiresOn ? { expiresOn } : {}) });
const base = () => ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>" }, ports: { mailer: h.mailer, directory: h.directory } });

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
});

describe("the vault", () => {
  it("keeps typed documents with expiry, tells the upload dialog what it never keeps, and ledgers changes", async () => {
    const irs = await upload("IRS determination letter.pdf", "irs_letter");
    const audit = await upload("Audit FY2025.pdf", "audit", inDays(20));
    await upload("Old budget.pdf", "budget", inDays(-1));
    const list = await data<{ documents: VDoc[]; types: { type: string; label: string }[]; never: string }>(s.applicant, "GET", "/gms/vault");
    expect(list.documents).toHaveLength(3);
    expect(list.types.map((t) => t.type)).toEqual(["irs_letter", "audit", "financials", "board_list", "budget", "annual_report", "logo", "other"]);
    expect(list.never).toContain("never keeps bank letters, voided checks, ACH forms");
    expect(list.documents.find((d) => d.id === audit.id)!.expiry).toEqual({ state: "expiring", expiresOn: inDays(20), daysLeft: 20 });
    expect(list.documents.find((d) => d.name === "Old budget.pdf")!.expiry.state).toBe("expired");
    expect(list.documents.find((d) => d.id === irs.id)!).toMatchObject({ docTypeLabel: "IRS determination letter", expiry: { state: "none" } });
    expect((await data<{ documents: VDoc[] }>(s.applicant, "GET", "/gms/vault?docType=audit")).documents.map((d) => d.id)).toEqual([audit.id]);
    const moved = await data<VDoc>(s.applicant, "PATCH", `/gms/vault/${audit.id}`, { expiresOn: inDays(400) });
    expect(moved.expiry.state).toBe("current");
    const file = await s.call(s.applicant, "GET", `/gms/vault/${irs.id}/file`);
    expect(file.status).toBe(200);
    expect(h.ledger.events.filter((e) => e.eventType.startsWith("vault.")).map((e) => e.eventType)).toEqual(["vault.document_added", "vault.document_added", "vault.document_added", "vault.document_changed"]);
    // Ledger data holds ids, types and dates, never the file name.
    expect(JSON.stringify(h.ledger.events.filter((e) => e.eventType.startsWith("vault.")).map((e) => e.data))).not.toContain("Audit FY2025");
    await data(s.applicant, "DELETE", `/gms/vault/${irs.id}`);
    expect((await data<{ documents: VDoc[] }>(s.applicant, "GET", "/gms/vault")).documents).toHaveLength(2);
  });

  it("refuses files named like bank or tax forms, everywhere a file comes in", async () => {
    for (const name of ["Bank letter.pdf", "voided_check.pdf", "ACH authorization.pdf", "routing-info.png", "W-9 2026.pdf", "w9.pdf", "Banking details.docx"]) {
      const r = await s.call<Err>(s.applicant, "POST", "/gms/vault", { name, mime: "application/pdf", contentBase64: btoa("x"), docType: "other" });
      expect(r.status, name).toBe(422);
      expect(r.body.errors[0]!.code).toBe("sensitive_document");
      expect(r.body.message).toContain("never keeps bank letters");
    }
    for (const name of ["Attachment A.pdf", "Teacher training budget.pdf", "Avoidance plan.pdf", "Wave 9 report.pdf", "Riverbank project.pdf"]) expect(SENSITIVE_FILENAME.test(name), name).toBe(false);
    expect(await h.repos.table("documents").count({ subject_type: "vault" })).toBe(0);
    // Renaming into one is refused too, and so is attaching one to an outside application.
    const ok = await upload("Board list.pdf", "board_list");
    expect((await s.call(s.applicant, "PATCH", `/gms/vault/${ok.id}`, { name: "Bank statement.pdf" })).status).toBe(422);
    const oa = await data<{ id: string }>(s.applicant, "POST", "/gms/outside-applications", { title: "T", funderName: "F" });
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/documents`, { name: "voided check.pdf", mime: "application/pdf", contentBase64: btoa("x") })).status).toBe(422);
    // A type that is not a vault type does not exist.
    expect((await s.call(s.applicant, "POST", "/gms/vault", { name: "x.pdf", mime: "application/pdf", contentBase64: btoa("x"), docType: "bank_letter" })).status).toBe(400);
  });

  it("is the applicant's own: funders and other workspaces see nothing, viewers read but cannot change", async () => {
    const doc = await upload("Audit.pdf", "audit");
    expect((await s.call(s.funder, "GET", "/gms/vault")).status).toBe(403);
    expect((await s.call(s.funder, "GET", `/gms/vault/${doc.id}/file`)).status).toBe(403);
    // Another applicant workspace's id answers 404.
    const other = await h.repos.table("documents").insert({ workspace_id: WS_APPLICANT, owner_workspace_id: WS_APPLICANT, subject_type: "application", subject_id: crypto.randomUUID(), name: "Not vault.pdf", mime: "application/pdf", size: 1, sha256: "b".repeat(64), storage: "r2", path: "p" });
    expect((await s.call(s.applicant, "GET", `/gms/vault/${other.id}/file`)).status).toBe(404);
  });
});

describe("expiry warnings", () => {
  it("emails admins and editors 30 days before a vault document expires, once", async () => {
    h.directory.users.set(USER_APPLICANT, { email: "maria.santos@aldercreek.example", name: "Maria Santos" });
    h.directory.users.set(USER_APPLICANT_EDITOR, { email: "jamal.reed@aldercreek.example", name: "Jamal Reed" });
    await upload("Audit FY2025.pdf", "audit", inDays(30));
    await upload("Budget.pdf", "budget", inDays(29));
    h.mailer.sent.length = 0;
    const out = await sendDocumentExpiryWarnings(base());
    expect(out).toMatchObject({ checked: 1, warned: 1, failed: 0 });
    // The workspace's admin and its two editors (the harness's officer is an editor here too).
    expect(h.mailer.sent.map((m) => m.to[0]).sort()).toEqual(["dana.ortiz@riverbendcf.example", "jamal.reed@aldercreek.example", "maria.santos@aldercreek.example"]);
    expect(h.mailer.sent[0]!.subject).toBe("Document expiring in 30 days: Audit FY2025.pdf");
    expect(h.mailer.sent[0]!.text).toContain("https://app.gms.test/w/alder-creek/organization/documents");
    // The idempotency key names the document, its date and the offset, so a re-run sends nothing new.
    const keys = h.mailer.sent.map((m) => m.idempotencyKey);
    await sendDocumentExpiryWarnings(base());
    expect(new Set(h.mailer.sent.map((m) => m.idempotencyKey)).size).toBe(new Set(keys).size);
  });
});

describe("required documents", () => {
  it("lists what the funder asks for, matches vault documents by type, and uses one from the vault", async () => {
    const audit = await upload("Audit FY2025.pdf", "audit", inDays(-3));
    const audit2 = await upload("Audit FY2026.pdf", "audit");
    const oa = await data<{ id: string }>(s.applicant, "POST", "/gms/outside-applications", { title: "Clinics", funderName: "Northwind" });
    const set = await data<Req[]>(s.applicant, "PUT", `/gms/outside-applications/${oa.id}/required-documents`, { items: [{ label: "Most recent audit", docType: "audit" }, { label: "Project timeline", docType: null }, { label: "Logo", docType: "logo", status: "not_needed" }] });
    expect(set.map((r) => [r.label, r.status, r.matches.length])).toEqual([["Most recent audit", "needed", 2], ["Project timeline", "needed", 0], ["Logo", "not_needed", 0]]);
    const used = await data<Req[]>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/required-documents/use-from-vault`, { label: "most recent audit", documentId: audit.id });
    expect(used[0]).toMatchObject({ status: "attached", document: { id: audit.id, expiry: { state: "expired" } } });
    const detail = await data<{ requiredDocuments: Req[] }>(s.applicant, "GET", `/gms/outside-applications/${oa.id}`);
    expect(detail.requiredDocuments[0]!.document!.id).toBe(audit.id);
    // Swap to the current audit, then take it off.
    await data(s.applicant, "POST", `/gms/outside-applications/${oa.id}/required-documents/use-from-vault`, { label: "Most recent audit", documentId: audit2.id });
    const off = await data<Req[]>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/required-documents/use-from-vault`, { label: "Most recent audit", documentId: null });
    expect(off[0]).toMatchObject({ status: "needed", document: null });
    // Removing an attached vault document returns its item to needed.
    await data(s.applicant, "POST", `/gms/outside-applications/${oa.id}/required-documents/use-from-vault`, { label: "Most recent audit", documentId: audit2.id });
    await data(s.applicant, "DELETE", `/gms/vault/${audit2.id}`);
    expect((await data<{ requiredDocuments: Req[] }>(s.applicant, "GET", `/gms/outside-applications/${oa.id}`)).requiredDocuments[0]!.status).toBe("needed");
    // Labels are unique; a document that is not in this vault is not found.
    expect((await s.call(s.applicant, "PUT", `/gms/outside-applications/${oa.id}/required-documents`, { items: [{ label: "A" }, { label: "a" }] })).status).toBe(400);
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/required-documents/use-from-vault`, { label: "Logo", documentId: crypto.randomUUID() })).status).toBe(404);
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/required-documents/use-from-vault`, { label: "Nope", documentId: audit.id })).status).toBe(404);
  });
});
