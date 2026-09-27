// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import {
  Alert,
  Button,
  Field,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@gms/ui';
import { Copy, Trash } from 'lucide-react';
import * as React from 'react';
import { CG_PATHS, cgPathInfo } from '../../cg';
import {
  type Column,
  COLUMN_TYPES,
  type ColumnType,
  type Field as FormField,
  type FieldEligibilityRule,
  type FormModel,
  type InfoBlock,
  isField,
  listFields,
  type Page,
  type Section,
} from '../../model';
import { describeFieldRules, humanizeFlag } from '../../rules';
import {
  type AnyElement,
  elementLabel,
  FIELD_TYPE_LABELS,
  getElement,
  idProblem,
  mappingConflicts,
  mappingSuggestion,
  renameElementId,
  slugifyId,
  updateElement,
  updatePage,
} from '../builder-ops';
import { formatCentsForInput, parseNumberInput } from '../money';
import { MoneyInput } from '../renderers/basic';
import { MarkdownEditor } from '../renderers/rich-text';
import { opChoices, opKey, opNeedsValue } from '../rule-draft';
import { ConditionValueEditor, RuleEditor } from './logic-editor';
import { OptionListEditor } from './options-editor';

export type BuilderSelection = { kind: 'element'; id: string } | { kind: 'page'; id: string } | { kind: 'form' };

/** Applies an edit. `key` merges rapid edits of one property into one undo step. */
export type EditFn = (fn: (m: FormModel) => FormModel, key?: string) => void;

export interface PropertiesPanelProps {
  model: FormModel;
  selection: BuilderSelection;
  edit: EditFn;
  readOnly?: boolean;
  flagLabels?: Readonly<Record<string, string>>;
  onJump: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onDeletePage: (id: string) => void;
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  const { model, selection } = props;
  let body: React.ReactNode;
  let heading: string;
  if (selection.kind === 'element') {
    const el = getElement(model, selection.id);
    if (!el) {
      heading = 'Nothing selected';
      body = <p className="text-sm text-muted-foreground">Select a question on the form to edit it.</p>;
    } else {
      heading = isField(el) ? 'Question settings' : el.type === 'section' ? 'Section settings' : 'Text block settings';
      body = isField(el) ? <FieldProperties key={el.id} field={el} {...props} /> : <LayoutProperties key={el.id} element={el} {...props} />;
    }
  } else if (selection.kind === 'page') {
    const page = model.pages.find((p) => p.id === selection.id);
    heading = 'Page settings';
    body = page ? <PageProperties key={page.id} page={page} {...props} /> : <p className="text-sm text-muted-foreground">That page was removed.</p>;
  } else {
    heading = 'Form settings';
    body = <FormProperties {...props} />;
  }
  return (
    <div className="grid gap-4">
      <h2 className="font-heading text-base font-semibold">{heading}</h2>
      <fieldset disabled={props.readOnly} className="grid min-w-0 gap-4">
        {body}
      </fieldset>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small controls
// ---------------------------------------------------------------------------

function SwitchRow({ id, label, description, checked, onChange }: { id: string; label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const descId = description ? `${id}-desc` : undefined;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {description ? (
          <p id={descId} className="text-xs text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={descId} />
    </div>
  );
}

function NumberSetting({
  id,
  label,
  description,
  value,
  onChange,
  integer = true,
  min,
}: {
  id: string;
  label: string;
  description?: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  integer?: boolean;
  min?: number;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? (value === undefined ? '' : String(value));
  const parsed = draft === null ? value : parseNumberInput(draft, integer);
  const invalid = draft !== null && draft.trim() !== '' && (parsed === undefined || parsed === null || (min !== undefined && parsed < min));
  return (
    <Field label={label} description={description} htmlFor={id} error={invalid ? `Enter a ${integer ? 'whole ' : ''}number${min !== undefined ? ` of at least ${min}` : ''}.` : undefined}>
      <Input
        inputSize="sm"
        inputMode={integer ? 'numeric' : 'decimal'}
        className="max-w-32 tabular-nums"
        value={shown}
        onChange={(e) => {
          const t = e.currentTarget.value;
          setDraft(t);
          const n = parseNumberInput(t, integer);
          if (t.trim() === '') onChange(undefined);
          else if (typeof n === 'number' && (min === undefined || n >= min)) onChange(n);
        }}
        onBlur={() => setDraft(null)}
      />
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

type FieldPatch = Record<string, unknown>;

function FieldProperties({ field, model, edit, flagLabels, onJump, onDuplicate, onDelete, readOnly }: PropertiesPanelProps & { field: FormField }) {
  const id = field.id;
  const update = (patch: FieldPatch, prop?: string) => edit((m) => updateElement(m, id, patch), prop ? `${id}:${prop}` : undefined);
  const [tab, setTab] = React.useState('question');
  const rules = describeFieldRules(model, id);
  return (
    <>
      <Tabs value={tab} onValueChange={setTab} className="gap-3">
        <TabsList variant="pill" className="w-full">
          <TabsTrigger value="question" className="flex-1">
            Question
          </TabsTrigger>
          <TabsTrigger value="logic" className="flex-1">
            Logic
          </TabsTrigger>
          <TabsTrigger value="data" className="flex-1">
            Data & review
          </TabsTrigger>
        </TabsList>
        <TabsContent value="question" className="grid gap-4">
          <p className="text-xs text-muted-foreground">{FIELD_TYPE_LABELS[field.type]}</p>
          <Field label="Question" htmlFor={`prop-${id}-label`} description="Applicants and screen readers hear this. Ask the question in plain words.">
            <Textarea rows={2} value={field.label} onChange={(e) => update({ label: e.currentTarget.value }, 'label')} />
          </Field>
          <Field label="Help text" htmlFor={`prop-${id}-help`} description="Shown under the question. Explain what a good answer looks like.">
            <Textarea rows={3} value={field.help ?? ''} onChange={(e) => update({ help: e.currentTarget.value || undefined }, 'help')} />
          </Field>
          <SwitchRow
            id={`prop-${id}-required`}
            label="Required"
            description={field.requiredWhen && !field.required ? 'Turning this on replaces the “required when” rule.' : 'Applicants must answer before they submit.'}
            checked={field.required}
            onChange={(v) => update(v ? { required: true, requiredWhen: undefined } : { required: false })}
          />
          <IdSetting model={model} element={field} edit={edit} />
          <TypeSettings field={field} model={model} update={update} />
        </TabsContent>
        <TabsContent value="logic" className="grid gap-5">
          {rules.length ? (
            <ul className="grid gap-1 rounded-md bg-muted/50 p-3 text-sm">
              {rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          <section className="grid gap-2">
            <h3 className="text-sm font-semibold">Show or hide</h3>
            <RuleEditor model={model} elementId={id} kind="visibleWhen" onApply={(next) => edit(() => next)} readOnly={readOnly} flagLabels={flagLabels} onJump={onJump} />
          </section>
          <section className="grid gap-2">
            <h3 className="text-sm font-semibold">Required when</h3>
            {field.required ? (
              <p className="text-sm text-muted-foreground">Always required. Turn off “Required” on the Question tab to require it only sometimes.</p>
            ) : (
              <RuleEditor model={model} elementId={id} kind="requiredWhen" onApply={(next) => edit(() => next)} readOnly={readOnly} flagLabels={flagLabels} onJump={onJump} />
            )}
          </section>
          <section className="grid gap-2">
            <h3 className="text-sm font-semibold">Editable when</h3>
            <RuleEditor model={model} elementId={id} kind="enabledWhen" onApply={(next) => edit(() => next)} readOnly={readOnly} flagLabels={flagLabels} onJump={onJump} />
          </section>
        </TabsContent>
        <TabsContent value="data" className="grid gap-5">
          <MappingSetting field={field} model={model} update={update} onJump={onJump} />
          <SwitchRow
            id={`prop-${id}-blind`}
            label="Hide in blind review"
            description={
              field.cgMapping && cgPathInfo(field.cgMapping)?.identifying && !field.blind
                ? 'This answer identifies the applicant. Consider hiding it from reviewers in blind stages.'
                : 'Reviewers in blind stages see “Hidden for blind review” instead of the answer.'
            }
            checked={field.blind}
            onChange={(v) => update({ blind: v })}
          />
          <Field label="Notes for reviewers" htmlFor={`prop-${id}-notes`} description="Staff only. Shown to reviewers next to the answer.">
            <Textarea rows={3} value={field.reviewerNotes ?? ''} onChange={(e) => update({ reviewerNotes: e.currentTarget.value || undefined }, 'reviewerNotes')} />
          </Field>
          <EligibilitySetting field={field} update={update} />
          <Field label="Report indicator" htmlFor={`prop-${id}-indicator`} description="Optional key that feeds grantee reports, like youth_served.">
            <Input
              inputSize="sm"
              className="font-mono"
              value={field.indicator ?? ''}
              onChange={(e) => update({ indicator: e.currentTarget.value.trim() ? slugifyId(e.currentTarget.value, 'indicator') : undefined }, 'indicator')}
            />
          </Field>
        </TabsContent>
      </Tabs>
      <ElementActions id={id} onDuplicate={onDuplicate} onDelete={onDelete} readOnly={readOnly} />
    </>
  );
}

function ElementActions({ id, onDuplicate, onDelete, readOnly }: { id: string; onDuplicate: (id: string) => void; onDelete: (id: string) => void; readOnly?: boolean }) {
  if (readOnly) return null;
  return (
    <div className="flex flex-wrap gap-2 border-t pt-3">
      <Button type="button" variant="outline" size="sm" onClick={() => onDuplicate(id)}>
        <Copy aria-hidden="true" />
        Duplicate
      </Button>
      <Button type="button" variant="ghost" size="sm" className="text-status-danger-fg" onClick={() => onDelete(id)}>
        <Trash aria-hidden="true" />
        Delete
      </Button>
    </div>
  );
}

function IdSetting({ model, element, edit }: { model: FormModel; element: AnyElement; edit: EditFn }) {
  const [draft, setDraft] = React.useState(element.id);
  React.useEffect(() => setDraft(element.id), [element.id]);
  const problem = draft === element.id ? undefined : idProblem(model, element.id, draft);
  const commit = () => {
    if (draft !== element.id && !problem) edit((m) => renameElementId(m, element.id, draft));
    else if (problem) setDraft(element.id);
  };
  return (
    <Field
      label="Answer id"
      htmlFor={`prop-${element.id}-id`}
      description="Answers are stored under this id. Changing it after the form is published starts a new, empty answer."
      error={problem}
    >
      <Input
        inputSize="sm"
        className="font-mono"
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value.trim())}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
    </Field>
  );
}

function TypeSettings({ field, model, update }: { field: FormField; model: FormModel; update: (p: FieldPatch, prop?: string) => void }) {
  const id = field.id;
  switch (field.type) {
    case 'text':
      return <NumberSetting id={`prop-${id}-maxLength`} label="Character limit" value={field.maxLength} min={1} onChange={(v) => update({ maxLength: v })} />;
    case 'long_text':
      return (
        <div className="grid grid-cols-2 gap-3">
          <NumberSetting id={`prop-${id}-maxWords`} label="Word limit" value={field.maxWords} min={1} onChange={(v) => update({ maxWords: v })} />
          <NumberSetting id={`prop-${id}-maxLength`} label="Character limit" value={field.maxLength} min={1} onChange={(v) => update({ maxLength: v })} />
        </div>
      );
    case 'rich_text':
      return <NumberSetting id={`prop-${id}-maxWords`} label="Word limit" value={field.maxWords} min={1} onChange={(v) => update({ maxWords: v })} />;
    case 'number':
      return (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <NumberSetting id={`prop-${id}-min`} label="Smallest allowed" integer={false} value={field.min} onChange={(v) => update({ min: v })} />
            <NumberSetting id={`prop-${id}-max`} label="Largest allowed" integer={false} value={field.max} onChange={(v) => update({ max: v })} />
          </div>
          <SwitchRow id={`prop-${id}-integer`} label="Whole numbers only" checked={field.integer} onChange={(v) => update({ integer: v })} />
          <Field label="Unit" htmlFor={`prop-${id}-unit`} description="Shown after the box, like “people” or “hours”.">
            <Input inputSize="sm" className="max-w-40" value={field.unit ?? ''} onChange={(e) => update({ unit: e.currentTarget.value || undefined }, 'unit')} />
          </Field>
        </div>
      );
    case 'currency':
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Smallest amount" htmlFor={`prop-${id}-min`}>
            <MoneyInput size="sm" cents={field.min} onCents={(v) => update({ min: typeof v === 'number' ? v : undefined })} />
          </Field>
          <Field label="Largest amount" htmlFor={`prop-${id}-max`}>
            <MoneyInput size="sm" cents={field.max} onCents={(v) => update({ max: typeof v === 'number' ? v : undefined })} />
          </Field>
          {field.min !== undefined || field.max !== undefined ? (
            <p className="col-span-2 text-xs text-muted-foreground">
              Applicants see: {field.min !== undefined ? `from $${formatCentsForInput(field.min)}` : ''}
              {field.min !== undefined && field.max !== undefined ? ' ' : ''}
              {field.max !== undefined ? `up to $${formatCentsForInput(field.max)}` : ''}.
            </p>
          ) : null}
        </div>
      );
    case 'date':
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Earliest date" htmlFor={`prop-${id}-min`}>
            <Input type="date" inputSize="sm" value={field.min ?? ''} onChange={(e) => update({ min: e.currentTarget.value || undefined })} />
          </Field>
          <Field label="Latest date" htmlFor={`prop-${id}-max`}>
            <Input type="date" inputSize="sm" value={field.max ?? ''} onChange={(e) => update({ max: e.currentTarget.value || undefined })} />
          </Field>
        </div>
      );
    case 'select':
      return (
        <div className="grid gap-4">
          <Field label="Show choices as" htmlFor={`prop-${id}-display`}>
            <Select value={field.display} onValueChange={(v) => update({ display: v })}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dropdown">A dropdown list</SelectItem>
                <SelectItem value="radio">Radio buttons (best for 5 or fewer)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <OptionListEditor legend="Choices" noun="choice" items={field.options} onChange={(options) => update({ options }, 'options')} />
        </div>
      );
    case 'multi_select':
    case 'checkbox_group':
      return (
        <div className="grid gap-4">
          <OptionListEditor legend="Choices" noun="choice" items={field.options} onChange={(options) => update({ options }, 'options')} />
          <NumberSetting id={`prop-${id}-maxSel`} label="Most choices allowed" value={field.maxSelections} min={1} onChange={(v) => update({ maxSelections: v })} />
        </div>
      );
    case 'file_upload':
      return <FileSettings field={field} update={update} />;
    case 'repeater_table':
      return <RepeaterSettings field={field} model={model} update={update} />;
    case 'likert_matrix':
      return (
        <div className="grid gap-4">
          <OptionListEditor
            legend="Statements (rows)"
            noun="row"
            valueHeading="Row id"
            min={1}
            items={field.rows.map((r) => ({ value: r.id, label: r.label }))}
            onChange={(items) => update({ rows: items.map((i) => ({ id: i.value, label: i.label })) }, 'rows')}
          />
          <OptionListEditor legend="Answer scale (columns)" noun="answer" min={2} items={field.scale} onChange={(scale) => update({ scale }, 'scale')} />
        </div>
      );
    case 'attestation':
      return (
        <div className="grid gap-4">
          <Field label="Statement applicants confirm" htmlFor={`prop-${id}-statement`}>
            <MarkdownEditor value={field.statement} onChange={(t) => update({ statement: t }, 'statement')} rows={5} toolbarLabel="Formatting for the statement" />
          </Field>
          <SwitchRow id={`prop-${id}-sig`} label="Ask for a typed signature" description="Applicants type their full name." checked={field.requireName} onChange={(v) => update({ requireName: v })} />
        </div>
      );
    default:
      return null;
  }
}

function FileSettings({ field, update }: { field: Extract<FormField, { type: 'file_upload' }>; update: (p: FieldPatch, prop?: string) => void }) {
  const id = field.id;
  const [acceptText, setAcceptText] = React.useState(field.accept.join(', '));
  return (
    <div className="grid gap-3">
      <Field label="Allowed file types" htmlFor={`prop-${id}-accept`} description="File extensions separated by commas, like pdf, docx, xlsx. Leave blank to allow any type.">
        <Input
          inputSize="sm"
          value={acceptText}
          onChange={(e) => {
            setAcceptText(e.currentTarget.value);
            const accept = [...new Set(e.currentTarget.value.split(/[\s,]+/).map((a) => a.replace(/^\./, '').toLowerCase()).filter(Boolean))];
            update({ accept }, 'accept');
          }}
        />
      </Field>
      <NumberSetting
        id={`prop-${id}-size`}
        label="Size limit per file (MB)"
        integer={false}
        min={0.1}
        value={Math.round((field.maxBytes / (1024 * 1024)) * 10) / 10}
        onChange={(v) => v !== undefined && update({ maxBytes: Math.max(1, Math.round(v * 1024 * 1024)) })}
      />
      <SwitchRow id={`prop-${id}-multiple`} label="Allow more than one file" checked={field.multiple} onChange={(v) => update({ multiple: v, ...(v ? {} : { maxFiles: undefined }) })} />
      {field.multiple ? <NumberSetting id={`prop-${id}-maxFiles`} label="Most files allowed" min={1} value={field.maxFiles} onChange={(v) => update({ maxFiles: v })} /> : null}
    </div>
  );
}

function RepeaterSettings({ field, model, update }: { field: Extract<FormField, { type: 'repeater_table' }>; model: FormModel; update: (p: FieldPatch, prop?: string) => void }) {
  const id = field.id;
  const setColumns = (columns: Column[]) => update({ columns }, 'columns');
  const setColumn = (i: number, patch: Record<string, unknown>) =>
    setColumns(
      field.columns.map((c, j) => {
        if (j !== i) return c;
        const next: Record<string, unknown> = { ...c, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
        return next as Column;
      }),
    );
  const changeType = (i: number, type: ColumnType) => {
    const c = field.columns[i]!;
    const base = { id: c.id, label: c.label, required: c.required, blind: false, type };
    const extra = type === 'select' ? { options: [{ value: 'option_1', label: 'Option 1' }], display: 'dropdown' } : type === 'currency' ? { currency: 'USD' } : type === 'number' ? { integer: false } : {};
    setColumns(field.columns.map((x, j) => (j === i ? ({ ...base, ...extra } as Column) : x)));
  };
  const addColumn = () => {
    const taken = new Set(field.columns.map((c) => c.id));
    let n = field.columns.length + 1;
    while (taken.has(`column_${n}`)) n++;
    setColumns([...field.columns, { id: `column_${n}`, type: 'text', label: `Column ${n}`, required: false, blind: false }]);
  };
  const moveColumn = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= field.columns.length) return;
    const next = [...field.columns];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setColumns(next);
  };
  const numericCols = field.columns.filter((c) => c.type === 'number' || c.type === 'currency');
  const targets = listFields(model).filter((l) => (l.field.type === 'currency' || l.field.type === 'number') && l.field.id !== id);
  const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
    text: 'Short text',
    long_text: 'Long text',
    number: 'Number',
    currency: 'Dollar amount',
    date: 'Date',
    select: 'Single choice',
    yes_no: 'Yes / No',
    email: 'Email',
    phone: 'Phone',
  };
  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">Columns</legend>
        {field.columns.map((c, i) => (
          <div key={i} className="grid gap-2 rounded-md border p-2.5">
            <div className="grid grid-cols-2 gap-2">
              <Field label={`Column ${i + 1} heading`} htmlFor={`prop-${id}-col-${i}-label`} labelClassName="text-xs">
                <Input inputSize="sm" value={c.label} onChange={(e) => setColumn(i, { label: e.currentTarget.value })} />
              </Field>
              <Field label="Type" htmlFor={`prop-${id}-col-${i}-type`} labelClassName="text-xs">
                <Select value={c.type} onValueChange={(v) => changeType(i, v as ColumnType)}>
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLUMN_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {COLUMN_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Switch id={`prop-${id}-col-${i}-req`} checked={c.required} onCheckedChange={(v) => setColumn(i, { required: v })} />
                <Label htmlFor={`prop-${id}-col-${i}-req`} className="text-xs">
                  Required in each row
                </Label>
              </div>
              <span className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" disabled={i === 0} onClick={() => moveColumn(i, -1)} aria-label={`Move column ${i + 1} left`}>
                  Left
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={i === field.columns.length - 1} onClick={() => moveColumn(i, 1)} aria-label={`Move column ${i + 1} right`}>
                  Right
                </Button>
                <Button type="button" variant="ghost" size="sm" className="text-status-danger-fg" onClick={() => setColumns(field.columns.filter((_, j) => j !== i))} aria-label={`Remove column ${i + 1}`}>
                  Remove
                </Button>
              </span>
            </div>
            {c.type === 'select' ? (
              <OptionListEditor legend={`Choices for “${c.label}”`} noun="choice" items={c.options} onChange={(options) => setColumn(i, { options })} />
            ) : null}
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={addColumn}>
          Add column
        </Button>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <NumberSetting id={`prop-${id}-minRows`} label="Fewest rows" min={0} value={field.minRows} onChange={(v) => update({ minRows: v })} />
        <NumberSetting id={`prop-${id}-maxRows`} label="Most rows" min={1} value={field.maxRows} onChange={(v) => update({ maxRows: v })} />
      </div>
      <Field label="“Add row” button text" htmlFor={`prop-${id}-addLabel`}>
        <Input inputSize="sm" value={field.addLabel ?? ''} onChange={(e) => update({ addLabel: e.currentTarget.value || undefined }, 'addLabel')} />
      </Field>
      <SwitchRow id={`prop-${id}-totals`} label="Show totals" description="Adds a total under each number and dollar column." checked={field.totals} onChange={(v) => update({ totals: v })} />
      <fieldset className="grid gap-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Total must equal</legend>
        <p className="text-xs text-muted-foreground">Applicants see a live hint and can’t submit until the column adds up to another answer.</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Column" htmlFor={`prop-${id}-sum-col`} labelClassName="text-xs">
            <Select
              value={field.sumEquals?.column ?? '__none__'}
              onValueChange={(v) => {
                if (v === '__none__') update({ sumEquals: undefined });
                else update({ sumEquals: { column: v, field: field.sumEquals?.field ?? targets[0]?.field.id ?? '', ...(field.sumEquals?.noun ? { noun: field.sumEquals.noun } : {}) } });
              }}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No rule</SelectItem>
                {numericCols.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Must equal" htmlFor={`prop-${id}-sum-field`} labelClassName="text-xs">
            <Select
              value={field.sumEquals?.field || undefined}
              disabled={!field.sumEquals}
              onValueChange={(v) => field.sumEquals && update({ sumEquals: { ...field.sumEquals, field: v } })}
            >
              <SelectTrigger size="sm">
                <SelectValue placeholder="Choose a question" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={t.field.id} value={t.field.id}>
                    {t.field.label || t.field.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        {field.sumEquals ? (
          <Field label="What applicants call the rows" htmlFor={`prop-${id}-sum-noun`} description="Used in the hint, like “budget lines”." labelClassName="text-xs">
            <Input
              inputSize="sm"
              value={field.sumEquals.noun ?? ''}
              onChange={(e) => field.sumEquals && update({ sumEquals: { ...field.sumEquals, noun: e.currentTarget.value || undefined } }, 'sumNoun')}
            />
          </Field>
        ) : null}
        {numericCols.length === 0 ? <p className="text-xs text-muted-foreground">Add a number or dollar column to use this rule.</p> : null}
      </fieldset>
    </div>
  );
}

function MappingSetting({ field, model, update, onJump }: { field: FormField; model: FormModel; update: (p: FieldPatch) => void; onJump: (id: string) => void }) {
  const id = field.id;
  const options = CG_PATHS.filter((p) => p.fieldTypes.includes(field.type));
  const current = field.cgMapping;
  const custom = current && !options.some((o) => o.path === current);
  const suggestion = mappingSuggestion(model, field);
  const suggestionInfo = suggestion ? cgPathInfo(suggestion) : undefined;
  const others = current ? (mappingConflicts(model).get(current) ?? []).filter((x) => x !== id) : [];
  const labelOf = (fid: string) => {
    const el = getElement(model, fid);
    return el ? elementLabel(el) : fid;
  };
  return (
    <div className="grid gap-2">
      <Field
        label="CommonGrants field"
        htmlFor={`prop-${id}-cg`}
        description="Mapped answers are filled in from the applicant’s profile and included in CommonGrants exports."
      >
        <Select value={current ?? '__none__'} onValueChange={(v) => update({ cgMapping: v === '__none__' ? undefined : v })}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Not mapped</SelectItem>
            {custom ? <SelectItem value={current!}>{current}</SelectItem> : null}
            {options.map((o) => (
              <SelectItem key={o.path} value={o.path}>
                {o.label} ({o.path})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {options.length === 0 && !current ? <p className="text-xs text-muted-foreground">No CommonGrants fields fit this question type.</p> : null}
      {suggestion && suggestionInfo ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-status-info-bg px-3 py-2 text-xs text-status-info-fg">
          <span>
            Suggested: {suggestionInfo.label} <span className="font-mono">({suggestion})</span>
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => update({ cgMapping: suggestion })}>
            Use suggestion
          </Button>
        </div>
      ) : null}
      {others.length ? (
        <Alert
          variant="warning"
          title="Mapping conflict"
          actions={others.map((o) => (
            <Button key={o} type="button" variant="outline" size="sm" onClick={() => onJump(o)}>
              Go to “{labelOf(o)}”
            </Button>
          ))}
        >
          {others.length === 1 ? `“${labelOf(others[0]!)}” is` : `${others.length} other questions are`} also mapped to <span className="font-mono">{current}</span>. Prefill and exports use only the
          first one in the form. Map each CommonGrants field to one question.
        </Alert>
      ) : null}
    </div>
  );
}

const DEFAULT_KNOCKOUT_MESSAGE =
  "Thank you for your interest. Based on this answer, this opportunity isn't a fit for your organization. If you think this is a mistake, please contact the program team.";

function EligibilitySetting({ field, update }: { field: FormField; update: (p: FieldPatch, prop?: string) => void }) {
  const id = field.id;
  const rule = field.eligibility;
  const choices = opChoices(field.type);
  const set = (patch: Partial<FieldEligibilityRule>) => {
    if (!rule) return;
    const next: Record<string, unknown> = { ...rule, ...patch };
    if ('value' in patch && patch.value === undefined) delete next.value;
    update({ eligibility: next });
  };
  const clause = rule ? { kind: 'field' as const, field: id, op: rule.op, ...(rule.value !== undefined ? { value: rule.value } : {}) } : undefined;
  return (
    <section className="grid gap-3">
      <SwitchRow
        id={`prop-${id}-ko`}
        label="Eligibility knock-out"
        description="When the answer matches, applicants see a kind message and the application is flagged as not eligible."
        checked={!!rule}
        onChange={(on) => {
          const first = choices[0]!;
          update({ eligibility: on ? { op: first.op, ...(first.value !== undefined ? { value: first.value } : {}), message: DEFAULT_KNOCKOUT_MESSAGE } : undefined });
        }}
      />
      {rule && clause ? (
        <div className="grid gap-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Not eligible when the answer</span>
            <Select
              value={opKey(field.type, clause)}
              onValueChange={(k) => {
                const c = choices.find((x) => x.key === k);
                if (c) set({ op: c.op, value: c.value });
              }}
            >
              <SelectTrigger size="sm" className="w-auto" aria-label="Knock-out comparison">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {choices.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {opNeedsValue(rule.op) && choices.find((c) => c.key === opKey(field.type, clause))?.value === undefined ? (
              <ConditionValueEditor index={1} clause={clause} target={field} onChange={(v) => set({ value: v })} />
            ) : null}
          </div>
          <Field label="Message applicants see" htmlFor={`prop-${id}-ko-msg`} description="Be kind and specific. Say what happens next.">
            <Textarea rows={3} value={rule.message} onChange={(e) => set({ message: e.currentTarget.value || DEFAULT_KNOCKOUT_MESSAGE })} />
          </Field>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sections, text blocks, pages, form
// ---------------------------------------------------------------------------

function LayoutProperties({ element, model, edit, readOnly, flagLabels, onJump, onDuplicate, onDelete }: PropertiesPanelProps & { element: Section | InfoBlock }) {
  const id = element.id;
  const update = (patch: Record<string, unknown>, prop?: string) => edit((m) => updateElement(m, id, patch), prop ? `${id}:${prop}` : undefined);
  return (
    <>
      {element.type === 'section' ? (
        <>
          <Field label="Section heading" htmlFor={`prop-${id}-title`}>
            <Input inputSize="sm" value={element.title} onChange={(e) => update({ title: e.currentTarget.value }, 'title')} />
          </Field>
          <Field label="Description" htmlFor={`prop-${id}-desc`} description="Optional. Shown under the heading.">
            <Textarea rows={2} value={element.description ?? ''} onChange={(e) => update({ description: e.currentTarget.value || undefined }, 'description')} />
          </Field>
        </>
      ) : (
        <>
          <Field label="Heading" htmlFor={`prop-${id}-title`} description="Optional.">
            <Input inputSize="sm" value={element.title ?? ''} onChange={(e) => update({ title: e.currentTarget.value || undefined }, 'title')} />
          </Field>
          <Field label="Text" htmlFor={`prop-${id}-md`} description="Applicants read this. Use short paragraphs and plain words.">
            <MarkdownEditor value={element.markdown} onChange={(t) => update({ markdown: t }, 'markdown')} rows={6} toolbarLabel="Formatting for this text block" />
          </Field>
        </>
      )}
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Show or hide</h3>
        <RuleEditor model={model} elementId={id} kind="visibleWhen" onApply={(next) => edit(() => next)} readOnly={readOnly} flagLabels={flagLabels} onJump={onJump} />
      </section>
      <ElementActions id={id} onDuplicate={onDuplicate} onDelete={onDelete} readOnly={readOnly} />
    </>
  );
}

function PageProperties({ page, edit, onDeletePage, readOnly }: PropertiesPanelProps & { page: Page }) {
  const update = (patch: Partial<Pick<Page, 'title' | 'description'>>, prop: string) => edit((m) => updatePage(m, page.id, patch), `page:${page.id}:${prop}`);
  return (
    <>
      <Field label="Page title" htmlFor={`prop-page-${page.id}-title`} description="Applicants see this in the progress list.">
        <Input inputSize="sm" value={page.title} onChange={(e) => update({ title: e.currentTarget.value }, 'title')} />
      </Field>
      <Field label="Introduction" htmlFor={`prop-page-${page.id}-desc`} description="Optional. Shown at the top of the page.">
        <Textarea rows={3} value={page.description ?? ''} onChange={(e) => update({ description: e.currentTarget.value || undefined }, 'description')} />
      </Field>
      <p className="text-xs text-muted-foreground">
        Page id: <span className="font-mono">{page.id}</span>
      </p>
      {!readOnly ? (
        <div className="border-t pt-3">
          <Button type="button" variant="ghost" size="sm" className="text-status-danger-fg" onClick={() => onDeletePage(page.id)}>
            <Trash aria-hidden="true" />
            Delete page
          </Button>
        </div>
      ) : null}
    </>
  );
}

function FormProperties({ model, edit, flagLabels }: PropertiesPanelProps) {
  const fields = listFields(model);
  const flags = Object.keys(model.flags);
  return (
    <>
      <Field label="Form title" htmlFor="prop-form-title" description="Applicants see this at the top of every page.">
        <Input inputSize="sm" value={model.title} onChange={(e) => edit((m) => ({ ...m, title: e.currentTarget.value }), 'form:title')} />
      </Field>
      <Field label="Introduction" htmlFor="prop-form-desc" description="Say how long the form takes and that applicants can save and come back.">
        <Textarea
          rows={3}
          value={model.description ?? ''}
          onChange={(e) => {
            const v = e.currentTarget.value;
            edit((m) => {
              const next = { ...m, description: v };
              if (!v) delete (next as { description?: string }).description;
              return next;
            }, 'form:description');
          }}
        />
      </Field>
      {flags.length ? (
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-medium">Form switches</legend>
          {flags.map((f) => (
            <SwitchRow
              key={f}
              id={`prop-flag-${f}`}
              label={flagLabels?.[f] ?? humanizeFlag(f)}
              description="Rules can depend on this switch. It takes effect when you publish."
              checked={model.flags[f] === true}
              onChange={(v) => edit((m) => ({ ...m, flags: { ...m.flags, [f]: v } }))}
            />
          ))}
        </fieldset>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {model.pages.length} {model.pages.length === 1 ? 'page' : 'pages'}, {fields.length} {fields.length === 1 ? 'question' : 'questions'} ({fields.filter((f) => f.field.required).length} always required).
      </p>
      <p className="text-xs text-muted-foreground">Select a page or a question to edit it.</p>
    </>
  );
}
