// SPDX-License-Identifier: AGPL-3.0-only
// Where the API sends the browser after a Passport sign-in: `/auth/passport#token_hash=…&type=…&next=…`.
// The one-time sign-in is in the fragment, so no server or log ever saw it. This page redeems it
// for a session, drops it from the address bar, and hands over to the sign-in page, which already
// knows what comes next (the second step when a workspace requires it, then the destination).
//
// Before handing over it presents the same one-time token to the API once more, so that Passport's
// authenticator counts as this session's second step (owner's decision, 2026-11-11), and waits for
// the app to re-read who is signed in. Without that wait the sign-in page would briefly see the
// session as single-step and start this app's own authenticator setup.
//
// It redeems only what this tab asked for: the fragment must carry the value the button stored
// before leaving for Passport. An address with someone else's sign-in, opened here, is refused,
// and a tab that is already signed in is never switched to another account.
import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { useServices } from "../../app/services.tsx";
import { endPassportHop, safeNext } from "../../lib/passportSignIn.ts";

/** How long to wait for the app to re-read the signed-in person after the second step was claimed. */
const HANDOVER_TIMEOUT_MS = 5000;

export default function PassportReturn() {
  const { auth, api, meState, reloadMe } = useServices();
  const navigate = useNavigate();
  const location = useLocation();
  const started = useRef(false);
  // Set once the second step was claimed: where to go when the app has re-read who is signed in.
  const [handover, setHandover] = useState<string | null>(null);
  const sawReload = useRef(false);

  useEffect(() => {
    if (!handover) return;
    if (meState.status === "loading") {
      sawReload.current = true;
      return;
    }
    if (sawReload.current) navigate(handover, { replace: true });
  }, [handover, meState.status, navigate]);

  // Never leave the person on a spinner: if the re-read does not come, go on and let the sign-in page decide.
  useEffect(() => {
    if (!handover) return;
    const t = setTimeout(() => navigate(handover, { replace: true }), HANDOVER_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [handover, navigate]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
    const tokenHash = fragment.get("token_hash");
    const type = fragment.get("type") ?? "magiclink";
    const next = safeNext(fragment.get("next"));
    const signin = (query: Record<string, string>) => `/signin${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ""}`;
    // Used up whatever happens, so a second address cannot ride on the same trip.
    const mine = endPassportHop(fragment.get("hop"));
    if (!tokenHash) {
      navigate(signin({ passport_error: "state_mismatch" }), { replace: true });
      return;
    }
    void auth
      .getSession()
      .catch(() => null)
      .then((session) => {
        // Already signed in: keep that account and just go on.
        if (session) return navigate(signin(next ? { next } : {}), { replace: true });
        if (!mine) return navigate(signin({ passport_error: "state_mismatch" }), { replace: true });
        return auth.redeemSignIn(tokenHash, type).then(
          async () => {
            const to = signin(next ? { next } : {});
            // A refusal or an outage here is not a failed sign-in: the app asks for its own second step.
            const claimed = await api.claimPassportSecondStep(tokenHash).catch(() => ({ verified: false }));
            if (!claimed.verified) return navigate(to, { replace: true });
            reloadMe();
            setHandover(to);
          },
          () => navigate(signin({ passport_error: "expired" }), { replace: true }),
        );
      });
  }, [auth, api, reloadMe, location.hash, navigate]);

  return (
    <>
      <title>{"Signing in — OpenGrants GMS"}</title>
      <div className="gms pub" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "var(--grad-hero)" }}>
        <main className="card" style={{ padding: "28px", display: "flex", alignItems: "center", gap: "12px" }} aria-busy="true">
          <LoaderCircle className="ic" aria-hidden="true" />
          <p role="status" style={{ margin: 0 }}>
            Signing you in with Passport…
          </p>
        </main>
      </div>
    </>
  );
}
