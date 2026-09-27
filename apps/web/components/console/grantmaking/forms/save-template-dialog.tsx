// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// FB-01 save a form version's structure as a reusable workspace template (forms.save_template).
import { Alert, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Textarea } from '@gms/ui';
import { LayoutTemplate } from 'lucide-react';
import { useState } from 'react';
import { saveTemplateAction } from '@/app/console/(app)/forms/actions';
import { problemMessage, useRunAction } from '../run-action';

export function SaveTemplateDialog({ versionId, formName, versionLabel }: { versionId: string; formName: string; versionLabel: string }) {
  const { run, pending } = useRunAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(formName);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <LayoutTemplate aria-hidden="true" /> Save as template
      </Button>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Save as a workspace template</DialogTitle>
          <DialogDescription>Saves the structure of {versionLabel} (as last saved) so your team can start new forms from it.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return setError('Name the template.');
            void run(() => saveTemplateAction({ versionId, name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) }), { success: `Saved the template “${name.trim()}”.` }).then((r) => {
              if (r.ok) setOpen(false);
              else setError(problemMessage(r.problem));
            });
          }}
        >
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <Field label="Template name" htmlFor="tpl-name" required>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </Field>
          <Field label="Description" htmlFor="tpl-desc" optional>
            <Textarea id="tpl-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Saving…">
              Save template
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
