// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// Live branding engine: type or pick colors and see exactly what resolveBrand() does with them.
import {
  Field,
  HEADING_FONTS,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  isHexColor,
  normalizeHex,
  resolveBrand,
} from '@gms/ui';
import * as React from 'react';
import { BrandResult } from './brand-result';

function ColorField({
  label,
  value,
  onChange,
  description,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  description: string;
}) {
  const id = React.useId();
  const valid = isHexColor(value);
  // The native picker only takes #rrggbb; keep it on the last valid value while the text is mid-edit.
  const [pickerValue, setPickerValue] = React.useState(valid ? normalizeHex(value).toLowerCase() : '#000000');
  React.useEffect(() => {
    if (isHexColor(value)) setPickerValue(normalizeHex(value).toLowerCase());
  }, [value]);
  return (
    <Field
      label={label}
      htmlFor={`${id}-hex`}
      description={description}
      error={value && !valid ? 'Use a hex color code like #1F6F5C.' : undefined}
    >
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={pickerValue}
          onChange={(e) => onChange(e.currentTarget.value.toUpperCase())}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-card p-1"
        />
        <Input
          id={`${id}-hex`}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
        />
      </div>
    </Field>
  );
}

export function BrandPlayground() {
  const [primary, setPrimary] = React.useState('#F2D74B');
  const [accent, setAccent] = React.useState('#2B6CB0');
  const [font, setFont] = React.useState<string>('figtree');
  const resolved = React.useMemo(
    () => resolveBrand({ primary, accent, headingFont: font }),
    [primary, accent, font],
  );
  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
      <div className="grid content-start gap-4">
        <ColorField
          label="Primary color"
          value={primary}
          onChange={setPrimary}
          description="Buttons and links. White text must reach 4.5:1."
        />
        <ColorField
          label="Accent color"
          value={accent}
          onChange={setAccent}
          description="Highlights and badges."
        />
        <Field label="Heading font" htmlFor="playground-font">
          <Select value={font} onValueChange={setFont}>
            <SelectTrigger id="playground-font">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HEADING_FONTS.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div>
        <p className="sr-only" aria-live="polite">
          {resolved.warnings.length === 0
            ? 'No adjustments needed.'
            : `${resolved.warnings.length} ${resolved.warnings.length === 1 ? 'adjustment' : 'adjustments'}: ${resolved.warnings.map((w) => w.message).join(' ')}`}
        </p>
        <BrandResult resolved={resolved} />
      </div>
    </div>
  );
}
