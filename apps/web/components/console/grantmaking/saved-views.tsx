// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// Saved views for a console table: apply a named set of URL filters, or save the current one (views.save).
import {
  Button,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Input,
  toast,
} from '@gms/ui';
import { Bookmark, BookmarkPlus, Users } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveViewAction } from './actions';

export interface SavedView {
  id: string;
  name: string;
  shared: boolean;
  mine: boolean;
  query: string;
}

export function SavedViewsMenu({ surface, views }: { surface: string; views: SavedView[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const current = sp.toString();
  const active = views.find((v) => v.query && v.query === current);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Bookmark aria-hidden="true" />
            {active ? active.name : 'Views'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => router.replace(pathname)}>All (no filters)</DropdownMenuItem>
          {views.map((v) => (
            <DropdownMenuItem key={v.id} onSelect={() => router.replace(v.query ? `${pathname}?${v.query}` : pathname)}>
              {v.shared ? <Users aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
              <span className="truncate">{v.name}</span>
              {v.shared && !v.mine ? <span className="ml-auto text-xs text-muted-foreground">Shared</span> : null}
            </DropdownMenuItem>
          ))}
          {views.length === 0 ? <p className="px-2 py-1.5 text-xs text-muted-foreground">No saved views yet.</p> : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            <BookmarkPlus aria-hidden="true" />
            Save current view…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>Saves the current filters, sort, columns and density so you can come back to them.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) {
                setError('Name the view.');
                return;
              }
              setError(null);
              start(async () => {
                const r = await saveViewAction({ surface, name: name.trim(), query: current, shared, path: pathname });
                if (r.ok) {
                  toast.success(`Saved “${name.trim()}”.`);
                  setOpen(false);
                  setName('');
                  router.refresh();
                } else setError(r.problem.detail);
              });
            }}
          >
            <Field label="Name" htmlFor="view-name" error={error ?? undefined} required>
              <Input id="view-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
            </Field>
            <CheckboxField label="Share with the team" description="Everyone on staff can use this view." checked={shared} onCheckedChange={(v) => setShared(v === true)} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" pending={pending} pendingLabel="Saving…">
                Save view
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
