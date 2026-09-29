// SPDX-License-Identifier: AGPL-3.0-or-later
// DS-01 Tokens & theming.
import {
  AA_NON_TEXT,
  AA_TEXT,
  Badge,
  BrandPattern,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DESIGN_TOKENS,
  HEADING_FONTS,
  SCALE_STEPS,
  STATUS_TONES,
  Section,
  resolveBrand,
  type DesignTokenGroup,
  type ResolvedBrand,
} from '@gms/ui';
import type { Tenant } from '@/lib/tenant';
import { BrandPlayground } from './brand-playground';
import { BrandResult } from './brand-result';
import { ContrastTable, type ContrastPair } from './contrast-table';

const SCALE_TOKEN = /^--(brand|accent)-\d+$/;

function TokenGroup({ group }: { group: DesignTokenGroup }) {
  const tokens = group.tokens.filter((t) => !SCALE_TOKEN.test(t.name));
  const scales = group.tokens.some((t) => SCALE_TOKEN.test(t.name));
  const overridable =
    group.tenantOverridable === true
      ? 'Workspace brand'
      : group.tenantOverridable === 'console-subset'
        ? 'Console subset'
        : 'Fixed';
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h4" className="flex flex-wrap items-center gap-2">
          {group.label}
          <Badge variant={group.tenantOverridable === false ? 'outline' : 'info'}>{overridable}</Badge>
        </CardTitle>
        <CardDescription>{group.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {tokens.map((t) => (
            <li key={t.name} className="flex items-start gap-2.5">
              {t.name === '--font-heading' ? (
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-md border font-heading text-sm font-semibold"
                >
                  Aa
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className="size-8 shrink-0 rounded-md border"
                  style={{ background: `var(${t.name})` }}
                />
              )}
              <span className="grid min-w-0 gap-0.5">
                <code className="text-xs font-medium">{t.name}</code>
                <span className="text-xs text-muted-foreground">{t.purpose}</span>
                {t.utility ? <code className="text-[11px] text-muted-foreground">{t.utility}</code> : null}
              </span>
            </li>
          ))}
        </ul>
        {scales ? (
          <div className="grid gap-2">
            {(['brand', 'accent'] as const).map((s) => (
              <div key={s} className="grid gap-1">
                <p className="text-xs font-medium text-muted-foreground">
                  <code>--{s}-50</code> … <code>--{s}-950</code>
                </p>
                <ol
                  className="grid grid-cols-11 overflow-hidden rounded-md border"
                  aria-label={`${s} scale steps`}
                >
                  {SCALE_STEPS.map((step) => (
                    <li key={step} className="grid">
                      <span
                        aria-hidden="true"
                        className="h-7"
                        style={{ background: `var(--${s}-${step})` }}
                      />
                      <span className="pb-0.5 text-center text-[10px] tabular-nums">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

const CONTRAST_PAIRS: ContrastPair[] = [
  { label: 'Body text', fg: '--foreground', bg: '--background', min: AA_TEXT },
  { label: 'Secondary text', fg: '--muted-foreground', bg: '--background', min: AA_TEXT },
  { label: 'Secondary text on muted', fg: '--muted-foreground', bg: '--muted', min: AA_TEXT },
  { label: 'Text on cards', fg: '--card-foreground', bg: '--card', min: AA_TEXT },
  { label: 'Primary button', fg: '--primary-foreground', bg: '--primary', min: AA_TEXT },
  { label: 'Links', fg: '--link', bg: '--background', min: AA_TEXT },
  { label: 'Destructive button', fg: '--destructive-foreground', bg: '--destructive', min: AA_TEXT },
  { label: 'Control borders', fg: '--input', bg: '--background', min: AA_NON_TEXT },
  { label: 'Focus ring', fg: '--ring', bg: '--background', min: AA_NON_TEXT },
  ...[1, 2, 3, 4, 5].map((n) => ({
    label: `Chart series ${n}`,
    fg: `--chart-${n}`,
    bg: '--background',
    min: AA_NON_TEXT as 3,
  })),
];

const STATUS_PAIRS: ContrastPair[] = STATUS_TONES.map((tone) => ({
  label: tone[0]!.toUpperCase() + tone.slice(1),
  fg: `--status-${tone}-fg`,
  bg: `--status-${tone}-bg`,
  min: AA_TEXT as 4.5,
}));

const PRESETS: { name: string; note: string; input: Parameters<typeof resolveBrand>[0] }[] = [
  { name: 'No brand set', note: 'Neutral defaults used until a workspace picks colors.', input: {} },
  {
    name: 'Teal & gold',
    note: 'A typical foundation palette. Passes as picked.',
    input: { primary: '#1F6F5C', accent: '#E0A526', headingFont: 'source-serif-4' },
  },
  {
    name: 'Failing contrast',
    note: 'A light yellow primary can’t carry white text, so the engine darkens it for buttons and links.',
    input: { primary: '#F2D74B', accent: '#F7E9A0', headingFont: 'atkinson-hyperlegible' },
  },
  {
    name: 'Not a color',
    note: 'Free text is rejected and replaced with the neutral default.',
    input: { primary: 'teal', accent: '#B83280', headingFont: 'figtree' },
  },
];

function PresetCard({ name, note, resolved }: { name: string; note: string; resolved: ResolvedBrand }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h4">{name}</CardTitle>
        <CardDescription>{note}</CardDescription>
      </CardHeader>
      <CardContent>
        <BrandResult resolved={resolved} />
      </CardContent>
    </Card>
  );
}

export function TokensSection({ tenant }: { tenant: Tenant | null }) {
  return (
    <Section
      id="ds-01"
      title="DS-01 Tokens & theming"
      description="Design tokens, WCAG contrast, the branding engine, heading fonts and default imagery."
    >
      <Section
        level={3}
        title="Token groups"
        description={`${DESIGN_TOKENS.groups.reduce((n, g) => n + g.tokens.length, 0)} tokens. Swatches show the live value in the current theme.`}
      >
        <div className="grid gap-4">
          {DESIGN_TOKENS.groups.map((g) => (
            <TokenGroup key={g.id} group={g} />
          ))}
          <Card>
            <CardHeader>
              <CardTitle as="h4">Radius & motion</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 sm:grid-cols-2">
                {[...DESIGN_TOKENS.radius, ...DESIGN_TOKENS.motion].map((t) => (
                  <li key={t.name} className="grid gap-0.5">
                    <code className="text-xs font-medium">{t.name}</code>
                    <span className="text-xs text-muted-foreground">
                      {t.purpose}
                      {t.utility ? (
                        <>
                          {' '}
                          · <code>{t.utility}</code>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section
        level={3}
        title="Contrast: surfaces, brand and charts"
        description="Text needs 4.5:1; borders, focus rings and chart marks need 3:1."
      >
        <ContrastTable caption="Contrast of surface, brand and chart tokens" pairs={CONTRAST_PAIRS} />
      </Section>

      <Section
        level={3}
        title="Contrast: status tones"
        description="Status colors are fixed for every workspace and always paired with an icon and text."
      >
        <ContrastTable caption="Contrast of status tone text on status fill" pairs={STATUS_PAIRS} />
      </Section>

      <Section
        level={3}
        title="Branding engine presets"
        description="resolveBrand() output: what the workspace picked, what is used, the ratios before and after, and the plain-language warnings admins see."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          {tenant ? (
            <PresetCard
              name={`This workspace: ${tenant.brand.displayName}`}
              note="The live brand for this host."
              resolved={tenant.brand.resolved}
            />
          ) : null}
          {PRESETS.map((p) => (
            <PresetCard key={p.name} name={p.name} note={p.note} resolved={resolveBrand(p.input)} />
          ))}
        </div>
      </Section>

      <Section
        level={3}
        title="Brand playground"
        description="Runs the same engine in your browser as you type."
      >
        <Card>
          <CardContent className="py-5">
            <BrandPlayground />
          </CardContent>
        </Card>
      </Section>

      <Section
        level={3}
        title="Heading fonts"
        description="Curated, self-hosted fonts a workspace can choose for headings. Body text is always Inter."
      >
        <ul className="grid gap-3 sm:grid-cols-2">
          {HEADING_FONTS.map((f) => (
            <li key={f.id}>
              <Card className="h-full">
                <CardContent className="grid gap-1.5 py-4">
                  <p className="text-2xl leading-tight font-semibold" style={{ fontFamily: f.family }}>
                    Youth Arts Fund 2027
                  </p>
                  <p className="text-sm font-medium">
                    {f.label} <code className="text-xs text-muted-foreground">{f.id}</code>
                  </p>
                  <p className="text-sm text-muted-foreground">{f.description}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        level={3}
        title="Brand pattern"
        description="Default imagery: a deterministic geometric pattern from the brand color and a seed (decorative, hidden from screen readers)."
      >
        <ul className="grid gap-3 sm:grid-cols-3">
          {[
            { color: '#1F6F5C', seed: 'halcyon' },
            { color: '#5B3F9E', seed: 'larkspur' },
            { color: '#B4532A', seed: 'youth-arts-2027' },
          ].map((p) => (
            <li key={p.seed} className="grid gap-1.5">
              <BrandPattern
                color={p.color}
                seed={p.seed}
                rows={3}
                columns={6}
                className="aspect-[2/1] rounded-lg border"
              />
              <p className="text-xs text-muted-foreground">
                <code>{p.color}</code> · seed <code>{p.seed}</code>
              </p>
            </li>
          ))}
        </ul>
      </Section>
    </Section>
  );
}
