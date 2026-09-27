// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import {
  Alert,
  Badge,
  BrandPattern,
  Button,
  contrastRatio,
  Field,
  FieldSet,
  Input,
  isHexColor,
  RadioGroup,
  RadioOption,
  resolveBrand,
  Section,
  SURFACES,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  type ContrastWarning,
} from '@gms/ui';
import { ArrowRight, ImageUp, RotateCcw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from 'react';
import { useUnsavedChangesWarning } from '@/components/console/admin/unsaved';
import { putToSignedUrl } from '@/components/upload';
import { previewEmailAction, requestBrandUploadAction, saveBrandAction, type BrandDraft } from './actions';

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/x-icon'];
const MAX_BYTES = 2 * 1024 * 1024;

type Errors = Partial<Record<keyof BrandDraft, string>>;

export interface FontOption {
  label: string;
  family: string;
  description: string;
}

function validate(d: BrandDraft): Errors {
  const e: Errors = {};
  if (!d.displayName.trim()) e.displayName = 'Enter the name applicants know you by.';
  if (!isHexColor(d.primaryColor) || d.primaryColor.length !== 7) e.primaryColor = 'Use a 6-digit color code like #1F4E79.';
  if (!isHexColor(d.accentColor) || d.accentColor.length !== 7) e.accentColor = 'Use a 6-digit color code like #C9822B.';
  if (d.emailReplyTo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.emailReplyTo.trim())) e.emailReplyTo = 'Enter an email address, like grants@example.org.';
  return e;
}

export function BrandEditor({
  saved: savedProp,
  initial,
  version: versionProp,
  readOnly,
  initialEmailHtml,
  logoUrl,
  forcedConflict,
  fonts,
  workspaceName,
}: {
  saved: BrandDraft;
  initial: BrandDraft;
  version: number;
  readOnly: boolean;
  initialEmailHtml: string;
  logoUrl: string | null;
  forcedConflict: boolean;
  fonts: FontOption[];
  workspaceName: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(savedProp);
  const [draft, setDraft] = useState(initial);
  const [version, setVersion] = useState(versionProp);
  const [conflict, setConflict] = useState(forcedConflict);
  const [latestVersion, setLatestVersion] = useState<number | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [emailHtml, setEmailHtml] = useState(initialEmailHtml);
  const [logoPreview, setLogoPreview] = useState<string | null>(logoUrl);
  const [uploading, setUploading] = useState<null | 'logo' | 'favicon'>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useUnsavedChangesWarning(dirty && !readOnly);

  const resolved = useMemo(() => resolveBrand({ primary: draft.primaryColor, accent: draft.accentColor, headingFont: draft.headingFont }), [draft.primaryColor, draft.accentColor, draft.headingFont]);

  // Re-render the sample email on the server when the parts it uses change (debounced; stale replies ignored).
  const seq = useRef(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(() => {
      if (!isHexColor(draft.primaryColor) || !isHexColor(draft.accentColor)) return;
      void previewEmailAction({ displayName: draft.displayName, primaryColor: draft.primaryColor, accentColor: draft.accentColor, headingFont: draft.headingFont, emailReplyTo: draft.emailReplyTo || null, hasLogo: Boolean(draft.logoPath) })
        .then((html) => {
          if (n === seq.current) setEmailHtml(html);
        })
        .catch(() => undefined);
    }, 500);
    return () => clearTimeout(t);
  }, [draft.displayName, draft.primaryColor, draft.accentColor, draft.headingFont, draft.emailReplyTo, draft.logoPath]);

  const set = <K extends keyof BrandDraft>(k: K, v: BrandDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const upload = async (kind: 'logo' | 'favicon', file: File | undefined) => {
    if (!file) return;
    if (!ACCEPT.includes(file.type)) {
      toast.error('Use a PNG, JPEG, WebP or ICO file. SVG isn’t accepted because it can contain scripts.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('That file is larger than 2 MB. Export a smaller version and try again.');
      return;
    }
    setUploading(kind);
    try {
      const r = await requestBrandUploadAction({ kind, contentType: file.type, sizeBytes: file.size });
      if (!r.ok) throw new Error(r.problem.detail);
      await putToSignedUrl({ uploadUrl: r.data.uploadUrl, method: r.data.method, headers: r.data.headers }, file);
      if (kind === 'logo') {
        set('logoPath', r.data.path);
        setLogoPreview(URL.createObjectURL(file));
      } else set('faviconPath', r.data.path);
      toast.success(`${kind === 'logo' ? 'Logo' : 'Favicon'} uploaded. Save branding to publish it.`);
    } catch (err) {
      toast.error((err as Error).message || 'The upload didn’t finish. Try again.');
    } finally {
      setUploading(null);
    }
  };

  const save = () => {
    const e = validate(draft);
    setErrors(e);
    setFormError(null);
    if (Object.keys(e).length) {
      setFormError('Fix the highlighted fields, then save again.');
      return;
    }
    start(async () => {
      const r = await saveBrandAction({ ...draft, primaryColor: draft.primaryColor.toUpperCase(), accentColor: draft.accentColor.toUpperCase() }, version);
      if (r.ok) {
        setVersion(r.data.version);
        setSaved(draft);
        setConflict(false);
        toast.success(r.data.warnings.length ? 'Branding saved. We adjusted some colors for readability (see below).' : 'Branding saved.');
        router.refresh();
      } else if (r.problem.code === 'precondition_failed') {
        setConflict(true);
        setLatestVersion(typeof r.problem.currentVersion === 'number' ? r.problem.currentVersion : null);
      } else {
        const fieldErrors: Errors = {};
        for (const issue of r.problem.errors ?? []) {
          const key = issue.pointer.replace(/^\//, '') as keyof BrandDraft;
          if (key in draft) fieldErrors[key] = issue.message;
        }
        setErrors(fieldErrors);
        setFormError(r.problem.detail);
      }
    });
  };

  const previewStyle = {
    ...resolved.tokens,
    '--background': SURFACES.light.background,
    '--foreground': SURFACES.light.foreground,
    '--card': SURFACES.light.card,
    '--card-foreground': SURFACES.light.foreground,
    '--muted': SURFACES.light.muted,
    '--muted-foreground': '#57534E',
    '--border': '#E7E5E4',
    '--input': '#D6D3D1',
    colorScheme: 'light',
  } as CSSProperties;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <form
        className="grid content-start gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        noValidate
        aria-describedby={readOnly ? 'brand-readonly' : undefined}
      >
        {readOnly ? (
          <Alert id="brand-readonly" variant="info" title="View only">
            Only owners and admins can change branding.
          </Alert>
        ) : null}
        {conflict ? (
          <Alert
            variant="warning"
            title="Someone else saved branding while you were editing"
            role="alert"
            actions={
              <>
                <Button type="button" size="sm" variant="secondary" onClick={() => window.location.reload()}>
                  <RotateCcw aria-hidden="true" /> Load their version
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={latestVersion === null}
                  onClick={() => {
                    // Keep my edits and adopt the newest version, so my next save knowingly replaces theirs.
                    if (latestVersion !== null) setVersion(latestVersion);
                    setConflict(false);
                  }}
                >
                  Keep my changes
                </Button>
              </>
            }
          >
            To avoid overwriting their changes, we didn’t save yours. Load their version, or keep your changes and save again.
          </Alert>
        ) : null}
        {formError ? (
          <Alert variant="danger" title="Not saved" role="alert">
            {formError}
          </Alert>
        ) : null}

        <Section title="Name & logo" level={2}>
          <Field label="Display name" htmlFor="brand-name" error={errors.displayName} description={`Shown on your public site, forms and emails. Your legal workspace name stays “${workspaceName}”.`} required>
            <Input id="brand-name" value={draft.displayName} disabled={readOnly} maxLength={120} onChange={(e) => set('displayName', e.target.value)} />
          </Field>
          <AssetField
            id="brand-logo"
            label="Logo"
            description="PNG, JPEG or WebP, up to 2 MB. A wide logo on a transparent background works best."
            previewUrl={logoPreview}
            hasAsset={Boolean(draft.logoPath)}
            uploading={uploading === 'logo'}
            disabled={readOnly}
            onFile={(f) => void upload('logo', f)}
            onRemove={() => {
              set('logoPath', null);
              setLogoPreview(null);
            }}
          />
          <AssetField
            id="brand-favicon"
            label="Favicon"
            description="Square PNG or ICO (at least 64×64). If you skip it, we use your logo."
            previewUrl={null}
            hasAsset={Boolean(draft.faviconPath)}
            uploading={uploading === 'favicon'}
            disabled={readOnly}
            onFile={(f) => void upload('favicon', f)}
            onRemove={() => set('faviconPath', null)}
          />
        </Section>

        <Section title="Colors" level={2} description="Buttons, links and highlights. We check every color against WCAG 2.2 AA and adjust it if text wouldn’t be readable.">
          <ColorField id="brand-primary" label="Primary color" description="Buttons and links." value={draft.primaryColor} error={errors.primaryColor} disabled={readOnly} onChange={(v) => set('primaryColor', v)} />
          <ColorField id="brand-accent" label="Accent color" description="Badges, highlights and patterns." value={draft.accentColor} error={errors.accentColor} disabled={readOnly} onChange={(v) => set('accentColor', v)} />
          <ContrastReport warnings={resolved.warnings} adjusted={resolved.adjusted} />
        </Section>

        <Section title="Heading font" level={2}>
          <FieldSet legend="Font for page titles and headings" description="Body text always uses Inter for readability.">
            <RadioGroup value={draft.headingFont} onValueChange={(v) => set('headingFont', v as BrandDraft['headingFont'])} disabled={readOnly} className="grid gap-2">
              {fonts.map((f) => (
                <RadioOption
                  key={f.label}
                  id={`font-${f.label.replace(/\s+/g, '-').toLowerCase()}`}
                  value={f.label}
                  label={<span style={{ fontFamily: f.family }} className="text-base font-semibold">{f.label}</span>}
                  description={f.description}
                />
              ))}
            </RadioGroup>
          </FieldSet>
        </Section>

        <Section title="Email sender" level={2} description="Emails come from your sending domain once it’s verified (Settings → Integrations).">
          <Field label="Sender name" htmlFor="brand-sender" description={`Defaults to “${draft.displayName || workspaceName}”.`}>
            <Input id="brand-sender" value={draft.emailSenderName} disabled={readOnly} maxLength={120} placeholder={draft.displayName} onChange={(e) => set('emailSenderName', e.target.value)} />
          </Field>
          <Field label="Reply-to address" htmlFor="brand-reply" error={errors.emailReplyTo} description="Where replies to GMS emails go. Leave blank to use your public contact email.">
            <Input id="brand-reply" type="email" autoComplete="email" value={draft.emailReplyTo} disabled={readOnly} onChange={(e) => set('emailReplyTo', e.target.value)} />
          </Field>
        </Section>

        {readOnly ? null : (
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 border-t bg-background/95 px-1 py-3 backdrop-blur">
            <span role="status" className="text-sm text-muted-foreground">
              {dirty ? (
                <Badge variant="warning">Unsaved changes</Badge>
              ) : (
                'All changes saved'
              )}
            </span>
            <div className="ml-auto flex gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={!dirty || pending}
                onClick={() => {
                  setDraft(saved);
                  setErrors({});
                  setFormError(null);
                  setLogoPreview(logoUrl);
                }}
              >
                Discard changes
              </Button>
              <Button type="submit" pending={pending} pendingLabel="Saving…" disabled={!dirty && !conflict}>
                Save branding
              </Button>
            </div>
          </div>
        )}
      </form>

      <section aria-labelledby="brand-preview-title" className="grid content-start gap-3 xl:sticky xl:top-4">
        <h2 id="brand-preview-title" className="font-heading text-lg font-semibold">
          Live preview
        </h2>
        <Tabs defaultValue="public">
          <TabsList variant="pill">
            <TabsTrigger value="public">Public page</TabsTrigger>
            <TabsTrigger value="form">Application form</TabsTrigger>
            <TabsTrigger value="email">Email</TabsTrigger>
            <TabsTrigger value="document">Award letter</TabsTrigger>
          </TabsList>
          <div style={previewStyle} className="overflow-hidden rounded-xl border bg-background text-foreground shadow-soft">
            <TabsContent value="public">
              <PublicPreview name={draft.displayName} logo={logoPreview} color={resolved.original.accent} />
            </TabsContent>
            <TabsContent value="form">
              <FormPreview name={draft.displayName} />
            </TabsContent>
            <TabsContent value="email" className="bg-muted">
              <iframe title="Sample email in your branding" sandbox="" srcDoc={emailHtml} className="h-[36rem] w-full border-0" />
            </TabsContent>
            <TabsContent value="document">
              <LetterPreview name={draft.displayName} logo={logoPreview} />
            </TabsContent>
          </div>
        </Tabs>
        <p className="text-xs text-muted-foreground">Previews use fictional applicants. The staff console keeps its own light and dark themes and only takes your accent and focus color.</p>
      </section>
    </div>
  );
}

function ColorField({ id, label, description, value, error, disabled, onChange }: { id: string; label: string; description: string; value: string; error?: string; disabled: boolean; onChange: (v: string) => void }) {
  const valid = isHexColor(value) && value.length === 7;
  return (
    <Field label={label} htmlFor={id} description={description} error={error}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={valid ? value.toLowerCase() : '#000000'}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-card p-1 disabled:cursor-not-allowed"
        />
        <Input id={id} value={value} disabled={disabled} maxLength={7} spellCheck={false} autoComplete="off" className="max-w-32 font-mono uppercase" onChange={(e) => onChange(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)} />
        {valid ? <span className="text-xs text-muted-foreground tabular-nums">{contrastRatio(value, '#FFFFFF').toFixed(2)}:1 on white</span> : null}
      </div>
    </Field>
  );
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block size-4 shrink-0 rounded-sm border align-middle" style={{ background: color }} />;
}

function ContrastReport({ warnings, adjusted }: { warnings: ContrastWarning[]; adjusted: { primary: string; accent: string } }) {
  if (!warnings.length) {
    return (
      <p className="text-sm text-status-success-fg" role="status">
        Both colors pass WCAG AA. Buttons use {adjusted.primary} with white text ({contrastRatio(adjusted.primary, '#FFFFFF').toFixed(1)}:1).
      </p>
    );
  }
  return (
    <Alert variant="warning" title="We adjusted your colors so text stays readable" role="status" data-testid="contrast-autofix">
      <ul className="grid gap-2">
        {warnings.map((w) => (
          <li key={`${w.field}-${w.code}`} className="grid gap-1">
            <span className="flex flex-wrap items-center gap-2 font-medium">
              <Swatch color={w.code === 'invalid-color' ? w.adjusted : w.original} /> {w.original}
              <ArrowRight aria-label="changed to" className="size-3.5" />
              <Swatch color={w.adjusted} /> {w.adjusted}
              {w.ratioBefore !== undefined && w.ratioAfter !== undefined ? (
                <span className="text-xs font-normal tabular-nums">
                  contrast {w.ratioBefore}:1 → {w.ratioAfter}:1 (needs 4.5:1)
                </span>
              ) : null}
            </span>
            <span>{w.message}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs">Your original colors are still used where no text sits on them, such as the header pattern and charts. Nothing is changed in the file you uploaded.</p>
    </Alert>
  );
}

function AssetField({ id, label, description, previewUrl, hasAsset, uploading, disabled, onFile, onRemove }: { id: string; label: string; description: string; previewUrl: string | null; hasAsset: boolean; uploading: boolean; disabled: boolean; onFile: (f: File | undefined) => void; onRemove: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Field label={label} htmlFor={id} description={description}>
      <div className="flex flex-wrap items-center gap-3">
        {previewUrl ? (
          <img src={previewUrl} alt={`Current ${label.toLowerCase()}`} className="h-12 max-w-40 rounded-md border bg-white object-contain p-1" />
        ) : hasAsset ? (
          <Badge variant="success">Uploaded</Badge>
        ) : (
          <span className="text-sm text-muted-foreground">None yet</span>
        )}
        <input ref={input} id={id} type="file" accept={ACCEPT.join(',')} className="sr-only" disabled={disabled || uploading} onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }} />
        <Button type="button" variant="outline" size="sm" pending={uploading} pendingLabel="Uploading…" disabled={disabled} onClick={() => input.current?.click()}>
          <ImageUp aria-hidden="true" /> {hasAsset ? 'Replace' : 'Upload'} {label.toLowerCase()}
        </Button>
        {hasAsset && !disabled ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            <Trash2 aria-hidden="true" /> Remove
          </Button>
        ) : null}
      </div>
    </Field>
  );
}

function PublicPreview({ name, logo, color }: { name: string; logo: string | null; color: string }) {
  return (
    <div aria-label="Public page preview" role="group">
      <div className="flex items-center justify-between gap-3 border-b bg-card px-5 py-3">
        <span className="flex items-center gap-2 font-heading font-semibold">
          {logo ? <img src={logo} alt="" className="h-8 max-w-28 object-contain" /> : null}
          {name || 'Your foundation'}
        </span>
        <span className="flex gap-4 text-sm">
          <span className="text-link underline">Opportunities</span>
          <span className="text-link underline">Awarded grants</span>
        </span>
      </div>
      <div className="relative overflow-hidden">
        <BrandPattern color={color} seed={name} className="absolute inset-0 opacity-25" />
        <div className="relative grid gap-3 px-5 py-8">
          <p className="text-sm font-medium text-muted-foreground">Funding for Alder, Bramble and Cinder counties</p>
          <p className="font-heading text-3xl font-semibold leading-tight">Grants that keep neighborhoods creative</p>
          <p className="max-w-prose text-sm">We fund community arts, youth programs and neighborhood groups. Apply online in about an hour.</p>
          <span className="inline-flex h-10 w-fit items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">See open opportunities</span>
        </div>
      </div>
      <div className="grid gap-3 border-t bg-card p-5">
        <div className="grid gap-2 rounded-lg border p-4">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-heading font-semibold">Youth Arts Fund 2027</span>
            <span className="rounded-md px-1.5 py-0.5 text-xs font-medium" style={{ background: 'var(--brand-accent)', color: 'var(--brand-accent-foreground)' }}>
              Open
            </span>
          </span>
          <span className="text-sm text-muted-foreground">Grants of $5,000–$25,000 for after-school arts. Closes December 5, 2026.</span>
          <span className="text-sm text-link underline">Read the guidelines</span>
        </div>
      </div>
    </div>
  );
}

function FormPreview({ name }: { name: string }) {
  return (
    <div className="grid gap-4 bg-card p-5" role="group" aria-label="Application form preview">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{name || 'Your foundation'} · Youth Arts Fund 2027</p>
      <p className="font-heading text-2xl font-semibold">About your project</p>
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((s) => (
          <span key={s} className={`h-1.5 flex-1 rounded-full ${s <= 2 ? 'bg-primary' : 'bg-muted'}`} />
        ))}
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Project title</span>
        <span className="h-11 rounded-md border bg-card px-3 py-2.5 text-sm">After-School Strings Program</span>
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">What will you do with this grant?</span>
        <span className="min-h-20 rounded-md border bg-card px-3 py-2 text-sm">Weekly string lessons for 40 students at two Bramble County middle schools, with a spring concert.</span>
        <span className="text-xs text-muted-foreground">24 of 250 words</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-link underline">Save and finish later</span>
        <span className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground">Continue</span>
      </div>
    </div>
  );
}

function LetterPreview({ name, logo }: { name: string; logo: string | null }) {
  return (
    <div className="bg-muted p-4" role="group" aria-label="Award letter preview">
      <div className="mx-auto grid max-w-xl gap-4 bg-card p-8 text-sm shadow-soft">
        <div className="flex items-center justify-between border-b-2 pb-3" style={{ borderColor: 'var(--primary)' }}>
          <span className="flex items-center gap-2 font-heading text-lg font-semibold" style={{ color: 'var(--primary)' }}>
            {logo ? <img src={logo} alt="" className="h-8 max-w-28 object-contain" /> : null}
            {name || 'Your foundation'}
          </span>
          <span className="text-xs text-muted-foreground">Award HRF-2027-014</span>
        </div>
        <p className="text-xs text-muted-foreground">October 12, 2026</p>
        <p>Dear Maya Chen,</p>
        <p>
          We are pleased to award <strong>Eastside Youth Music Collective</strong> a grant of <strong>$25,000.00</strong> for the After-School Strings Program, for the period January 1 – December 31, 2027.
        </p>
        <table className="w-full text-left text-xs">
          <thead style={{ background: 'var(--brand-50)' }}>
            <tr>
              <th scope="col" className="px-2 py-1.5">Payment</th>
              <th scope="col" className="px-2 py-1.5">Due</th>
              <th scope="col" className="px-2 py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr>
              <td className="px-2 py-1.5">1 of 2</td>
              <td className="px-2 py-1.5">January 15, 2027</td>
              <td className="px-2 py-1.5 text-right tabular-nums">$15,000.00</td>
            </tr>
            <tr>
              <td className="px-2 py-1.5">2 of 2</td>
              <td className="px-2 py-1.5">July 15, 2027, after the interim report</td>
              <td className="px-2 py-1.5 text-right tabular-nums">$10,000.00</td>
            </tr>
          </tbody>
        </table>
        <p>Please review and sign the grant agreement in your applicant portal.</p>
        <p>
          With appreciation,
          <br />
          <span className="font-heading font-semibold">Priya Natarajan</span>, Program Officer
        </p>
      </div>
    </div>
  );
}
