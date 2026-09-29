// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// B-02 Org setup: EIN lookup (found → prefill; not found; status warning; fiscally sponsored path).
import { parseMoneyToCents } from '@gms/domain';
import { Alert, Button, CheckboxField, Field, Input, RadioGroup, RadioOption, Textarea, ValidationSummary } from '@gms/ui';
import { CheckCircle2, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { createOrgAction, lookupEinAction, type EinLookup } from '../actions';

const COUNTIES = ['Alder', 'Bramble', 'Cinder'];

type Path = 'ein' | 'sponsored' | 'other';

interface FormState {
  legalName: string;
  ein: string;
  orgType: 'nonprofit_501c3' | 'fiscally_sponsored' | 'nonprofit_other' | 'school' | 'government' | 'tribal';
  mission: string;
  budget: string;
  website: string;
  counties: string[];
  sponsorName: string;
  sponsorEin: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  county: string;
}

const EMPTY: FormState = {
  legalName: '',
  ein: '',
  orgType: 'nonprofit_501c3',
  mission: '',
  budget: '',
  website: '',
  counties: [],
  sponsorName: '',
  sponsorEin: '',
  line1: '',
  city: '',
  state: 'CA',
  postalCode: '',
  county: '',
};

export function OrgSetup({ next }: { next: string }) {
  const router = useRouter();
  const [path, setPath] = useState<Path>('ein');
  const [f, setF] = useState<FormState>(EMPTY);
  const [lookup, setLookup] = useState<EinLookup | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [looking, startLookup] = useTransition();
  const idem = useMemo(() => crypto.randomUUID(), []);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  function doLookup() {
    setErrors({});
    startLookup(async () => {
      const r = await lookupEinAction(f.ein);
      if (!r.ok) {
        setErrors({ ein: r.problem.errors?.[0]?.message ?? r.problem.detail });
        setLookup(null);
        return;
      }
      setLookup(r.data);
      if (r.data.record) {
        setF((s) => ({ ...s, ein: r.data.ein, legalName: s.legalName || titleCase(r.data.record!.name), city: s.city || titleCase(r.data.record!.city ?? ''), state: r.data.record!.state ?? s.state }));
      } else setF((s) => ({ ...s, ein: r.data.ein }));
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.legalName.trim()) errs.legalName = 'Enter your organization’s legal name.';
    if (path === 'sponsored') {
      if (!f.sponsorName.trim()) errs.sponsorName = 'Enter your fiscal sponsor’s legal name.';
      if (!/^\d{2}-?\d{7}$/.test(f.sponsorEin.trim())) errs.sponsorEin = 'Enter the sponsor’s 9-digit EIN, like 12-3456789.';
    }
    if (f.budget && parseMoneyToCents(f.budget) === null) errs.budget = 'Enter a dollar amount, like 480,000.';
    if (!f.line1.trim()) errs.line1 = 'Enter a street address.';
    if (!f.city.trim()) errs.city = 'Enter a city.';
    if (!f.postalCode.trim()) errs.postalCode = 'Enter a ZIP code.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    start(async () => {
      const r = await createOrgAction({
        idempotencyKey: idem,
        legalName: f.legalName,
        ein: path === 'ein' && f.ein ? f.ein : null,
        orgType: path === 'sponsored' ? 'fiscally_sponsored' : f.orgType,
        mission: f.mission || null,
        annualBudgetCents: f.budget ? parseMoneyToCents(f.budget) : null,
        website: f.website || null,
        counties: f.counties,
        fiscalSponsorName: path === 'sponsored' ? f.sponsorName : null,
        fiscalSponsorEin: path === 'sponsored' ? f.sponsorEin : null,
        address: { line1: f.line1, city: f.city, state: f.state, postalCode: f.postalCode, county: f.county || null },
      });
      if (!r.ok) {
        const map: Record<string, string> = {};
        for (const e of r.problem.errors ?? []) map[e.pointer.replace(/^\//, '').split('/')[0] ?? ''] = e.message;
        setErrors(map);
        setFormError(r.problem.detail);
        return;
      }
      router.push(next);
      router.refresh();
    });
  }

  const summary = Object.entries(errors).map(([k, message]) => ({ fieldId: `org-${k}`, message }));

  return (
    <form onSubmit={submit} className="grid gap-8" noValidate>
      {summary.length ? <ValidationSummary errors={summary} title="A few things need attention" /> : null}
      {formError && !summary.length ? <Alert variant="danger" title="We couldn’t save this">{formError}</Alert> : null}

      <fieldset className="grid gap-3">
        <legend className="mb-1 font-heading text-lg font-semibold">How is your organization set up?</legend>
        <RadioGroup value={path} onValueChange={(v) => setPath(v as Path)} className="grid gap-2">
          <RadioOption value="ein" id="path-ein" label="We have our own EIN (for example, a 501(c)(3) nonprofit)" />
          <RadioOption value="sponsored" id="path-sponsored" label="We’re a fiscally sponsored project" description="Another nonprofit holds your funds and files taxes for you." />
          <RadioOption value="other" id="path-other" label="Something else (school, government, tribe, or not yet registered)" />
        </RadioGroup>
      </fieldset>

      {path === 'ein' ? (
        <section className="grid gap-3" aria-labelledby="ein-h">
          <h2 id="ein-h" className="font-heading text-lg font-semibold">
            Look up your EIN
          </h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Employer Identification Number (EIN)" htmlFor="org-ein" error={errors.ein} description="9 digits, like 12-3456789." className="min-w-56 flex-1">
              <Input id="org-ein" inputMode="numeric" autoComplete="off" inputSize="lg" value={f.ein} onChange={(e) => set('ein', e.target.value)} />
            </Field>
            <Button type="button" size="lg" variant="secondary" onClick={doLookup} pending={looking} pendingLabel="Looking up…">
              <Search aria-hidden="true" /> Look up
            </Button>
          </div>
          <div aria-live="polite">
            {lookup?.status === 'found' ? (
              <Alert variant="success" title="We found your organization" icon={<CheckCircle2 aria-hidden="true" />}>
                {lookup.message}
              </Alert>
            ) : lookup?.status === 'warning' ? (
              <Alert variant="warning" title="Please double-check your IRS status">{lookup.message}</Alert>
            ) : lookup?.status === 'not_found' ? (
              <Alert variant="info" title="No match in the IRS list we use">{lookup.message}</Alert>
            ) : null}
            {lookup?.alreadyRegistered ? (
              <Alert variant="warning" title="This organization already has a GMS profile" className="mt-3">
                Ask the person who set it up to add you as a collaborator. You can also apply as an individual project.
              </Alert>
            ) : null}
          </div>
        </section>
      ) : null}

      {path === 'sponsored' ? (
        <section className="grid gap-4" aria-labelledby="sponsor-h">
          <h2 id="sponsor-h" className="font-heading text-lg font-semibold">
            Your fiscal sponsor
          </h2>
          <Field label="Fiscal sponsor’s legal name" htmlFor="org-sponsorName" error={errors.sponsorName} required>
            <Input id="org-sponsorName" inputSize="lg" value={f.sponsorName} onChange={(e) => set('sponsorName', e.target.value)} />
          </Field>
          <Field label="Fiscal sponsor’s EIN" htmlFor="org-sponsorEin" error={errors.sponsorEin} description="We use your sponsor’s EIN to confirm their tax-exempt status." required>
            <Input id="org-sponsorEin" inputMode="numeric" inputSize="lg" value={f.sponsorEin} onChange={(e) => set('sponsorEin', e.target.value)} />
          </Field>
        </section>
      ) : null}

      {path === 'other' ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 font-medium">Which best describes you?</legend>
          <RadioGroup value={f.orgType} onValueChange={(v) => set('orgType', v as FormState['orgType'])} className="grid gap-2">
            <RadioOption value="nonprofit_other" id="t-np" label="Nonprofit without 501(c)(3) status" />
            <RadioOption value="school" id="t-school" label="School or school district" />
            <RadioOption value="government" id="t-gov" label="Government agency" />
            <RadioOption value="tribal" id="t-tribal" label="Tribal government or organization" />
          </RadioGroup>
        </fieldset>
      ) : null}

      <section className="grid gap-4" aria-labelledby="about-h">
        <h2 id="about-h" className="font-heading text-lg font-semibold">
          About your organization
        </h2>
        <Field label={path === 'sponsored' ? 'Project or organization name' : 'Legal name'} htmlFor="org-legalName" error={errors.legalName} required>
          <Input id="org-legalName" inputSize="lg" autoComplete="organization" value={f.legalName} onChange={(e) => set('legalName', e.target.value)} />
        </Field>
        <Field label="Mission" htmlFor="org-mission" optional description="One or two sentences. You can change this later.">
          <Textarea id="org-mission" rows={3} value={f.mission} onChange={(e) => set('mission', e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Annual operating budget (USD)" htmlFor="org-budget" optional error={errors.budget}>
            <Input id="org-budget" inputMode="decimal" inputSize="lg" value={f.budget} onChange={(e) => set('budget', e.target.value)} />
          </Field>
          <Field label="Website" htmlFor="org-website" optional>
            <Input id="org-website" type="url" inputSize="lg" autoComplete="url" value={f.website} onChange={(e) => set('website', e.target.value)} />
          </Field>
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Counties you serve (optional)</legend>
          <div className="flex flex-wrap gap-4">
            {COUNTIES.map((c) => (
              <CheckboxField key={c} id={`county-${c}`} label={`${c} County`} size="lg" checked={f.counties.includes(c)} onCheckedChange={(on) => set('counties', on ? [...f.counties, c] : f.counties.filter((x) => x !== c))} />
            ))}
          </div>
        </fieldset>
      </section>

      <section className="grid gap-4" aria-labelledby="addr-h">
        <h2 id="addr-h" className="font-heading text-lg font-semibold">
          Mailing address
        </h2>
        <Field label="Street address" htmlFor="org-line1" error={errors.line1} required>
          <Input id="org-line1" inputSize="lg" autoComplete="address-line1" value={f.line1} onChange={(e) => set('line1', e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
          <Field label="City" htmlFor="org-city" error={errors.city} required>
            <Input id="org-city" inputSize="lg" autoComplete="address-level2" value={f.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="State" htmlFor="org-state" required>
            <Input id="org-state" inputSize="lg" autoComplete="address-level1" value={f.state} onChange={(e) => set('state', e.target.value)} />
          </Field>
          <Field label="ZIP code" htmlFor="org-postalCode" error={errors.postalCode} required>
            <Input id="org-postalCode" inputSize="lg" autoComplete="postal-code" value={f.postalCode} onChange={(e) => set('postalCode', e.target.value)} />
          </Field>
        </div>
        <Field label="County" htmlFor="org-county" optional>
          <Input id="org-county" inputSize="lg" value={f.county} onChange={(e) => set('county', e.target.value)} />
        </Field>
      </section>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" pending={pending} pendingLabel="Saving…">
          Save and continue
        </Button>
      </div>
    </form>
  );
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
