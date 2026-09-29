// SPDX-License-Identifier: AGPL-3.0-or-later
// Pure, immutable editing operations on a builder model: add, update, move, duplicate, delete and
// restore elements and pages. The form builder UI calls these; they never mutate their input.
// React-free so they can be unit tested in node.
import { suggestCgPath } from '../cg';
import {
  type Condition,
  conditionFieldRefs,
  type Element,
  type Field,
  FIELD_ID_PATTERN,
  FieldSchema,
  type FieldType,
  type FormModel,
  type InfoBlock,
  isField,
  listFields,
  type Page,
  type Section,
  type SectionChild,
} from '../model';

/** Where an element lives. `sectionId` is set for elements inside a section. */
export interface ElementLocation {
  pageIndex: number;
  pageId: string;
  sectionId?: string;
  index: number;
}

/** A drop target: a page's top level (`page:<id>`) or a section's children (`section:<id>`). */
export type ContainerId = `page:${string}` | `section:${string}`;

export function pageContainer(pageId: string): ContainerId {
  return `page:${pageId}`;
}
export function sectionContainer(sectionId: string): ContainerId {
  return `section:${sectionId}`;
}

export type AnyElement = Element | SectionChild;

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function locateElement(model: FormModel, id: string): ElementLocation | undefined {
  for (let p = 0; p < model.pages.length; p++) {
    const page = model.pages[p]!;
    for (let i = 0; i < page.elements.length; i++) {
      const el = page.elements[i]!;
      if (el.id === id) return { pageIndex: p, pageId: page.id, index: i };
      if (el.type === 'section') {
        const j = el.elements.findIndex((c) => c.id === id);
        if (j >= 0) return { pageIndex: p, pageId: page.id, sectionId: el.id, index: j };
      }
    }
  }
  return undefined;
}

export function getElement(model: FormModel, id: string): AnyElement | undefined {
  const loc = locateElement(model, id);
  if (!loc) return undefined;
  const page = model.pages[loc.pageIndex]!;
  if (!loc.sectionId) return page.elements[loc.index];
  const section = page.elements.find((e): e is Section => e.type === 'section' && e.id === loc.sectionId);
  return section?.elements[loc.index];
}

/** The ids in a container, in order. */
export function containerIds(model: FormModel, container: ContainerId): string[] {
  const [kind, id] = splitContainer(container);
  if (kind === 'page') return model.pages.find((p) => p.id === id)?.elements.map((e) => e.id) ?? [];
  for (const page of model.pages)
    for (const el of page.elements) if (el.type === 'section' && el.id === id) return el.elements.map((c) => c.id);
  return [];
}

export function containerOf(loc: ElementLocation): ContainerId {
  return loc.sectionId ? sectionContainer(loc.sectionId) : pageContainer(loc.pageId);
}

function splitContainer(c: ContainerId): ['page' | 'section', string] {
  const i = c.indexOf(':');
  return [c.slice(0, i) as 'page' | 'section', c.slice(i + 1)];
}

/** Every id in the model: pages, sections, info blocks, fields (one shared namespace). */
export function allIds(model: FormModel): Set<string> {
  const ids = new Set<string>();
  for (const page of model.pages) {
    ids.add(page.id);
    for (const el of page.elements) {
      ids.add(el.id);
      if (el.type === 'section') for (const c of el.elements) ids.add(c.id);
    }
  }
  return ids;
}

/** Turns any text into a valid id base: "Project title" → "project_title". */
export function slugifyId(text: string, fallback = 'question'): string {
  let s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  if (!s || !/^[a-z]/.test(s)) s = `${fallback}${s ? `_${s}` : ''}`;
  return s.slice(0, 64);
}

/** An id not used anywhere in the model (or in `extra`), based on `base`. */
export function uniqueId(model: FormModel, base: string, extra: Iterable<string> = []): string {
  const taken = allIds(model);
  for (const x of extra) taken.add(x);
  const clean = FIELD_ID_PATTERN.test(base) ? base : slugifyId(base);
  if (!taken.has(clean)) return clean;
  for (let n = 2; ; n++) {
    const candidate = `${clean.slice(0, 60)}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Why an id can't be used, or undefined when it's fine. Copy is for staff. */
export function idProblem(model: FormModel, currentId: string, nextId: string): string | undefined {
  if (!nextId) return 'Enter an id.';
  if (!FIELD_ID_PATTERN.test(nextId)) return 'Use letters, numbers and underscores, starting with a letter (64 characters at most).';
  if (nextId !== currentId && allIds(model).has(nextId)) return `“${nextId}” is already used in this form.`;
  return undefined;
}

// ---------------------------------------------------------------------------
// New elements
// ---------------------------------------------------------------------------

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Short text',
  long_text: 'Long text',
  rich_text: 'Formatted text',
  number: 'Number',
  currency: 'Dollar amount',
  date: 'Date',
  select: 'Single choice',
  multi_select: 'Multiple choice',
  checkbox_group: 'Checkboxes',
  yes_no: 'Yes / No',
  name: 'Name',
  address: 'Address',
  email: 'Email',
  phone: 'Phone',
  ein: 'EIN',
  uei: 'UEI',
  file_upload: 'File upload',
  repeater_table: 'Table (repeating rows)',
  likert_matrix: 'Rating grid',
  attestation: 'Attestation',
};

export const FIELD_TYPE_DESCRIPTIONS: Record<FieldType, string> = {
  text: 'One line, like a title or a website.',
  long_text: 'A paragraph with an optional word limit.',
  rich_text: 'A paragraph with bold, italics, lists and links.',
  number: 'A count, like people served.',
  currency: 'Dollars, stored as exact cents.',
  date: 'A calendar date.',
  select: 'Pick one from a list.',
  multi_select: 'Pick several from a list.',
  checkbox_group: 'Tick all that apply.',
  yes_no: 'A simple yes or no.',
  name: 'First and last name.',
  address: 'Street, city, state and ZIP.',
  email: 'An email address.',
  phone: 'A phone number.',
  ein: 'Employer Identification Number (12-3456789).',
  uei: 'SAM.gov Unique Entity ID.',
  file_upload: 'Attach documents, with type and size limits.',
  repeater_table: 'Rows with columns and totals, like a budget.',
  likert_matrix: 'Rate several statements on one scale.',
  attestation: 'A statement to confirm and sign.',
};

const DEFAULT_LABELS: Record<FieldType, string> = {
  text: 'New short-answer question',
  long_text: 'New long-answer question',
  rich_text: 'New formatted-answer question',
  number: 'New number question',
  currency: 'New dollar-amount question',
  date: 'New date question',
  select: 'New single-choice question',
  multi_select: 'New multiple-choice question',
  checkbox_group: 'New checkbox question',
  yes_no: 'New yes/no question',
  name: 'Full name',
  address: 'Mailing address',
  email: 'Email address',
  phone: 'Phone number',
  ein: 'Employer Identification Number (EIN)',
  uei: 'Unique Entity ID (UEI)',
  file_upload: 'Upload a document',
  repeater_table: 'New table question',
  likert_matrix: 'How much do you agree with each statement?',
  attestation: 'Attestation',
};

const TWO_OPTIONS = [
  { value: 'option_1', label: 'Option 1' },
  { value: 'option_2', label: 'Option 2' },
];

/** A new field of `type` with sensible defaults and an id unique in `model`. */
export function createField(model: FormModel, type: FieldType, overrides: Partial<Record<string, unknown>> = {}): Field {
  const label = DEFAULT_LABELS[type];
  const id = uniqueId(model, slugifyId(typeof overrides.label === 'string' ? overrides.label : type));
  const base: Record<string, unknown> = { id, type, label };
  switch (type) {
    case 'long_text':
    case 'rich_text':
      base.maxWords = 250;
      break;
    case 'select':
    case 'multi_select':
    case 'checkbox_group':
      base.options = TWO_OPTIONS.map((o) => ({ ...o }));
      break;
    case 'file_upload':
      base.accept = ['pdf'];
      base.maxBytes = 10 * 1024 * 1024;
      base.help = 'Upload a PDF up to 10 MB.';
      break;
    case 'repeater_table':
      base.help = 'Add one row for each item.';
      base.columns = [
        { id: 'item', type: 'text', label: 'Item', required: true },
        { id: 'amount', type: 'currency', label: 'Amount', required: true, min: 0 },
      ];
      base.totals = true;
      break;
    case 'likert_matrix':
      base.help = 'Choose one answer for each statement.';
      base.rows = [
        { id: 'statement_1', label: 'Statement 1' },
        { id: 'statement_2', label: 'Statement 2' },
      ];
      base.scale = [
        { value: '1', label: 'Strongly disagree' },
        { value: '2', label: 'Disagree' },
        { value: '3', label: 'Neutral' },
        { value: '4', label: 'Agree' },
        { value: '5', label: 'Strongly agree' },
      ];
      break;
    case 'attestation':
      base.statement = 'I confirm that the information in this application is true and complete to the best of my knowledge.';
      base.required = true;
      break;
    default:
      break;
  }
  return FieldSchema.parse({ ...base, ...overrides, id: typeof overrides.id === 'string' ? overrides.id : id });
}

export function createInfoBlock(model: FormModel): InfoBlock {
  return { type: 'info_block', id: uniqueId(model, 'text_block'), markdown: 'Add instructions or context for applicants here.' };
}

export function createSection(model: FormModel): Section {
  return { type: 'section', id: uniqueId(model, 'section'), title: 'New section', elements: [] };
}

export function createPage(model: FormModel, title = `Page ${model.pages.length + 1}`): Page {
  return { id: uniqueId(model, slugifyId(title, 'page')), title, elements: [] };
}

// ---------------------------------------------------------------------------
// Element edits
// ---------------------------------------------------------------------------

function mapPages(model: FormModel, fn: (page: Page, index: number) => Page): FormModel {
  let changed = false;
  const pages = model.pages.map((p, i) => {
    const next = fn(p, i);
    if (next !== p) changed = true;
    return next;
  });
  return changed ? { ...model, pages } : model;
}

/** Replaces an element (field, info block or section) by id. */
export function replaceElement(model: FormModel, id: string, next: AnyElement): FormModel {
  return mapPages(model, (page) => {
    let hit = false;
    const elements = page.elements.map((el) => {
      if (el.id === id) {
        hit = true;
        return next as Element;
      }
      if (el.type === 'section' && el.elements.some((c) => c.id === id)) {
        hit = true;
        if (next.type === 'section') return el; // sections can't nest
        return { ...el, elements: el.elements.map((c) => (c.id === id ? (next as SectionChild) : c)) };
      }
      return el;
    });
    return hit ? { ...page, elements } : page;
  });
}

/** Shallow-merges a patch into an element. `undefined` values remove the property. */
export function updateElement<T extends AnyElement>(model: FormModel, id: string, patch: Partial<T>): FormModel {
  const current = getElement(model, id);
  if (!current) return model;
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return replaceElement(model, id, next as unknown as AnyElement);
}

/**
 * Changes an element's id and rewrites rules and repeater `sumEquals` targets that point at it,
 * so logic keeps working.
 */
export function renameElementId(model: FormModel, id: string, nextId: string): FormModel {
  if (id === nextId || idProblem(model, id, nextId)) return model;
  const el = getElement(model, id);
  if (!el) return model;
  let out = replaceElement(model, id, { ...el, id: nextId } as AnyElement);
  out = rewriteReferences(out, id, nextId);
  return out;
}

function rewriteCondition(c: Condition | undefined, from: string, to: string): Condition | undefined {
  if (!c) return c;
  if ('field' in c) return c.field === from ? { ...c, field: to } : c;
  if ('all' in c) return { all: c.all.map((x) => rewriteCondition(x, from, to)!) };
  if ('any' in c) return { any: c.any.map((x) => rewriteCondition(x, from, to)!) };
  return c;
}

function rewriteReferences(model: FormModel, from: string, to: string): FormModel {
  const fix = <T extends AnyElement>(el: T): T => {
    const out: Record<string, unknown> = { ...el };
    for (const key of ['visibleWhen', 'enabledWhen', 'requiredWhen'] as const) {
      if (key in out && out[key]) out[key] = rewriteCondition(out[key] as Condition, from, to);
    }
    if (el.type === 'repeater_table' && el.sumEquals?.field === from) out.sumEquals = { ...el.sumEquals, field: to };
    if (el.type === 'section') out.elements = el.elements.map(fix);
    return out as T;
  };
  return { ...model, pages: model.pages.map((p) => ({ ...p, elements: p.elements.map(fix) })) };
}

/** Inserts an element into a container at `index` (clamped). Sections can only go on a page. */
export function insertElement(model: FormModel, element: AnyElement, container: ContainerId, index?: number): FormModel {
  const [kind, cid] = splitContainer(container);
  if (kind === 'section' && element.type === 'section') return model;
  return mapPages(model, (page) => {
    if (kind === 'page') {
      if (page.id !== cid) return page;
      const elements = [...page.elements];
      elements.splice(clamp(index ?? elements.length, 0, elements.length), 0, element as Element);
      return { ...page, elements };
    }
    const sIdx = page.elements.findIndex((e) => e.type === 'section' && e.id === cid);
    if (sIdx < 0) return page;
    const section = page.elements[sIdx] as Section;
    const children = [...section.elements];
    children.splice(clamp(index ?? children.length, 0, children.length), 0, element as SectionChild);
    const elements = [...page.elements];
    elements[sIdx] = { ...section, elements: children };
    return { ...page, elements };
  });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Removes an element; returns the new model and what was removed (for undo). */
export function removeElement(model: FormModel, id: string): { model: FormModel; removed?: { element: AnyElement; container: ContainerId; index: number } } {
  const loc = locateElement(model, id);
  const element = getElement(model, id);
  if (!loc || !element) return { model };
  const container = containerOf(loc);
  const next = mapPages(model, (page, pi) => {
    if (pi !== loc.pageIndex) return page;
    if (!loc.sectionId) return { ...page, elements: page.elements.filter((e) => e.id !== id) };
    return {
      ...page,
      elements: page.elements.map((e) => (e.type === 'section' && e.id === loc.sectionId ? { ...e, elements: e.elements.filter((c) => c.id !== id) } : e)),
    };
  });
  return { model: next, removed: { element, container, index: loc.index } };
}

/** Puts a removed element back where it was (or at the end of the first page if that place is gone). */
export function restoreElement(model: FormModel, removed: { element: AnyElement; container: ContainerId; index: number }): FormModel {
  if (allIds(model).has(removed.element.id)) return model;
  const [kind, cid] = splitContainer(removed.container);
  const exists = kind === 'page' ? model.pages.some((p) => p.id === cid) : locateElement(model, cid) !== undefined;
  if (exists) return insertElement(model, removed.element, removed.container, removed.index);
  const first = model.pages[0];
  return first ? insertElement(model, removed.element, pageContainer(first.id)) : model;
}

/**
 * Moves an element to `container` at `index` (the index in the destination list *after* the
 * element has been taken out of its old place). Returns the model unchanged when the move is not
 * allowed (a section into a section, or into itself).
 */
export function moveElement(model: FormModel, id: string, container: ContainerId, index: number): FormModel {
  const element = getElement(model, id);
  if (!element) return model;
  const [kind, cid] = splitContainer(container);
  if (kind === 'section' && (element.type === 'section' || cid === id)) return model;
  const { model: without } = removeElement(model, id);
  return insertElement(without, element, container, index);
}

/** Moves an element up (-1) or down (+1) within its list. At the edge of a section it steps out onto the page. */
export function moveElementBy(model: FormModel, id: string, delta: -1 | 1): FormModel {
  const loc = locateElement(model, id);
  if (!loc) return model;
  const container = containerOf(loc);
  const siblings = containerIds(model, container);
  const target = loc.index + delta;
  if (target >= 0 && target < siblings.length) return moveElement(model, id, container, target);
  if (loc.sectionId) {
    // Step out of the section, just before or after it.
    const page = model.pages[loc.pageIndex]!;
    const sIdx = page.elements.findIndex((e) => e.id === loc.sectionId);
    return moveElement(model, id, pageContainer(page.id), delta < 0 ? sIdx : sIdx + 1);
  }
  return model;
}

/** Moves an element to the end of another page. */
export function moveElementToPage(model: FormModel, id: string, pageId: string): FormModel {
  const page = model.pages.find((p) => p.id === pageId);
  if (!page) return model;
  const loc = locateElement(model, id);
  const sameTop = loc && !loc.sectionId && loc.pageId === pageId;
  return moveElement(model, id, pageContainer(pageId), sameTop ? page.elements.length - 1 : page.elements.length);
}

/** A deep copy with fresh ids (for fields inside a copied section too), inserted right after the original. */
export function duplicateElement(model: FormModel, id: string): { model: FormModel; newId?: string } {
  const loc = locateElement(model, id);
  const el = getElement(model, id);
  if (!loc || !el) return { model };
  const reserved: string[] = [];
  const fresh = (base: string) => {
    const nid = uniqueId(model, base.replace(/(_copy(_\d+)?)?$/, '_copy'), reserved);
    reserved.push(nid);
    return nid;
  };
  const copyOne = <T extends AnyElement>(src: T): T => {
    const clone = structuredClone(src) as T & { cgMapping?: string; label?: string; title?: string };
    clone.id = fresh(src.id);
    // Two fields can't feed the same CommonGrants value; the copy starts unmapped.
    if ('cgMapping' in clone) delete clone.cgMapping;
    if (isField(src) && typeof clone.label === 'string') clone.label = `${clone.label} (copy)`;
    return clone;
  };
  let copy: AnyElement;
  if (el.type === 'section') {
    const s = copyOne(el);
    s.title = `${el.title} (copy)`;
    s.elements = el.elements.map((c) => copyOne(c));
    copy = s;
  } else {
    copy = copyOne(el);
  }
  return { model: insertElement(model, copy, containerOf(loc), loc.index + 1), newId: copy.id };
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export function addPage(model: FormModel, title?: string, index?: number): { model: FormModel; pageId: string } {
  const page = createPage(model, title);
  const pages = [...model.pages];
  pages.splice(clamp(index ?? pages.length, 0, pages.length), 0, page);
  return { model: { ...model, pages }, pageId: page.id };
}

export function updatePage(model: FormModel, pageId: string, patch: Partial<Pick<Page, 'title' | 'description'>>): FormModel {
  return mapPages(model, (p) => {
    if (p.id !== pageId) return p;
    const next: Page = { ...p, ...patch };
    if (patch.description === undefined && 'description' in patch) delete next.description;
    return next;
  });
}

export function movePage(model: FormModel, pageId: string, delta: -1 | 1): FormModel {
  const i = model.pages.findIndex((p) => p.id === pageId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= model.pages.length) return model;
  const pages = [...model.pages];
  [pages[i], pages[j]] = [pages[j]!, pages[i]!];
  return { ...model, pages };
}

export function movePageTo(model: FormModel, pageId: string, index: number): FormModel {
  const i = model.pages.findIndex((p) => p.id === pageId);
  if (i < 0) return model;
  const pages = [...model.pages];
  const [page] = pages.splice(i, 1);
  pages.splice(clamp(index, 0, pages.length), 0, page!);
  return { ...model, pages };
}

export function removePage(model: FormModel, pageId: string): FormModel {
  if (!model.pages.some((p) => p.id === pageId)) return model;
  return { ...model, pages: model.pages.filter((p) => p.id !== pageId) };
}

// ---------------------------------------------------------------------------
// Insights used by the builder
// ---------------------------------------------------------------------------

/** CommonGrants paths used by more than one field: path → field ids in form order. */
export function mappingConflicts(model: FormModel): Map<string, string[]> {
  const byPath = new Map<string, string[]>();
  for (const { field } of listFields(model)) {
    if (!field.cgMapping) continue;
    byPath.set(field.cgMapping, [...(byPath.get(field.cgMapping) ?? []), field.id]);
  }
  for (const [path, ids] of byPath) if (ids.length < 2) byPath.delete(path);
  return byPath;
}

/** Other elements whose rules (or budget totals) read `id`. */
export function referencesTo(model: FormModel, id: string): { elementId: string; label: string; kind: 'visibleWhen' | 'enabledWhen' | 'requiredWhen' | 'sumEquals' }[] {
  const out: { elementId: string; label: string; kind: 'visibleWhen' | 'enabledWhen' | 'requiredWhen' | 'sumEquals' }[] = [];
  const visit = (el: AnyElement) => {
    const label = elementLabel(el);
    for (const kind of ['visibleWhen', 'enabledWhen', 'requiredWhen'] as const) {
      const cond = (el as Partial<Record<typeof kind, Condition>>)[kind];
      if (cond && conditionFieldRefs(cond).includes(id)) out.push({ elementId: el.id, label, kind });
    }
    if (el.type === 'repeater_table' && el.sumEquals?.field === id) out.push({ elementId: el.id, label, kind: 'sumEquals' });
    if (el.type === 'section') el.elements.forEach(visit);
  };
  for (const page of model.pages) page.elements.forEach(visit);
  return out.filter((r) => r.elementId !== id);
}

/** A short name for any element, for lists and announcements. */
export function elementLabel(el: AnyElement): string {
  if (el.type === 'section') return el.title.trim() || 'Untitled section';
  if (el.type === 'info_block') return el.title?.trim() || firstLine(el.markdown) || 'Text block';
  return el.label.trim() || el.id;
}

function firstLine(md: string): string {
  const line = md.split('\n').find((l) => l.trim()) ?? '';
  const plain = line.replace(/[#*_`>[\]()]/g, '').trim();
  return plain.length > 60 ? `${plain.slice(0, 57)}…` : plain;
}

/** A suggested CommonGrants path for a field that isn't mapped yet (and whose path is free). */
export function mappingSuggestion(model: FormModel, field: Field): string | undefined {
  if (field.cgMapping) return undefined;
  const s = suggestCgPath(field);
  if (!s) return undefined;
  const used = listFields(model).some((l) => l.field.id !== field.id && l.field.cgMapping === s.path);
  return used ? undefined : s.path;
}
