// SPDX-License-Identifier: AGPL-3.0-only
// Month calendar of requirement due dates (design: Reporting & compliance). Each day with
// something due carries dots, a text label for assistive technology, and is a button that
// reports the day so the screen can filter its list. Colour is never the only signal: the
// legend names every dot and the accessible name lists what is due.
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface CalendarItem {
  id: string;
  /** ISO date or date-time. */
  date: string;
  label: string;
  tone: "overdue" | "due" | "scheduled" | "received";
}

const TONES: Record<CalendarItem["tone"], { color: string; label: string }> = {
  overdue: { color: "var(--s-dng-fg)", label: "Overdue" },
  due: { color: "var(--s-warn-fg)", label: "Due" },
  scheduled: { color: "var(--og-gray-600)", label: "Scheduled" },
  received: { color: "var(--og-teal)", label: "Received" },
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const monthName = (y: number, m: number) => new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function RequirementsCalendar({
  items,
  today = new Date(),
  selectedDay,
  onSelectDay,
  legend = Object.keys(TONES) as CalendarItem["tone"][],
  label = "due dates",
}: {
  items: CalendarItem[];
  today?: Date;
  selectedDay?: string | null;
  onSelectDay?: (day: string | null) => void;
  /** The tones the legend names (all by default). */
  legend?: CalendarItem["tone"][];
  /** What the grid shows, for its accessible name ("due dates", "deadlines"). */
  label?: string;
}) {
  // Opens on the current month, or on the month of the next thing due when this month is empty.
  const [cursor, setCursor] = useState(() => {
    const thisMonth = today.toISOString().slice(0, 7);
    const dates = items.map((i) => i.date.slice(0, 10)).sort();
    const first = dates.some((d) => d.startsWith(thisMonth)) ? null : (dates.find((d) => d >= today.toISOString().slice(0, 10)) ?? dates[0]);
    const at = first ? new Date(`${first}T00:00:00Z`) : today;
    return { y: at.getUTCFullYear(), m: at.getUTCMonth() };
  });
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const it of items) {
      const key = it.date.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), it]);
    }
    return map;
  }, [items]);
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
    const start = new Date(first);
    start.setUTCDate(1 - first.getUTCDay());
    const out: Array<{ date: Date; inMonth: boolean }> = [];
    for (let i = 0; i < 42; i++) {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + i);
      out.push({ date, inMonth: date.getUTCMonth() === cursor.m });
    }
    // Drop a trailing week that lies wholly in the next month.
    return out.slice(35).some((c) => c.inMonth) ? out : out.slice(0, 35);
  }, [cursor]);
  const move = (delta: number) => setCursor(({ y, m }) => ({ y: y + Math.floor((m + delta) / 12), m: (((m + delta) % 12) + 12) % 12 }));
  const title = monthName(cursor.y, cursor.m);
  const todayKey = dayKey(today);
  const inMonthCount = cells.filter((c) => c.inMonth).reduce((n, c) => n + (byDay.get(dayKey(c.date))?.length ?? 0), 0);

  return (
    <div className="card">
      <div className="card-h">
        <div className="row" style={{ gap: "8px" }}>
          <button type="button" className="iconbtn" style={{ width: "28px", height: "28px" }} aria-label="Previous month" onClick={() => move(-1)}>
            <ChevronLeft className="ic" aria-hidden="true" />
          </button>
          <h3 aria-live="polite">{title}</h3>
          <button type="button" className="iconbtn" style={{ width: "28px", height: "28px" }} aria-label="Next month" onClick={() => move(1)}>
            <ChevronRight className="ic" aria-hidden="true" />
          </button>
        </div>
        <span className="small muted">Today · {today.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span>
      </div>
      <div className="card-b" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div className="cal" role="group" aria-label={`${title} ${label}`}>
          {WEEKDAYS.map((w) => (
            <div key={w} className="wd" aria-hidden="true">
              {w}
            </div>
          ))}
          {cells.map(({ date, inMonth }) => {
            const key = dayKey(date);
            const due = byDay.get(key) ?? [];
            const cls = ["d", inMonth ? "" : "dim", key === todayKey ? "today" : ""].filter(Boolean).join(" ");
            const dayLabel = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
            if (!due.length) {
              return (
                <div key={key} className={cls}>
                  <span aria-hidden="true">{date.getUTCDate()}</span>
                  <span className="sr">{dayLabel}</span>
                </div>
              );
            }
            const worst = due.some((d) => d.tone === "overdue");
            const pressed = selectedDay === key;
            return (
              <button
                key={key}
                type="button"
                className={cls}
                style={{ opacity: 1, font: "inherit", textAlign: "left", cursor: "pointer", ...(worst ? { borderColor: "var(--s-dng-bd)" } : {}), ...(pressed ? { background: "var(--og-teal-soft)", borderColor: "var(--og-teal)" } : {}) }}
                aria-pressed={pressed}
                aria-label={`${dayLabel}: ${due.map((d) => `${d.label} (${TONES[d.tone].label.toLowerCase()})`).join("; ")}`}
                title={due.map((d) => `${d.label} · ${TONES[d.tone].label}`).join("\n")}
                onClick={() => onSelectDay?.(pressed ? null : key)}
              >
                {date.getUTCDate()}
                <span className="dots" aria-hidden="true">
                  {due.slice(0, 6).map((d) => (
                    <i key={d.id} style={{ background: TONES[d.tone].color }}></i>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <div className="row wrap small muted" style={{ gap: "12px" }}>
          {legend.map((t) => (
            <span key={t} className="row" style={{ gap: "5px" }}>
              <i aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: TONES[t].color, display: "inline-block" }}></i>
              {TONES[t].label}
            </span>
          ))}
        </div>
        {inMonthCount === 0 && <p className="small muted">Nothing due this month.</p>}
      </div>
    </div>
  );
}
