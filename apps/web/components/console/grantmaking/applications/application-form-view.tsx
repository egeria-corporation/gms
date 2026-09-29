// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// Read-only answers for staff: one GmsForm (review mode, staff density) per form of the stage. File answers
// link to the console attachment route, which re-checks access under RLS.
import type { CompiledForm } from '@gms/forms';
import { GmsForm } from '@gms/forms/react';
import type { FileScanStatus } from '@gms/ui';

export interface FormAnswers {
  formId: string;
  versionId: string;
  title: string;
  compiled: CompiledForm | null;
  data: Record<string, unknown>;
}

export function ApplicationFormView({ applicationId, forms, fileStatus }: { applicationId: string; forms: FormAnswers[]; fileStatus: Record<string, FileScanStatus> }) {
  return (
    <div className="grid gap-6">
      {forms.map((f, i) =>
        f.compiled ? (
          <section key={f.formId || i} aria-label={f.title} className="grid gap-2">
            {forms.length > 1 ? <h3 className="text-base font-semibold">{f.title}</h3> : null}
            <GmsForm
              compiled={f.compiled}
              data={f.data}
              mode="review"
              density="staff"
              headingLevel={3}
              idPrefix={`f${i}-`}
              fileStatus={fileStatus}
              fileHref={(file) => `/console/applications/${applicationId}/attachments/${encodeURIComponent(file.fileId)}`}
            />
          </section>
        ) : (
          <p key={f.formId || i} className="text-sm text-muted-foreground">
            The form “{f.title}” couldn’t be displayed (its saved version is invalid). Download the packet PDF to see the answers.
          </p>
        ),
      )}
    </div>
  );
}
