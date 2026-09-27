// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// FB-01…FB-08 host for the FormBuilder: saves the draft version (forms.save_draft with optimistic concurrency),
// publishes (save, then forms.publish), loads older versions for the compare view, and starts a new version.
import type { FormModel, FormTemplate, QuestionBankItem } from '@gms/forms';
import { FormBuilder, type FormVersionSummary } from '@gms/forms/react';
import { toast } from '@gms/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { loadVersionModelAction, newVersionAction, publishFormAction, saveDraftAction } from '@/app/console/(app)/forms/actions';
import { problemMessage } from '../run-action';

export interface FormBuilderHostProps {
  formId: string;
  versionId: string;
  initialModel: FormModel;
  lastModifiedAt: string;
  readOnly: boolean;
  /** Demo states: the model is never saved or published. */
  demo: boolean;
  versions: FormVersionSummary[];
  publishedModel?: FormModel;
  questionBank: QuestionBankItem[];
  templates: FormTemplate[];
  canEdit: boolean;
}

const CONFLICT = 'Someone else saved this form after you opened it. Reload the page to get their changes (copy anything you need first).';

export function FormBuilderHost(props: FormBuilderHostProps) {
  const router = useRouter();
  const [model, setModel] = useState<FormModel>(props.initialModel);
  const [savedModel, setSavedModel] = useState<FormModel>(props.initialModel);
  const [lastModifiedAt, setLastModifiedAt] = useState(props.lastModifiedAt);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(props.lastModifiedAt);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [conflict, setConflict] = useState(false);

  const save = async (m: FormModel): Promise<boolean> => {
    if (props.demo) {
      toast.info('This is a demo state. Nothing is saved.');
      return false;
    }
    if (conflict) {
      setSaveError(CONFLICT);
      return false;
    }
    setSaving(true);
    const r = await saveDraftAction(props.formId, { versionId: props.versionId, model: m, expectedLastModifiedAt: lastModifiedAt });
    setSaving(false);
    if (r.ok) {
      setLastModifiedAt(r.data.lastModifiedAt);
      setLastSavedAt(new Date().toISOString());
      setSavedModel(m);
      setSaveError(undefined);
      return true;
    }
    if (r.problem.code === 'precondition_failed') {
      setConflict(true);
      setSaveError(CONFLICT);
      toast.error(CONFLICT, { action: { label: 'Reload', onClick: () => window.location.reload() } });
    } else {
      setSaveError(problemMessage(r.problem));
      toast.error(problemMessage(r.problem));
    }
    return false;
  };

  const dirty = model !== savedModel;
  const editable = props.canEdit && !props.readOnly;

  return (
    <div className="grid gap-2">
      {editable && dirty && !props.demo ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Unsaved changes. Use Save draft (the builder does not save automatically).
        </p>
      ) : null}
      <FormBuilder
        model={model}
        onChange={setModel}
        readOnly={!editable}
        onSave={editable ? () => save(model).then(() => undefined) : undefined}
        saving={saving}
        lastSavedAt={lastSavedAt}
        saveError={saveError}
        questionBank={props.questionBank}
        templates={props.templates}
        versions={props.versions}
        currentVersionId={props.versionId}
        publishedModel={props.publishedModel}
        publishing={publishing}
        onLoadVersion={async (id) => {
          const r = await loadVersionModelAction(id);
          if (!r.ok) throw new Error(r.problem.detail);
          return r.data;
        }}
        onStartNewVersion={
          props.canEdit && !props.demo
            ? () => {
                void newVersionAction(props.formId).then((r) => {
                  if (r.ok) {
                    toast.success('Started a new draft version.');
                    router.refresh();
                  } else toast.error(problemMessage(r.problem));
                });
              }
            : undefined
        }
        onPublish={
          editable
            ? async ({ model: m, changeNote }) => {
                if (props.demo) {
                  toast.info('This is a demo state. Nothing is published.');
                  return;
                }
                setPublishing(true);
                const saved = await save(m);
                if (!saved) {
                  setPublishing(false);
                  return;
                }
                const r = await publishFormAction(props.formId, { versionId: props.versionId, changeNote });
                setPublishing(false);
                if (r.ok) {
                  const moved = r.data.migratedApplications;
                  toast.success(`Published version ${r.data.version}.`, {
                    description: `${r.data.notice}${moved ? ` ${moved} application${moved === 1 ? '' : 's'} in progress moved to this version.` : ''}`,
                    duration: 10000,
                  });
                  router.refresh();
                } else {
                  toast.error(problemMessage(r.problem));
                }
              }
            : undefined
        }
      />
    </div>
  );
}
