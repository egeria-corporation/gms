// SPDX-License-Identifier: AGPL-3.0-only
// The one-time prompt for the opt-in Monday digests: "Get new matches every Monday" on the
// applicant's Find funding screen, "Get this week's activity every Monday" on the funder dashboard.
// Shown until the person turns the digest on or dismisses it (kept per person and workspace on the
// server), and never while the digest is already on or not offered to them.
import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import type { DigestKey } from "../api/digests.ts";
import { useDigestsApi, useDigestsQuery } from "../api/digestsHooks.ts";
import { ErrorBanner } from "./ui.tsx";

const COPY: Record<"new_matches" | "funder_activity", { title: string; detail: string }> = {
  new_matches: { title: "Get new matches every Monday", detail: "One email a week with up to 10 new opportunities that fit your organization, from OpenGrants and from funders here. Only when there is something new, and you can stop it from any email." },
  funder_activity: { title: "Get this week's activity every Monday", detail: "One email a week with counts of new applications, reviews due, payments due and reports overdue, with links. Never an applicant's answers, and you can stop it from any email." },
};

export function DigestPrompt({ workspaceId, digest, settingsTo }: { workspaceId: string; digest: "new_matches" | "funder_activity"; settingsTo: string }) {
  const api = useDigestsApi();
  // A prompt that cannot load stays hidden: it is an offer, never in the way.
  const query = useDigestsQuery((a) => a.settings(workspaceId).catch(() => null), [workspaceId]);
  const [hidden, setHidden] = useState(false);
  const [turnedOn, setTurnedOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const copy = COPY[digest];

  if (query.status !== "ready" || !query.data) return null;
  const choice = query.data.digests.find((d) => d.key === (digest as DigestKey));
  if (turnedOn) {
    return (
      <div className="bnr bnr-ok" role="status">
        <CalendarClock className="ic" aria-hidden="true" />
        <div className="grow">
          <div className="t">You will get it on Mondays</div>
          <div className="d">
            Change it any time in <Link to={settingsTo}>what we email you</Link>.
          </div>
        </div>
      </div>
    );
  }
  if (hidden || query.data.promptDismissed || !choice || choice.on) return null;

  const act = async (input: { on: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      query.set(await api.save(workspaceId, { ...(input.on ? { [digest]: true } : {}), promptDismissed: true }));
      if (input.on) setTurnedOn(true);
      else setHidden(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bnr bnr-info" role="region" aria-label={copy.title}>
      <CalendarClock className="ic" aria-hidden="true" />
      <div className="grow">
        <div className="t">{copy.title}</div>
        <div className="d">{copy.detail}</div>
        {error ? <ErrorBanner error={error} title="That did not work" /> : null}
      </div>
      <button type="button" className="btn btn-sm btn-secondary act" disabled={busy} onClick={() => void act({ on: true })}>
        Turn it on
      </button>
      <button type="button" className="btn btn-sm btn-ghost act" disabled={busy} onClick={() => void act({ on: false })}>
        Not now
      </button>
    </div>
  );
}
