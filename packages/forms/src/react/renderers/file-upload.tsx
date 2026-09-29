// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { type DropzoneFile, Field, FieldError, FileDropzone, type RejectedFile } from '@gms/ui';
import * as React from 'react';
import { fileRefs, type FileRef } from '../form-state';
import { fieldProps } from './basic';
import type { FieldRendererProps } from './types';

interface Uploading {
  tempId: string;
  name: string;
  size: number;
  status: 'uploading' | 'error';
  message?: string;
}

/** "PDF, XLSX or DOCX". */
export function acceptLabel(accept: readonly string[]): string | undefined {
  if (!accept.length) return undefined;
  const up = accept.map((a) => a.replace(/^\./, '').toUpperCase());
  if (up.length === 1) return up[0];
  return `${up.slice(0, -1).join(', ')} or ${up[up.length - 1]}`;
}

let tempCounter = 0;

export function FileUploadRenderer(p: FieldRendererProps) {
  const accept = p.meta.accept ?? [];
  const maxBytes = p.meta.maxBytes ?? (typeof p.options.maxBytes === 'number' ? p.options.maxBytes : undefined);
  const multiple = p.options.multiple === true || p.schema.type === 'array';
  const maxFiles = multiple ? p.schema.maxItems : 1;
  const current = fileRefs(p.value);
  const [uploading, setUploading] = React.useState<Uploading[]>([]);
  const [rejections, setRejections] = React.useState<string[]>([]);
  // Latest answer, so parallel uploads each add to what's there when they finish.
  const valueRef = React.useRef(current);
  valueRef.current = current;

  const commit = (refs: FileRef[]) => {
    if (multiple) p.onChange(refs.length ? refs : undefined);
    else p.onChange(refs[refs.length - 1]);
  };

  const onFilesSelected = (accepted: File[], rejected: RejectedFile[]) => {
    setRejections(rejected.map((r) => r.message));
    if (!p.ctx.onUpload) {
      if (accepted.length) setRejections((r) => [...r, "Uploading isn't available here yet. Please try again later."]);
      return;
    }
    const upload = p.ctx.onUpload;
    const list = multiple ? accepted : accepted.slice(0, 1);
    for (const file of list) {
      const tempId = `upload-${++tempCounter}`;
      setUploading((u) => [...u, { tempId, name: file.name, size: file.size, status: 'uploading' }]);
      upload(p.fieldId, file).then(
        (ref) => {
          setUploading((u) => u.filter((x) => x.tempId !== tempId));
          const next = multiple ? [...valueRef.current, ref] : [ref];
          valueRef.current = next;
          commit(next);
        },
        (err: unknown) => {
          const message = err instanceof Error && err.message ? err.message : 'The upload did not finish. Please try again.';
          setUploading((u) => u.map((x) => (x.tempId === tempId ? { ...x, status: 'error', message } : x)));
        },
      );
    }
  };

  const onRemove = (id: string) => {
    const temp = uploading.find((u) => u.tempId === id);
    if (temp) {
      setUploading((u) => u.filter((x) => x.tempId !== id));
      return;
    }
    const ref = current.find((f) => f.fileId === id);
    if (!ref) return;
    void p.ctx.onRemoveFile?.(p.fieldId, ref);
    commit(current.filter((f) => f.fileId !== id));
  };

  const files: DropzoneFile[] = [
    ...current.map((f) => ({ id: f.fileId, name: f.name, size: f.size ?? 0, status: p.ctx.fileStatus?.[f.fileId] ?? ('clean' as const) })),
    ...uploading.map((u) => ({ id: u.tempId, name: u.name, size: u.size, status: u.status, ...(u.message ? { message: u.message } : {}) })),
  ];
  const partErrors = p.errors.filter((e) => e.pointer !== `/${p.fieldId}`).map((e) => e.message);
  const locked = p.disabled || p.readOnly;
  const typeText = acceptLabel(accept) ? `${acceptLabel(accept)} files` : 'Any file type';

  return (
    <Field {...fieldProps(p)}>
      <FileDropzone
        accept={accept.length ? accept.map((a) => `.${a.replace(/^\./, '')}`).join(',') : undefined}
        acceptLabel={typeText}
        maxSizeBytes={maxBytes}
        maxFiles={maxFiles}
        multiple={multiple}
        disabled={locked || (!multiple && files.length > 0)}
        files={files}
        onFilesSelected={onFilesSelected}
        onRemove={locked ? undefined : onRemove}
      />
      {!multiple && files.length > 0 && !locked ? <p className="text-xs text-muted-foreground">To use a different file, remove this one first.</p> : null}
      {[...rejections, ...partErrors].map((m, i) => (
        <FieldError key={i}>{m}</FieldError>
      ))}
    </Field>
  );
}
