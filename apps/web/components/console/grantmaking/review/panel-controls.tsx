// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// R-04 panel controls: add a panel note for an application (review.panel_note) and manage panel sessions
// (review.save_panel: schedule, go live, close).
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  StatusChip,
  Textarea,
} from '@gms/ui';
import { CalendarPlus, MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { addPanelNoteAction, savePanelAction } from '@/app/console/(app)/review/actions';
import { useRunAction } from '../run-action';
import { PANEL_STATUS } from './meta';

export function PanelNoteForm({ stageId, applicationId, applicationLabel, panelId }: { stageId: string; applicationId: string; applicationLabel: string; panelId: string | null }) {
  const [body, setBody] = useState('');
  const [open, setOpen] = useState(false);
  const { run, pending } = useRunAction();
  const id = `note-${applicationId}`;
  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <MessageSquarePlus aria-hidden="true" />
        Add panel note
      </Button>
    );
  }
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        void run(() => addPanelNoteAction(stageId, applicationId, panelId, body.trim()), {
          success: 'Panel note added.',
          onDone: () => {
            setBody('');
            setOpen(false);
          },
        });
      }}
    >
      <Field label={`Panel note on ${applicationLabel}`} htmlFor={id} description="Visible to staff and cleared reviewers of this application.">
        <Textarea id={id} rows={3} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!body.trim()} pending={pending} pendingLabel="Adding…">
          Add note
        </Button>
      </div>
    </form>
  );
}

export interface PanelSession {
  id: string;
  name: string;
  status: string;
  meetsAtLabel: string | null;
  meetsAtInput: string;
}

export function PanelSessions({ stageId, panels, canEdit, timeZone }: { stageId: string; panels: PanelSession[]; canEdit: boolean; timeZone: string }) {
  const { run, pending } = useRunAction();
  const setStatus = (p: PanelSession, status: 'scheduled' | 'live' | 'closed') =>
    void run(() => savePanelAction({ panelId: p.id, stageId, name: p.name, meetsAt: p.meetsAtInput, status }), { success: status === 'live' ? `${p.name} is live.` : `${p.name} closed.` });
  return (
    <div className="grid gap-3">
      {panels.length ? (
        <ul className="grid gap-2">
          {panels.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.name}</span>
                <StatusChip meta={PANEL_STATUS[p.status] ?? { label: p.status, tone: 'neutral', icon: 'circle' }} size="sm" />
                {p.meetsAtLabel ? <span className="text-xs text-muted-foreground">{p.meetsAtLabel}</span> : null}
              </span>
              {canEdit ? (
                <span className="flex gap-1">
                  {p.status !== 'live' ? (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => setStatus(p, 'live')}>
                      Go live
                    </Button>
                  ) : null}
                  {p.status !== 'closed' ? (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => setStatus(p, 'closed')}>
                      Close
                    </Button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No panel sessions yet. Notes can still be added without one.</p>
      )}
      {canEdit ? <NewPanelDialog stageId={stageId} timeZone={timeZone} /> : null}
    </div>
  );
}

function NewPanelDialog({ stageId, timeZone }: { stageId: string; timeZone: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [meetsAt, setMeetsAt] = useState('');
  const { run, pending } = useRunAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="justify-self-start">
          <CalendarPlus aria-hidden="true" />
          Schedule a panel
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Schedule a review panel</DialogTitle>
          <DialogDescription>Notes added while a panel is live are linked to it.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void run(() => savePanelAction({ stageId, name: name.trim(), meetsAt, status: 'scheduled' }), {
              success: 'Panel scheduled.',
              onDone: () => {
                setOpen(false);
                setName('');
                setMeetsAt('');
              },
            });
          }}
        >
          <Field label="Panel name" htmlFor="panel-name" required>
            <Input id="panel-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Meets at" htmlFor="panel-meets" optional description={`Time zone: ${timeZone}`}>
            <Input id="panel-meets" type="datetime-local" value={meetsAt} onChange={(e) => setMeetsAt(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()} pending={pending} pendingLabel="Scheduling…">
              Schedule panel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
