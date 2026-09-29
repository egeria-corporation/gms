// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// F-01…F-05 first-run setup wizard. All answers stay in this component until the final step; `?step=` is kept
// in sync so each step is linkable. Each step is validated before continuing.
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@gms/domain';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CheckboxField,
  DescriptionList,
  Field,
  FieldSet,
  Input,
  ProgressRail,
  RadioGroup,
  RadioOption,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ValidationSummary,
  contrastRatio,
  headingFont,
  resolveBrand,
  toast,
  type RailPage,
} from '@gms/ui';
import { ArrowLeft, ArrowRight, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from 'react';
import { initializeSetup, type SetupResult } from './actions';
import { CheckEmailPanel, type SetupDone } from './check-email';
import {
  FONT_LABELS,
  INVITE_ROLES,
  MAX_INVITES,
  PAYMENT_CHOICES,
  PAYMENT_LABELS,
  STEPS,
  STEP_TITLES,
  TIMEZONES,
  fieldId,
  filledInvites,
  slugify,
  validateStep,
  type FieldErrors,
  type FontLabel,
  type InviteRole,
  type PaymentChoice,
  type SetupDraft,
  type StepId,
} from './wizard-schema';

export interface TemplateOption {
  key: string;
  name: string;
  description: string;
}

export interface SetupWizardProps {
  initialStep: StepId;
  initialDraft: SetupDraft;
  templates: TemplateOption[];
  rootDomain: string;
  multi: boolean;
  /** Dev tools only: a workspace already exists, so the final submit is turned off. */
  previewOnly: boolean;
}

const FONT_DESCRIPTIONS: Record<FontLabel, string> = {
  Inter: 'Neutral and modern.',
  'Source Serif 4': 'Classic serif, institutional feel.',
  'Atkinson Hyperlegible': 'Very distinct letters for low-vision readers.',
  Figtree: 'Friendly and geometric.',
};

let inviteSeq = 100;

export function SetupWizard({ initialStep, initialDraft, templates, rootDomain, multi, previewOnly }: SetupWizardProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<SetupDraft>(initialDraft);
  const [step, setStep] = useState<StepId>(initialStep);
  const [furthest, setFurthest] = useState(() => STEPS.indexOf(initialStep));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<{ message: string; alreadySetUp?: boolean } | null>(null);
  const [slugTouched, setSlugTouched] = useState(Boolean(initialDraft.slug));
  const [done, setDone] = useState<SetupDone | null>(null);
  const [pending, startTransition] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const errorCount = useRef(0);
  errorCount.current = Object.keys(errors).length;

  const index = STEPS.indexOf(step);

  // Keep ?step= in sync (replace, not push: Back/Continue are the wizard's own navigation).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('step') !== step) {
      params.set('step', step);
      router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false });
    }
    // Move focus to the new step's heading, unless the error summary has just taken focus.
    if (firstRender.current) firstRender.current = false;
    else if (errorCount.current === 0) headingRef.current?.focus();
  }, [step, router]);

  function update<K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      if (key === 'name' && !slugTouched) next.slug = slugify(String(value));
      return next;
    });
    if (errors[key as string]) setErrors((e) => withoutKey(e, key as string));
  }

  function goTo(target: StepId) {
    setErrors({});
    setFormError(null);
    setStep(target);
    setFurthest((f) => Math.max(f, STEPS.indexOf(target)));
  }

  function next() {
    const e = validateStep(step, draft);
    setErrors(e);
    if (Object.keys(e).length) return;
    const target = STEPS[index + 1];
    if (target) goTo(target);
  }

  function submit() {
    const e = validateStep(step, draft);
    setErrors(e);
    if (Object.keys(e).length) return;
    // Earlier steps may have been reached by link; re-check them all before creating anything.
    for (const s of STEPS) {
      const se = validateStep(s, draft);
      if (Object.keys(se).length) {
        setStep(s);
        setErrors(se);
        return;
      }
    }
    if (previewOnly) {
      setFormError({ message: 'This is a preview: this GMS already has a workspace, so setup is turned off.', alreadySetUp: true });
      return;
    }
    setFormError(null);
    startTransition(async () => {
      let r: SetupResult;
      try {
        r = await initializeSetup(draft);
      } catch {
        r = { ok: false, message: 'We couldn’t reach the server. Check your connection and try again.' };
      }
      if (r.ok) {
        setDone({ email: r.email, origin: r.origin, name: r.name, programCreated: r.programCreated, opportunityCreated: r.opportunityCreated, invited: r.invited, payments: draft.payments, emailSent: r.emailSent });
        toast.success('Your workspace is ready');
        return;
      }
      if (r.fieldErrors && r.step) {
        setStep(r.step);
        setErrors(r.fieldErrors);
      }
      setFormError({ message: r.message, alreadySetUp: r.alreadySetUp });
      toast.error(r.message);
    });
  }

  const pages: RailPage[] = STEPS.map((s, i) => {
    const visited = i <= furthest;
    const ok = Object.keys(validateStep(s, draft)).length === 0;
    return {
      id: s,
      title: STEP_TITLES[s],
      status: s === step ? 'in_progress' : !visited ? 'not_started' : ok ? 'complete' : 'error',
    };
  });

  if (done) return <CheckEmailPanel done={done} />;

  const summary = Object.entries(errors).map(([key, message]) => ({ fieldId: fieldId(key), message }));

  return (
    <div className="grid gap-6 md:grid-cols-[15rem_1fr] md:items-start">
      <ProgressRail
        pages={pages}
        currentId={step}
        label="Setup steps"
        onSelect={(id) => {
          const target = id as StepId;
          if (STEPS.indexOf(target) <= furthest) goTo(target);
        }}
        className="md:sticky md:top-6"
      />
      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">
            Step {index + 1} of {STEPS.length}
          </p>
          <h2 ref={headingRef} tabIndex={-1} className="font-heading text-xl font-semibold leading-tight outline-offset-4">
            {STEP_TITLES[step]}
          </h2>
          <CardDescription>{STEP_INTROS[step]}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-6"
            noValidate
            onSubmit={(ev) => {
              ev.preventDefault();
              if (step === 'team') submit();
              else next();
            }}
          >
            <ValidationSummary errors={summary} />
            {formError ? (
              <Alert variant={formError.alreadySetUp ? 'warning' : 'danger'} title={formError.alreadySetUp ? 'Already set up' : 'Setup didn’t finish'}>
                <p>{formError.message}</p>
                {formError.alreadySetUp && !previewOnly ? (
                  <p className="mt-2">
                    <a className="text-link underline underline-offset-2" href="/setup">
                      Reload this page
                    </a>{' '}
                    to find where to sign in.
                  </p>
                ) : null}
              </Alert>
            ) : null}

            {step === 'owner' ? <OwnerStep draft={draft} errors={errors} update={update} /> : null}
            {step === 'brand' ? (
              <BrandStep
                draft={draft}
                errors={errors}
                update={update}
                rootDomain={rootDomain}
                multi={multi}
                onSlugEdit={(v) => {
                  setSlugTouched(true);
                  update('slug', v);
                }}
              />
            ) : null}
            {step === 'email' ? <EmailStep draft={draft} errors={errors} update={update} /> : null}
            {step === 'payments' ? <PaymentsStep draft={draft} errors={errors} update={update} /> : null}
            {step === 'program' ? <ProgramStep draft={draft} errors={errors} update={update} templates={templates} /> : null}
            {step === 'team' ? <TeamStep draft={draft} errors={errors} setDraft={setDraft} clearError={(k) => setErrors((e) => withoutKey(e, k))} templates={templates} rootDomain={rootDomain} multi={multi} /> : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
              {index > 0 ? (
                <Button type="button" variant="ghost" onClick={() => goTo(STEPS[index - 1]!)} disabled={pending}>
                  <ArrowLeft aria-hidden="true" /> Back
                </Button>
              ) : (
                <span />
              )}
              <div className="flex flex-wrap items-center gap-2">
                {step === 'program' && !draft.programSkip ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      update('programSkip', true);
                      goTo('team');
                    }}
                  >
                    Skip this step
                  </Button>
                ) : null}
                {step === 'payments' ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      update('payments', 'later');
                      goTo('program');
                    }}
                  >
                    Skip — decide later
                  </Button>
                ) : null}
                {step === 'team' ? (
                  <Button type="submit" size="lg" pending={pending} pendingLabel="Creating your workspace…">
                    Create workspace
                  </Button>
                ) : (
                  <Button type="submit">
                    Continue <ArrowRight aria-hidden="true" />
                  </Button>
                )}
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

const STEP_INTROS: Record<StepId, string> = {
  owner: 'You’ll be the workspace owner. We’ll email you a sign-in link at the end — no password needed.',
  brand: 'Your foundation’s name, web address and colors. Applicants see these on your public site and in every email.',
  email: 'How your emails to applicants and grantees are signed. You can send from your own domain later.',
  payments: 'Choose how you’ll pay grants. You can change this anytime, and nothing is connected until you sign in.',
  program: 'Start with one program and a draft opportunity built from a ready-made application form. Nothing is published yet.',
  team: 'Invite the people who’ll work in GMS with you. They get an email invitation once your workspace is created.',
};

function withoutKey(e: FieldErrors, key: string): FieldErrors {
  if (!(key in e)) return e;
  const copy = { ...e };
  delete copy[key];
  return copy;
}

type Update = <K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) => void;

interface StepProps {
  draft: SetupDraft;
  errors: FieldErrors;
  update: Update;
}

function OwnerStep({ draft, errors, update }: StepProps) {
  return (
    <div className="grid gap-5 sm:max-w-md">
      <Field label="Your full name" htmlFor={fieldId('ownerName')} error={errors.ownerName} required>
        <Input value={draft.ownerName} onChange={(e) => update('ownerName', e.target.value)} autoComplete="name" inputSize="lg" />
      </Field>
      <Field label="Your email address" htmlFor={fieldId('ownerEmail')} error={errors.ownerEmail} required description="Your sign-in link goes here. Use an address only you can read.">
        <Input type="email" value={draft.ownerEmail} onChange={(e) => update('ownerEmail', e.target.value)} autoComplete="email" inputSize="lg" />
      </Field>
    </div>
  );
}

function BrandStep({ draft, errors, update, rootDomain, multi, onSlugEdit }: StepProps & { rootDomain: string; multi: boolean; onSlugEdit: (v: string) => void }) {
  const host = multi ? `${draft.slug || 'your-foundation'}.${rootDomain}` : rootDomain;
  return (
    <div className="grid gap-6">
      <div className="grid gap-5 sm:max-w-lg">
        <Field label="Foundation name" htmlFor={fieldId('name')} error={errors.name} required description="As applicants should see it, e.g. “Juniper Valley Community Fund”.">
          <Input value={draft.name} onChange={(e) => update('name', e.target.value)} autoComplete="organization" inputSize="lg" />
        </Field>
        <Field
          label="Web address"
          htmlFor={fieldId('slug')}
          error={errors.slug}
          required
          description={multi ? 'Lowercase letters, numbers and dashes. This becomes your public site’s address.' : 'A short name for your workspace (lowercase letters, numbers and dashes).'}
          describedBy={[`${fieldId('slug')}-preview`]}
        >
          <Input
            value={draft.slug}
            onChange={(e) => onSlugEdit(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputSize="lg"
            className="font-mono"
          />
        </Field>
        <p id={`${fieldId('slug')}-preview`} className="-mt-3 text-sm text-muted-foreground" aria-live="polite">
          Your site: <span className="font-mono font-medium text-foreground">{host}</span>
          {multi ? null : ' (single-foundation mode uses this server’s own address)'}
        </p>
        <Field label="Time zone" htmlFor={fieldId('timezone')} error={errors.timezone} required description="Deadlines and dates are shown in this time zone.">
          <Select value={draft.timezone} onValueChange={(v) => update('timezone', v)}>
            <SelectTrigger size="lg">
              <SelectValue placeholder="Choose a time zone" />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <ColorField label="Primary color" field="primary" value={draft.primary} error={errors.primary} onChange={(v) => update('primary', v)} description="Buttons, links and headers." />
        <ColorField label="Accent color" field="accent" value={draft.accent} error={errors.accent} onChange={(v) => update('accent', v)} description="Highlights and badges." />
      </div>

      <FieldSet legend="Heading font" id={fieldId('headingFont')} error={errors.headingFont} required>
        <RadioGroup value={draft.headingFont} onValueChange={(v) => update('headingFont', v as FontLabel)} className="grid gap-1 sm:grid-cols-2">
          {FONT_LABELS.map((f) => (
            <RadioOption key={f} value={f} label={<span style={{ fontFamily: headingFont(f).family }}>{f}</span>} description={FONT_DESCRIPTIONS[f]} />
          ))}
        </RadioGroup>
      </FieldSet>

      <BrandPreview name={draft.name} primary={draft.primary} accent={draft.accent} font={draft.headingFont} />
    </div>
  );
}

function ColorField({ label, field, value, error, onChange, description }: { label: string; field: 'primary' | 'accent'; value: string; error?: string; onChange: (v: string) => void; description: string }) {
  const valid = /^#[0-9A-Fa-f]{6}$/.test(value);
  return (
    <Field label={label} htmlFor={fieldId(field)} error={error} required description={`${description} Use a 6-digit hex code.`}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`Pick the ${label.toLowerCase()}`}
          value={valid ? value.toLowerCase() : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-11 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-card p-1"
        />
        <Input
          id={fieldId(field)}
          value={value}
          onChange={(e) => {
            const v = e.target.value.trim();
            onChange(v && !v.startsWith('#') ? `#${v}` : v);
          }}
          maxLength={7}
          spellCheck={false}
          autoCapitalize="none"
          inputSize="lg"
          className="font-mono uppercase"
        />
      </div>
    </Field>
  );
}

/** Live preview: the same branding engine the public site uses, including its automatic contrast fixes. */
function BrandPreview({ name, primary, accent, font }: { name: string; primary: string; accent: string; font: FontLabel }) {
  const resolved = useMemo(() => resolveBrand({ primary, accent, headingFont: font }), [primary, accent, font]);
  const ratio = contrastRatio(resolved.adjusted.primary, '#FFFFFF');
  const style = resolved.tokens as CSSProperties;
  return (
    <section aria-labelledby="brand-preview-title" className="grid gap-3">
      <h3 id="brand-preview-title" className="text-sm font-semibold">
        Preview
      </h3>
      {resolved.warnings.length ? (
        <Alert variant="warning" title="We adjusted your colors so text stays readable">
          <ul className="grid gap-1">
            {resolved.warnings.map((w) => (
              <li key={`${w.code}-${w.field}`} className="flex flex-wrap items-center gap-2">
                <Swatch color={w.original} label={`${w.field} as picked`} />
                <ArrowRight className="size-3.5" aria-hidden="true" />
                <Swatch color={w.adjusted} label={`${w.field} as used`} />
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm">Your original color is still used for decoration. You can change this anytime in Settings → Branding.</p>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">Your colors meet WCAG AA contrast as picked.</p>
      )}
      <div data-surface="branded" style={style} className="overflow-hidden rounded-xl border bg-background">
        <div className="flex items-center gap-3 border-b bg-card px-4 py-3">
          <span aria-hidden="true" className="size-6 rounded-md" style={{ background: resolved.original.primary }} />
          <span className="font-heading font-semibold">{name.trim() || 'Your foundation'}</span>
        </div>
        <div className="grid gap-3 bg-brand-50 px-4 py-5">
          <p className="font-heading text-2xl font-semibold leading-tight">Funding for the work that holds our communities together</p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">See open opportunities</span>
            <span className="text-sm text-link underline underline-offset-2">How applying works</span>
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium" style={{ background: 'var(--brand-accent)', color: 'var(--brand-accent-foreground)' }}>
              Now open
            </span>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Button text contrast: {ratio.toFixed(2)}:1 (AA needs 4.5:1). Heading font: {resolved.headingFont.label}.
      </p>
    </section>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs">
      <span aria-hidden="true" className="size-3.5 rounded-sm border" style={{ background: color }} />
      <span className="sr-only">{label}: </span>
      {color}
    </span>
  );
}

function EmailStep({ draft, errors, update }: StepProps) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-5 sm:max-w-md">
        <Field label="Sender name" htmlFor={fieldId('senderName')} error={errors.senderName} optional description={`Shown as “From”. Leave blank to use ${draft.name.trim() ? `“${draft.name.trim()}”` : 'your foundation’s name'}.`}>
          <Input value={draft.senderName} onChange={(e) => update('senderName', e.target.value)} placeholder={draft.name.trim() || undefined} inputSize="lg" />
        </Field>
        <Field label="Reply-to address" htmlFor={fieldId('replyTo')} error={errors.replyTo} optional description="Where replies from applicants go, e.g. a shared grants inbox.">
          <Input type="email" value={draft.replyTo} onChange={(e) => update('replyTo', e.target.value)} autoComplete="email" inputSize="lg" />
        </Field>
      </div>
      <Alert variant="info" title="Sending from your own domain comes later">
        Until then, email goes out from GMS’s address with your sender name and reply-to. After you sign in, open Settings → Integrations → Email domain to add the DNS records (SPF, DKIM, DMARC).
      </Alert>
    </div>
  );
}

function PaymentsStep({ draft, errors, update }: StepProps) {
  return (
    <div className="grid gap-5">
      <FieldSet legend="How will you pay grants?" id={fieldId('payments')} error={errors.payments} required>
        <RadioGroup value={draft.payments} onValueChange={(v) => update('payments', v as PaymentChoice)} className="grid gap-2">
          {PAYMENT_CHOICES.map((c) => (
            <RadioOption key={c} value={c} size="lg" label={PAYMENT_LABELS[c].label} description={PAYMENT_LABELS[c].description} />
          ))}
        </RadioGroup>
      </FieldSet>
      <Alert variant="info" title="We’ll record your choice for after you sign in">
        Connecting a bank happens inside your console (Payments → Bank), after you’ve set up two-factor sign-in. GMS never stores bank account numbers.
      </Alert>
    </div>
  );
}

function ProgramStep({ draft, errors, update, templates }: StepProps & { templates: TemplateOption[] }) {
  return (
    <div className="grid gap-5">
      <CheckboxField
        label="Skip for now — I’ll set up programs later"
        description="You can create programs and opportunities anytime from the console."
        checked={draft.programSkip}
        onCheckedChange={(v) => update('programSkip', v === true)}
      />
      {draft.programSkip ? null : (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Program name" htmlFor={fieldId('programName')} error={errors.programName} required description="A grantmaking area, e.g. “Rural Youth Futures”.">
              <Input value={draft.programName} onChange={(e) => update('programName', e.target.value)} inputSize="lg" />
            </Field>
            <Field label="Cause area" htmlFor={fieldId('causeArea')} error={errors.causeArea} optional description="e.g. Youth development, Arts, Housing.">
              <Input value={draft.causeArea} onChange={(e) => update('causeArea', e.target.value)} inputSize="lg" />
            </Field>
          </div>
          <Field label="First opportunity title" htmlFor={fieldId('oppTitle')} error={errors.oppTitle} required description="Saved as a draft. You’ll add dates, amounts and eligibility before publishing.">
            <Input value={draft.oppTitle} onChange={(e) => update('oppTitle', e.target.value)} inputSize="lg" />
          </Field>
          <FieldSet legend="Application form" description="Start from a ready-made form. You can edit every question later." id={fieldId('templateKey')} error={errors.templateKey} required>
            <RadioGroup value={draft.templateKey} onValueChange={(v) => update('templateKey', v)} className="grid gap-2">
              {templates.map((t) => (
                <RadioOption key={t.key} value={t.key} size="lg" label={t.name} description={t.description} />
              ))}
            </RadioGroup>
          </FieldSet>
        </>
      )}
    </div>
  );
}

function TeamStep({
  draft,
  errors,
  setDraft,
  clearError,
  templates,
  rootDomain,
  multi,
}: {
  draft: SetupDraft;
  errors: FieldErrors;
  setDraft: (fn: (d: SetupDraft) => SetupDraft) => void;
  clearError: (key: string) => void;
  templates: TemplateOption[];
  rootDomain: string;
  multi: boolean;
}) {
  const setRow = (i: number, patch: Partial<{ email: string; role: InviteRole }>) => {
    setDraft((d) => ({ ...d, invites: d.invites.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
    clearError(`invite-${i}-${patch.role ? 'role' : 'email'}`);
  };
  const template = templates.find((t) => t.key === draft.templateKey);
  const count = filledInvites(draft).length;
  return (
    <div className="grid gap-6">
      {errors.invites ? (
        <p id={fieldId('invites')} tabIndex={-1} className="text-sm font-medium text-status-danger-fg">
          {errors.invites}
        </p>
      ) : null}
      <ul className="grid gap-4" aria-label="People to invite">
        {draft.invites.map((row, i) => (
          <li key={row.key} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_14rem_auto] sm:items-start">
            <Field label={`Person ${i + 1} email`} htmlFor={fieldId(`invite-${i}-email`)} error={errors[`invite-${i}-email`]} optional>
              <Input type="email" value={row.email} onChange={(e) => setRow(i, { email: e.target.value })} autoComplete="off" />
            </Field>
            <Field label={`Person ${i + 1} role`} htmlFor={fieldId(`invite-${i}-role`)} error={errors[`invite-${i}-role`]} description={ROLE_DESCRIPTIONS[row.role]}>
              <Select value={row.role} onValueChange={(v) => setRow(i, { role: v as InviteRole })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="sm:mt-6"
              aria-label={`Remove person ${i + 1}`}
              onClick={() => setDraft((d) => ({ ...d, invites: d.invites.length > 1 ? d.invites.filter((_, j) => j !== i) : [{ ...d.invites[0]!, email: '' }] }))}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={draft.invites.length >= MAX_INVITES}
          onClick={() => setDraft((d) => ({ ...d, invites: [...d.invites, { key: `i${inviteSeq++}`, email: '', role: 'program_officer' }] }))}
        >
          <Plus aria-hidden="true" /> Add another person
        </Button>
        <p className="mt-2 text-sm text-muted-foreground">Leave this empty to invite people later. Staff will be asked to set up two-factor sign-in.</p>
      </div>

      <section aria-labelledby="setup-review-title" className="grid gap-3 rounded-lg bg-muted/50 p-4">
        <h3 id="setup-review-title" className="text-sm font-semibold">
          Ready to create
        </h3>
        <DescriptionList
          items={[
            { term: 'Foundation', detail: draft.name.trim() || '—' },
            { term: 'Web address', detail: <span className="font-mono">{multi ? `${draft.slug}.${rootDomain}` : rootDomain}</span> },
            { term: 'Owner', detail: `${draft.ownerName.trim()} (${draft.ownerEmail.trim()})` },
            { term: 'Payments', detail: PAYMENT_LABELS[draft.payments].label },
            { term: 'First program', detail: draft.programSkip ? 'Skipped' : `${draft.programName.trim()} · draft opportunity “${draft.oppTitle.trim()}” using ${template?.name ?? 'a template'}` },
            { term: 'Invitations', detail: count ? `${count} ${count === 1 ? 'person' : 'people'}` : 'None yet' },
          ]}
        />
      </section>
    </div>
  );
}
