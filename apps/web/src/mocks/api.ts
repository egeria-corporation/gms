// SPDX-License-Identifier: AGPL-3.0-only
// In-browser implementation of the API port, backed by the seed in store.ts. It follows the
// Worker's rules closely enough for screens to behave the same in mock mode: published form
// versions are immutable, eligibility rules are parsed before saving, a competition opens only
// when its launch checklist passes.
import { validateFormDefinition, testFill, type FormDefinition, type JsonObject } from "@gms/forms";
import { evaluate, parseRules } from "@gms/rules";
import { ApiError, type GmsApi, type Me, type MeWorkspace, type Workspace } from "../api/client.ts";
import type {
  Checklist,
  ChecklistItem,
  Competition,
  FormRecord,
  FormSummary,
  Opportunity,
  PublicFunder,
  PublicOpportunityCard,
  Stage,
  WorkspaceRecord,
} from "../api/types.ts";
import type { Session } from "../auth/types.ts";
import { checkBrand } from "../lib/contrast.ts";
import { slugify } from "../lib/format.ts";
import { FIXTURE_WORKSPACES, MOCK_MEMBERSHIPS } from "./fixtures.ts";
import { seedStore, type Store, type WorkspaceData } from "./store.ts";

export interface MockApiOptions {
  session: () => Promise<Session | null>;
  memberships?: MeWorkspace[];
  workspaces?: Workspace[];
  store?: Store;
  now?: () => Date;
}

const clone = <T>(v: T): T => structuredClone(v);
const uuid = () => crypto.randomUUID();
const notFound = (what: string) => new ApiError(404, `${what} not found`);
const invalid = (message: string, errors: unknown[] = []) => new ApiError(422, message, errors);

function summaryOf(f: FormRecord): FormSummary {
  const { jsonSchema: _s, uiSchema: _u, mappingFromCommonGrants: _f, mappingToCommonGrants: _t, fieldMeta: _m, ...rest } = f;
  return rest;
}
const definitionOf = (f: FormRecord): FormDefinition => ({
  id: f.id,
  version: f.version,
  title: f.title,
  jsonSchema: f.jsonSchema,
  uiSchema: f.uiSchema,
  mappingFromCommonGrants: f.mappingFromCommonGrants,
  mappingToCommonGrants: f.mappingToCommonGrants,
  fieldMeta: f.fieldMeta,
});
const latest = (rows: FormRecord[]) => rows.reduce<FormRecord | undefined>((a, b) => (!a || b.version > a.version ? b : a), undefined);

const EMPTY_FORM: Pick<FormRecord, "jsonSchema" | "uiSchema" | "mappingFromCommonGrants" | "mappingToCommonGrants" | "fieldMeta"> = {
  jsonSchema: { type: "object", properties: {}, required: [] },
  uiSchema: { type: "VerticalLayout", elements: [] },
  mappingFromCommonGrants: {},
  mappingToCommonGrants: {},
  fieldMeta: {},
};

/** In-browser implementation of the API port, backed by fixtures. */
export function createMockApi(opts: MockApiOptions): GmsApi {
  const memberships = opts.memberships ?? MOCK_MEMBERSHIPS;
  const shells = opts.workspaces ?? FIXTURE_WORKSPACES;
  const store = opts.store ?? seedStore();
  const now = () => (opts.now ?? (() => new Date()))().toISOString();
  let currentId: string | null = null;

  const me = async (): Promise<Me> => {
    const session = await opts.session();
    if (!session) throw new ApiError(401, "Sign in to continue");
    return { userId: session.userId, email: session.email, mfaVerified: session.aal === "aal2", workspaces: memberships };
  };

  /** The funder workspace the caller is acting in. */
  async function ws(): Promise<WorkspaceData> {
    await me();
    const id = currentId ?? memberships.find((m) => m.kind === "funder")?.id;
    const data = store.workspaces.find((w) => w.record.id === id);
    if (!data) throw new ApiError(403, "This workspace cannot do that");
    return data;
  }
  async function member(workspaceId: string): Promise<WorkspaceData> {
    await me();
    const data = store.workspaces.find((w) => w.record.id === workspaceId);
    if (!data || !memberships.some((m) => m.id === workspaceId)) throw notFound("Workspace");
    return data;
  }

  const funderOf = (w: WorkspaceData): PublicFunder => ({
    handle: w.record.handle,
    name: w.record.displayName,
    brand: { logoUrl: w.record.brand.logoUrl ?? null, accent: w.record.brand.accent ?? null, onAccent: w.record.brand.onAccent ?? null },
    mission: w.profile.mission,
    website: w.profile.website,
    verificationLevel: w.record.verificationLevel,
  });
  const cardOf = (o: Opportunity): PublicOpportunityCard => ({
    id: o.id.replace(/^opp_/, ""),
    slug: o.slug,
    title: o.title,
    description: o.description,
    status: o.status,
    funding: o.funding,
    keyDates: o.keyDates,
    acceptedApplicantTypes: o.acceptedApplicantTypes,
  });
  const listed = (o: Opportunity) => o.published && o.publish.publicPage !== false;
  const publicFunderData = (handle: string) => {
    const w = store.workspaces.find((x) => x.record.handle === handle && x.record.kind === "funder" && x.record.status === "active");
    if (!w) throw notFound("Funder");
    return w;
  };

  function assertRules(rules: unknown) {
    const parsed = parseRules(rules);
    if (!parsed.ok) throw invalid("These eligibility rules are not valid", parsed.errors.map((e) => ({ path: `eligibilityRules${e.at}`, message: e.message })));
  }
  function assertDefinition(f: FormRecord) {
    const errors = validateFormDefinition(definitionOf(f));
    if (errors.length) throw invalid("This form definition is not valid", errors);
  }
  const allForms = (w: WorkspaceData) => [...w.forms, ...store.library];
  function formVersions(w: WorkspaceData, id: string): FormRecord[] {
    const rows = allForms(w).filter((f) => f.id === id);
    if (!rows.length) throw notFound("Form");
    return rows;
  }
  const one = <T extends { id: string }>(rows: T[], id: string, what: string): T => {
    const row = rows.find((r) => r.id === id);
    if (!row) throw notFound(what);
    return row;
  };

  function checklist(w: WorkspaceData, comp: Competition): Checklist {
    const opp = one(w.opportunities, comp.opportunityId, "Opportunity");
    const base = `/w/${w.record.handle}`;
    const compHref = `${base}/competitions/${comp.id}`;
    const oppHref = `${base}/opportunities/${opp.id}/edit`;
    const stages = comp.stages;
    const names = (xs: Stage[]) => xs.map((s) => s.label).join(", ");
    const item = (key: string, ok: boolean, label: string, pass: string, fail: string, fixHref: string): ChecklistItem => ({ key, state: ok ? "pass" : "fail", label, reason: ok ? pass : fail, fixHref: ok ? null : fixHref });
    const pinned = Object.entries(Object.assign({}, ...stages.map((s) => s.forms)) as Record<string, number>);
    const problems = pinned.filter(([id, v]) => allForms(w).find((f) => f.id === id && f.version === v)?.status !== "published");
    const noForms = stages.filter((s) => s.requiresSubmission && !Object.keys(s.forms).length);
    const badDates = stages.filter((s) => s.opens && s.closes && Date.parse(s.opens) >= Date.parse(s.closes));
    const undated = stages.filter((s) => s.requiresSubmission && !s.closes);
    const noRubric = stages.filter((s) => s.decisionRequired && !s.rubricId);
    const rules = parseRules(opp.eligibilityRules);
    const items = [
      item("opportunity_published", opp.published && opp.status !== "closed", "Opportunity is published", `${opp.title} is live`, opp.status === "closed" ? "The opportunity is closed" : "Publish the opportunity so applicants can find this competition", oppHref),
      item("stages", stages.length > 0, "At least one stage", `${stages.length} stage${stages.length === 1 ? "" : "s"}: ${names(stages)}`, "Add a stage; a single stage is the common case", compHref),
      item("stage_forms", stages.length > 0 && !noForms.length, "Every submission stage has a form", "Each stage that takes a submission pins a form", noForms.length ? `No form on: ${names(noForms)}` : "Stages need forms", compHref),
      item("forms_published", stages.length > 0 && !problems.length, "Pinned form versions are published", `${pinned.length} form version${pinned.length === 1 ? "" : "s"} pinned`, `${problems.length} pinned form version${problems.length === 1 ? " is" : "s are"} missing or still a draft`, `${base}/forms`),
      item("stage_dates", stages.length > 0 && !badDates.length && !undated.length, "Stage dates are set", "Every submission stage has a closing date after its opening date", badDates.length ? `Closes before it opens: ${names(badDates)}` : `No closing date on: ${names(undated)}`, compHref),
      item("rubrics", stages.length > 0 && !noRubric.length, "Decision stages have a rubric", "Reviewers will score against a rubric", `No rubric on: ${names(noRubric)}`, compHref),
      item("eligibility_rules", rules.ok, "Eligibility rules are valid", "Rules run at submit and never auto-decline an unknown", rules.ok ? "" : `${rules.errors.length} problem${rules.errors.length === 1 ? "" : "s"} in the rules`, `${oppHref}#who`),
    ];
    const count = (state: ChecklistItem["state"]) => items.filter((i) => i.state === state).length;
    return { ready: count("fail") === 0 && count("unknown") === 0, summary: { pass: count("pass"), fail: count("fail"), unknown: count("unknown") }, items };
  }

  function brandWrite(record: WorkspaceRecord, brand: WorkspaceRecord["brand"] | undefined): string[] {
    if (!brand) return [];
    const next = { ...record.brand, ...brand };
    const warnings: string[] = [];
    if (next.accent && next.onAccent) {
      const check = checkBrand(next.accent, next.onAccent);
      if (!check.passes && check.warning) warnings.push(check.warning);
    }
    record.brand = next;
    return warnings;
  }

  return {
    me,
    async workspace(handle) {
      const profile = await me();
      const shell = shells.find((w) => w.handle === handle);
      const data = store.workspaces.find((w) => w.record.handle === handle);
      if (!profile.workspaces.some((m) => m.handle === handle) || (!shell && !data)) throw new ApiError(404, "Workspace not found");
      currentId = data?.record.id ?? shell?.id ?? null;
      if (!shell) {
        // A workspace created in this session (onboarding): build the shell view from its record.
        const r = data!.record;
        return { id: r.id, handle: r.handle, kind: r.kind, name: r.displayName, sub: r.kind === "funder" ? "Funder workspace" : "Applicant workspace", brand: { accent: r.brand.accent ?? "#1F6F8B", onAccent: r.brand.onAccent ?? "#FFFFFF" }, member: { name: profile.email, initials: profile.email.slice(0, 2).toUpperCase(), title: "Admin" }, unreadNotifications: 0, pendingApprovals: 0 };
      }
      return data ? { ...shell, name: data.record.displayName, brand: { accent: data.record.brand.accent ?? shell.brand.accent, onAccent: data.record.brand.onAccent ?? shell.brand.onAccent } } : shell;
    },

    async publicFunder(handle) {
      const w = publicFunderData(handle);
      return clone({ funder: funderOf(w), opportunities: w.opportunities.filter(listed).map(cardOf) });
    },
    async publicOpportunity(handle, slug) {
      const w = publicFunderData(handle);
      const opp = w.opportunities.find((o) => o.slug === slug && listed(o));
      if (!opp) throw notFound("Opportunity");
      const parsed = parseRules(opp.eligibilityRules);
      const labels = parsed.ok && parsed.rules && "all" in parsed.rules ? parsed.rules.all.flatMap((r) => ("label" in r && r.label ? [r.label] : [])) : [];
      const bare = opp.id.replace(/^opp_/, "");
      return clone({
        funder: funderOf(w),
        opportunity: { ...cardOf(opp), publishedAt: opp.publishedAt, eligibility: labels },
        competitions: w.competitions
          .filter((c) => c.opportunityId === opp.id && c.status !== "draft")
          .map((c) => ({ id: c.id.replace(/^cmp_/, ""), title: c.title, description: c.description, instructions: c.instructions, status: c.status, keyDates: c.keyDates, stages: c.stages.map((s) => ({ key: s.key, label: s.label, opens: s.opens ?? null, closes: s.closes ?? null, requiresSubmission: s.requiresSubmission })) })),
        commonGrants: { id: bare, title: opp.title, description: opp.description, status: { value: opp.status }, funding: opp.funding, keyDates: opp.keyDates },
        links: { json: `/common-grants/opportunities/${bare}`, page: `/f/${handle}/o/${slug}` },
      });
    },
    async publicCompetition(id) {
      for (const w of store.workspaces) {
        const comp = w.competitions.find((c) => c.id.replace(/^cmp_/, "") === id.replace(/^cmp_/, "") && c.status !== "draft");
        if (!comp) continue;
        const forms = Object.fromEntries(
          Object.entries(comp.forms).flatMap(([formId, version]) => {
            const f = allForms(w).find((x) => x.id === formId && x.version === version);
            return f ? [[formId.replace(/^frm_/, ""), { id: formId.replace(/^frm_/, ""), title: f.title, description: f.description ?? undefined, version: String(f.version), jsonSchema: f.jsonSchema, uiSchema: f.uiSchema }]] : [];
          }),
        );
        return clone({ id: comp.id.replace(/^cmp_/, ""), title: comp.title, forms: { forms } });
      }
      throw notFound("Competition");
    },

    async createWorkspace(input) {
      const profile = await me();
      if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(input.handle)) throw invalid("Check the handle", [{ path: "handle", message: "Use 3 to 64 lowercase letters, digits and hyphens" }]);
      if (store.workspaces.some((w) => w.record.handle === input.handle)) throw new ApiError(409, "A workspace with this handle already exists", [{ path: "handle", message: "This handle is taken" }]);
      const record: WorkspaceRecord = { id: uuid(), kind: input.kind, handle: input.handle, displayName: input.displayName, legalName: input.legalName ?? null, passportOrgId: input.passportOrgId ?? null, verificationLevel: null, brand: {}, settings: {}, status: "active" };
      const warnings = brandWrite(record, input.brand);
      store.workspaces.push({ record, profile: { mission: null, website: null }, members: [{ userId: profile.userId, role: "admin", email: profile.email }], invitations: [], passport: { linked: false, passportOrgId: record.passportOrgId, check: { state: "fail", reason: "Connect Passport to pay. Awards still work without it" }, canDebit: null }, programs: [], rubrics: [], opportunities: [], competitions: [], forms: [] });
      memberships.push({ id: record.id, handle: record.handle, name: record.displayName, kind: record.kind, role: "admin", requiresMfa: true });
      currentId = record.id;
      return clone({ workspace: record, warnings });
    },
    async workspaceRecord(id) {
      return clone((await member(id)).record);
    },
    async updateWorkspace(id, patch) {
      const w = await member(id);
      if (patch.displayName !== undefined) w.record.displayName = patch.displayName;
      if (patch.settings) w.record.settings = { ...w.record.settings, ...patch.settings };
      const warnings = brandWrite(w.record, patch.brand);
      return clone({ workspace: w.record, warnings });
    },
    async listMembers(id) {
      return clone((await member(id)).members);
    },
    async createInvitation(id, input) {
      const w = await member(id);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) throw invalid("Check the email address", [{ path: "email", message: "Enter a full email address" }]);
      const invitation = { id: uuid(), email: input.email, role: input.role, expiresAt: new Date(Date.parse(now()) + (input.expiresInDays ?? 14) * 86_400_000).toISOString(), acceptUrl: `/invitations/accept?token=mock-${w.invitations.length + 1}` };
      w.invitations.push(invitation);
      return clone(invitation);
    },
    async passportStatus(id) {
      return clone((await member(id)).passport);
    },
    async linkPassport(id, input) {
      const w = await member(id);
      // The mock accepts any client whose id looks like one Passport issues, so both outcomes can be seen.
      const ok = /^pc_/.test(input.clientId);
      if (!ok) return { linked: false, passportOrgId: w.record.passportOrgId, check: { state: "fail", reason: "Passport rejected the client id or secret" }, canDebit: null };
      w.passport = { linked: true, passportOrgId: w.record.passportOrgId, clientId: input.clientId, scopes: ["org:read", "payee:read", "award:write", "disbursement:read", "disbursement:write"], linkedAt: now(), lastOkAt: now(), check: { state: "pass", reason: "Passport accepted the client and a funding source can be debited" }, canDebit: true };
      return clone(w.passport);
    },
    async unlinkPassport(id) {
      const w = await member(id);
      w.passport = { linked: false, passportOrgId: w.record.passportOrgId, check: { state: "fail", reason: "Connect Passport to pay. Awards still work without it" }, canDebit: null };
      return { linked: false };
    },

    async listPrograms() {
      return clone([...(await ws()).programs].sort((a, b) => a.name.localeCompare(b.name)));
    },
    async createProgram(input) {
      const w = await ws();
      if (!input.name.trim()) throw invalid("Check the program", [{ path: "name", message: "Give the program a name" }]);
      const program = { id: uuid(), description: null, fiscalYear: null, budgetAmountMinor: null, currency: "USD", defaults: {}, ...input, name: input.name.trim(), createdAt: now(), updatedAt: now() };
      w.programs.push(program);
      return clone(program);
    },
    async updateProgram(id, patch) {
      const program = one((await ws()).programs, id, "Program");
      Object.assign(program, patch, { updatedAt: now() });
      return clone(program);
    },
    async listRubrics() {
      return clone([...(await ws()).rubrics, ...store.sharedRubrics]);
    },
    async createRubric(input) {
      const w = await ws();
      const rubric = { id: uuid(), version: 1, shared: false, overall: {}, ...input };
      w.rubrics.push(rubric);
      return clone(rubric);
    },

    async listOpportunities(filter = {}) {
      const rows = (await ws()).opportunities.filter((o) => (!filter.programId || o.programId === filter.programId) && (!filter.status || o.status === filter.status));
      return clone(rows);
    },
    async getOpportunity(id) {
      return clone(one((await ws()).opportunities, id, "Opportunity"));
    },
    async createOpportunity(input) {
      const w = await ws();
      if (input.eligibilityRules !== undefined) assertRules(input.eligibilityRules);
      const slug = input.slug ?? slugify(input.title);
      if (w.opportunities.some((o) => o.slug === slug)) throw new ApiError(409, "An opportunity with this slug already exists", [{ path: "slug", message: "This address is taken" }]);
      const opp: Opportunity = { id: `opp_${uuid()}`, programId: null, description: "", status: "forecasted", funding: {}, keyDates: {}, acceptedApplicantTypes: [], eligibilityRules: { all: [] }, customFields: {}, published: false, publishedAt: null, createdAt: now(), updatedAt: now(), ...input, slug, publish: { publicPage: true, openGrantsIndex: true, sitemap: true, ...input.publish } };
      w.opportunities.unshift(opp);
      return clone(opp);
    },
    async updateOpportunity(id, patch) {
      const opp = one((await ws()).opportunities, id, "Opportunity");
      if (patch.eligibilityRules !== undefined) assertRules(patch.eligibilityRules);
      Object.assign(opp, patch, { publish: { ...opp.publish, ...patch.publish }, updatedAt: now() });
      return clone(opp);
    },
    async publishOpportunity(id, status = "open") {
      const opp = one((await ws()).opportunities, id, "Opportunity");
      if (opp.status === "closed") throw new ApiError(409, "This opportunity is closed");
      if (!opp.description.trim()) throw new ApiError(409, "Add a description before publishing; the public page and the CommonGrants record both need one");
      Object.assign(opp, { status, published: true, publishedAt: opp.publishedAt ?? now(), updatedAt: now() });
      return clone(opp);
    },
    async closeOpportunity(id) {
      const opp = one((await ws()).opportunities, id, "Opportunity");
      Object.assign(opp, { status: "closed", updatedAt: now() });
      return clone(opp);
    },
    async previewOpportunity(id) {
      const w = await ws();
      const opp = one(w.opportunities, id, "Opportunity");
      return clone({ commonGrants: { id: opp.id.replace(/^opp_/, ""), title: opp.title, description: opp.description, status: { value: opp.status }, funding: opp.funding, keyDates: opp.keyDates }, publicUrl: `/f/${w.record.handle}/o/${opp.slug}`, brand: w.record.brand, publish: opp.publish });
    },

    async listCompetitions(filter = {}) {
      return clone((await ws()).competitions.filter((c) => !filter.opportunityId || c.opportunityId === filter.opportunityId));
    },
    async getCompetition(id) {
      return clone(one((await ws()).competitions, id, "Competition"));
    },
    async createCompetition(input) {
      const w = await ws();
      one(w.opportunities, input.opportunityId, "Opportunity");
      const comp: Competition = { id: `cmp_${uuid()}`, description: null, instructions: null, status: "draft", keyDates: {}, stages: [], forms: {}, acceptedApplicantTypes: [], createdAt: now(), updatedAt: now(), ...input };
      w.competitions.unshift(comp);
      return clone(comp);
    },
    async updateCompetition(id, patch) {
      const comp = one((await ws()).competitions, id, "Competition");
      Object.assign(comp, patch, { updatedAt: now() });
      return clone(comp);
    },
    async putStages(id, stages) {
      const w = await ws();
      const comp = one(w.competitions, id, "Competition");
      const errors: { path: string; message: string }[] = [];
      const keys = new Set<string>();
      stages.forEach((s, i) => {
        if (!/^[a-z][a-z0-9_]{0,40}$/.test(s.key)) errors.push({ path: `stages.${i}.key`, message: "Use a short lowercase key such as loi or full" });
        if (keys.has(s.key)) errors.push({ path: `stages.${i}.key`, message: "Stage keys must be unique" });
        keys.add(s.key);
        if (!s.label.trim()) errors.push({ path: `stages.${i}.label`, message: "Give the stage a name" });
        for (const [formId, version] of Object.entries(s.forms)) {
          if (!allForms(w).some((f) => f.id === formId && f.version === version)) errors.push({ path: `stages.${i}.forms.${formId}`, message: `Form version ${version} does not exist` });
        }
      });
      if (!stages.length) errors.push({ path: "stages", message: "Add at least one stage" });
      if (errors.length) throw invalid("Check the stages", errors);
      comp.stages = clone(stages);
      comp.forms = Object.assign({}, ...stages.map((s) => s.forms)) as Record<string, number>;
      comp.updatedAt = now();
      return clone(comp);
    },
    async launchCheck(id) {
      const w = await ws();
      return checklist(w, one(w.competitions, id, "Competition"));
    },
    async openCompetition(id) {
      const w = await ws();
      const comp = one(w.competitions, id, "Competition");
      const check = checklist(w, comp);
      if (!check.ready) throw new ApiError(409, "The launch checklist has open items", check.items.filter((i) => i.state !== "pass"));
      Object.assign(comp, { status: "open", updatedAt: now() });
      return clone(comp);
    },
    async closeCompetition(id) {
      const comp = one((await ws()).competitions, id, "Competition");
      Object.assign(comp, { status: "closed", updatedAt: now() });
      return clone(comp);
    },

    async listForms() {
      const w = await ws();
      const ids = [...new Set(w.forms.map((f) => f.id))];
      return clone(ids.map((id) => summaryOf(latest(w.forms.filter((f) => f.id === id))!)));
    },
    async listFormLibrary() {
      await ws();
      const ids = [...new Set(store.library.map((f) => f.id))];
      return clone(ids.map((id) => summaryOf(latest(store.library.filter((f) => f.id === id && f.status === "published"))!)));
    },
    async getForm(id, version) {
      const rows = formVersions(await ws(), id);
      const row = version === undefined ? latest(rows) : rows.find((f) => f.version === version);
      if (!row) throw notFound("Form");
      return clone(row);
    },
    async createForm(input) {
      const w = await ws();
      const { copyFrom, ...fields } = input;
      let base = EMPTY_FORM;
      if (copyFrom) {
        const rows = formVersions(w, copyFrom.id).filter((f) => f.status === "published");
        const source = copyFrom.version === undefined ? latest(rows) : rows.find((f) => f.version === copyFrom.version);
        if (!source) throw notFound("Form to copy");
        base = { jsonSchema: source.jsonSchema, uiSchema: source.uiSchema, mappingFromCommonGrants: source.mappingFromCommonGrants, mappingToCommonGrants: source.mappingToCommonGrants, fieldMeta: source.fieldMeta };
      }
      const form: FormRecord = { id: `frm_${uuid()}`, version: 1, description: null, instructions: null, purpose: "application", status: "draft", publishedAt: null, supersedesFormVersion: null, shared: false, createdAt: now(), updatedAt: now(), ...clone(base), ...fields };
      assertDefinition(form);
      w.forms.push(form);
      return clone(form);
    },
    async updateForm(id, patch) {
      const w = await ws();
      const current = latest(w.forms.filter((f) => f.id === id));
      if (!current) throw notFound("Form");
      if (current.status === "published") throw new ApiError(409, `Version ${current.version} is published and cannot change. Create version ${current.version + 1} to edit`);
      const next = { ...current, ...clone(patch), updatedAt: now() };
      assertDefinition(next);
      Object.assign(current, next);
      return clone(current);
    },
    async createFormVersion(id) {
      const w = await ws();
      const current = latest(w.forms.filter((f) => f.id === id));
      if (!current) throw notFound("Form");
      if (current.status !== "published") throw new ApiError(409, `Version ${current.version} is still a draft; edit it directly`);
      const draft: FormRecord = { ...clone(current), version: current.version + 1, status: "draft", publishedAt: null, supersedesFormVersion: current.version, createdAt: now(), updatedAt: now() };
      w.forms.push(draft);
      return clone(draft);
    },
    async publishForm(id) {
      const w = await ws();
      const current = latest(w.forms.filter((f) => f.id === id));
      if (!current) throw notFound("Form");
      if (current.status === "published") throw new ApiError(409, `Version ${current.version} is already published`);
      assertDefinition(current);
      Object.assign(current, { status: "published", publishedAt: now(), updatedAt: now() });
      return clone(current);
    },
    async testFillForm(id, o = {}) {
      const rows = formVersions(await ws(), id);
      const row = o.version === undefined ? latest(rows) : rows.find((f) => f.version === o.version);
      if (!row) throw notFound("Form");
      return { response: testFill(definitionOf(row), { seed: o.seed ?? 1 }) as JsonObject };
    },

    async evaluateEligibility(input) {
      const w = await ws();
      const rules = input.rules !== undefined ? input.rules : one(w.opportunities, input.opportunityId ?? "", "Opportunity").eligibilityRules;
      const parsed = parseRules(rules);
      if (!parsed.ok) throw invalid("These eligibility rules are not valid", parsed.errors.map((e) => ({ path: `rules${e.at}`, message: e.message })));
      return clone(evaluate(parsed.rules, { org: input.org, profile: input.profile, applicant: input.applicant }));
    },
  };
}
