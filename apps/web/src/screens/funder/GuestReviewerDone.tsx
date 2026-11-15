// SPDX-License-Identifier: AGPL-3.0-only
// The guest reviewer's done screen (C4), after their last assigned review is submitted
// (`/review/done?ws=<funder handle>`). It thanks them and, once, offers "Run a review panel for
// your own organization, free": the same workspace creation as funder setup, with their email
// domain as a suggestion only. Dismissible, never shown again after dismissal, and no email
// follows. Shown, clicked, dismissed and created are counted in the GMS's own events.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowRight, ClipboardCheck, PartyPopper, Users, X } from "lucide-react";
import type { GuestDone, PanelSuggestion } from "../../api/guestReview.ts";
import { useGuestMembership, useGuestReviewApi, useGuestReviewQuery } from "../../api/guestReviewHooks.ts";
import { useServices } from "../../app/services.tsx";
import { signInPath } from "../../auth/RequireAuth.tsx";
import { ErrorBanner, Field, Loading, problemFor } from "../../components/ui.tsx";
import { slugify } from "../../lib/format.ts";
import { GuestFrame, NotAGuest } from "./GuestReviewerWelcome.tsx";

export default function GuestReviewerDone() {
  const [params] = useSearchParams();
  const guest = useGuestMembership(params.get("ws"));
  const membership = guest.status === "ready" ? guest.membership : null;
  return (
    <GuestFrame title="Thank you" funder={membership?.name ?? null}>
      {guest.status === "loading" && <Loading label="Opening the reviewer portal" />}
      {guest.status === "ready" && !membership && <NotAGuest />}
      {membership && <Done workspaceId={membership.id} />}
    </GuestFrame>
  );
}

function Done({ workspaceId }: { workspaceId: string }) {
  const query = useGuestReviewQuery((api) => api.done(workspaceId), [workspaceId]);
  if (query.status === "loading") return <Loading label="Opening the reviewer portal" />;
  if (query.status === "error") return <ErrorBanner error={query.error} onRetry={query.reload} />;
  const d = query.data;
  if (!d.done)
    return (
      <section className="card" aria-labelledby="gd-title">
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <h1 id="gd-title" style={{ fontSize: "20px" }}>
            {d.open} {d.open === 1 ? "review is" : "reviews are"} still open
          </h1>
          <p className="muted">When every review assigned to you is submitted, this page says so.</p>
          <div>
            <Link to={`/review/assignments?ws=${encodeURIComponent(d.funder.handle)}`} className="btn btn-primary">
              <ClipboardCheck className="ic" aria-hidden="true" />
              Back to my assignments
            </Link>
          </div>
        </div>
      </section>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <section className="card" aria-labelledby="gd-title">
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <PartyPopper className="ic ic-lg" aria-hidden="true" />
          <h1 id="gd-title" style={{ fontSize: "22px" }}>
            Thank you. Your reviews are in.
          </h1>
          <p>
            You submitted {d.submitted} {d.submitted === 1 ? "review" : "reviews"} for {d.funder.name}. They have everything they need from you. You can still read your reviews in{" "}
            <Link to={`/review/assignments?ws=${encodeURIComponent(d.funder.handle)}`}>your assignments</Link>.
          </p>
        </div>
      </section>
      {d.offer.show && <PanelOffer workspaceId={workspaceId} done={d} />}
    </div>
  );
}

function PanelOffer({ workspaceId, done }: { workspaceId: string; done: GuestDone }) {
  const api = useGuestReviewApi();
  const [state, setState] = useState<"offer" | "form" | "dismissed">("offer");
  // Counted once, when it is first on screen (React runs effects twice in development).
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current) return;
    counted.current = true;
    void api.offer(workspaceId, "shown").catch(() => undefined);
  }, [api, workspaceId]);

  if (state === "dismissed")
    return (
      <p className="small muted" role="status">
        Got it. We won’t show this again.
      </p>
    );
  return (
    <section className="card" aria-labelledby="gd-offer">
      <div className="card-h" style={{ justifyContent: "space-between" }}>
        <h2 id="gd-offer" style={{ fontSize: "15px" }} className="row">
          <Users className="ic" aria-hidden="true" />
          Run a review panel for your own organization, free
        </h2>
        {state === "offer" && (
          <button
            type="button"
            className="iconbtn"
            aria-label="Dismiss"
            onClick={() => {
              setState("dismissed");
              void api.offer(workspaceId, "dismissed").catch(() => undefined);
            }}
          >
            <X className="ic ic-md" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {state === "offer" ? (
          <>
            <p>You just saw how {done.funder.name} runs its review. OpenGrants GMS gives any funder the same, free: application forms, reviewers, scoring, decisions and awards in one place.</p>
            <div className="row" style={{ gap: "8px" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setState("form");
                  void api.offer(workspaceId, "clicked").catch(() => undefined);
                }}
              >
                Set up my organization
                <ArrowRight className="ic" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setState("dismissed");
                  void api.offer(workspaceId, "dismissed").catch(() => undefined);
                }}
              >
                Not now
              </button>
            </div>
          </>
        ) : (
          <CreateFunder workspaceId={workspaceId} suggestion={done.offer.suggestion} />
        )}
      </div>
    </section>
  );
}

/** Funder setup's first step, here: name and handle, the domain's suggestion filled in for the person to change. */
function CreateFunder({ workspaceId, suggestion }: { workspaceId: string; suggestion: PanelSuggestion | null }) {
  const { api, meState, reloadMe } = useServices();
  const guestApi = useGuestReviewApi();
  const navigate = useNavigate();
  const [name, setName] = useState(suggestion?.name ?? "");
  const [handle, setHandle] = useState(suggestion?.handle ?? "");
  const [handleTouched, setHandleTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const handleValue = handleTouched ? handle : name === suggestion?.name ? (suggestion?.handle ?? "") : slugify(name).slice(0, 40);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const made = await api.createWorkspace({ kind: "funder", handle: handleValue, displayName: name.trim() });
      await guestApi.offer(workspaceId, "created", made.workspace.id).catch(() => undefined);
      reloadMe();
      const verified = meState.status === "ready" && meState.me.mfaVerified;
      // A funder admin needs the second step of sign-in; it comes back to the new workspace.
      navigate(verified ? `/w/${made.workspace.handle}` : signInPath(`/w/${made.workspace.handle}`, "mfa"));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "12px" }} aria-label="Set up your funder workspace">
      <Field id="gd-name" label="Organization name" required help={suggestion ? `Suggested from your email address (${suggestion.domain}). Change it to your organization’s name.` : "The name funders and applicants will see."} error={problemFor(error, "displayName")}>
        <input id="gd-name" className="inp" value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" />
      </Field>
      <Field id="gd-handle" label="Public handle" help={`Your public page will be at /f/${handleValue || "your-handle"}.`} error={problemFor(error, "handle")}>
        <input
          id="gd-handle"
          className="inp"
          value={handleValue}
          onChange={(e) => {
            setHandleTouched(true);
            setHandle(e.target.value.toLowerCase());
          }}
        />
      </Field>
      {error ? <ErrorBanner error={error} title="The workspace was not created" /> : null}
      <div className="row" style={{ gap: "8px" }}>
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || handleValue.length < 3}>
          {busy ? "Creating…" : "Create my funder workspace"}
        </button>
      </div>
      <p className="small muted">Free. You become its admin; nothing is emailed to you about it.</p>
    </form>
  );
}
