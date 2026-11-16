// SPDX-License-Identifier: AGPL-3.0-only
// Interview scheduling on the funder's application detail: offer up to ten times, see which one
// the applicant confirmed. The applicant picks on their status page.
import { useState } from "react";
import { Calendar, CalendarPlus, Check, Plus, X } from "lucide-react";
import { useLaunchMutation, useLaunchQuery } from "../../api/launchHooks.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { ErrorBanner, Field } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { intlLocale } from "../../i18n/index.tsx";
import { t } from "./i18n.ts";

const slotText = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(intlLocale(), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

function OfferDialog({ applicationId, onClose, onDone }: { applicationId: string; onClose: () => void; onDone: () => void }) {
  const [slots, setSlots] = useState<string[]>(["", "", ""]);
  const [note, setNote] = useState("");
  const [location, setLocation] = useState("");
  const offer = useLaunchMutation((api) =>
    api.proposeInterview(applicationId, {
      slots: slots.filter(Boolean).map((s) => new Date(s).toISOString()),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(location.trim() ? { location: location.trim() } : {}),
    }),
  );
  const filled = slots.filter(Boolean).length;
  return (
    <Dialog open onClose={onClose} labelledBy="interview-title">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await offer.run()) onDone();
        }}
      >
        <div className="hd">
          <h2 id="interview-title">{t("interviewPanel.offerInterviewTimes")}</h2>
        </div>
        <div className="bd">
          {offer.error !== null && <ErrorBanner error={offer.error} />}
          <p>{t("interviewPanel.theApplicantSeesThese")}</p>
          {slots.map((value, i) => (
            <div className="row" key={i} style={{ alignItems: "flex-end" }}>
              <div className="grow">
                <Field id={`slot-${i}`} label={t("interviewPanel.time", { i: i + 1 })}>
                  <input id={`slot-${i}`} className="inp" type="datetime-local" value={value} onChange={(e) => setSlots((all) => all.map((s, n) => (n === i ? e.target.value : s)))} />
                </Field>
              </div>
              {slots.length > 1 && (
                <button type="button" className="iconbtn" aria-label={t("interviewPanel.removeTime", { i: i + 1 })} onClick={() => setSlots((all) => all.filter((_, n) => n !== i))}>
                  <X className="ic" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          {slots.length < 10 && (
            <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setSlots((all) => [...all, ""])}>
              <Plus className="ic" aria-hidden="true" />
              {t("interviewPanel.addAnotherTime")}
            </button>
          )}
          <Field id="interview-location" label={t("interviewPanel.where")} help={t("interviewPanel.aRoomAPhone")}>
            <input id="interview-location" className="inp" value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <Field id="interview-note" label={t("interviewPanel.noteToTheApplicant")}>
            <textarea id="interview-note" className="ta" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("interviewPanel.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={filled === 0 || offer.state === "saving"}>
            {t("interviewPanel.offerTime", { filled: filled || "" })}{filled === 1 ? "" : t("interviewPanel.s")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** The interview card in the application's rail. `canOffer` is false once the application is decided. */
export function InterviewCard({ applicationId, canOffer }: { applicationId: string; canOffer: boolean }) {
  const interview = useLaunchQuery((api) => api.interview(applicationId, "funder"), [applicationId]);
  const [offering, setOffering] = useState(false);
  const proposed = interview.data?.proposed ?? null;
  const confirmed = interview.data?.confirmed ?? null;
  if (!canOffer && !proposed) return null;
  return (
    <section className="card" aria-labelledby="funder-int-h">
      <div className="card-h">
        <h3 id="funder-int-h">{t("interviewPanel.interview")}</h3>
        {confirmed?.slot ? (
          <span className="bdg bdg-ok">
            <Check className="ic" aria-hidden="true" />
            {t("interviewPanel.confirmed")}
          </span>
        ) : proposed ? (
          <span className="bdg bdg-info">
            <Calendar className="ic" aria-hidden="true" />
            {t("interviewPanel.timesOffered")}
          </span>
        ) : null}
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {interview.status === "error" && <ErrorBanner error={interview.error} onRetry={interview.reload} />}
        {confirmed?.slot && (
          <p>
            {t.rich("interviewPanel.confirmedByTheApplicant", { slotText: slotText(confirmed.slot), date: formatDate(confirmed.at), span: (chunks) => <span className="b">{chunks}</span> })}
          </p>
        )}
        {proposed && !confirmed?.slot && (
          <>
            <p className="small muted">{t("interviewPanel.offeredWaitingForThe", { date: formatDate(proposed.at) })}</p>
            <ul className="col" style={{ gap: "4px" }}>
              {proposed.slots.map((s) => (
                <li key={s} className="row">
                  <Calendar className="ic" aria-hidden="true" />
                  {slotText(s)}
                </li>
              ))}
            </ul>
          </>
        )}
        {!proposed && <p className="small muted">{t("interviewPanel.noInterviewTimesHave")}</p>}
        {proposed?.location && <p className="small muted">{proposed.location}</p>}
        {canOffer && (
          <button type="button" className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start" }} onClick={() => setOffering(true)}>
            <CalendarPlus className="ic" aria-hidden="true" />
            {proposed ? t("interviewPanel.offerDifferentTimes") : t("interviewPanel.offerInterviewTimes")}
          </button>
        )}
      </div>
      {offering && (
        <OfferDialog
          applicationId={applicationId}
          onClose={() => setOffering(false)}
          onDone={() => {
            setOffering(false);
            interview.reload();
          }}
        />
      )}
    </section>
  );
}
