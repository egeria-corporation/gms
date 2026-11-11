// SPDX-License-Identifier: AGPL-3.0-only
// Where the API sends the browser after a Passport sign-in: `/auth/passport#token_hash=…&type=…&next=…`.
// The one-time sign-in is in the fragment, so no server or log ever saw it. This page redeems it
// for a session, drops it from the address bar, and hands over to the sign-in page, which already
// knows what comes next (the second step when a workspace requires it, then the destination).
//
// It redeems only what this tab asked for: the fragment must carry the value the button stored
// before leaving for Passport. An address with someone else's sign-in, opened here, is refused,
// and a tab that is already signed in is never switched to another account.
import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { useServices } from "../../app/services.tsx";
import { endPassportHop, safeNext } from "../../lib/passportSignIn.ts";

export default function PassportReturn() {
  const { auth } = useServices();
  const navigate = useNavigate();
  const location = useLocation();
  const started = useRef(false);

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
          () => navigate(signin(next ? { next } : {}), { replace: true }),
          () => navigate(signin({ passport_error: "expired" }), { replace: true }),
        );
      });
  }, [auth, location.hash, navigate]);

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
