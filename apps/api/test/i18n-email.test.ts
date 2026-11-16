// SPDX-License-Identifier: AGPL-3.0-only
// Emails and documents in the recipient's or requester's language (docs/i18n.md): Spanish for a
// person who chose Spanish, English for everyone else; a funder's own template as written; the
// package and the board docket in the language of the person who asks for them.
import { constants, inflateSync } from "node:zlib";
import { renderPdf } from "@gms/documents";
import { beforeEach, describe, expect, it } from "vitest";
import { sendDigests, sendNextCycleReminders } from "../src/jobs.ts";
import { docketBlocks, type DocketModel } from "../src/services/docket.ts";
import { WS_APPLICANT, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  h.directory.users.set(USER_APPLICANT, { email: "maria.santos@aldercreek.example", name: "Maria Santos" });
});

const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await s.call<{ data: T }>(who, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};

/** The text a PDF draws (the standard fonts write WinAnsi hex strings in Flate streams). */
function pdfText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const out: string[] = [];
  let i = 0;
  while ((i = buf.indexOf("stream", i)) !== -1) {
    let start = i + 6;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const end = buf.indexOf("endstream", start);
    if (end < 0) break;
    try {
      const txt = inflateSync(buf.subarray(start, end), { finishFlush: constants.Z_SYNC_FLUSH }).toString("latin1");
      for (const m of txt.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) out.push(Buffer.from(m[1]!, "hex").toString("latin1"));
    } catch {
      // Not a content stream.
    }
    i = end + 9;
  }
  return out.join(" ").replace(/\s+/g, " ");
}

const COMPLETE = { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles to reach primary care." };
async function submitApplication() {
  const app = (await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp })).body.data;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${app.id}/forms/${s.uuid.loi}`, { response: COMPLETE });
  h.mailer.sent.length = 0;
  const r = await s.call(s.applicant, "PUT", `/common-grants/applications/${app.id}/submit`);
  expect(r.status).toBe(200);
  return app.id;
}

describe("the built-in letters", () => {
  it("reach an organization whose admins chose Spanish in Spanish, at its own address", async () => {
    await h.preferences.setLocale(USER_APPLICANT, "es");
    await submitApplication();
    expect(h.mailer.sent).toHaveLength(1);
    const receipt = h.mailer.sent[0]!;
    expect(receipt).toMatchObject({ to: ["info@aldercreekfs.example"], subject: "Recibimos su solicitud: Mobile Health Navigation for Rural Families", locale: "es" });
    expect(receipt.text).toContain("Riverbend Community Foundation recibió Mobile Health Navigation for Rural Families para Community Health Grants 2027 el 16 de abril de 2027.");
    expect(receipt.text).not.toMatch(/\b(Hello|Thank you|received)\b/);
  });

  it("stay English for an organization whose people did not choose Spanish", async () => {
    await submitApplication();
    expect(h.mailer.sent[0]).toMatchObject({ to: ["info@aldercreekfs.example"], subject: "We received your application: Mobile Health Navigation for Rural Families" });
    expect(h.mailer.sent[0]!.locale).toBe("en");
    expect(h.mailer.sent[0]!.text).toContain("on 2027-04-16.");
  });

  it("are sent as the funder wrote them when the funder edited one, whatever the recipient's language", async () => {
    await data(s.funder, "POST", "/gms/templates", { kind: "email", name: "Application received", subject: "Thanks for applying: {{application.title}}", body: "Dear {{recipient.name}}, {{funder.name}} has your application." });
    await h.preferences.setLocale(USER_APPLICANT, "es");
    await submitApplication();
    const receipt = h.mailer.sent[0]!;
    expect(receipt.subject).toBe("Thanks for applying: Mobile Health Navigation for Rural Families");
    expect(receipt.text.startsWith("Dear Alder Creek Family Services, Riverbend Community Foundation has your application.")).toBe(true);
    // Not marked Spanish: the content is the funder's.
    expect(receipt.locale).toBeUndefined();
  });
});

describe("scheduled emails", () => {
  const base = () => ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>" }, ports: { mailer: h.mailer, directory: h.directory, preferences: h.preferences } });
  const declined = async () => {
    const id = (await data<{ id: string }>(s.applicant, "POST", "/gms/outside-applications", { title: "Clinic grant 2027", funderName: "Northwind", programName: "Rural Health Fund" })).id;
    await data(s.applicant, "POST", `/gms/outside-applications/${id}/submit`, { submittedAt: "2027-01-10", method: "portal" });
    await data(s.applicant, "POST", `/gms/outside-applications/${id}/decision`, { outcome: "declined", nextCycleOn: h.clock.now.toISOString().slice(0, 10) });
    h.mailer.sent.length = 0;
  };

  it("go in the recipient's saved language", async () => {
    await declined();
    await h.preferences.setLocale(USER_APPLICANT, "es");
    await sendNextCycleReminders(base());
    expect(h.mailer.sent.map((m) => [m.to[0], m.subject, m.locale])).toEqual([["maria.santos@aldercreek.example", "Próximo ciclo de financiamiento: Rural Health Fund", "es"]]);
    expect(h.mailer.sent[0]!.text).toContain("Pidió que le recordáramos hoy, 16 de abril de 2027, que Rural Health Fund de Northwind podría abrir de nuevo.");
  });

  it("go in English without a saved language, or when the preferences cannot be read", async () => {
    await declined();
    await sendNextCycleReminders(base());
    expect(h.mailer.sent.map((m) => m.subject)).toEqual(["Next funding cycle: Rural Health Fund"]);
  });
});

describe("invitations by address", () => {
  it("use the language of the account the address belongs to, English for a new address", async () => {
    h.identity.users.set("ana@riverbendcf.example", { userId: "abababab-abab-4bab-8bab-abababababab", passportUserId: null });
    await h.preferences.setLocale("abababab-abab-4bab-8bab-abababababab", "es");
    h.mailer.sent.length = 0;
    const known = await s.call(s.applicant, "POST", `/gms/workspaces/${WS_APPLICANT}/invitations`, { email: "ana@riverbendcf.example", role: "editor" });
    const unknown = await s.call(s.applicant, "POST", `/gms/workspaces/${WS_APPLICANT}/invitations`, { email: "new.person@example.org", role: "editor" });
    expect([known.status, unknown.status]).toEqual([201, 201]);
    const [es, en] = h.mailer.sent;
    expect(es).toMatchObject({ to: ["ana@riverbendcf.example"], locale: "es" });
    expect(es!.subject).toBe("Le invitan a Alder Creek Family Services en OpenGrants GMS");
    expect(es!.text).toContain("como editor(a)");
    expect(en).toMatchObject({ to: ["new.person@example.org"], locale: "en" });
    expect(en!.subject).toBe("You are invited to Alder Creek Family Services on OpenGrants GMS");
  });
});

describe("documents for the person who asks", () => {
  it("print the send package's fixed labels in the request's language", async () => {
    const id = (await data<{ id: string }>(s.applicant, "POST", "/gms/outside-applications", { title: "Clinic grant 2027", funderName: "Northwind", programName: "Rural Health Fund" })).id;
    const pdf = async (headers: Record<string, string>) => {
      const res = await h.request(`/gms/outside-applications/${id}/package.pdf`, { headers: { ...s.applicant, ...headers } });
      expect(res.status).toBe(200);
      return pdfText(new Uint8Array(await res.arrayBuffer()));
    };
    const es = await pdf({ Cookie: "gms_lang=es" });
    expect(es).toContain("Organización");
    expect(es).toContain("Monto solicitado");
    expect(es).toContain("Preguntas y respuestas");
    expect(es).toContain("Esta solicitud no tiene preguntas.");
    expect(es).toContain("Página 1 de");
    expect(es).not.toMatch(/Questions and answers|Page 1 of/);
    // What the person typed stays as written.
    expect(es).toContain("Clinic grant 2027");
    expect(await pdf({ "Accept-Language": "es-MX,es;q=0.9" })).toContain("Preguntas y respuestas");
    const en = await pdf({});
    expect(en).toContain("Questions and answers");
    expect(en).toContain("Page 1 of");
  });

  it("print the board docket's fixed labels in the model's language", async () => {
    const model = (locale: "en" | "es"): DocketModel => ({
      locale,
      title: "Board docket",
      funder: "Riverbend Community Foundation",
      opportunity: "Community Health Grants 2027",
      competition: "Community Health Grants 2027",
      stage: "Full proposal",
      generatedAt: "2027-04-16T17:00:00.000Z",
      includeFunderOnlyComments: false,
      totals: { applications: 1, requested: "$150,000", recommended: "$120,000" },
      applications: [{ applicationId: "app_1", title: "Navigator Expansion", applicant: "Alder Creek Family Services", requested: "$150,000", recommendedAmount: "$120,000", recommendation: "Approve (proposed)", averageScore: "81.5", reviews: 3, budgetTotal: "$150,000", summary: "Families travel 46 miles to reach primary care.", criteria: [{ label: "Fit", weight: 1, mean: "81.5", scored: 3 }], reviewerRecommendations: [], comments: [] }],
    });
    const text = async (locale: "en" | "es") => pdfText(await renderPdf({ title: "docket", blocks: docketBlocks(model(locale)), createdAt: "2027-04-16T17:00:00.000Z" }));
    const es = await text("es");
    for (const label of ["Carpeta para la junta", "Financiador", "Convocatoria", "Preparado el", "16 de abril de 2027", "Total solicitado", "Puntuación promedio", "Puntuaciones por criterio", "81.5 de 100 (3 revisiones)", "Sin comentarios."]) expect(es).toContain(label);
    expect(es).not.toMatch(/Board docket|Average score|No comments/);
    const en = await text("en");
    for (const label of ["Board docket", "Funder", "Prepared", "2027-04-16", "Average score", "81.5 of 100 (3 reviews)", "No comments."]) expect(en).toContain(label);
  });
});

describe("notification titles", () => {
  const started = async () => {
    const app = (await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp })).body.data;
    await s.call(s.applicant, "PUT", `/common-grants/applications/${app.id}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles." } });
    await s.call(s.applicant, "PUT", `/common-grants/applications/${app.id}/submit`);
    const asked = await s.call(s.funder, "POST", `/gms/applications/app_${app.id}/request-revision`, { message: "Please cite the county assessment." });
    expect(asked.status).toBe(200);
    return app.id;
  };
  type Item = { type: string; title: string; titleLocalized?: string };
  const list = async (headers: Record<string, string> = {}) => (await s.call<{ data: { items: Item[] } }>({ ...s.applicant, ...headers }, "GET", "/gms/notifications")).body.data.items;

  it("keep the English title as it always was, and add the reader's language only when it is not English", async () => {
    await started();
    const en = await list();
    const revision = en.find((n) => n.type === "application.request_revision")!;
    expect(revision.title).toMatch(/^Application request revision: /);
    expect(en.every((n) => n.titleLocalized === undefined)).toBe(true);
    const es = (await list({ Cookie: "gms_lang=es" })).find((n) => n.type === "application.request_revision")!;
    expect(es.title).toBe(revision.title);
    expect(es.titleLocalized).toBe(revision.title.replace("Application request revision", "Se pidió una revisión de la solicitud"));
  });

  it("are listed in each digest in its recipient's language", async () => {
    const base = { repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>" }, ports: { mailer: h.mailer, directory: h.directory, preferences: h.preferences } };
    h.directory.users.set(USER_APPLICANT, { email: "maria.santos@aldercreek.example", name: "Maria Santos" });
    await h.repos.table("workspace_members").update({ workspace_id: WS_APPLICANT, user_id: USER_APPLICANT }, { notification_preferences: { digest: "daily", channels: {} } as never });
    await h.preferences.setLocale(USER_APPLICANT, "es");
    await started();
    h.mailer.sent.length = 0;
    expect((await sendDigests(base, "daily")).sent).toBe(1);
    const mail = h.mailer.sent[0]!;
    expect(mail.locale).toBe("es");
    expect(mail.text).toContain("- Se pidió una revisión de la solicitud: ");
    expect(mail.text).not.toContain("Application request revision");
  });
});
