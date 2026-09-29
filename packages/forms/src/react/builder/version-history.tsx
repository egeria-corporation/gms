// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { Alert, Button, cn, EmptyState, ToneChip } from '@gms/ui';
import { Archive, CircleCheck, PenLine, Plus } from 'lucide-react';
import * as React from 'react';
import type { FormModel } from '../../model';
import { FormDiffView } from './diff-view';

export type FormVersionStatus = 'draft' | 'published' | 'retired';

export interface FormVersionSummary {
  id: string;
  version: number;
  status: FormVersionStatus;
  publishedAt?: string | null;
  /** Display name of who published it. */
  publishedBy?: string | null;
  changeNote?: string | null;
  /** The version's builder model, when already loaded. Otherwise `onLoadVersion` is called. */
  model?: FormModel;
}

const STATUS = {
  draft: { tone: 'neutral', icon: PenLine, label: 'Draft' },
  published: { tone: 'success', icon: CircleCheck, label: 'Published' },
  retired: { tone: 'muted', icon: Archive, label: 'Retired' },
} as const;

export function VersionStatusChip({ status }: { status: FormVersionStatus }) {
  const s = STATUS[status];
  return <ToneChip tone={s.tone} icon={s.icon} label={s.label} size="sm" />;
}

function formatWhen(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export interface VersionHistoryProps {
  versions: readonly FormVersionSummary[];
  /** The model being edited ("current"). */
  currentModel: FormModel;
  /** The version being edited, to mark it in the list. */
  currentVersionId?: string;
  onLoadVersion?: (id: string) => Promise<FormModel>;
  onStartNewVersion?: () => void;
  readOnly?: boolean;
}

/** FB-08: every version with its status, who published it and why, and a compare view. */
export function VersionHistory({ versions, currentModel, currentVersionId, onLoadVersion, onStartNewVersion, readOnly }: VersionHistoryProps) {
  const [compare, setCompare] = React.useState<{ id: string; model?: FormModel; loading: boolean; error?: string } | null>(null);
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const hasDraft = versions.some((v) => v.status === 'draft');

  const startCompare = async (v: FormVersionSummary) => {
    if (v.model) {
      setCompare({ id: v.id, model: v.model, loading: false });
      return;
    }
    if (!onLoadVersion) {
      setCompare({ id: v.id, loading: false, error: 'This version’s questions aren’t available here.' });
      return;
    }
    setCompare({ id: v.id, loading: true });
    try {
      const model = await onLoadVersion(v.id);
      setCompare({ id: v.id, model, loading: false });
    } catch {
      setCompare({ id: v.id, loading: false, error: 'We couldn’t load that version. Try again.' });
    }
  };
  const comparing = compare ? versions.find((v) => v.id === compare.id) : undefined;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Applicants always fill in the published version. Edits happen in a draft until you publish it.</p>
        {onStartNewVersion && !readOnly ? (
          <Button type="button" variant="outline" onClick={onStartNewVersion} disabled={hasDraft} title={hasDraft ? 'A draft already exists. Publish or discard it first.' : undefined}>
            <Plus aria-hidden="true" />
            Start new version
          </Button>
        ) : null}
      </div>
      {sorted.length === 0 ? (
        <EmptyState title="No versions yet" description="Save this form to create its first draft." />
      ) : (
        <ol className="grid gap-2" aria-label="Versions, newest first">
          {sorted.map((v) => {
            const current = v.id === currentVersionId;
            return (
              <li key={v.id} className={cn('flex flex-wrap items-start gap-3 rounded-md border bg-card p-3', current && 'border-primary')}>
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Version {v.version}</span>
                    <VersionStatusChip status={v.status} />
                    {current ? <span className="text-xs text-muted-foreground">(editing)</span> : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {v.publishedAt ? `Published ${formatWhen(v.publishedAt)}${v.publishedBy ? ` by ${v.publishedBy}` : ''}` : 'Not published'}
                  </p>
                  {v.changeNote ? <p className="text-sm">{v.changeNote}</p> : null}
                </div>
                {!current ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => void startCompare(v)} aria-pressed={compare?.id === v.id}>
                    Compare with current<span className="sr-only">: version {v.version}</span>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {compare ? (
        <section aria-label="Comparison" className="grid gap-3 border-t pt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-heading text-base font-semibold">Version {comparing?.version} compared with the current draft</h3>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCompare(null)}>
              Close comparison
            </Button>
          </div>
          {compare.loading ? <p className="text-sm text-muted-foreground" role="status">Loading version {comparing?.version}…</p> : null}
          {compare.error ? (
            <Alert variant="danger" role="alert">
              {compare.error}
            </Alert>
          ) : null}
          {compare.model ? <FormDiffView before={compare.model} after={currentModel} beforeLabel={`version ${comparing?.version ?? ''}`} afterLabel="the current draft" /> : null}
        </section>
      ) : null}
    </div>
  );
}
