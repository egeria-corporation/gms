// SPDX-License-Identifier: AGPL-3.0-only
// The interview and decision sections of an application's status.
import { Link } from "react-router";
import { useState } from "react";
import { Calendar, Check } from "lucide-react";
import type { ApplicationEvent, ApplicationStatusView } from "../../api/applicant.ts";
import { useLaunchMutation, useLaunchQuery } from "../../api/launchHooks.ts";
import { StatusBadge } from "../../components/status.tsx";
import { ErrorBanner } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";

const DECIDED = ["accepted", "declined", "waitlisted"];

const slotText = (v: unknown): string | null => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/**
 * Interview scheduling: the funder offers times, the applicant picks one and confirms it. Shown
 * while the application is at interview, or once times have been offered.
 */
export function InterviewSection({ status, funder }: { status: ApplicationStatusView; funder: string }) {
  const interview = useLaunchQuery((api) => api.interview(status.id, "applicant"), [status.id]);
  const confirm = useLaunchMutation((api, slot: string) => api.confirmInterview(status.id, slot));
  const [choice, setChoice] = useState<string | null>(null);
  const events = status.timeline.filter((e) => e.type === "interview" || e.toStatus === "interview");
  const last: ApplicationEvent | undefined = events[events.length - 1];
  const state = interview.data;
  const proposed = state?.proposed ?? null;
  const confirmed = state?.confirmed?.slot ?? null;
  if (!proposed && events.length === 0 && status.status !== "interview") return null;

  async function submit() {
    if (!choice) return;
    const next = await confirm.run(choice);
    if (next) interview.set(next);
  }

  return (
    <section className="card" aria-labelledby="int-h">
      <div className="card-h">
        <h2 id="int-h" style={{ fontSize: "18px" }}>
          Interview scheduling
        </h2>
        {confirmed ? (
          <span className="bdg bdg-ok">
            <Check className="ic" aria-hidden="true" />
            Time confirmed
          </span>
        ) : status.status === "interview" ? (
          <StatusBadge kind="application" status="interview" />
        ) : null}
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {interview.status === "error" && <ErrorBanner error={interview.error} onRetry={interview.reload} />}
        {proposed?.note ? <p>{proposed.note}</p> : last?.message ? <p>{last.message}</p> : <p>{funder} has invited you to an interview.</p>}
        {confirmed ? (
          <div className="card row" style={{ padding: "10px 12px", gap: "8px" }} role="status">
            <Calendar className="ic" aria-hidden="true" />
            <span className="b">{slotText(confirmed)}</span>
            <span className="small muted">· confirmed{state?.confirmed?.at ? ` ${formatDate(state.confirmed.at)}` : ""}</span>
          </div>
        ) : proposed && proposed.slots.length > 0 ? (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
            <legend className="lbl" style={{ marginBottom: "6px" }}>
              Choose one of the times {funder} offered
            </legend>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
              {proposed.slots.map((slot) => (
                <label key={slot} className="card row" style={{ padding: "10px 12px", gap: "8px", minHeight: "44px", cursor: "pointer", borderColor: choice === slot ? "var(--og-teal)" : undefined }}>
                  <input type="radio" name="interview-slot" value={slot} checked={choice === slot} onChange={() => setChoice(slot)} />
                  <span className="b">{slotText(slot)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="small muted">{funder} has not offered times here yet.</p>
        )}
        {proposed?.location ? <p className="small muted">{proposed.location}</p> : null}
        {confirm.error !== null && <ErrorBanner error={confirm.error} />}
        <div className="row wrap">
          {!confirmed && proposed && proposed.slots.length > 0 && (
            <button type="button" className="btn btn-primary" disabled={!choice || confirm.state === "saving"} onClick={submit}>
              Confirm this time
            </button>
          )}
          <a href="#msg-h" className="btn btn-secondary">
            {confirmed ? "Ask to change it in the thread" : "None of these work: reply in the thread"}
          </a>
        </div>
        <p className="help">{confirmed ? `${funder} has been told which time you chose.` : `${funder} sees your choice as soon as you confirm.`}</p>
      </div>
    </section>
  );
}

export function DecisionSection({ status, funder, base, awardId }: { status: ApplicationStatusView; funder: string; base: string; awardId?: string | null }) {
  const decided = DECIDED.includes(status.status);
  const event = [...status.timeline].reverse().find((e) => e.toStatus && DECIDED.includes(e.toStatus));
  return (
    <section className="card" aria-labelledby="dec-h">
      <div className="card-h">
        <h2 id="dec-h" style={{ fontSize: "18px" }}>
          Decision
        </h2>
        {decided ? <StatusBadge kind="application" status={status.status} /> : null}
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {!decided ? (
          <p className="muted">No decision yet. When {funder} decides, the outcome and its letter appear here and by email.</p>
        ) : (
          <>
            <p style={{ fontSize: "15px" }}>
              {funder} decided{event ? ` on ${formatDate(event.at)}` : ""}.{" "}
              {status.status === "accepted" ? "The award and its agreement are under My grants." : status.status === "waitlisted" ? "Your application is on the waitlist; you will be told if funding becomes available." : "The letter was sent to your team by email."}
            </p>
            {event?.message ? <p>{event.message}</p> : null}
            {status.status === "accepted" ? (
              <Link to={awardId ? `${base}/grants/${awardId}/offer` : `${base}/grants`} className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
                Open the award
              </Link>
            ) : (
              <Link to={`${base}/find`} className="small b">
                Find other funding
              </Link>
            )}
          </>
        )}
      </div>
    </section>
  );
}
