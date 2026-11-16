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

import { translator } from "../i18n/index.tsx";

const t = translator("shared");
const COPY: Record<"new_matches" | "funder_activity", { title: string; detail: string }> = {
  new_matches: {
    get title() {
      return t("digestPrompt.copy.new_matches.title");
    },
    get detail() {
      return t("digestPrompt.copy.new_matches.detail");
    },
  },
  funder_activity: {
    get title() {
      return t("digestPrompt.copy.funder_activity.title");
    },
    get detail() {
      return t("digestPrompt.copy.funder_activity.detail");
    },
  },
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
          <div className="t">{t("digestPrompt.youWillGetItOn")}</div>
          <div className="d">
            {t.rich("digestPrompt.changeItAnyTimeIn", { link: (chunks) => <Link to={settingsTo}>{chunks}</Link> })}
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
        {error ? <ErrorBanner error={error} title={t("digestPrompt.thatDidNotWork")} /> : null}
      </div>
      <button type="button" className="btn btn-sm btn-secondary act" disabled={busy} onClick={() => void act({ on: true })}>
        {t("digestPrompt.turnItOn")}
      </button>
      <button type="button" className="btn btn-sm btn-ghost act" disabled={busy} onClick={() => void act({ on: false })}>
        {t("digestPrompt.notNow")}
      </button>
    </div>
  );
}
