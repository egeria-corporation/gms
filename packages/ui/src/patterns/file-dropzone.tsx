// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { CircleAlert, FileText, LoaderCircle, ShieldAlert, ShieldCheck, Upload, X, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { buttonVariants } from '../components/button';
import { useFieldControl } from '../components/field';
import { cn, formatBytes } from '../lib/utils';

export type FileScanStatus = 'uploading' | 'scanning' | 'clean' | 'infected' | 'error';

export interface DropzoneFile {
  id: string;
  name: string;
  size: number;
  /** Upload progress 0–1 while uploading. */
  progress?: number;
  status: FileScanStatus;
  /** Plain-language error for 'error' / 'infected'. */
  message?: string;
}

export interface RejectedFile {
  file: File;
  reason: 'type' | 'size' | 'count';
  message: string;
}

export interface FileDropzoneProps {
  /** Comma-separated accept list, e.g. ".pdf,.docx,image/*". */
  accept?: string;
  /** Human description of the allowed types, e.g. "PDF or Word". */
  acceptLabel?: string;
  /** Per-file limit in bytes. */
  maxSizeBytes?: number;
  maxFiles?: number;
  multiple?: boolean;
  disabled?: boolean;
  /** Files already added (with their upload/scan state). */
  files: DropzoneFile[];
  onFilesSelected: (accepted: File[], rejected: RejectedFile[]) => void;
  onRemove?: (id: string) => void;
  id?: string;
  name?: string;
  className?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  required?: boolean;
}

function matchesAccept(file: File, accept: string | undefined): boolean {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .some((a) => (a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : type === a));
}

const STATUS_VIEW: Record<FileScanStatus, { icon: LucideIcon; text: string; cls: string; spin?: boolean }> = {
  uploading: { icon: LoaderCircle, text: 'Uploading', cls: 'text-muted-foreground', spin: true },
  scanning: { icon: LoaderCircle, text: 'Checking for viruses', cls: 'text-status-progress-fg', spin: true },
  clean: { icon: ShieldCheck, text: 'Ready', cls: 'text-status-success-fg' },
  infected: { icon: ShieldAlert, text: 'Blocked: this file may be unsafe', cls: 'text-status-danger-fg' },
  error: { icon: CircleAlert, text: 'Upload failed', cls: 'text-status-danger-fg' },
};

/**
 * File upload with drag and drop and a regular "Choose files" button (the keyboard and screen
 * reader path). Shows allowed types and size up front, and each file's upload and virus-scan status.
 */
export function FileDropzone({
  accept,
  acceptLabel,
  maxSizeBytes,
  maxFiles,
  multiple = true,
  disabled = false,
  files,
  onFilesSelected,
  onRemove,
  className,
  ...rest
}: FileDropzoneProps) {
  const auto = React.useId();
  const wired = useFieldControl({ id: rest.id, 'aria-describedby': rest['aria-describedby'], 'aria-invalid': rest['aria-invalid'], required: rest.required });
  const inputId = wired.id ?? `dropzone-${auto}`;
  const hintId = `${inputId}-hint`;
  const [dragging, setDragging] = React.useState(false);

  const handle = (list: FileList | null) => {
    if (!list || disabled) return;
    const accepted: File[] = [];
    const rejected: RejectedFile[] = [];
    const room = maxFiles === undefined ? Infinity : Math.max(0, maxFiles - files.length);
    for (const f of Array.from(list)) {
      if (!matchesAccept(f, accept)) {
        rejected.push({ file: f, reason: 'type', message: `${f.name} isn't an allowed file type${acceptLabel ? ` (${acceptLabel})` : ''}.` });
      } else if (maxSizeBytes !== undefined && f.size > maxSizeBytes) {
        rejected.push({ file: f, reason: 'size', message: `${f.name} is ${formatBytes(f.size)}. The limit is ${formatBytes(maxSizeBytes)}.` });
      } else if (accepted.length >= room) {
        rejected.push({ file: f, reason: 'count', message: `${f.name} wasn't added. You can add up to ${maxFiles} files.` });
      } else {
        accepted.push(f);
      }
    }
    onFilesSelected(accepted, rejected);
  };

  const limits = [acceptLabel ?? accept, maxSizeBytes !== undefined ? `up to ${formatBytes(maxSizeBytes)} each` : null, maxFiles ? `${maxFiles} files max` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div data-slot="file-dropzone" className={cn('grid gap-3', className)}>
      <div
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handle(e.dataTransfer.files);
        }}
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-input bg-card px-4 py-6 text-center transition-colors duration-150',
          dragging && 'border-primary bg-accent',
          wired['aria-invalid'] && 'border-destructive',
          disabled && 'opacity-60',
        )}
      >
        <Upload className="size-6 text-muted-foreground" aria-hidden="true" />
        <input
          id={inputId}
          type="file"
          name={rest.name}
          className="peer sr-only"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          aria-describedby={[hintId, wired['aria-describedby']].filter(Boolean).join(' ')}
          aria-invalid={wired['aria-invalid']}
          required={wired.required && files.length === 0}
          onChange={(e) => {
            handle(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
        <label
          htmlFor={inputId}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'lg' }),
            'cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
            disabled && 'pointer-events-none',
          )}
        >
          {multiple ? 'Choose files' : 'Choose a file'}
        </label>
        <p className="text-sm text-muted-foreground">
          <span className="hidden sm:inline">or drag {multiple ? 'them' : 'it'} here</span>
        </p>
        <p id={hintId} className="text-xs text-muted-foreground">
          {limits}
        </p>
      </div>

      {files.length > 0 ? (
        <ul className="grid gap-2" aria-live="polite" aria-label="Added files">
          {files.map((f) => {
            const v = STATUS_VIEW[f.status];
            return (
              <li key={f.id} className="flex items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm">
                <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate font-medium">{f.name}</span>
                  <span className={cn('inline-flex items-center gap-1 text-xs', v.cls)}>
                    <v.icon className={cn('size-3.5', v.spin && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
                    {v.text}
                    {f.status === 'uploading' && f.progress !== undefined ? ` ${Math.round(f.progress * 100)}%` : ''}
                    <span className="text-muted-foreground tabular-nums"> · {formatBytes(f.size)}</span>
                  </span>
                  {f.message ? <span className="text-xs text-status-danger-fg">{f.message}</span> : null}
                </div>
                {onRemove ? (
                  <button
                    type="button"
                    onClick={() => onRemove(f.id)}
                    className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <X className="size-4" aria-hidden="true" />
                    <span className="sr-only">Remove {f.name}</span>
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
