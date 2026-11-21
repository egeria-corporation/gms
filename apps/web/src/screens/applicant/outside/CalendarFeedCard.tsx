// SPDX-License-Identifier: AGPL-3.0-only
// Workspace settings: a private calendar link (iCalendar feed) of the organization's deadlines.
// The address is shown once when it is made; getting a new one turns the old one off.
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { useOutsideMutation } from "../../../api/outsideHooks.ts";
import { useWorkspace } from "../../../app/workspace.tsx";
import { applicantAccess } from "../../../lib/roles.ts";
import { CopyButton } from "../../../components/CopyButton.tsx";
import { ErrorBanner, Notice } from "../../../components/ui.tsx";
import { t } from "../i18n.ts";

export function CalendarFeedCard() {
  const [url, setUrl] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const create = useOutsideMutation((api) => api.createCalendarFeed());
  const remove = useOutsideMutation(async (api) => {
    await api.deleteCalendarFeed();
    return true;
  });
  const canChange = applicantAccess(useWorkspace("applicant").member.role).draft;
  const busy = create.state === "saving" || remove.state === "saving";
  return (
    <section className="card" aria-labelledby="calfeed-h">
      <div className="card-h">
        <div className="row" style={{ gap: "8px" }}>
          <CalendarDays className="ic ic-md" aria-hidden="true" />
          <h2 id="calfeed-h" style={{ fontSize: "18px" }}>
            {t("outsideCalendarFeedCard.calendarFeed")}
          </h2>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "14px" }}>
        <p>{t("outsideCalendarFeedCard.aPrivateLinkYourCalendarApp")}</p>
        <p className="muted">{t("outsideCalendarFeedCard.eachEventShowsOnlyTheApplications")}</p>
        {url ? (
          <>
            <Notice tone="warn" title={t("outsideCalendarFeedCard.copyThisLinkNow")}>
              {t("outsideCalendarFeedCard.itIsShownOnlyOnceIf")}
            </Notice>
            <label className="lbl" htmlFor="calfeed-url">
              {t("outsideCalendarFeedCard.yourCalendarLink")}
            </label>
            <div className="row" style={{ gap: "8px" }}>
              <input id="calfeed-url" className="inp mono" readOnly value={url} onFocus={(e) => e.currentTarget.select()} style={{ fontSize: "12px" }} />
              <CopyButton value={url} what={t("outsideCalendarFeedCard.theCalendarLink")} className="btn btn-sm btn-secondary" />
            </div>
          </>
        ) : off ? (
          <Notice tone="neu" title={t("outsideCalendarFeedCard.theCalendarLinkIsOff")}>
            {t("outsideCalendarFeedCard.calendarsThatSubscribedToItStop")}
          </Notice>
        ) : (
          <p className="small muted">{t("outsideCalendarFeedCard.ifYouMadeALinkBefore")}</p>
        )}
        {!canChange && <p className="small muted">{t("access.cannotChangeCalendar")}</p>}
        {canChange && (
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
            {create.state === "saving" ? t("outsideCalendarFeedCard.makingTheLink") : url ? t("outsideCalendarFeedCard.getANewLink") : t("outsideCalendarFeedCard.getACalendarLink")}
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
            {t("outsideCalendarFeedCard.turnOffTheCalendarLink")}
          </button>
        </div>
        )}
        {create.error ? <ErrorBanner error={create.error} title={t("outsideCalendarFeedCard.theLinkWasNotMade")} /> : null}
        {remove.error ? <ErrorBanner error={remove.error} title={t("outsideCalendarFeedCard.theLinkWasNotTurnedOff")} /> : null}
      </div>
    </section>
  );
}
