// SPDX-License-Identifier: AGPL-3.0-only
// Write faster (v1.6.0) through the real routes: the assistant drafts an answer from the
// organization's own content (saving nothing), the person accepts it with provenance `assist`,
// the application's "AI use" note lists it, and the assistant reads a funder's guidelines, pasted
// or uploaded. The quota counts every model call. The assistant never reads a vault document.
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, WS_APPLICANT, bearer, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
type Data<T> = { data: T };
type Err = { errors: { code: string; message: string }[] };

const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await s.call<Data<T>>(who, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};

const VAULT_SECRET = "VAULT-ONLY-board-minutes-7731";
const b64 = (text: string) => btoa(text);
const PDF = (pages: number) => `%PDF-1.4\n1 0 obj << /Type /Pages /Count ${pages} >>\n${Array.from({ length: pages }, (_, i) => `${i + 2} 0 obj << /Type /Page >>`).join("\n")}\n%%EOF\n`;

let oaId: string;
let qid: string;

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  oaId = (await data<{ id: string }>(s.applicant, "POST", "/gms/outside-applications", { title: "Rural clinics 2027", funderName: "Northwind Family Foundation", fullDue: "2027-05-01" })).id;
  qid = (await data<{ id: string }[]>(s.applicant, "POST", `/gms/outside-applications/${oaId}/questions`, { questions: [{ prompt: "Describe the need your project addresses and the families you serve.", limitKind: "words", limitValue: 30 }] }))[0]!.id;
  // The library: one relevant stale answer, one relevant fresh answer, one unrelated.
  await h.repos.table("answers").insert({ workspace_id: WS_APPLICANT, key: "need", title: "Need statement", body: "Families in the valley travel 46 miles to reach primary care.", last_verified_at: "2025-01-10T00:00:00Z" });
  await h.repos.table("answers").insert({ workspace_id: WS_APPLICANT, key: "families", title: "Families we serve", body: "We serve families across three rural counties.", last_verified_at: "2027-03-01T00:00:00Z" });
  await h.repos.table("answers").insert({ workspace_id: WS_APPLICANT, key: "audit", title: "Audit policy", body: "Our books are audited yearly." });
  // A vault document and an attachment the assistant must never see.
  const stored = await h.storage.put("vault/secret", new TextEncoder().encode(VAULT_SECRET), "text/plain");
  await h.repos.table("documents").insert({ workspace_id: WS_APPLICANT, owner_workspace_id: WS_APPLICANT, subject_type: "vault", name: `${VAULT_SECRET}.txt`, mime: "text/plain", size: VAULT_SECRET.length, sha256: "a".repeat(64), storage: stored.storage, path: stored.path, doc_type: "board_list" });
  await data(s.applicant, "POST", `/gms/outside-applications/${oaId}/documents`, { name: `${VAULT_SECRET}-attachment.txt`, mime: "text/plain", contentBase64: b64(VAULT_SECRET) });
});

const everythingSent = () => h.llm.requests.map((r) => JSON.stringify(r)).join("\n");
const callsLogged = () => h.repos.table("assist_calls").count({ workspace_id: WS_APPLICANT });

describe("assistant off", () => {
  it("has no draft or guidelines reading, and the deterministic parse still works", async () => {
    for (const [path, body] of [
      [`/gms/outside-questions/${qid}/draft`, {}],
      [`/gms/outside-applications/${oaId}/questions/parse`, { text: "1. Need?", mode: "ai" }],
      [`/gms/outside-applications/${oaId}/guidelines`, { name: "Guidelines.pdf", mime: "application/pdf", contentBase64: b64(PDF(1)) }],
    ] as const) {
      const r = await s.call<Err>(s.applicant, "POST", path, body);
      expect(r.status).toBe(404);
      expect(r.body.errors[0]!.code).toBe("assistant_disabled");
    }
    expect((await data<{ questions: unknown[] }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/questions/parse`, { text: "1. Need? (100 words)" })).questions).toHaveLength(1);
    // Nothing was stored for the refused upload.
    expect(await h.repos.table("documents").count({ doc_type: "funder_guidelines" })).toBe(0);
    expect(h.llm.requests).toHaveLength(0);
  });
});

describe("drafting an answer", () => {
  beforeEach(() => {
    h.env.ASSISTANT_ENABLED = "true";
  });

  it("drafts from the relevant library answers and the profile facts, saves nothing, and flags stale figures", async () => {
    const lib = await h.repos.table("answers").find({ workspace_id: WS_APPLICANT });
    const need = lib.find((a) => a.key === "need")!;
    const families = lib.find((a) => a.key === "families")!;
    h.llmAnswer.value = { draft: "Families travel 46 miles to reach care. We serve [number of families in 2026] across three counties.", usedAnswerIds: [need.id, families.id, "not-an-id"], unknowns: [], staleFlags: [] };
    const r = await data<{ draft: string; usedAnswerIds: string[]; usedAnswers: { id: string; stale: boolean }[]; offeredAnswerIds: string[]; unknowns: string[]; staleFlags: { answerId: string; figure: string }[]; counts: { words: number }; limit: { kind: string; value: number }; overLimit: boolean; retried: boolean; saved: boolean; provenance: string; quota: { used: number } }>(s.applicant, "POST", `/gms/outside-questions/${qid}/draft`);
    expect(r).toMatchObject({ draft: expect.stringContaining("46 miles"), unknowns: ["number of families in 2026"], limit: { kind: "words", value: 30 }, overLimit: false, retried: false, saved: false, provenance: "assist", quota: { used: 1 } });
    expect(r.usedAnswerIds.sort()).toEqual([need.id, families.id].sort());
    expect(r.usedAnswers.find((a) => a.id === need.id)!.stale).toBe(true);
    expect(r.usedAnswers.find((a) => a.id === families.id)!.stale).toBe(false);
    expect(r.staleFlags).toEqual([expect.objectContaining({ answerId: need.id, figure: "46" })]);
    // The unrelated answer was not offered.
    expect(r.offeredAnswerIds).not.toContain(lib.find((a) => a.key === "audit")!.id);
    const req = h.llm.requests[0]!;
    expect(req.user).toContain("Alder Creek Family Services");
    expect(req.user).toContain("46 miles");
    expect(req.documents).toBeUndefined();
    // Nothing saved: no answer version, the question still empty.
    expect(await h.repos.table("outside_answers").count({ question_id: qid })).toBe(0);
    expect((await h.repos.table("outside_questions").one({ id: qid }))!.status).toBe("empty");
    expect(await callsLogged()).toBe(1);
    expect((await h.repos.table("assist_calls").find({ workspace_id: WS_APPLICANT }))[0]).toMatchObject({ tool: "draft_answer", subject: `outside_question:${qid}`, user_id: USER_APPLICANT });
  });

  it("retries once to fit the limit, and the retry counts against the quota", async () => {
    const long = Array.from({ length: 50 }, () => "word").join(" ");
    let n = 0;
    Object.defineProperty(h.llmAnswer, "value", { get: () => ({ draft: ++n === 1 ? long : "Short enough now.", usedAnswerIds: [], unknowns: [], staleFlags: [] }) });
    const r = await data<{ draft: string; retried: boolean; overLimit: boolean; quota: { used: number } }>(s.applicant, "POST", `/gms/outside-questions/${qid}/draft`);
    expect(r).toMatchObject({ draft: "Short enough now.", retried: true, overLimit: false, quota: { used: 2 } });
    expect(await callsLogged()).toBe(2);
  });

  it("does not retry on the month's last call, and stops at the quota", async () => {
    h.env.ASSISTANT_MONTHLY_QUOTA = "1";
    h.llmAnswer.value = { draft: Array.from({ length: 50 }, () => "word").join(" "), usedAnswerIds: [], unknowns: [], staleFlags: [] };
    const r = await data<{ retried: boolean; overLimit: boolean }>(s.applicant, "POST", `/gms/outside-questions/${qid}/draft`);
    expect(r).toMatchObject({ retried: false, overLimit: true });
    const over = await s.call<Err>(s.applicant, "POST", `/gms/outside-questions/${qid}/draft`, {});
    expect(over.status).toBe(429);
    expect(over.body.errors[0]!.code).toBe("assist_quota_exhausted");
    expect(h.llm.requests).toHaveLength(1);
  });

  it("is accepted through the answer save with provenance assist, and the AI use note lists it", async () => {
    h.llmAnswer.value = { draft: "Families travel far for care.", usedAnswerIds: [], unknowns: [], staleFlags: [] };
    const draft = await data<{ draft: string }>(s.applicant, "POST", `/gms/outside-questions/${qid}/draft`);
    const saved = await data<{ provenance: string; version: number }>(s.applicant, "PUT", `/gms/outside-questions/${qid}/answer`, { body: `${draft.draft} Edited.`, provenance: "assist" });
    expect(saved).toMatchObject({ provenance: "assist", version: 1 });
    const detail = await data<{ aiUse: { used: boolean; count: number; questions: { questionId: string; prompt: string }[] } }>(s.applicant, "GET", `/gms/outside-applications/${oaId}`);
    expect(detail.aiUse).toMatchObject({ used: true, count: 1, questions: [{ questionId: qid, prompt: expect.stringContaining("Describe the need") }] });
    // A later version written by the person takes the question off the note.
    await data(s.applicant, "PUT", `/gms/outside-questions/${qid}/answer`, { body: "Rewritten by hand." });
    expect((await data<{ aiUse: { used: boolean } }>(s.applicant, "GET", `/gms/outside-applications/${oaId}`)).aiUse.used).toBe(false);
    // Library and assist are not both claimed.
    const lib = (await h.repos.table("answers").find({ workspace_id: WS_APPLICANT }))[0]!;
    expect((await s.call(s.applicant, "PUT", `/gms/outside-questions/${qid}/answer`, { body: "x", provenance: "assist", libraryAnswerId: lib.id })).status).toBe(400);
  });

  it("records an agent's save as the agent's, whatever it calls the text, and keeps drafting to the UI's people", async () => {
    const agent = { ...bearer(await h.forge({ sub: USER_APPLICANT, client_id: CLIENT_AGENT, scope: "applications:write assist library:read", [WORKSPACE_CLAIM]: WS_APPLICANT, jti: "tok-agent" })).headers, "Content-Type": "application/json" };
    const saved = await data<{ provenance: string }>(agent, "PUT", `/gms/outside-questions/${qid}/answer`, { body: "Agent text.", provenance: "assist" });
    expect(saved.provenance).toBe(`agent:${CLIENT_AGENT}`);
    // A funder cannot draft for an applicant's question; another workspace's question is not found.
    expect((await s.call(s.funder, "POST", `/gms/outside-questions/${qid}/draft`, {})).status).toBe(403);
    expect((await s.call(s.applicant, "POST", "/gms/outside-questions/0190a000-0000-7000-8000-00000000dead/draft", {})).status).toBe(404);
    expect((await s.call(s.applicant, "POST", `/gms/outside-questions/${qid}/draft`, { libraryAnswerIds: [] })).status).toBe(400);
  });
});

describe("reading a funder's guidelines", () => {
  const READING = {
    questions: [
      { prompt: "Describe your project.", limitKind: "words", limitValue: 250, phase: "full" },
      { prompt: "Summarize your request in a letter of inquiry.", limitKind: null, limitValue: null, phase: "loi" },
    ],
    requiredDocuments: ["IRS determination letter", "Most recent audit", "List of board members", "Project timeline", "irs determination letter"],
    deadlines: { loiDue: "2027-03-01", fullDue: "2027-02-30" },
    cautions: [],
  };
  beforeEach(() => {
    h.env.ASSISTANT_ENABLED = "true";
    h.llmAnswer.value = READING;
  });

  it("reads pasted guidelines into proposed questions and required documents, saving nothing", async () => {
    const r = await data<{ mode: string; questions: { prompt: string; limitKind?: string; limitValue?: number; phase: string }[]; requiredDocuments: { label: string; docType: string | null }[]; deadlines: { loiDue: string | null; fullDue: string | null }; saved: boolean }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/questions/parse`, { text: "Guidelines: 1. Describe your project (250 words). Attach your IRS determination letter.", mode: "ai" });
    expect(r.mode).toBe("ai");
    expect(r.questions).toEqual([
      { prompt: "Describe your project.", limitKind: "words", limitValue: 250, phase: "full" },
      { prompt: "Summarize your request in a letter of inquiry.", phase: "loi" },
    ]);
    expect(r.requiredDocuments).toEqual([
      { label: "IRS determination letter", docType: "irs_letter" },
      { label: "Most recent audit", docType: "audit" },
      { label: "List of board members", docType: "board_list" },
      { label: "Project timeline", docType: null },
    ]);
    // A date that does not exist is dropped.
    expect(r.deadlines).toEqual({ loiDue: "2027-03-01", fullDue: null });
    expect(r.saved).toBe(false);
    expect(await h.repos.table("outside_questions").count({ outside_application_id: oaId })).toBe(1);
    expect(await callsLogged()).toBe(1);
    expect((await h.repos.table("assist_calls").find({ workspace_id: WS_APPLICANT }))[0]!.tool).toBe("parse_guidelines");
    const tooLong = await s.call<Err>(s.applicant, "POST", `/gms/outside-applications/${oaId}/questions/parse`, { text: "x".repeat(60_001), mode: "ai" });
    expect(tooLong.status).toBe(422);
  });

  it("keeps an uploaded PDF as the funder's guidelines and sends it to the model as a document input", async () => {
    const pdf = b64(PDF(3));
    const r = await data<{ document: { id: string; docType: string; name: string }; questions: unknown[]; requiredDocuments: unknown[] }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/guidelines`, { name: "Northwind guidelines.pdf", mime: "application/pdf", contentBase64: pdf });
    expect(r.document).toMatchObject({ docType: "funder_guidelines", name: "Northwind guidelines.pdf" });
    expect(r.questions).toHaveLength(2);
    const req = h.llm.requests.at(-1)!;
    expect(req.documents).toEqual([{ kind: "pdf", base64: pdf, title: "Northwind guidelines.pdf" }]);
    const doc = (await h.repos.table("documents").one({ id: r.document.id }))!;
    expect(doc).toMatchObject({ subject_type: "outside_application", subject_id: oaId, doc_type: "funder_guidelines", workspace_id: WS_APPLICANT, owner_workspace_id: WS_APPLICANT });
    // The same file again is kept once, and read again (a second call).
    await data(s.applicant, "POST", `/gms/outside-applications/${oaId}/guidelines`, { name: "Northwind guidelines.pdf", mime: "application/pdf", contentBase64: pdf });
    expect(await h.repos.table("documents").count({ doc_type: "funder_guidelines" })).toBe(1);
    expect(await callsLogged()).toBe(2);
    // A plain-text file goes as a text document.
    await data(s.applicant, "POST", `/gms/outside-applications/${oaId}/guidelines`, { name: "guidelines.txt", mime: "text/plain", contentBase64: b64("1. Describe your project (250 words).") });
    expect(h.llm.requests.at(-1)!.documents).toEqual([{ kind: "text", text: "1. Describe your project (250 words).", title: "guidelines.txt" }]);
  });

  it("refuses files that are too large, too long, not what they say, or named like bank forms", async () => {
    const post = (body: Record<string, unknown>) => s.call<Err>(s.applicant, "POST", `/gms/outside-applications/${oaId}/guidelines`, body);
    expect((await post({ name: "g.pdf", mime: "application/pdf", contentBase64: b64(PDF(51)) })).body.errors[0]!.code).toBe("too_many_pages");
    expect((await post({ name: "g.pdf", mime: "application/pdf", contentBase64: b64("not a pdf") })).body.errors[0]!.code).toBe("not_a_pdf");
    expect((await post({ name: "g.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", contentBase64: b64("x") })).status).toBe(400);
    expect((await post({ name: "g.txt", mime: "text/plain", contentBase64: b64("x".repeat(60_001)) })).body.errors[0]!.code).toBe("too_long");
    const big = btoa(String.fromCharCode(...new Uint8Array(1024))).repeat(Math.ceil((10 * 1024 * 1024 + 2048) / 1024));
    expect((await post({ name: "g.pdf", mime: "application/pdf", contentBase64: big })).status).toBe(400);
    const refused = await post({ name: "Voided check for ACH.pdf", mime: "application/pdf", contentBase64: b64(PDF(1)) });
    expect(refused.status).toBe(422);
    expect(refused.body.errors[0]!.code).toBe("sensitive_document");
    expect(await h.repos.table("documents").count({ doc_type: "funder_guidelines" })).toBe(0);
    expect(h.llm.requests).toHaveLength(0);
  });

  it("stores nothing when the month's calls are spent", async () => {
    h.env.ASSISTANT_MONTHLY_QUOTA = "0";
    const r = await s.call<Err>(s.applicant, "POST", `/gms/outside-applications/${oaId}/guidelines`, { name: "g.pdf", mime: "application/pdf", contentBase64: b64(PDF(1)) });
    expect(r.status).toBe(429);
    expect(await h.repos.table("documents").count({ doc_type: "funder_guidelines" })).toBe(0);
  });
});

describe("the assistant never sees the vault", () => {
  it("sends no vault document or attachment in any draft or guidelines reading", async () => {
    h.env.ASSISTANT_ENABLED = "true";
    h.llmAnswer.value = { draft: "A draft.", usedAnswerIds: [], unknowns: [], staleFlags: [], questions: [], requiredDocuments: [], deadlines: { loiDue: null, fullDue: null }, cautions: [] };
    await data(s.applicant, "POST", `/gms/outside-questions/${qid}/draft`);
    await data(s.applicant, "POST", `/gms/outside-applications/${oaId}/questions/parse`, { text: "1. Need?", mode: "ai" });
    await data(s.applicant, "POST", `/gms/outside-applications/${oaId}/guidelines`, { name: "g.pdf", mime: "application/pdf", contentBase64: b64(PDF(1)) });
    expect(h.llm.requests).toHaveLength(3);
    expect(everythingSent()).not.toContain(VAULT_SECRET);
    expect(everythingSent()).not.toContain(btoa(VAULT_SECRET));
    // Only the uploaded guidelines ever went as a document input.
    expect(h.llm.requests.flatMap((r) => r.documents ?? []).map((d) => d.title)).toEqual(["g.pdf"]);
  });
});
