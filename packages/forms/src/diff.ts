// SPDX-License-Identifier: AGPL-3.0-or-later
// Version diffs for the builder ("what changed since v3?") and the notice staff see before
// publishing a new version for a competition that is already open.
import { type Condition, type Field, type FieldLocation, type FormModel, listFields, listInfoBlocks } from './model';
import { describeCondition, humanizeFlag, type RuleKind } from './rules';
import { deepEqual, formatBytes, formatIsoDate, listJoin, money, plural } from './util';

export type ChangeKind =
  | 'form_renamed'
  | 'form_description_changed'
  | 'flag_changed'
  | 'page_added'
  | 'page_removed'
  | 'page_renamed'
  | 'page_moved'
  | 'field_added'
  | 'field_removed'
  | 'field_moved'
  | 'field_reordered'
  | 'type_changed'
  | 'label_changed'
  | 'help_changed'
  | 'required_changed'
  | 'limit_changed'
  | 'options_changed'
  | 'columns_changed'
  | 'rule_changed'
  | 'mapping_changed'
  | 'blind_changed'
  | 'content_changed';

export interface FormChange {
  kind: ChangeKind;
  summary: string;
  fieldId?: string;
  pageId?: string;
  /** The property that changed, for field-level changes (e.g. `maxWords`, `visibleWhen`). */
  property?: string;
  before?: unknown;
  after?: unknown;
  /** True when an answer given under the old version might no longer pass. */
  affectsAnswers: boolean;
}

const TYPE_NAMES: Record<string, string> = {
  text: 'short text',
  long_text: 'long text',
  rich_text: 'formatted text',
  number: 'number',
  currency: 'dollar amount',
  date: 'date',
  select: 'single choice',
  multi_select: 'multiple choice',
  checkbox_group: 'checkbox',
  yes_no: 'yes/no',
  name: 'name',
  address: 'address',
  email: 'email',
  phone: 'phone',
  ein: 'EIN',
  uei: 'UEI',
  file_upload: 'file upload',
  repeater_table: 'table',
  likert_matrix: 'rating grid',
  attestation: 'attestation',
};

const q = (f: Field) => `“${f.label || f.id}”`;

/** Lower-is-stricter limits (max…) and higher-is-stricter limits (min…). */
const MAX_LIKE = ['maxLength', 'maxWords', 'max', 'maxRows', 'maxSelections', 'maxBytes', 'maxFiles'] as const;
const MIN_LIKE = ['min', 'minRows'] as const;
const LIMIT_PROPS = [...MAX_LIKE, ...MIN_LIKE, 'integer', 'accept', 'multiple', 'currency', 'requireName', 'sumEquals', 'statement', 'display', 'totals'] as const;

function prop(f: Field, key: string): unknown {
  return (f as unknown as Record<string, unknown>)[key];
}

function formatLimit(f: Field, key: string, v: unknown): string {
  if (v === undefined) return 'none';
  if (typeof v === 'number') {
    if (f.type === 'currency' && (key === 'min' || key === 'max')) return money(v, f.currency);
    if (key === 'maxBytes') return formatBytes(v);
    return v.toLocaleString('en-US');
  }
  if (typeof v === 'string' && f.type === 'date') return formatIsoDate(v);
  if (Array.isArray(v)) return v.map((x) => String(x).toUpperCase()).join(', ') || 'any';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return JSON.stringify(v);
}

const LIMIT_NAMES: Record<string, string> = {
  maxLength: 'character limit',
  maxWords: 'word limit',
  min: 'minimum',
  max: 'maximum',
  maxRows: 'row limit',
  minRows: 'minimum number of rows',
  maxSelections: 'choice limit',
  maxBytes: 'file size limit',
  maxFiles: 'file count limit',
  integer: 'whole-numbers-only setting',
  accept: 'allowed file types',
  multiple: 'multiple-files setting',
  currency: 'currency',
  requireName: 'typed-name signature setting',
  sumEquals: 'total check',
  statement: 'statement',
  display: 'display style',
  totals: 'column totals setting',
};

function isTighter(key: string, before: unknown, after: unknown): boolean {
  if ((MAX_LIKE as readonly string[]).includes(key)) {
    if (typeof after !== 'number') return false;
    return typeof before !== 'number' || after < before;
  }
  if ((MIN_LIKE as readonly string[]).includes(key)) {
    if (after === undefined) return false;
    if (before === undefined) return true;
    return typeof after === 'number' && typeof before === 'number' ? after > before : String(after) > String(before);
  }
  if (key === 'accept') {
    const b = Array.isArray(before) ? before : [];
    const a = Array.isArray(after) ? after : [];
    if (a.length === 0) return false;
    return b.length === 0 || b.some((x) => !a.includes(x));
  }
  if (key === 'integer' || key === 'requireName') return after === true && before !== true;
  if (key === 'multiple') return after === false && before === true;
  if (key === 'sumEquals' || key === 'statement') return !deepEqual(before, after) && after !== undefined;
  return false;
}

function limitSummary(f: Field, key: string, before: unknown, after: unknown): string {
  const what = LIMIT_NAMES[key] ?? key;
  if (key === 'maxWords' || key === 'maxLength') {
    const unit = key === 'maxWords' ? 'word' : 'character';
    if (before === undefined) return `Added a ${Number(after).toLocaleString('en-US')}-${unit} limit to ${q(f)}.`;
    if (after === undefined) return `Removed the ${unit} limit from ${q(f)}.`;
    return `Changed the ${unit} limit for ${q(f)} from ${formatLimit(f, key, before)} to ${plural(Number(after), unit)}.`;
  }
  if (key === 'statement') return `Changed the attestation statement for ${q(f)}.`;
  if (before === undefined) return `Set the ${what} for ${q(f)} to ${formatLimit(f, key, after)}.`;
  if (after === undefined) return `Removed the ${what} from ${q(f)}.`;
  return `Changed the ${what} for ${q(f)} from ${formatLimit(f, key, before)} to ${formatLimit(f, key, after)}.`;
}

const RULE_PHRASE: Record<RuleKind, { now: string; none: string }> = {
  visibleWhen: { now: 'now shows when', none: 'is now always shown' },
  enabledWhen: { now: 'can now be edited when', none: 'can now always be edited' },
  requiredWhen: { now: 'is now required when', none: 'no longer has a “required when” rule' },
};

function ruleSummary(f: Field, kind: RuleKind, after: Condition | undefined, model: FormModel): string {
  if (!after) return `${q(f)} ${RULE_PHRASE[kind].none}.`;
  return `${q(f)} ${RULE_PHRASE[kind].now} ${describeCondition(after, model)}.`;
}

/** Order changes among common items: those outside the longest common subsequence moved. */
function movedWithin(before: readonly string[], after: readonly string[]): Set<string> {
  const common = new Set(before.filter((x) => after.includes(x)));
  const a = before.filter((x) => common.has(x));
  const b = after.filter((x) => common.has(x));
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const keep = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      keep.add(a[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return new Set(b.filter((x) => !keep.has(x)));
}

function fieldChanges(fa: Field, fb: Field, b: FormModel): FormChange[] {
  const out: FormChange[] = [];
  const at = { fieldId: fb.id };
  if (fa.type !== fb.type) {
    out.push({ kind: 'type_changed', summary: `Changed ${q(fb)} from a ${TYPE_NAMES[fa.type]} question to a ${TYPE_NAMES[fb.type]} question.`, property: 'type', before: fa.type, after: fb.type, affectsAnswers: true, ...at });
  }
  if (fa.label !== fb.label) out.push({ kind: 'label_changed', summary: `Renamed ${q(fa)} to ${q(fb)}.`, property: 'label', before: fa.label, after: fb.label, affectsAnswers: false, ...at });
  if ((fa.help ?? '') !== (fb.help ?? '')) out.push({ kind: 'help_changed', summary: `Updated the help text for ${q(fb)}.`, property: 'help', before: fa.help, after: fb.help, affectsAnswers: false, ...at });
  if (fa.required !== fb.required) {
    out.push({ kind: 'required_changed', summary: fb.required ? `${q(fb)} is now required.` : `${q(fb)} is no longer required.`, property: 'required', before: fa.required, after: fb.required, affectsAnswers: fb.required, ...at });
  }
  for (const kind of ['visibleWhen', 'enabledWhen', 'requiredWhen'] as const) {
    if (!deepEqual(fa[kind], fb[kind])) {
      out.push({ kind: 'rule_changed', summary: ruleSummary(fb, kind, fb[kind], b), property: kind, before: fa[kind], after: fb[kind], affectsAnswers: kind !== 'visibleWhen', ...at });
    }
  }
  if (fa.type === fb.type) {
    for (const key of LIMIT_PROPS) {
      const before = prop(fa, key);
      const after = prop(fb, key);
      if (deepEqual(before, after)) continue;
      out.push({ kind: 'limit_changed', summary: limitSummary(fb, key, before, after), property: key, before, after, affectsAnswers: isTighter(key, before, after), ...at });
    }
    if ('options' in fa && 'options' in fb && !deepEqual(fa.options, fb.options)) {
      const bv = new Map(fa.options.map((o) => [o.value, o.label]));
      const av = new Map(fb.options.map((o) => [o.value, o.label]));
      const added = fb.options.filter((o) => !bv.has(o.value)).map((o) => `“${o.label}”`);
      const removed = fa.options.filter((o) => !av.has(o.value)).map((o) => `“${o.label}”`);
      const renamed = fb.options.filter((o) => bv.has(o.value) && bv.get(o.value) !== o.label).map((o) => `“${bv.get(o.value)}” → “${o.label}”`);
      const parts = [added.length ? `added ${listJoin(added)}` : '', removed.length ? `removed ${listJoin(removed)}` : '', renamed.length ? `renamed ${listJoin(renamed)}` : ''].filter(Boolean);
      out.push({
        kind: 'options_changed',
        summary: parts.length ? `Changed the choices for ${q(fb)}: ${parts.join('; ')}.` : `Reordered the choices for ${q(fb)}.`,
        property: 'options',
        before: fa.options,
        after: fb.options,
        affectsAnswers: removed.length > 0,
        ...at,
      });
    }
    if (fa.type === 'repeater_table' && fb.type === 'repeater_table' && !deepEqual(fa.columns, fb.columns)) {
      const ids = new Set(fa.columns.map((c) => c.id));
      const nextIds = new Set(fb.columns.map((c) => c.id));
      const added = fb.columns.filter((c) => !ids.has(c.id));
      const removed = fa.columns.filter((c) => !nextIds.has(c.id));
      const parts = [
        added.length ? `added ${listJoin(added.map((c) => `“${c.label}”`))}` : '',
        removed.length ? `removed ${listJoin(removed.map((c) => `“${c.label}”`))}` : '',
      ].filter(Boolean);
      out.push({
        kind: 'columns_changed',
        summary: parts.length ? `Changed the columns of ${q(fb)}: ${parts.join('; ')}.` : `Changed column settings in ${q(fb)}.`,
        property: 'columns',
        before: fa.columns,
        after: fb.columns,
        affectsAnswers: added.some((c) => c.required) || !parts.length,
        ...at,
      });
    }
    if (fa.type === 'likert_matrix' && fb.type === 'likert_matrix' && (!deepEqual(fa.rows, fb.rows) || !deepEqual(fa.scale, fb.scale))) {
      out.push({ kind: 'options_changed', summary: `Changed the rows or answer choices for ${q(fb)}.`, property: 'rows', before: { rows: fa.rows, scale: fa.scale }, after: { rows: fb.rows, scale: fb.scale }, affectsAnswers: true, ...at });
    }
  }
  if (fa.cgMapping !== fb.cgMapping) {
    out.push({
      kind: 'mapping_changed',
      summary: fb.cgMapping ? `${q(fb)} now maps to ${fb.cgMapping}${fa.cgMapping ? ` (was ${fa.cgMapping})` : ''}.` : `${q(fb)} no longer maps to ${fa.cgMapping}.`,
      property: 'cgMapping',
      before: fa.cgMapping,
      after: fb.cgMapping,
      affectsAnswers: false,
      ...at,
    });
  }
  if (fa.blind !== fb.blind) {
    out.push({ kind: 'blind_changed', summary: fb.blind ? `${q(fb)} is now hidden from blind reviewers.` : `${q(fb)} is now shown to blind reviewers.`, property: 'blind', before: fa.blind, after: fb.blind, affectsAnswers: false, ...at });
  }
  if ((fa.reviewerNotes ?? '') !== (fb.reviewerNotes ?? '')) {
    out.push({ kind: 'content_changed', summary: `Updated the reviewer notes for ${q(fb)}.`, property: 'reviewerNotes', before: fa.reviewerNotes, after: fb.reviewerNotes, affectsAnswers: false, ...at });
  }
  if (!deepEqual(fa.eligibility, fb.eligibility)) {
    out.push({ kind: 'rule_changed', summary: fb.eligibility ? `Changed the eligibility check on ${q(fb)}.` : `Removed the eligibility check from ${q(fb)}.`, property: 'eligibility', before: fa.eligibility, after: fb.eligibility, affectsAnswers: false, ...at });
  }
  return out;
}

/** Everything that changed from version `a` to version `b`, with plain-language summaries. */
export function diffVersions(a: FormModel, b: FormModel): FormChange[] {
  const out: FormChange[] = [];
  if (a.title !== b.title) out.push({ kind: 'form_renamed', summary: `Renamed the form from “${a.title}” to “${b.title}”.`, before: a.title, after: b.title, affectsAnswers: false });
  if ((a.description ?? '') !== (b.description ?? '')) out.push({ kind: 'form_description_changed', summary: 'Updated the form description.', before: a.description, after: b.description, affectsAnswers: false });
  for (const flag of [...new Set([...Object.keys(a.flags), ...Object.keys(b.flags)])].sort()) {
    const before = a.flags[flag] === true;
    const after = b.flags[flag] === true;
    if (before !== after) out.push({ kind: 'flag_changed', summary: `Turned ${after ? 'on' : 'off'} the “${humanizeFlag(flag)}” setting.`, property: flag, before, after, affectsAnswers: after });
  }

  // Pages
  const pagesA = new Map(a.pages.map((p) => [p.id, p]));
  const pagesB = new Map(b.pages.map((p) => [p.id, p]));
  for (const p of b.pages) if (!pagesA.has(p.id)) out.push({ kind: 'page_added', summary: `Added the page “${p.title}”.`, pageId: p.id, affectsAnswers: false });
  for (const p of a.pages) if (!pagesB.has(p.id)) out.push({ kind: 'page_removed', summary: `Removed the page “${p.title}”.`, pageId: p.id, affectsAnswers: false });
  for (const p of b.pages) {
    const old = pagesA.get(p.id);
    if (old && old.title !== p.title) out.push({ kind: 'page_renamed', summary: `Renamed the page “${old.title}” to “${p.title}”.`, pageId: p.id, before: old.title, after: p.title, affectsAnswers: false });
  }
  for (const id of movedWithin(a.pages.map((p) => p.id), b.pages.map((p) => p.id))) {
    out.push({ kind: 'page_moved', summary: `Moved the page “${pagesB.get(id)!.title}” to a new position.`, pageId: id, affectsAnswers: false });
  }

  // Fields
  const fa = new Map(listFields(a).map((l) => [l.field.id, l]));
  const fb = new Map(listFields(b).map((l) => [l.field.id, l]));
  const pageTitle = (l: FieldLocation) => `“${l.page.title}”`;
  for (const [id, l] of fb) {
    if (fa.has(id)) continue;
    const req = l.field.required ? ' (required)' : l.field.requiredWhen ? ' (sometimes required)' : '';
    out.push({ kind: 'field_added', summary: `Added ${q(l.field)} on ${pageTitle(l)}${req}.`, fieldId: id, pageId: l.page.id, after: l.field, affectsAnswers: l.field.required || !!l.field.requiredWhen });
  }
  for (const [id, l] of fa) {
    if (fb.has(id)) continue;
    out.push({ kind: 'field_removed', summary: `Removed ${q(l.field)} from ${pageTitle(l)}.`, fieldId: id, pageId: l.page.id, before: l.field, affectsAnswers: false });
  }
  for (const [id, lb] of fb) {
    const la = fa.get(id);
    if (!la) continue;
    if (la.page.id !== lb.page.id) {
      out.push({ kind: 'field_moved', summary: `Moved ${q(lb.field)} from ${pageTitle(la)} to ${pageTitle(lb)}.`, fieldId: id, pageId: lb.page.id, before: la.page.id, after: lb.page.id, affectsAnswers: false });
    }
  }
  for (const page of b.pages) {
    const before = [...fa.values()].filter((l) => l.page.id === page.id).map((l) => l.field.id);
    const after = [...fb.values()].filter((l) => l.page.id === page.id).map((l) => l.field.id);
    for (const id of movedWithin(before, after)) {
      out.push({ kind: 'field_reordered', summary: `Moved ${q(fb.get(id)!.field)} to a new position on “${page.title}”.`, fieldId: id, pageId: page.id, affectsAnswers: false });
    }
  }
  for (const [id, lb] of fb) {
    const la = fa.get(id);
    if (la) out.push(...fieldChanges(la.field, lb.field, b).map((c) => ({ ...c, pageId: lb.page.id })));
  }

  // Text blocks
  const ia = new Map(listInfoBlocks(a).map((x) => [x.block.id, x.block]));
  for (const { block, page } of listInfoBlocks(b)) {
    const old = ia.get(block.id);
    if (!old) out.push({ kind: 'content_changed', summary: `Added a text block on “${page.title}”.`, pageId: page.id, fieldId: block.id, affectsAnswers: false });
    else if (!deepEqual(old, block)) out.push({ kind: 'content_changed', summary: `Updated a text block on “${page.title}”.`, pageId: page.id, fieldId: block.id, affectsAnswers: false });
  }
  const ib = new Set(listInfoBlocks(b).map((x) => x.block.id));
  for (const { block, page } of listInfoBlocks(a)) if (!ib.has(block.id)) out.push({ kind: 'content_changed', summary: `Removed a text block from “${page.title}”.`, pageId: page.id, fieldId: block.id, affectsAnswers: false });

  return out;
}

export interface MigrationNotice {
  /** One short paragraph for the publish confirmation dialog. */
  summary: string;
  /** Bulleted details, one sentence each. */
  details: string[];
  /** Field ids whose answers carry over (same id in both versions). */
  carriedOver: string[];
  /** Removed fields: answers stay in history but are hidden. */
  removed: { fieldId: string; label: string }[];
  /** Questions applicants must answer before they can submit (new or newly required). */
  newRequired: { fieldId: string; label: string; conditional: boolean }[];
  /** Carried-over answers that may no longer pass (type changed, limits tightened, choices removed). */
  needsReview: { fieldId: string; label: string; reason: string }[];
}

/**
 * What happens to in-progress applications when version `b` replaces version `a` for an open
 * competition. Answers are keyed by field id, so:
 * - answers to fields whose id is unchanged carry over;
 * - answers to removed fields are kept in the application's history but hidden from the form;
 * - new required fields must be answered before the applicant can submit.
 */
export function migrationNotice(a: FormModel, b: FormModel): MigrationNotice {
  const fa = new Map(listFields(a).map((l) => [l.field.id, l.field]));
  const fb = new Map(listFields(b).map((l) => [l.field.id, l.field]));
  const carriedOver = [...fb.keys()].filter((id) => fa.has(id));
  const removed = [...fa.values()].filter((f) => !fb.has(f.id)).map((f) => ({ fieldId: f.id, label: f.label }));
  const newRequired: MigrationNotice['newRequired'] = [];
  for (const f of fb.values()) {
    const old = fa.get(f.id);
    const nowReq = f.required || !!f.requiredWhen;
    const wasReq = old ? old.required || !!old.requiredWhen : false;
    if (nowReq && (!old || !wasReq || (old.required === false && f.required))) newRequired.push({ fieldId: f.id, label: f.label, conditional: !f.required });
  }
  const changes = diffVersions(a, b);
  const needsReview: MigrationNotice['needsReview'] = [];
  for (const c of changes) {
    if (!c.fieldId || !fa.has(c.fieldId) || !fb.has(c.fieldId) || !c.affectsAnswers) continue;
    if (c.kind === 'required_changed' || c.kind === 'rule_changed') continue; // covered by newRequired / rules
    const label = fb.get(c.fieldId)!.label;
    if (!needsReview.some((n) => n.fieldId === c.fieldId && n.reason === c.summary)) needsReview.push({ fieldId: c.fieldId, label, reason: c.summary });
  }
  const flagChanges = changes.filter((c) => c.kind === 'flag_changed');

  const details: string[] = [];
  details.push(
    carriedOver.length
      ? `Answers to ${plural(carriedOver.length, 'question')} carry over unchanged.`
      : 'No answers carry over, because no questions kept their ids.',
  );
  if (removed.length) {
    details.push(
      `${plural(removed.length, 'question was', 'questions were')} removed (${listJoin(removed.map((r) => `“${r.label}”`))}). Answers already given stay in each application's history, but they are hidden from the form.`,
    );
  }
  const always = newRequired.filter((n) => !n.conditional);
  const sometimes = newRequired.filter((n) => n.conditional);
  if (always.length) details.push(`Applicants must answer ${plural(always.length, 'new required question')} before they can submit: ${listJoin(always.map((n) => `“${n.label}”`))}.`);
  if (sometimes.length) details.push(`Depending on their answers, applicants may also need to answer ${listJoin(sometimes.map((n) => `“${n.label}”`))} before they can submit.`);
  for (const n of needsReview) details.push(`Some answers may need another look: ${n.reason}`);
  for (const f of flagChanges) details.push(f.summary);

  const hasImpact = removed.length || newRequired.length || needsReview.length || flagChanges.length;
  const summary = hasImpact
    ? `Applications already in progress will switch to this version. ${details[0]} ${
        newRequired.length ? `Applicants will be asked to answer ${plural(newRequired.length, 'new required question')} before they submit.` : 'Applicants can keep working where they left off.'
      }`
    : `Applications already in progress will switch to this version. ${details[0]} Nothing else changes for applicants.`;

  return { summary, details, carriedOver, removed, newRequired, needsReview };
}
