// SPDX-License-Identifier: AGPL-3.0-only
// The template gallery (v1.8.0): what is stripped before sharing, the moderation states, copies
// that are independent drafts, anonymous reads of approved items only, human-only sharing and
// moderation, and the starter library kept in step with migration 0036.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateFormDefinition, type FormDefinition } from "@gms/forms";
import { renderTemplate } from "@gms/notify";
import { describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { STARTER_ITEMS, STARTERS_PUBLISHED_AT, type Snapshot } from "../src/services/gallery-starters.ts";
import { findContacts, isModerator, redactContacts, replaceNames, stripSnapshot } from "../src/services/gallery.ts";
import { rubricInput } from "../src/services/programs.ts";
import { templateInput } from "../src/services/templates.ts";
import { startersSql } from "../scripts/gallery-starters.ts";
import { CLIENT_AGENT, USER_ADMIN, USER_AUDITOR, USER_OFFICER, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";

type H = Record<string, string>;
const root = fileURLToPath(new URL("../../../", import.meta.url));
const MODERATOR = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";
const json = (h: H, body: unknown, method = "POST"): RequestInit => ({ method, headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const as = async (h: Harness, userId: string, workspaceId = WS_FUNDER): Promise<H> => ({ ...bearer(await h.session(userId)).headers, "X-GMS-Workspace": workspaceId });
const person = async (h: Harness, userId: string): Promise<H> => bearer(await h.session(userId)).headers;
const data = async <T>(res: Response) => ((await res.json()) as { data: T }).data;
const items = async <T>(res: Response) => ((await res.json()) as { items: T[] }).items;
const code = async (res: Response) => ((await res.json()) as { errors: { code: string }[] }).errors[0]?.code;

async function withStarters(): Promise<Harness> {
  const h = await harness();
  h.env.GALLERY_MODERATORS = ` ${MODERATOR} , Gallery@OpenGrants.example `;
  for (const s of STARTER_ITEMS) {
    await h.repos.table("gallery_items").insert({ id: s.id, slug: s.slug, kind: s.kind, title: s.title, summary: s.summary, tags: s.tags as never, author_workspace_id: null, licence: "CC-BY-4.0", status: "approved", version: 1, snapshot: s.snapshot as never, uses_count: 0, published_at: STARTERS_PUBLISHED_AT, withdrawn_at: null });
  }
  return h;
}

interface Card {
  slug: string;
  kind: string;
  title: string;
  usesCount: number;
  author: { kind: string; name: string; verified: boolean };
  licence: { code: string; name: string };
}

/** A published application form in WS_FUNDER that carries contact details and the funder's name. */
async function sharedForm(h: Harness, who: H) {
  const form = await data<{ id: string }>(
    await h.request(
      "/gms/forms",
      json(who, {
        title: "Riverbend Community Foundation small grants application",
        description: "Questions? Write to grants@riverbendcf.example or call (555) 201-3344.",
        instructions: "Read the guidelines at https://riverbendcf.example/guidelines and https://elsewhere.example/apply before you start.",
        purpose: "application",
        jsonSchema: {
          type: "object",
          required: ["projectTitle"],
          properties: {
            projectTitle: { type: "string", title: "Project title", description: "What Riverbend Community Foundation will call your project." },
            contactEmail: { type: "string", format: "email", title: "Contact email", default: "dana.ortiz@riverbendcf.example" },
            phone: { type: "string", title: "Phone", description: "Our office line is 555-201-3344 if you get stuck." },
            amount: { type: "integer", title: "Amount", default: 5000 },
          },
        },
        uiSchema: {
          type: "VerticalLayout",
          elements: [
            { type: "Control", scope: "#/properties/projectTitle", options: { help: "Keep it short." } },
            { type: "Control", scope: "#/properties/contactEmail", options: { placeholder: "you@yourorg.example" } },
            { type: "Control", scope: "#/properties/phone", options: { help: "See www.riverbendcf.example/contact for hours." } },
            { type: "Control", scope: "#/properties/amount" },
          ],
        },
      }),
    ),
  );
  expect((await h.request(`/gms/forms/${form.id}/publish`, json(who, {}))).status).toBe(200);
  return form;
}

const SUBMIT = { title: "Small grants application from Riverbend Community Foundation", summary: "A short application we use for grants under $10,000.", tags: { fieldOfWork: ["Any field"], grantSize: ["Under $10,000"], audience: ["Nonprofits"] }, licence: "CC-BY-4.0" };

describe("stripping before sharing", () => {
  it("finds email addresses, phone numbers and web addresses, and keeps the funder's own site", () => {
    expect(findContacts("Write to grants@riverbend.example")).toEqual(["email"]);
    expect(findContacts("Call (555) 201-3344 or +44 20 7946 0958")).toEqual(["phone"]);
    expect(findContacts("See https://elsewhere.example/apply or www.other.org")).toEqual(["link"]);
    expect(findContacts("See https://riverbendcf.example/guidelines", ["riverbendcf.example"])).toEqual([]);
    expect(findContacts("See https://apply.riverbendcf.example", ["riverbendcf.example"])).toEqual([]);
    // Not contact details: years, dates, amounts and merge fields.
    expect(findContacts("Grants of $10,000 to $50,000 for 2026-2027, due 2027-06-30, {{links.status}} {{funder.name}}")).toEqual([]);
    expect(redactContacts("Email jo@x.example, call 555-201-3344, visit x.example").text).toBe("Email [email address], call [phone number], visit [web address]");
  });

  it("replaces the organization's names, whole words in any case, longest first", () => {
    expect(replaceNames("RIVERBEND Community Foundation and Riverbend's board", ["Riverbend Community Foundation", "Riverbend"]).text).toBe("[Your organization] and [Your organization]'s board");
    expect(replaceNames("Riverbendish", ["Riverbend"]).replaced).toBe(false);
  });

  it("drops a default or help text that holds a contact detail, redacts other text, and keeps no value it took out", () => {
    const snap: Snapshot = {
      forms: [
        {
          title: "Acme Fund application",
          description: "Contact acme@acme.example",
          instructions: null,
          purpose: "application",
          jsonSchema: { type: "object", properties: { a: { type: "string", title: "Acme question", default: "call 555-201-3344", description: "Mail a@acme.example" }, b: { type: "string", title: "B", default: "Acme Fund", description: "Fine help" } } },
          uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/a", options: { help: "www.acme.example/help", pii: true } }, { type: "Control", scope: "#/properties/b", options: { help: "About Acme Fund" } }] },
          mappingFromCommonGrants: {},
          mappingToCommonGrants: { funder: { const: "Acme Fund" } },
          fieldMeta: {},
        },
      ],
      rubrics: [{ name: "Acme rubric", criteria: [{ key: "x", label: "Fit with Acme Fund", weight: 1, scale: { type: "numeric", min: 1, max: 5 }, guidance: "Ask jo@acme.example" }], overall: {} }],
      emails: [{ name: "Acme decline", subject: "From Acme Fund", body: "Questions: jo@acme.example or https://acme.example/faq" }],
    };
    const { snapshot, stripped } = stripSnapshot(snap, { names: ["Acme Fund", "Acme"], allowedHosts: [] });
    const f = snapshot.forms[0]!;
    const props = f.jsonSchema.properties as Record<string, Record<string, unknown>>;
    expect(f.title).toBe("[Your organization] application");
    expect(f.description).toBe("Contact [email address]");
    expect(props.a).toEqual({ type: "string", title: "[Your organization] question" });
    expect(props.b).toEqual({ type: "string", title: "B", default: "[Your organization]", description: "Fine help" });
    const ui = (f.uiSchema.elements as { options: Record<string, unknown> }[]).map((e) => e.options);
    expect(ui).toEqual([{ pii: true }, { help: "About [Your organization]" }]);
    expect(f.mappingToCommonGrants).toEqual({ funder: { const: "[Your organization]" } });
    expect(snapshot.rubrics[0]!.criteria[0]).toEqual({ key: "x", label: "Fit with [Your organization]", weight: 1, scale: { type: "numeric", min: 1, max: 5 } });
    expect(snapshot.emails[0]).toEqual({ name: "[Your organization] decline", subject: "From [Your organization]", body: "Questions: [email address] or [web address]" });
    expect(stripped.map((s) => `${s.what}:${s.found.join("+")}`)).toEqual(expect.arrayContaining(["default:phone", "help:email", "help:link", "text:email", "name:organization name"]));
    expect(stripped.find((s) => s.path === "forms[0].jsonSchema.properties.a.default")?.where).toBe("Acme question · default value");
    const record = JSON.stringify(stripped);
    for (const secret of ["555-201-3344", "acme@acme.example", "jo@acme.example", "www.acme.example"]) expect(record).not.toContain(secret);
  });
});

describe("the starter library", () => {
  it("is nine items: three application forms, two reports, a rubric, two emails and a kit, each usable as it is", () => {
    expect(STARTER_ITEMS.map((s) => s.kind).sort()).toEqual(["application_form", "application_form", "application_form", "email_template", "email_template", "program_kit", "report_form", "report_form", "rubric"]);
    for (const s of STARTER_ITEMS) {
      for (const f of s.snapshot.forms) {
        const def = { id: s.id, version: 1, title: f.title, jsonSchema: f.jsonSchema, uiSchema: f.uiSchema, mappingFromCommonGrants: f.mappingFromCommonGrants, mappingToCommonGrants: f.mappingToCommonGrants, fieldMeta: f.fieldMeta } as unknown as FormDefinition;
        expect(validateFormDefinition(def), `${s.slug}: ${f.title}`).toEqual([]);
        // Plain help: no contact details in what every funder copies.
        expect(findContacts(JSON.stringify(f)), f.title).toEqual([]);
      }
      for (const r of s.snapshot.rubrics) expect(rubricInput.safeParse(r).success, r.name).toBe(true);
      for (const m of s.snapshot.emails) {
        expect(templateInput.safeParse({ kind: "email", ...m }).success, m.name).toBe(true);
        // Every merge field is one the GMS fills in when it sends to an applicant or a grantee.
        const fields = { recipient: { name: "Alder Creek" }, funder: { name: "Riverbend" }, application: { title: "Clinic", submittedAt: "2027-04-02" }, opportunity: { title: "Health 2027" }, award: { title: "Clinic", amount: "$25,000.00" }, links: { status: "https://x/s", award: "https://x/a", application: "https://x/e" } };
        expect(() => renderTemplate(m, fields)).not.toThrow();
      }
    }
  });

  it("is the same in the migration and in the mock-mode fixture", () => {
    const sql = readFileSync(`${root}supabase/migrations/0036_template_gallery.sql`, "utf8");
    const block = /-- starters:begin\n([\s\S]*?)\n-- starters:end/.exec(sql)?.[1];
    expect(block, "run: node --experimental-strip-types apps/api/scripts/gallery-starters.ts").toBe(startersSql());
    const fixture = JSON.parse(readFileSync(`${root}apps/web/src/mocks/galleryStarters.json`, "utf8")) as { publishedAt: string; items: unknown };
    expect(fixture).toEqual({ publishedAt: STARTERS_PUBLISHED_AT, items: STARTER_ITEMS });
  });
});

describe("public reads", () => {
  it("anyone lists and previews approved items, filtered by kind, tag and words; nothing else is public", async () => {
    const h = await withStarters();
    await h.repos.table("gallery_items").insert({ slug: "taken-down", kind: "rubric", title: "Taken down", summary: "Withdrawn by its author.", tags: { fieldOfWork: [], grantSize: [], audience: [] } as never, author_workspace_id: WS_FUNDER, licence: "CC-BY-4.0", status: "withdrawn", version: 1, snapshot: STARTER_ITEMS[3]!.snapshot as never, uses_count: 0, published_at: STARTERS_PUBLISHED_AT, withdrawn_at: STARTERS_PUBLISHED_AT });
    const all = await h.request("/gms/gallery?pageSize=100");
    expect(all.status).toBe(200);
    const body = (await all.json()) as { items: Card[]; paginationInfo: { totalItems: number }; tags: { grantSize: string[] } };
    expect(body.items.map((i) => i.slug).sort()).toEqual(STARTER_ITEMS.map((s) => s.slug).sort());
    expect(body.items[0]).toMatchObject({ licence: { code: "CC-BY-4.0", name: "CC BY 4.0" }, author: { kind: "opengrants", verified: false } });
    expect(body.tags.grantSize).toContain("Under $10,000");
    expect((await items<Card>(await h.request("/gms/gallery?kind=report_form"))).map((i) => i.slug).sort()).toEqual(["final-report", "interim-report"]);
    expect((await items<Card>(await h.request(`/gms/gallery?tag=${encodeURIComponent("under $10,000")}`))).map((i) => i.slug).sort()).toEqual(["small-capacity-building", "small-grants-program-kit"]);
    expect((await items<Card>(await h.request("/gms/gallery?q=decline%20kind"))).map((i) => i.slug)).toEqual(["decline-email"]);
    expect((await h.request("/gms/gallery?kind=letter")).status).toBe(400);

    const one = await data<Card & { snapshot: Snapshot }>(await h.request("/gms/gallery/common-application"));
    expect(one.snapshot.forms[0]!.title).toBe("Common application");
    expect((await h.request("/gms/gallery/taken-down")).status).toBe(404);
    expect((await h.request("/gms/gallery/no-such-template")).status).toBe(404);
  });
});

describe("copy to a workspace", () => {
  it("makes an independent draft form and counts the use", async () => {
    const h = await withStarters();
    const officer = await as(h, USER_OFFICER);
    const res = await h.request(`/gms/workspaces/${WS_FUNDER}/gallery/items/common-application/copy`, json(officer, {}));
    expect(res.status).toBe(201);
    const out = await data<{ item: { usesCount: number }; created: { type: string; id: string; title: string }[] }>(res);
    expect(out.item.usesCount).toBe(1);
    expect(out.created).toEqual([{ type: "form", id: expect.stringMatching(/^frm_/), title: "Common application", purpose: "application" }]);
    const form = await data<{ status: string; shared: boolean; jsonSchema: { properties: Record<string, unknown> } }>(await h.request(`/gms/forms/${out.created[0]!.id}`, { headers: officer }));
    expect(form).toMatchObject({ status: "draft", shared: false });

    // Editing the copy leaves the gallery item as it was, and the item changing never reaches the copy.
    expect((await h.request(`/gms/forms/${out.created[0]!.id}`, json(officer, { title: "Our application" }, "PATCH"))).status).toBe(200);
    const item = await data<{ snapshot: Snapshot; usesCount: number }>(await h.request("/gms/gallery/common-application"));
    expect(item.snapshot.forms[0]!.title).toBe("Common application");
    expect(item.usesCount).toBe(1);
    const row = (await h.repos.table("gallery_items").one({ slug: "common-application" }))!;
    await h.repos.table("gallery_items").update({ id: row.id }, { snapshot: { forms: [], rubrics: STARTER_ITEMS[3]!.snapshot.rubrics, emails: [] } as never });
    const again = await data<{ title: string; jsonSchema: { properties: Record<string, unknown> } }>(await h.request(`/gms/forms/${out.created[0]!.id}`, { headers: officer }));
    expect(again.title).toBe("Our application");
    expect(Object.keys(again.jsonSchema.properties)).toEqual(Object.keys(form.jsonSchema.properties));
    expect(h.ledger.events.map((e) => e.eventType)).toEqual(expect.arrayContaining(["form.created", "gallery.copied"]));
  });

  it("copies a program kit whole, and never turns a copied email into a new version of the workspace's own", async () => {
    const h = await withStarters();
    const admin = await as(h, USER_ADMIN);
    expect((await h.request("/gms/templates", json(admin, { kind: "email", name: "Decline", subject: "Ours", body: "Our own decline." }))).status).toBe(201);
    const out = await data<{ created: { type: string; title: string; purpose?: string }[] }>(await h.request(`/gms/workspaces/${WS_FUNDER}/gallery/items/small-grants-program-kit/copy`, json(admin, {})));
    expect(out.created.map((c) => `${c.type}:${c.title}`)).toEqual(["form:Common application", "form:Final report", "rubric:Five-criterion rubric", "template:Award letter", "template:Decline (from the gallery)"]);
    expect(out.created.filter((c) => c.type === "form").map((c) => c.purpose)).toEqual(["application", "report"]);
    const own = (await h.repos.table("templates").find({ workspace_id: WS_FUNDER, name: "Decline" }))!;
    expect(own.map((t) => t.version)).toEqual([1]);
  });

  it("is for funder workspaces whose members may make each part", async () => {
    const h = await withStarters();
    // An applicant workspace has no forms, rubrics or email templates of its own to copy into.
    expect((await h.request(`/gms/workspaces/${WS_APPLICANT}/gallery/items/decline-email/copy`, json(await as(h, USER_OFFICER, WS_APPLICANT), {}))).status).toBe(403);
    // An auditor reads, and makes nothing: no part of a kit is created.
    const auditor = await as(h, USER_AUDITOR);
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}/gallery/items/small-grants-program-kit/copy`, json(auditor, {}))).status).toBe(403);
    expect(await h.repos.table("forms").count({ workspace_id: WS_FUNDER })).toBe(0);
    expect((await h.repos.table("gallery_items").one({ slug: "small-grants-program-kit" }))!.uses_count).toBe(0);
    // Not a member of the workspace named in the path.
    expect((await h.request(`/gms/workspaces/${WS_OTHER}/gallery/items/decline-email/copy`, json(await as(h, USER_OFFICER, WS_OTHER), {}))).status).toBe(403);
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}/gallery/items/no-such/copy`, json(await as(h, USER_OFFICER), {}))).status).toBe(404);
  });
});

describe("sharing and moderation", () => {
  it("strips contact details and names, waits for a moderator, and only then is public", async () => {
    const h = await withStarters();
    const admin = await as(h, USER_ADMIN);
    const form = await sharedForm(h, admin);
    await h.repos.table("workspaces").update({ id: WS_FUNDER }, { org_projection: { name: "Riverbend Community Foundation", socials: { website: "https://riverbendcf.example" } } as never });

    const preview = await data<{ kind: string; names: string[]; snapshot: Snapshot; stripped: { what: string; where: string }[] }>(await h.request(`/gms/workspaces/${WS_FUNDER}/gallery/preview`, json(admin, { source: { type: "form", id: form.id }, extraNames: ["Riverbend"] })));
    expect(preview.kind).toBe("application_form");
    expect(preview.names).toEqual(expect.arrayContaining(["Riverbend Community Foundation", "Riverbend"]));
    const f = preview.snapshot.forms[0]!;
    expect(f.title).toBe("[Your organization] small grants application");
    expect(f.description).toBe("Questions? Write to [email address] or call [phone number].");
    // The funder's own site stays; anyone else's goes.
    expect(f.instructions).toBe("Read the guidelines at https://riverbendcf.example/guidelines and [web address] before you start.");
    const props = f.jsonSchema.properties as Record<string, Record<string, unknown>>;
    expect(props.contactEmail).toEqual({ type: "string", format: "email", title: "Contact email" });
    expect(props.phone).toEqual({ type: "string", title: "Phone" });
    expect(props.amount).toEqual({ type: "integer", title: "Amount", default: 5000 });
    expect(props.projectTitle!.description).toBe("What [Your organization] will call your project.");
    expect((f.uiSchema.elements as { options?: Record<string, unknown> }[]).map((e) => e.options)).toEqual([{ help: "Keep it short." }, {}, { help: "See www.riverbendcf.example/contact for hours." }, undefined]);
    expect(preview.stripped.map((s) => s.where)).toEqual(expect.arrayContaining(["Contact email · default value", "Phone · help text", "Contact email · placeholder"]));
    expect(await h.repos.table("gallery_submissions").count({})).toBe(0);

    const res = await h.request(`/gms/workspaces/${WS_FUNDER}/gallery/submissions`, json(admin, { ...SUBMIT, source: { type: "form", id: form.id }, extraNames: ["Riverbend"] }));
    expect(res.status).toBe(201);
    const sub = await data<{ id: string; status: string; title: string; stripped: unknown[]; source: { version: number } }>(res);
    expect(sub).toMatchObject({ status: "pending", title: "Small grants application from [Your organization]", source: { version: 1 } });
    expect(JSON.stringify(sub.stripped)).not.toMatch(/grants@|555|dana\.ortiz/);
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}/gallery/submissions`, json(admin, { ...SUBMIT, source: { type: "form", id: form.id } }))).status).toBe(409);
    expect((await items<Card>(await h.request("/gms/gallery?pageSize=100"))).some((i) => i.title.includes("Small grants application from"))).toBe(false);

    // Not a moderator: refused. A moderator, by user id or by email address: the queue.
    expect((await h.request("/gms/gallery/moderation/queue", { headers: await person(h, USER_OFFICER) })).status).toBe(403);
    expect(await data<{ moderator: boolean }>(await h.request("/gms/gallery/moderation/me", { headers: await person(h, USER_OFFICER) }))).toEqual({ moderator: false });
    const mod = await person(h, MODERATOR);
    expect(await data<{ moderator: boolean }>(await h.request("/gms/gallery/moderation/me", { headers: mod }))).toEqual({ moderator: true });
    const queue = await items<{ id: string; author: { name: string; verified: boolean }; snapshot: Snapshot }>(await h.request("/gms/gallery/moderation/queue", { headers: mod }));
    expect(queue.map((q) => q.id)).toEqual([sub.id]);
    expect(queue[0]!.author).toEqual({ kind: "workspace", name: "Riverbend Community Foundation", verified: true });

    const approved = await h.request(`/gms/gallery/moderation/submissions/${sub.id}/approve`, json(mod, {}));
    expect(approved.status).toBe(200);
    const { item } = await data<{ item: { slug: string } }>(approved);
    expect(item.slug).toBe("small-grants-application-from-your-organization");
    const pub = await data<Card & { snapshot: Snapshot }>(await h.request(`/gms/gallery/${item.slug}`));
    expect(pub.author).toEqual({ kind: "workspace", name: "Riverbend Community Foundation", verified: true });
    expect(pub.licence.code).toBe("CC-BY-4.0");
    expect(pub.snapshot.forms[0]!.title).toBe("[Your organization] small grants application");
    expect((await h.request(`/gms/gallery/moderation/submissions/${sub.id}/approve`, json(mod, {}))).status).toBe(409);
    // The author's team sees the decision, in its own ledger and beside the submission.
    expect(h.ledger.events.filter((e) => e.workspaceId === WS_FUNDER).map((e) => e.eventType)).toEqual(expect.arrayContaining(["gallery.submitted", "gallery.item_approved"]));
    const mine = await items<{ status: string; item: { slug: string; live: boolean } }>(await h.request(`/gms/workspaces/${WS_FUNDER}/gallery/submissions`, { headers: await as(h, USER_OFFICER) }));
    expect(mine[0]).toMatchObject({ status: "approved", item: { slug: item.slug, live: true } });

    // The author withdraws it: off the gallery; a second withdraw is refused.
    const withdrawn = await h.request(`/gms/workspaces/${WS_FUNDER}/gallery/submissions/${sub.id}/withdraw`, json(admin, {}));
    expect(await data<{ status: string; item: { live: boolean } }>(withdrawn)).toMatchObject({ status: "withdrawn", item: { live: false } });
    expect((await h.request(`/gms/gallery/${item.slug}`)).status).toBe(404);
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}/gallery/submissions/${sub.id}/withdraw`, json(admin, {}))).status).toBe(409);
  });

  it("a decline needs a reason, and the author reads it", async () => {
    const h = await withStarters();
    const admin = await as(h, USER_ADMIN);
    const form = await sharedForm(h, admin);
    const sub = await data<{ id: string }>(await h.request(`/gms/workspaces/${WS_FUNDER}/gallery/submissions`, json(admin, { ...SUBMIT, source: { type: "form", id: form.id } })));
    // By email address this time (any case).
    const mod = { ...bearer(await h.session(MODERATOR.replace(/5/g, "6"))).headers };
    h.env.GALLERY_MODERATORS = "person@RiverbendCF.example";
    expect((await h.request(`/gms/gallery/moderation/submissions/${sub.id}/reject`, json(mod, {}))).status).toBe(400);
    expect((await h.request(`/gms/gallery/moderation/submissions/${sub.id}/reject`, json(mod, { reason: "It still names a staff member in the instructions." }))).status).toBe(200);
    const mine = await items<{ status: string; decisionReason: string }>(await h.request(`/gms/workspaces/${WS_FUNDER}/gallery/submissions`, { headers: admin }));
    expect(mine[0]).toMatchObject({ status: "rejected", decisionReason: "It still names a staff member in the instructions." });
    expect(h.ledger.events.find((e) => e.eventType === "gallery.item_declined")).toMatchObject({ workspaceId: WS_FUNDER, subjectId: sub.id });
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}/gallery/submissions/${sub.id}/withdraw`, json(admin, {}))).status).toBe(409);
    // A declined submission frees the record to be shared again.
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}/gallery/submissions`, json(admin, { ...SUBMIT, source: { type: "form", id: form.id } }))).status).toBe(201);
  });

  it("sharing is a funder admin's, in person; drafts, letters and other workspaces' records are refused", async () => {
    const h = await withStarters();
    const admin = await as(h, USER_ADMIN);
    const form = await sharedForm(h, admin);
    const body = { ...SUBMIT, source: { type: "form", id: form.id } };
    const url = `/gms/workspaces/${WS_FUNDER}/gallery/submissions`;
    expect(await code(await h.request(url, json(await as(h, USER_OFFICER), body)))).toBe("insufficient_scope");
    // An agent acting for the admin, and a workspace API client, are refused: a human gate.
    const agent = await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "workspace:admin forms:read", [WORKSPACE_CLAIM]: WS_FUNDER });
    expect(await code(await h.request(url, json(bearer(agent).headers, body)))).toBe("human_only");
    expect(await code(await h.request(url, json(bearer(await h.forge({ scope: "workspace:admin" })).headers, body)))).toBe("person_required");
    // The licence must be accepted.
    expect((await h.request(url, json(admin, { ...body, licence: undefined }))).status).toBe(400);
    // A form with no published version.
    const draft = await data<{ id: string }>(await h.request("/gms/forms", json(admin, { title: "Draft" })));
    expect(await code(await h.request(url, json(admin, { ...body, source: { type: "form", id: draft.id } })))).toBe("form_not_published");
    // A letter is not an email template.
    const letter = await data<{ id: string }>(await h.request("/gms/templates", json(admin, { kind: "letter", name: "Our letter", body: "Dear {{recipient.name}}" })));
    expect(await code(await h.request(url, json(admin, { ...body, source: { type: "template", id: letter.id } })))).toBe("not_shareable");
    // Another workspace's form is not found.
    const other = await sharedForm(h, await as(h, USER_ADMIN, WS_FUNDER));
    await h.repos.table("forms").update({ id: other.id.replace(/^frm_/, "") }, { workspace_id: WS_OTHER });
    expect((await h.request(url, json(admin, { ...body, source: { type: "form", id: other.id } }))).status).toBe(404);
    // A rubric and an email template share too.
    const rubric = await data<{ id: string }>(await h.request("/gms/rubrics", json(admin, { name: "Riverbend Community Foundation rubric", criteria: [{ key: "fit", label: "Fit", weight: 1, scale: { type: "numeric", min: 1, max: 5 }, guidance: "Ask helen@riverbendcf.example" }] })));
    const r = await data<{ kind: string; stripped: { what: string }[] }>(await h.request(url, json(admin, { ...SUBMIT, source: { type: "rubric", id: rubric.id } })));
    expect(r.kind).toBe("rubric");
    expect(r.stripped.map((s) => s.what)).toEqual(expect.arrayContaining(["name", "help"]));
    const email = await data<{ id: string }>(await h.request("/gms/templates", json(admin, { kind: "email", name: "Thanks", subject: "Thank you from Riverbend Community Foundation", body: "Hello {{recipient.name}}" })));
    const e = await data<{ kind: string }>(await h.request(url, json(admin, { ...SUBMIT, source: { type: "template", id: email.id } })));
    expect(e.kind).toBe("email_template");
  });

  it("moderators are a fixed list, matched by user id or email", () => {
    expect(isModerator(" a@b.example , 5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a", { userId: "5A5A5A5A-5A5A-4A5A-8A5A-5A5A5A5A5A5A", email: null })).toBe(true);
    expect(isModerator("a@b.example", { userId: USER_ADMIN, email: "A@B.example" })).toBe(true);
    expect(isModerator("", { userId: USER_ADMIN, email: "a@b.example" })).toBe(false);
    expect(isModerator(undefined, { userId: USER_ADMIN, email: null })).toBe(false);
  });
});

describe("agents", () => {
  async function mcp(h: Harness, token: string, method: string, params?: Record<string, unknown>) {
    const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }) });
    return ((await res.json()) as { result: Record<string, unknown> }).result;
  }

  it("search and read the gallery, and have no tool to share, withdraw or moderate", async () => {
    const h = await withStarters();
    const token = await h.forge({ sub: USER_OFFICER, client_id: CLIENT_AGENT, scope: "forms:read", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-gallery-1" });
    const tools = ((await mcp(h, token, "tools/list")).tools as { name: string }[]).map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["search_gallery", "get_gallery_item"]));
    expect(tools.filter((t) => /gallery|moderat/.test(t))).toEqual(["search_gallery", "get_gallery_item"]);
    const found = (await mcp(h, token, "tools/call", { name: "search_gallery", arguments: { kind: "rubric" } })).structuredContent as { items: { slug: string }[]; total: number };
    expect(found).toMatchObject({ total: 1, items: [{ slug: "five-criterion-rubric" }] });
    const one = (await mcp(h, token, "tools/call", { name: "get_gallery_item", arguments: { slug: "decline-email" } })).structuredContent as { snapshot: Snapshot };
    expect(one.snapshot.emails[0]!.name).toBe("Decline");
  });
});
