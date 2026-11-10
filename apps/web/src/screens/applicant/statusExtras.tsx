// SPDX-License-Identifier: AGPL-3.0-only
// The interview and decision sections of an application's status, read from its timeline.
import { Link } from "react-router";
import { Calendar } from "lucide-react";
import type { ApplicationEvent, ApplicationStatusView } from "../../api/applicant.ts";
import { StatusBadge } from "../../components/status.tsx";
import { formatDate } from "../../lib/format.ts";

const DECIDED = ["accepted", "declined", "waitlisted"];

const slotText = (v: unknown): string | null => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/** Shown while the application is at interview, or once one has been recorded. */
export function InterviewSection({ status, funder }: { status: ApplicationStatusView; funder: string }) {
  const events = status.timeline.filter((e) => e.type === "interview" || e.toStatus === "interview");
  if (events.length === 0 && status.status !== "interview") return null;
  const last: ApplicationEvent | undefined = events[events.length - 1];
  const payload = (last?.payload ?? {}) as { slot?: unknown; slots?: unknown; location?: unknown };
  const slots = (Array.isArray(payload.slots) ? payload.slots : payload.slot ? [payload.slot] : []).map(slotText).filter((s): s is string => !!s);
  return (
    <section className="card" aria-labelledby="int-h">
      <div className="card-h">
        <h2 id="int-h" style={{ fontSize: "18px" }}>
          Interview scheduling
        </h2>
        {status.status === "interview" ? <StatusBadge kind="application" status="interview" /> : null}
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {last?.message ? <p>{last.message}</p> : <p>{funder} has invited you to an interview.</p>}
        {slots.length > 0 ? (
          <ul style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
            {slots.map((s) => (
              <li key={s} className="card row" style={{ padding: "10px 12px", gap: "8px" }}>
                <Calendar className="ic" aria-hidden="true" />
                <span className="b">{s}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">{funder} has not proposed times here yet.</p>
        )}
        {typeof payload.location === "string" && payload.location ? <p className="small muted">{payload.location}</p> : null}
        <p className="help">Confirm a time, or ask for another, in the shared thread. {funder} sees your reply there.</p>
        <a href="#msg-h" className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
          Reply in the thread
        </a>
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
