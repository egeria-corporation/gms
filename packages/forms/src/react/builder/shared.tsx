// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { Badge } from '@gms/ui';
import {
  Ban,
  Calendar,
  CircleDot,
  DollarSign,
  EyeOff,
  FileText,
  Grid3x3,
  Group,
  Hash,
  IdCard,
  Info,
  Link,
  ListChecks,
  Mail,
  MapPin,
  PenLine,
  Phone,
  Pilcrow,
  Signature,
  SquareCheck,
  Table,
  TextCursorInput,
  ToggleLeft,
  type LucideIcon,
  Paperclip,
  User,
  Workflow,
  ScanLine,
} from 'lucide-react';
import * as React from 'react';
import type { FieldType } from '../../model';
import type { AnyElement } from '../builder-ops';

export const FIELD_ICONS: Record<FieldType | 'info_block' | 'section', LucideIcon> = {
  text: TextCursorInput,
  long_text: Pilcrow,
  rich_text: PenLine,
  number: Hash,
  currency: DollarSign,
  date: Calendar,
  select: CircleDot,
  multi_select: ListChecks,
  checkbox_group: SquareCheck,
  yes_no: ToggleLeft,
  name: User,
  address: MapPin,
  email: Mail,
  phone: Phone,
  ein: IdCard,
  uei: ScanLine,
  file_upload: Paperclip,
  repeater_table: Table,
  likert_matrix: Grid3x3,
  attestation: Signature,
  info_block: FileText,
  section: Group,
};

export function ElementIcon({ type, className }: { type: AnyElement['type']; className?: string }) {
  const Icon = FIELD_ICONS[type] ?? Info;
  return <Icon className={className ?? 'size-4 shrink-0 text-muted-foreground'} aria-hidden="true" />;
}

/** Required / conditional / blind / mapped / logic / knock-out badges for a canvas card. */
export function ElementBadges({ element, mappingConflict }: { element: AnyElement; mappingConflict?: boolean }) {
  const out: React.ReactNode[] = [];
  if (element.type !== 'section' && element.type !== 'info_block') {
    if (element.required) out.push(<Badge key="req" variant="outline">Required</Badge>);
    else if (element.requiredWhen) out.push(<Badge key="reqw" variant="outline">Sometimes required</Badge>);
    if (element.blind)
      out.push(
        <Badge key="blind" variant="muted">
          <EyeOff aria-hidden="true" />
          Blind
        </Badge>,
      );
    if (element.cgMapping)
      out.push(
        <Badge key="cg" variant={mappingConflict ? 'warning' : 'info'} title={element.cgMapping}>
          <Link aria-hidden="true" />
          {mappingConflict ? 'Mapping conflict' : 'Mapped'}
        </Badge>,
      );
    if (element.eligibility)
      out.push(
        <Badge key="ko" variant="warning">
          <Ban aria-hidden="true" />
          Knock-out
        </Badge>,
      );
  }
  const hasLogic = 'visibleWhen' in element && element.visibleWhen ? true : 'enabledWhen' in element && element.enabledWhen ? true : false;
  if (hasLogic)
    out.push(
      <Badge key="logic" variant="progress">
        <Workflow aria-hidden="true" />
        Logic
      </Badge>,
    );
  return out.length ? <span className="flex flex-wrap gap-1">{out}</span> : null;
}

/** A polite live region for builder announcements ("Moved … to …"). */
export function useAnnouncer(): [React.ReactNode, (message: string) => void] {
  const [message, setMessage] = React.useState('');
  const announce = React.useCallback((m: string) => {
    // Clear first so the same message is announced twice in a row.
    setMessage('');
    globalThis.setTimeout(() => setMessage(m), 30);
  }, []);
  const region = (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
  return [region, announce];
}
