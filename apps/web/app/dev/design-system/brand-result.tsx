// SPDX-License-Identifier: AGPL-3.0-or-later
// Presentational view of a resolveBrand() result. Used by the server-rendered presets and the live playground.
import {
  Alert,
  Badge,
  Button,
  SCALE_STEPS,
  WHITE,
  contrastRatio,
  isHexColor,
  type ColorScale,
  type ResolvedBrand,
} from '@gms/ui';
import { ArrowRight } from 'lucide-react';
import type { CSSProperties } from 'react';

const fmt = (n: number) => `${n.toFixed(2)}:1`;

function Swatch({ hex, label }: { hex: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="size-6 shrink-0 rounded-md border"
        style={{ backgroundColor: hex }}
      />
      <span className="grid leading-tight">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <code className="text-xs">{hex}</code>
      </span>
    </span>
  );
}

function ColorChange({
  field,
  original,
  adjusted,
  ratioBefore,
  ratioAfter,
}: {
  field: string;
  original: string;
  adjusted: string;
  ratioBefore: number | null;
  ratioAfter: number;
}) {
  const changed = original !== adjusted;
  return (
    <div className="grid gap-1.5">
      <p className="text-sm font-medium">{field}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Swatch hex={original} label="Picked" />
        <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
        <Swatch hex={adjusted} label={changed ? 'Used for text fills' : 'Used as-is'} />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {ratioBefore !== null && changed ? (
          <>
            Contrast {fmt(ratioBefore)} →{' '}
            <span className="font-medium text-foreground">{fmt(ratioAfter)}</span> (AA needs 4.50:1)
          </>
        ) : (
          <>Contrast {fmt(ratioAfter)} (AA needs 4.50:1)</>
        )}
      </p>
    </div>
  );
}

function ScaleRow({ name, scale }: { name: string; scale: ColorScale }) {
  return (
    <div className="grid gap-1">
      <p className="text-xs font-medium text-muted-foreground">{name}</p>
      <ol className="grid grid-cols-11 overflow-hidden rounded-md border" aria-label={`${name} scale`}>
        {SCALE_STEPS.map((step) => (
          <li key={step} className="grid gap-0.5">
            <span aria-hidden="true" className="h-8" style={{ backgroundColor: scale[step] }} />
            <span className="px-0.5 pb-1 text-center text-[10px] leading-tight tabular-nums">
              {step}
              <span className="sr-only"> {scale[step]}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function BrandResult({
  resolved,
  sample = 'Youth Arts Fund 2027',
}: {
  resolved: ResolvedBrand;
  sample?: string;
}) {
  const primaryWarning = resolved.warnings.find((w) => w.field === 'primary' && w.code !== 'invalid-color');
  const accentWarning = resolved.warnings.find((w) => w.field === 'accent' && w.code !== 'invalid-color');
  const safe = (hex: string) => (isHexColor(hex) ? hex : WHITE);
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <ColorChange
          field="Primary"
          original={resolved.original.primary}
          adjusted={resolved.adjusted.primary}
          ratioBefore={primaryWarning?.ratioBefore ?? contrastRatio(safe(resolved.original.primary), WHITE)}
          ratioAfter={primaryWarning?.ratioAfter ?? contrastRatio(safe(resolved.adjusted.primary), WHITE)}
        />
        <ColorChange
          field="Accent"
          original={resolved.original.accent}
          adjusted={resolved.adjusted.accent}
          ratioBefore={accentWarning?.ratioBefore ?? null}
          ratioAfter={
            accentWarning?.ratioAfter ??
            contrastRatio(
              safe(resolved.tokens['--brand-accent-foreground'] ?? WHITE),
              safe(resolved.adjusted.accent),
            )
          }
        />
      </div>

      {resolved.warnings.length > 0 ? (
        <div className="grid gap-2">
          {resolved.warnings.map((w, i) => (
            <Alert
              key={`${w.code}-${i}`}
              variant="warning"
              title={w.code === 'invalid-color' ? 'Not a color code' : 'Adjusted for contrast'}
            >
              {w.message}
            </Alert>
          ))}
        </div>
      ) : (
        <Alert variant="success" title="No adjustments needed">
          Both colors meet WCAG AA as picked.
        </Alert>
      )}

      <div className="grid gap-2">
        <ScaleRow name="Brand" scale={resolved.scales.brand} />
        <ScaleRow name="Accent" scale={resolved.scales.accent} />
      </div>

      <div
        className="grid gap-3 rounded-lg border bg-background p-4 text-foreground"
        style={resolved.tokens as unknown as CSSProperties}
        aria-label="Branded sample"
        role="group"
      >
        <p className="font-heading text-lg font-semibold" style={{ fontFamily: resolved.headingFont.family }}>
          {sample}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">Start application</Button>
          <Button size="sm" variant="outline">
            Save draft
          </Button>
          <Badge variant="default">Open</Badge>
          <span className="rounded-md bg-brand-accent px-2 py-0.5 text-xs font-medium text-brand-accent-foreground">
            Featured
          </span>
          <a href="#ds-01" className="text-sm text-link underline underline-offset-4">
            Read the guidelines
          </a>
        </div>
        <p className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          Selected row fill uses the subtle brand tint.
        </p>
        <p className="text-xs text-muted-foreground">Heading font: {resolved.headingFont.label}</p>
      </div>
    </div>
  );
}
