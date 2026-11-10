// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useServices } from "../app/services.tsx";

export function Busy() {
  return <div className="gms gms-frame" aria-busy="true" />;
}

/** Where to send someone who must sign in (or verify a second factor) before `next`. */
export function signInPath(next: string, step?: "mfa"): string {
  const q = new URLSearchParams({ next });
  if (step) q.set("step", step);
  return `/signin?${q.toString()}`;
}

/** Route guard: renders its children (or the nested route) only for a signed-in person. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { sessionState } = useServices();
  const location = useLocation();
  if (sessionState.status === "loading") return <Busy />;
  if (sessionState.status === "signedOut") return <Navigate to={signInPath(location.pathname + location.search + location.hash)} replace />;
  return children ?? <Outlet />;
}
