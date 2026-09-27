// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// Measures the live token colors (light or dark theme, whichever is active) and reports WCAG contrast.
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToneChip,
  contrastRatio,
  normalizeHex,
  oklchToHex,
} from '@gms/ui';
import { CircleCheck, CircleX, Loader } from 'lucide-react';
import * as React from 'react';

export interface ContrastPair {
  label: string;
  /** Token for the text or mark. */
  fg: string;
  /** Token for the surface behind it. */
  bg: string;
  /** 4.5 for text, 3 for non-text (borders, focus rings, chart marks). */
  min: 4.5 | 3;
}

const hex2 = (n: number) =>
  Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, '0');

/** Converts a computed CSS color (rgb(), color(srgb …) or oklch()) to #RRGGBB. Alpha is ignored. */
export function cssColorToHex(value: string): string | null {
  const v = value.trim();
  let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v);
  if (m) return normalizeHex(`#${hex2(Number(m[1]))}${hex2(Number(m[2]))}${hex2(Number(m[3]))}`);
  m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(v);
  if (m)
    return normalizeHex(`#${hex2(Number(m[1]) * 255)}${hex2(Number(m[2]) * 255)}${hex2(Number(m[3]) * 255)}`);
  m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+|none)/i.exec(v);
  if (m) {
    const l = Number(m[1]) / (m[2] ? 100 : 1);
    return oklchToHex({ mode: 'oklch', l, c: Number(m[3]), h: m[4] === 'none' ? 0 : Number(m[4]) });
  }
  return null;
}

type Measured = { fg: string | null; bg: string | null; ratio: number | null };

export function ContrastTable({ caption, pairs }: { caption: string; pairs: ContrastPair[] }) {
  const probe = React.useRef<HTMLSpanElement>(null);
  const [measured, setMeasured] = React.useState<Measured[] | null>(null);

  React.useEffect(() => {
    const el = probe.current;
    if (!el) return;
    const read = (token: string) => {
      el.style.color = `var(${token})`;
      return cssColorToHex(getComputedStyle(el).color);
    };
    const measure = () =>
      setMeasured(
        pairs.map((p) => {
          const fg = read(p.fg);
          const bg = read(p.bg);
          return { fg, bg, ratio: fg && bg ? contrastRatio(fg, bg) : null };
        }),
      );
    measure();
    // Re-measure when the console theme flips between light and dark.
    const obs = new MutationObserver(measure);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });
    return () => obs.disconnect();
  }, [pairs]);

  return (
    <div className="grid gap-2">
      <span ref={probe} aria-hidden="true" className="hidden" />
      <Table containerLabel={caption} containerClassName="rounded-lg border bg-card">
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Pair</TableHead>
            <TableHead scope="col">Sample</TableHead>
            <TableHead scope="col" className="text-right">
              Ratio
            </TableHead>
            <TableHead scope="col" className="text-right">
              Needs
            </TableHead>
            <TableHead scope="col">Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pairs.map((p, i) => {
            const m = measured?.[i];
            const pass = m?.ratio != null && m.ratio >= p.min;
            return (
              <TableRow key={`${p.fg}-${p.bg}`}>
                <TableCell>
                  <span className="font-medium">{p.label}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    {p.fg} on {p.bg}
                  </span>
                </TableCell>
                <TableCell>
                  <span
                    className="inline-flex items-center gap-2 rounded-md border px-2 py-1 text-sm font-medium"
                    style={{ color: `var(${p.fg})`, background: `var(${p.bg})` }}
                  >
                    <span
                      aria-hidden="true"
                      className="size-3 rounded-sm"
                      style={{ background: `var(${p.fg})` }}
                    />
                    Aa
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {m?.ratio != null ? `${m.ratio.toFixed(2)}:1` : '…'}
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.min.toFixed(1)}:1</TableCell>
                <TableCell>
                  {!measured ? (
                    <ToneChip tone="muted" icon={Loader} label="Measuring" size="sm" />
                  ) : pass ? (
                    <ToneChip tone="success" icon={CircleCheck} label="Passes AA" size="sm" />
                  ) : (
                    <ToneChip
                      tone="danger"
                      icon={CircleX}
                      label={m?.ratio == null ? 'Could not measure' : 'Fails AA'}
                      size="sm"
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Measured in your browser from the live CSS variables of the current theme.
      </p>
    </div>
  );
}
