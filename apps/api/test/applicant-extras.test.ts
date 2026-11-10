// SPDX-License-Identifier: AGPL-3.0-only
// What the applicant screens read back: section assignments, library answers inserted into a form,
// the revision diff, notifications and the member's connected agents.
import { beforeEach, describe, expect, it } from "vitest";
import { encryptSecret, fixtureFetch, type Fixture } from "@gms/passport-client";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, TEST_CREDENTIALS_KEY, USER_ADMIN, USER_OFFICER, WS_APPLICANT, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";
import { ORG_ALDER, USER_APPLICANT, USER_APPLICANT_EDITOR, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
let appId: string;
let appUuid: string;

const COMPLETE = { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles to reach primary care." };

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  appUuid = started.body.data.id;
  appId = `app_${appUuid}`;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${appUuid}/forms/${s.uuid.loi}`, { response: COMPLETE });
});

const submit = () => s.call<{ data: { status: { value: string } } }>(s.applicant, "PUT", `/common-grants/applications/${appUuid}/submit`);

describe("section assignments", () => {
  it("reads them back on both sides", async () => {
    await s.call(s.applicant, "POST", `/gms/my/applications/${appId}/sections/assign`, { formId: s.loiFormId, sections: { Budget: USER_APPLICANT_EDITOR } });
    const mine = await s.call<{ data: { formId: string; sections: Record<string, string> }[] }>(s.editor, "GET", `/gms/my/applications/${appId}/sections`);
    expect(mine.body.data).toEqual([expect.objectContaining({ formId: s.loiFormId, sections: { Budget: USER_APPLICANT_EDITOR } })]);
    await submit();
    const theirs = await s.call<{ data: { sections: Record<string, string> }[] }>(s.funder, "GET", `/gms/applications/${appId}/sections`);
    expect(theirs.body.data[0]!.sections).toEqual({ Budget: USER_APPLICANT_EDITOR });
    const detail = await s.call<{ data: { formResponses: { sectionAssignments: Record<string, string> }[] } }>(s.funder, "GET", `/gms/applications/${appId}`);
    expect(detail.body.data.formResponses[0]!.sectionAssignments).toEqual({ Budget: USER_APPLICANT_EDITOR });
  });
});

describe("library answers", () => {
  it("inserts an answer as `library`, records where it was used, and an edit afterwards is the user's", async () => {
    const a = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/gms/my/answers", { title: "Need statement", body: "Per the county assessment, families travel 46 miles." });
    const r = await s.call<{ data: { provenance: string; answer: { id: string; usedIn: { applicationId: string; formId: string; path: string; version: number }[] } } }>(s.applicant, "POST", `/gms/my/applications/${appId}/forms/${s.loiFormId}/insert-answer`, { answerId: a.body.data.id, path: "/need" });
    expect(r.status).toBe(200);
    expect(r.body.data.provenance).toBe("library");
    expect(r.body.data.answer.usedIn).toEqual([expect.objectContaining({ applicationId: appUuid, formId: s.uuid.loi, path: "/need", version: 1 })]);
    const row = (await h.repos.table("form_responses").one({ application_id: appUuid, form_id: s.uuid.loi }))!;
    expect((row.response as { need: string }).need).toBe("Per the county assessment, families travel 46 miles.");
    expect((row.provenance as Record<string, string>)["/need"]).toBe("library");

    await s.call(s.applicant, "PUT", `/common-grants/applications/${appUuid}/forms/${s.uuid.loi}`, { response: { need: "Edited by hand." } });
    const after = (await h.repos.table("form_responses").one({ application_id: appUuid, form_id: s.uuid.loi }))!;
    expect((after.provenance as Record<string, string>)["/need"]).toBe("user");
  });

  it("refuses another workspace's answer and a locked application", async () => {
    expect((await s.call(s.applicant, "POST", `/gms/my/applications/${appId}/forms/${s.loiFormId}/insert-answer`, { answerId: "0193a1c0-0000-7000-8000-00000000dead", path: "/need" })).status).toBe(404);
    const a = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/gms/my/answers", { title: "Need", body: "x" });
    await submit();
    expect((await s.call(s.applicant, "POST", `/gms/my/applications/${appId}/forms/${s.loiFormId}/insert-answer`, { answerId: a.body.data.id, path: "/need" })).status).toBe(409);
    expect((await s.call(s.funder, "POST", `/gms/my/applications/${appId}/forms/${s.loiFormId}/insert-answer`, { answerId: a.body.data.id, path: "/need" })).status).toBe(403);
  });
});

describe("revision diff", () => {
  it("stores before and after on resubmission and shows it to both sides", async () => {
    await submit();
    await s.call(s.funder, "POST", `/gms/applications/${appId}/request-revision`, { message: "Cite the county assessment." });
    await s.call(s.applicant, "PUT", `/common-grants/applications/${appUuid}/forms/${s.uuid.loi}`, { response: { need: "Per the 2026 county assessment, families travel 46 miles to reach primary care." } });
    expect((await submit()).body.data.status.value).toBe("submitted");

    type Rev = { message: string; changes: { formId: string; path: string; before: string; after: string; wordDelta: number }[] } | null;
    const status = await s.call<{ data: { timeline: { type: string; revision: Rev }[] } }>(s.applicant, "GET", `/gms/my/applications/${appId}/status`);
    const mine = status.body.data.timeline.at(-1)!;
    expect(mine.type).toBe("submit");
    expect(mine.revision!.message).toBe("Cite the county assessment.");
    expect(mine.revision!.changes).toEqual([expect.objectContaining({ formId: s.loiFormId, path: "/need", before: "Families travel 46 miles to reach primary care.", wordDelta: 5 })]);
    expect(status.body.data.timeline.find((t) => t.type === "request_revision")!.revision).toBeNull();

    const detail = await s.call<{ data: { timeline: { type: string; revision: Rev; payload: Record<string, unknown> }[] } }>(s.funder, "GET", `/gms/applications/${appId}`);
    expect(detail.body.data.timeline.at(-1)!.revision!.changes[0]!.after).toContain("2026 county assessment");
    // The stored snapshot is working data, not part of either view.
    expect(detail.body.data.timeline.every((t) => !("snapshot" in t.payload))).toBe(true);
  });
});

describe("notifications", () => {
  it("derives a member's notifications, marks them read, and honors in-app preferences", async () => {
    await submit();
    await s.call(s.funder, "POST", `/gms/applications/${appId}/request-revision`, { message: "Cite the county assessment." });
    type List = { data: { unread: number; items: { id: string; type: string; read: boolean; message: string | null; subjectId: string }[] } };
    const list = await s.call<List>(s.applicant, "GET", "/gms/notifications");
    const asked = list.body.data.items.find((n) => n.type === "application.request_revision")!;
    expect(asked).toMatchObject({ read: false, message: "Cite the county assessment.", subjectId: appId });
    // The applicant's own submission is not news to them.
    expect(list.body.data.items.some((n) => n.type === "application.submit")).toBe(false);

    const read = await s.call<{ data: { unread: number } }>(s.applicant, "POST", "/gms/notifications/read", { ids: [asked.id] });
    expect(read.body.data.unread).toBe(list.body.data.unread - 1);
    expect((await s.call<{ data: { unread: number } }>(s.applicant, "POST", "/gms/notifications/read", { all: true })).body.data.unread).toBe(0);
    // Read state is per member.
    expect((await s.call<List>(s.editor, "GET", "/gms/notifications?unread=true")).body.data.items.some((n) => n.id === asked.id)).toBe(true);

    const funder = await s.call<List>(s.funder, "GET", "/gms/notifications");
    expect(funder.status).toBe(200);

    const prefs = await s.call<{ data: { digest: string; channels: Record<string, { inApp: boolean; email: boolean }> } }>(s.editor, "PUT", "/gms/me/notification-preferences", { digest: "daily", channels: { application: { inApp: false, email: true } } });
    expect(prefs.body.data).toMatchObject({ digest: "daily", channels: { application: { inApp: false, email: true }, award: { inApp: true, email: true } } });
    expect((await s.call<List>(s.editor, "GET", "/gms/notifications")).body.data.items.some((n) => n.type.startsWith("application."))).toBe(false);
    expect((await s.call<{ data: { digest: string } }>(s.applicant, "GET", "/gms/me/notification-preferences")).body.data.digest).toBe("immediate");
  });
});

describe("connected agents", () => {
  it("lists a member's own agents on the applicant side and lets them revoke", async () => {
    const client = await h.repos.table("oauth_clients_dynamic").insert({ client_name: "Grant Writer Agent", redirect_uris: ["https://agent.example/cb"], grant_types: ["authorization_code"], token_endpoint_auth_method: "none" });
    const wsId = (await h.repos.table("applications").one({ id: appUuid }))!.applicant_workspace_id;
    const own = await h.repos.table("mcp_connections").insert({ workspace_id: wsId, client_id: client.id, user_id: USER_APPLICANT_EDITOR, scopes: ["applications:read"] });
    await h.repos.table("mcp_connections").insert({ workspace_id: wsId, client_id: client.id, user_id: USER_APPLICANT, scopes: ["applications:read"] });

    const editor = await s.call<{ data: { id: string; clientName: string; mine: boolean }[] }>(s.editor, "GET", "/gms/mcp-connections");
    expect(editor.body.data).toEqual([expect.objectContaining({ id: own.id, clientName: "Grant Writer Agent", mine: true })]);
    expect((await s.call<{ data: unknown[] }>(s.applicant, "GET", "/gms/mcp-connections")).body.data).toHaveLength(2);

    const other = (await h.repos.table("mcp_connections").one({ workspace_id: wsId, user_id: USER_APPLICANT }))!;
    expect((await s.call(s.editor, "DELETE", `/gms/mcp-connections/${other.id}`)).status).toBe(404);
    const gone = await s.call<{ data: { revokedAt: string | null } }>(s.editor, "DELETE", `/gms/mcp-connections/${own.id}`);
    expect(gone.body.data.revokedAt).not.toBeNull();
  });
});

describe("letters and settings", () => {
  it("uses the workspace's own email template for a built-in letter", async () => {
    await submit();
    const t = await s.call(s.funder, "POST", "/gms/templates", { kind: "email", name: "Revision requested", subject: "A few changes to {{application.title}}", body: "Hello {{recipient.name}}, our note: {{revision.message}}" });
    expect(t.status).toBe(201);
    h.mailer.sent.length = 0;
    await s.call(s.funder, "POST", `/gms/applications/${appId}/request-revision`, { message: "Cite the county assessment." });
    expect(h.mailer.sent[0]!.subject).toBe("A few changes to Mobile Health Navigation for Rural Families");
    expect(h.mailer.sent[0]!.text).toContain("our note: Cite the county assessment.");
  });

  it("merge-patches workspace settings: unsent keys stay, null removes", async () => {
    const admin = { ...bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
    const patch = (settings: Record<string, unknown>) => h.request(`/gms/workspaces/${WS_FUNDER}`, { method: "PATCH", headers: admin, body: JSON.stringify({ settings }) });
    expect((await patch({ fiscalYearStart: "07-01" })).status).toBe(200);
    expect((await patch({ defaultCurrency: "USD" })).status).toBe(200);
    expect((await h.repos.table("workspaces").one({ id: WS_FUNDER }))!.settings).toMatchObject({ fiscalYearStart: "07-01", defaultCurrency: "USD" });
    await patch({ fiscalYearStart: null });
    const settings = (await h.repos.table("workspaces").one({ id: WS_FUNDER }))!.settings as Record<string, unknown>;
    expect(settings).not.toHaveProperty("fiscalYearStart");
    expect(settings.defaultCurrency).toBe("USD");
  });
});

describe("fix-ups: where an answer was used, locker attachments, and the gates over REST", () => {
  it("names the application and the funder on each use of a library answer", async () => {
    const a = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/gms/my/answers", { title: "Need statement", body: "Per the county assessment, families travel 46 miles." });
    const r = await s.call<{ data: { answer: { usedIn: { applicationTitle: string | null; funderName: string | null; path: string }[] } } }>(s.applicant, "POST", `/gms/my/applications/${appId}/forms/${s.loiFormId}/insert-answer`, { answerId: a.body.data.id, path: "/need" });
    const app = (await h.repos.table("applications").one({ id: appUuid }))!;
    expect(r.body.data.answer.usedIn).toEqual([expect.objectContaining({ path: "/need", applicationTitle: app.title, funderName: "Riverbend Community Foundation" })]);
    const list = await s.call<{ data: { id: string; usedIn: { applicationTitle: string | null; funderName: string | null }[] }[] }>(s.applicant, "GET", "/gms/my/answers");
    expect(list.body.data.find((x) => x.id === a.body.data.id)!.usedIn[0]).toMatchObject({ applicationTitle: app.title, funderName: "Riverbend Community Foundation" });
    // The stored record stays ids only; names are looked up when the library is read.
    expect(JSON.stringify((await h.repos.table("answers").one({ id: a.body.data.id }))!.used_in)).not.toContain("Riverbend");
  });

  it("attaches a Passport locker document by id: name and hash come from Passport, no bytes are copied", async () => {
    await h.repos.table("passport_links").insert({ workspace_id: WS_APPLICANT, mode: "applicant_consent", client_id: "gms-test-client", refresh_token_enc: await encryptSecret("rt-first", TEST_CREDENTIALS_KEY), scopes: ["org:read"], linked_by_user_id: USER_APPLICANT, linked_at: "2027-02-03T00:00:00Z", last_ok_at: "2027-02-03T00:00:00Z" });
    const DOC = "0193a1c0-0000-7000-8000-0000000d0c01";
    const token: Fixture = { method: "POST", path: "/oauth/token", status: 200, body: { access_token: "passport-consented-token-for-tests", refresh_token: "rt-next", token_type: "Bearer", expires_in: 600, scope: "org:read" } };
    const docs = [
      { id: DOC, kind: "determination_letter", name: "IRS determination letter.pdf", mimeType: "application/pdf", sha256: "a".repeat(64), source: "upload", uploadedAt: "2027-01-12T17:00:00Z", expiresAt: null, lastModifiedAt: "2027-01-12T17:00:00Z" },
      { id: "0193a1c0-0000-7000-8000-0000000d0c03", kind: "other", name: "Board roster (Drive)", mimeType: "application/vnd.google-apps.document", sha256: null, source: "google_drive", uploadedAt: "2027-02-10T17:00:00Z", expiresAt: null, lastModifiedAt: "2027-02-10T17:00:00Z" },
    ];
    const fx = fixtureFetch([token, { method: "GET", path: `/passport/orgs/${ORG_ALDER}/documents`, status: 200, body: { status: 200, message: "Success", items: docs, paginationInfo: { page: 1, pageSize: 2, totalItems: 2, totalPages: 1 } } }]);
    h.passport.fetch = fx.fetch;

    // The caller names only the id; a name or hash it might invent is not accepted alongside it.
    const ref = await s.call<{ data: { id: string; name: string; mime: string; sha256: string; source: string; passportDocumentId: string; size: number } }>(s.applicant, "POST", `/gms/my/applications/${appId}/attachments`, { passportDocumentId: DOC });
    expect(ref.status).toBe(201);
    expect(ref.body.data).toMatchObject({ name: "IRS determination letter.pdf", mime: "application/pdf", sha256: "a".repeat(64), source: "passport_locker", passportDocumentId: DOC, size: 0 });
    expect(h.storage.files.size).toBe(0);
    const listed = await s.call<{ data: { passportDocumentId: string | null }[] }>(s.applicant, "GET", `/gms/my/applications/${appId}/attachments`);
    expect(listed.body.data.map((d) => d.passportDocumentId)).toEqual([DOC]);
    expect(h.ledger.events.filter((e) => e.eventType === "document.attached")).toHaveLength(1);
    // The funder sees the reference on the application once it is submitted.
    await submit();
    const theirs = await s.call<{ data: { passportDocumentId: string | null; sha256: string }[] }>(s.funder, "GET", `/gms/my/applications/${appId}/attachments`);
    expect(theirs.body.data).toEqual([expect.objectContaining({ passportDocumentId: DOC, sha256: "a".repeat(64) })]);
    // A document with no recorded hash cannot be pinned, and an unknown id is not found.
    await h.repos.table("applications").update({ id: appUuid }, { status: "draft" });
    expect((await s.call(s.applicant, "POST", `/gms/my/applications/${appId}/attachments`, { passportDocumentId: "0193a1c0-0000-7000-8000-0000000d0c03" })).status).toBe(422);
    expect((await s.call(s.applicant, "POST", `/gms/my/applications/${appId}/attachments`, { passportDocumentId: "0193a1c0-0000-7000-8000-0000000d0cff" })).status).toBe(404);
  });

  it("refuses an agent's direct submit and decline over REST; a person's still work", async () => {
    const agent = await h.forge({ sub: USER_APPLICANT, client_id: CLIENT_AGENT, scope: "applications:read applications:write applications:submit", [WORKSPACE_CLAIM]: WS_APPLICANT });
    const viaAgent = await h.request(`/common-grants/applications/${appUuid}/submit`, { method: "PUT", headers: bearer(agent).headers });
    expect(viaAgent.status).toBe(403);
    expect(((await viaAgent.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("approval_required");
    expect((await h.repos.table("applications").one({ id: appUuid }))!.status).toBe("draft");
    expect((await submit()).status).toBe(200);

    const funderAgent = await h.forge({ sub: USER_OFFICER, client_id: CLIENT_AGENT, scope: "applications:read applications:write decisions:write", [WORKSPACE_CLAIM]: WS_FUNDER });
    const json = { ...bearer(funderAgent).headers, "Content-Type": "application/json" };
    const decline = await h.request(`/gms/applications/${appId}/decline`, { method: "POST", headers: json, body: JSON.stringify({ rationale: "Outside the service area." }) });
    expect(decline.status).toBe(403);
    const bulk = await h.request("/gms/applications/bulk", { method: "POST", headers: json, body: JSON.stringify({ action: "decline", applicationIds: [appId], params: { rationale: "Outside the service area." } }) });
    expect(bulk.status).toBe(403);
    expect((await h.repos.table("applications").one({ id: appUuid }))!.status).toBe("submitted");
    // Tagging is not gated, so the same agent token may do it.
    const tag = await h.request("/gms/applications/bulk", { method: "POST", headers: json, body: JSON.stringify({ action: "tag", applicationIds: [appId], params: { add: ["rural"] } }) });
    expect(tag.status).toBe(200);
    expect((await s.call(s.funder, "POST", `/gms/applications/${appId}/decline`, { rationale: "Outside the service area." })).status).toBe(200);
  });
});
