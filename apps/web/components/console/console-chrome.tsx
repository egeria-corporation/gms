// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { relativeTime } from '@gms/domain';
import { Button, CommandPalette, Popover, PopoverContent, PopoverTrigger, type CommandPaletteGroup } from '@gms/ui';
import { Bell, Building2, FileText, Megaphone, Award } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { consoleSearch, markAllRead, recentNotifications, type SearchHit } from '@/app/console/(app)/chrome-actions';

const KIND_ICON = { application: <FileText aria-hidden />, organization: <Building2 aria-hidden />, opportunity: <Megaphone aria-hidden />, award: <Award aria-hidden /> };

export function ConsoleCommandPalette({ navGroups }: { navGroups: CommandPaletteGroup[] }) {
  const router = useRouter();
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onQueryChange = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      setHits(await consoleSearch(q));
      setLoading(false);
    }, 200);
  };
  const groups: CommandPaletteGroup[] = [
    ...(hits.length ? [{ heading: 'Results', items: hits.map((h) => ({ id: `${h.kind}-${h.id}`, label: h.label, hint: h.hint, href: h.href, icon: KIND_ICON[h.kind] })) }] : []),
    ...navGroups,
  ];
  return <CommandPalette groups={groups} onNavigate={(href) => router.push(href)} onQueryChange={onQueryChange} loading={loading} placeholder="Search applications, organizations, awards, or jump to a page…" />;
}

export function NotificationsButton({ unread }: { unread: number }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof recentNotifications>>>([]);
  const [count, setCount] = useState(unread);
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  useEffect(() => {
    if (open) void recentNotifications().then(setItems);
  }, [open]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={count ? `Notifications, ${count} unread` : 'Notifications'} className="relative">
          <Bell aria-hidden="true" />
          {count ? <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">{count > 9 ? '9+' : count}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Notifications</h2>
          {count ? (
            <Button
              variant="link"
              size="sm"
              onClick={() =>
                start(async () => {
                  await markAllRead();
                  setCount(0);
                  setItems((xs) => xs.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
                })
              }
            >
              Mark all read
            </Button>
          ) : null}
        </div>
        <ul className="max-h-96 overflow-y-auto">
          {items.length ? (
            items.map((n) => (
              <li key={n.id} className={`border-b px-3 py-2 text-sm last:border-0 ${n.read_at ? '' : 'bg-brand-50/60'}`}>
                {n.link ? (
                  <Link href={n.link} className="font-medium hover:underline" onClick={() => setOpen(false)}>
                    {n.title}
                  </Link>
                ) : (
                  <span className="font-medium">{n.title}</span>
                )}
                {n.body ? <p className="line-clamp-2 text-muted-foreground">{n.body}</p> : null}
                <p className="text-xs text-muted-foreground">{relativeTime(n.created_at)}</p>
              </li>
            ))
          ) : (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">You’re all caught up.</li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
