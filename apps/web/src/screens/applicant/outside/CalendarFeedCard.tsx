// SPDX-License-Identifier: AGPL-3.0-only
// Workspace settings: a private calendar link (iCalendar feed) of the organization's deadlines.
// The address is shown once when it is made; getting a new one turns the old one off.
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { useOutsideMutation } from "../../../api/outsideHooks.ts";
import { CopyButton } from "../../../components/CopyButton.tsx";
import { ErrorBanner, Notice } from "../../../components/ui.tsx";

export function CalendarFeedCard() {
  const [url, setUrl] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const create = useOutsideMutation((api) => api.createCalendarFeed());
  const remove = useOutsideMutation(async (api) => {
    await api.deleteCalendarFeed();
    return true;
  });
  const busy = create.state === "saving" || remove.state === "saving";
  return (
    <section className="card" aria-labelledby="calfeed-h">
      <div className="card-h">
        <div className="row" style={{ gap: "8px" }}>
          <CalendarDays className="ic ic-md" aria-hidden="true" />
          <h2 id="calfeed-h" style={{ fontSize: "18px" }}>
            Calendar feed
          </h2>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "14px" }}>
        <p>A private link your calendar app can subscribe to. It lists your deadlines: the letter of inquiry, full application and internal deadlines of the applications you track here, and stage closing and report due dates on this GMS.</p>
        <p className="muted">Each event shows only the application’s title, the funder and the date; never answers or amounts. Anyone who has the link can see those events, so share it only with your team. Archived applications are left out.</p>
        {url ? (
          <>
            <Notice tone="warn" title="Copy this link now">
              It is shown only once. If you lose it, get a new link; the old one stops working.
            </Notice>
            <label className="lbl" htmlFor="calfeed-url">
              Your calendar link
            </label>
            <div className="row" style={{ gap: "8px" }}>
              <input id="calfeed-url" className="inp mono" readOnly value={url} onFocus={(e) => e.currentTarget.select()} style={{ fontSize: "12px" }} />
              <CopyButton value={url} what="the calendar link" className="btn btn-sm btn-secondary" />
            </div>
          </>
        ) : off ? (
          <Notice tone="neu" title="The calendar link is off">
            Calendars that subscribed to it stop showing your deadlines.
          </Notice>
        ) : (
          <p className="small muted">If you made a link before, getting a new one turns the old one off.</p>
        )}
        <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            className={url ? "btn btn-sm btn-secondary" : "btn btn-sm btn-primary"}
            disabled={busy}
            onClick={async () => {
              const r = await create.run();
              if (r) {
                setUrl(r.url);
                setOff(false);
              }
            }}
          >
            {create.state === "saving" ? "Making the link…" : url ? "Get a new link" : "Get a calendar link"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={async () => {
              if (await remove.run()) {
                setUrl(null);
                setOff(true);
              }
            }}
          >
            Turn off the calendar link
          </button>
        </div>
        {create.error ? <ErrorBanner error={create.error} title="The link was not made" /> : null}
        {remove.error ? <ErrorBanner error={remove.error} title="The link was not turned off" /> : null}
      </div>
    </section>
  );
}
