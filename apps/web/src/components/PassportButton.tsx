// SPDX-License-Identifier: AGPL-3.0-only
// "Continue with Passport": a real navigation to Passport (through the API's start route), with a
// busy state from the first click so the button never looks dead while the browser leaves.
import { useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router";
import { useServices } from "../app/services.tsx";
import { beginPassportHop, passportBrowser, passportSignInUrl } from "../lib/passportSignIn.ts";

export function PassportButton({ returnTo = null, className = "btn btn-cta btn-lg", children }: { returnTo?: string | null; className?: string; children?: ReactNode }) {
  const { mock } = useServices();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const go = () => {
    if (busy) return;
    // This tab's value for the trip; the return page redeems the sign-in only if it comes back.
    const hop = beginPassportHop();
    if (!hop) {
      // No session storage (blocked by the browser): the trip could not be finished safely.
      navigate("/signin?passport_error=state_mismatch", { replace: true });
      return;
    }
    setBusy(true);
    const url = passportSignInUrl(returnTo, mock, hop);
    if (mock) navigate(url);
    else passportBrowser.go(url);
  };
  return (
    <button type="button" className={className} onClick={go} disabled={busy} aria-busy={busy}>
      <ShieldCheck className="ic" aria-hidden="true" />
      {busy ? "Opening Passport…" : (children ?? "Continue with Passport")}
    </button>
  );
}
