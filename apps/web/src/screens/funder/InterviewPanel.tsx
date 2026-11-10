// SPDX-License-Identifier: AGPL-3.0-only
// Interview scheduling on the funder's application detail: offer up to ten times, see which one
// the applicant confirmed. The applicant picks on their status page.
import { useState } from "react";
import { Calendar, CalendarPlus, Check, Plus, X } from "lucide-react";
import { useLaunchMutation, useLaunchQuery } from "../../api/launchHooks.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { ErrorBanner, Field } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";

const slotText = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
          <h2 id="interview-title">Offer interview times</h2>
        </div>
        <div className="bd">
          {offer.error !== null && <ErrorBanner error={offer.error} />}
          <p>The applicant sees these on their status page and confirms one. Offering new times replaces any offered before.</p>
          {slots.map((value, i) => (
            <div className="row" key={i} style={{ alignItems: "flex-end" }}>
              <div className="grow">
                <Field id={`slot-${i}`} label={`Time ${i + 1}`}>
                  <input id={`slot-${i}`} className="inp" type="datetime-local" value={value} onChange={(e) => setSlots((all) => all.map((s, n) => (n === i ? e.target.value : s)))} />
                </Field>
              </div>
              {slots.length > 1 && (
                <button type="button" className="iconbtn" aria-label={`Remove time ${i + 1}`} onClick={() => setSlots((all) => all.filter((_, n) => n !== i))}>
                  <X className="ic" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          {slots.length < 10 && (
            <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setSlots((all) => [...all, ""])}>
              <Plus className="ic" aria-hidden="true" />
              Add another time
            </button>
          )}
          <Field id="interview-location" label="Where" help="A room, a phone number, or how the video link will arrive.">
            <input id="interview-location" className="inp" value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <Field id="interview-note" label="Note to the applicant">
            <textarea id="interview-note" className="ta" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={filled === 0 || offer.state === "saving"}>
            Offer {filled || ""} time{filled === 1 ? "" : "s"}
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
        <h3 id="funder-int-h">Interview</h3>
        {confirmed?.slot ? (
          <span className="bdg bdg-ok">
            <Check className="ic" aria-hidden="true" />
            Confirmed
          </span>
        ) : proposed ? (
          <span className="bdg bdg-info">
            <Calendar className="ic" aria-hidden="true" />
            Times offered
          </span>
        ) : null}
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {interview.status === "error" && <ErrorBanner error={interview.error} onRetry={interview.reload} />}
        {confirmed?.slot && (
          <p>
            <span className="b">{slotText(confirmed.slot)}</span> · confirmed by the applicant {formatDate(confirmed.at)}
          </p>
        )}
        {proposed && !confirmed?.slot && (
          <>
            <p className="small muted">Offered {formatDate(proposed.at)}. Waiting for the applicant to confirm one.</p>
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
        {!proposed && <p className="small muted">No interview times have been offered.</p>}
        {proposed?.location && <p className="small muted">{proposed.location}</p>}
        {canOffer && (
          <button type="button" className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start" }} onClick={() => setOffering(true)}>
            <CalendarPlus className="ic" aria-hidden="true" />
            {proposed ? "Offer different times" : "Offer interview times"}
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
