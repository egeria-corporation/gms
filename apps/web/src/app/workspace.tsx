// SPDX-License-Identifier: AGPL-3.0-only
// Workspace context: the workspace the URL names (`/w/:ws`), loaded through the API port.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation, useParams } from "react-router";
import { RefreshCw, TriangleExclamationPoint } from "lucide-react";
import { ApiError, type Workspace, type WorkspaceKind } from "../api/client.ts";
import { Busy, signInPath } from "../auth/RequireAuth.tsx";
import { NotFound } from "../components/NotFound.tsx";
import { useServices } from "./services.tsx";

export type { Workspace, WorkspaceKind };

const WorkspaceContext = createContext<Workspace | null>(null);

type Load =
  { status: "loading" } | { status: "ready"; workspace: Workspace } | { status: "missing" } | { status: "error"; message: string };

/** Provides the workspace named by the `:ws` route param. Assumes a signed-in person (RequireAuth). */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { ws = "" } = useParams();
  const { api, meState } = useServices();
  const location = useLocation();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoad({ status: "loading" });
    api.workspace(ws).then(
      (workspace) => live && setLoad({ status: "ready", workspace }),
      (error: unknown) => {
        if (!live) return;
        if (error instanceof ApiError && (error.status === 404 || error.status === 403)) setLoad({ status: "missing" });
        else setLoad({ status: "error", message: error instanceof Error ? error.message : "The workspace could not be loaded." });
      },
    );
    return () => {
      live = false;
    };
  }, [api, ws, attempt]);

  if (meState.status === "ready") {
    const membership = meState.me.workspaces.find((m) => m.handle === ws);
    if (membership?.requiresMfa && !meState.me.mfaVerified) {
      return <Navigate to={signInPath(location.pathname + location.search + location.hash, "mfa")} replace />;
    }
  }
  if (load.status === "loading" || meState.status === "loading") return <Busy />;
  if (load.status === "missing") return <NotFound />;
  if (load.status === "error") {
    return (
      <div className="gms gms-frame" style={{ alignItems: "center", justifyContent: "center" }}>
        <div className="empty" role="alert">
          <TriangleExclamationPoint className="ic" aria-hidden="true" />
          <h3>This workspace could not be loaded</h3>
          <p>{load.message}</p>
          <div className="acts">
            <button className="btn btn-primary" type="button" onClick={() => setAttempt((n) => n + 1)}>
              <RefreshCw className="ic" aria-hidden="true" />
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
  return <WorkspaceContext.Provider value={load.workspace}>{children}</WorkspaceContext.Provider>;
}

/** The current workspace. Shells render only under `/w/:ws`, behind the kind guards in App.tsx. */
export function useWorkspace(kind: WorkspaceKind): Workspace {
  const current = useContext(WorkspaceContext);
  if (!current || current.kind !== kind) throw new Error(`No ${kind} workspace in context`);
  return current;
}

export function useCurrentWorkspace(): Workspace | null {
  return useContext(WorkspaceContext);
}
