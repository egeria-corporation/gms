// SPDX-License-Identifier: AGPL-3.0-only
// Google Workspace for a funder: connect and disconnect (Settings → Integrations), export a letter
// or agreement to a Drive folder the person picks, and directory suggestions when inviting.
// The GMS holds `drive.file` and directory read only; see docs/connectors.md.
import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router";
import { CircleCheck, FolderUp, Plug } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { DirectoryPerson, DriveExport, DriveExportKind } from "../../api/launch.ts";
import { useLaunchApi, useLaunchMutation } from "../../api/launchHooks.ts";
import { ErrorBanner, Notice } from "../../components/ui.tsx";
import { env } from "../../env.ts";
import { leaveTo } from "../../lib/browser.ts";
import { pickDriveFolder, type PickedFolder, type PickerConfig } from "../../lib/googlePicker.ts";

/** `/w/:handle/settings/connectors`: the API returns the person here; the integrations live under Agents & MCP. */
export function ConnectorReturn() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "../mcp", search, hash: "#integrations" }} relative="path" replace />;
}

/** The Google Workspace row of Settings → Integrations. */
export function GoogleWorkspaceCard() {
  const status = useApiQuery((api) => api.getConnector("google_workspace"), []);
  const connect = useApiMutation((api) => api.connectConnector("google_workspace"));
  const disconnect = useApiMutation((api) => api.disconnectConnector("google_workspace"));
  const c = status.data;
  const set = status.set;

  // Back from Google's sign-in: ask once whether the connection is now active.
  const location = useLocation();
  const returned = useRef(new URLSearchParams(location.search).get("connected") === "google_workspace");
  const run = connect.run;
  useEffect(() => {
    if (!returned.current) return;
    returned.current = false;
    void run().then((next) => next && set(next));
  }, [run, set]);

  const start = async () => {
    const next = await connect.run();
    if (!next) return;
    set(next);
    if (!next.connected && next.connectUrl) leaveTo(next.connectUrl);
  };
  if (!c) return status.status === "error" ? <ErrorBanner error={status.error} onRetry={status.reload} /> : null;
  const notConfigured = c.status === "not_configured" || (connect.error !== null && !c.connected && c.status !== "pending");
  const label = c.connected ? "Connected" : c.status === "pending" ? "Waiting for Google sign-in" : notConfigured ? "Not configured" : "Not connected";

  return (
    <div className="cmt">
      <div className="row wrap" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="b">Google Workspace</div>
          <div className="small muted">Export letters and agreements to a Drive folder you choose, and suggest teammates when inviting. The GMS can open only the folders you pick, and reads names and addresses from your directory.</div>
        </div>
        <span className={c.connected ? "bdg bdg-ok" : c.status === "pending" ? "bdg bdg-info" : "bdg bdg-neutral"}>
          <Plug className="ic" aria-hidden="true" />
          {label}
        </span>
      </div>
      {disconnect.error !== null && <ErrorBanner error={disconnect.error} />}
      {c.connected ? (
        <div className="row wrap">
          <span className="small muted">{c.scopes.length > 0 ? `Access: ${c.scopes.join(", ")}` : "Connected"}</span>
          <button type="button" className="btn btn-sm btn-danger" disabled={disconnect.state === "saving"} onClick={async () => (await disconnect.run()) && status.reload()}>
            Disconnect Google Workspace
          </button>
        </div>
      ) : notConfigured ? (
        <Notice tone="neu" title="Not configured on this installation">
          Google Workspace needs a Composio connection set up by whoever hosts this GMS. Everything else works without it.
        </Notice>
      ) : (
        <div className="row wrap">
          <button type="button" className="btn btn-sm btn-secondary" disabled={connect.state === "saving"} onClick={() => void start()}>
            {c.status === "pending" ? "Continue to Google sign-in" : "Connect Google Workspace"}
          </button>
          {c.status === "pending" && <span className="small muted">Sign-in was started but not finished. Nothing is connected until you finish it.</span>}
        </div>
      )}
    </div>
  );
}

const pickerConfig = (): PickerConfig | null => (env.googlePickerApiKey && env.googleOAuthClientId ? { apiKey: env.googlePickerApiKey, clientId: env.googleOAuthClientId } : null);

/**
 * "Export to Drive" on a letter or agreement. Shown only while Google Workspace is connected.
 * Google's scripts load when the button is pressed, never before. `pick` and `config` exist so
 * tests can stand in for Google.
 */
export function DriveExportButton({ kind, id, label, pick = pickDriveFolder, config = pickerConfig() }: { kind: DriveExportKind; id: string; label: string; pick?: (config: PickerConfig) => Promise<PickedFolder | null>; config?: PickerConfig | null }) {
  const connector = useApiQuery((api) => api.getConnector("google_workspace"), []);
  const [done, setDone] = useState<(DriveExport & { folder: string }) | null>(null);
  const [asked, setAsked] = useState(false);
  const send = useLaunchMutation(async (api) => {
    if (!config) return null;
    const folder = await pick(config);
    if (!folder) return null;
    const out = await api.exportToDrive(kind, id, folder.id);
    return { ...out, folder: folder.name };
  });
  if (!connector.data?.connected) return null;

  return (
    <div className="col" style={{ gap: "6px", alignItems: "flex-end" }}>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        aria-label={`Export ${label} to Drive`}
        disabled={send.state === "saving"}
        onClick={async () => {
          setAsked(true);
          setDone(null);
          const out = await send.run();
          if (out) setDone(out);
        }}
      >
        <FolderUp className="ic" aria-hidden="true" />
        Export to Drive
      </button>
      {asked && !config && (
        <span className="help" role="status">
          Export to Drive is not configured on this installation: the host has not set the Google Picker key and OAuth client id for the web app.
        </span>
      )}
      {send.error !== null && (
        <span className="err-msg" role="alert">
          {send.error instanceof Error ? send.error.message : "The file was not exported."}
        </span>
      )}
      {done && (
        <span className="notice" role="status">
          <CircleCheck className="ic" aria-hidden="true" />
          {done.fileName} saved to {done.folder}.{" "}
          {done.url && (
            <a href={done.url} target="_blank" rel="noopener noreferrer">
              Open in Drive
            </a>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * People from the funder's Google directory whose name or address matches what is typed in the
 * invite form. Choosing one fills the address; nobody is invited until the form is sent.
 */
export function DirectorySuggestions({ query, onChoose }: { query: string; onChoose: (person: DirectoryPerson) => void }) {
  const connector = useApiQuery((api) => api.getConnector("google_workspace"), []);
  const api = useLaunchApi();
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const connected = connector.data?.connected === true;
  const q = query.trim();
  useEffect(() => {
    if (!connected || q.length < 2) {
      setPeople([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      // A directory that cannot be read simply suggests nobody; the address can still be typed.
      api.directorySuggest(q).then(
        (found) => live && setPeople(found.filter((p) => p.email.toLowerCase() !== q.toLowerCase()).slice(0, 5)),
        () => live && setPeople([]),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, connected, q]);
  if (people.length === 0) return null;
  return (
    <div className="row wrap" role="group" aria-label="From your Google directory" style={{ flexBasis: "100%" }}>
      <span className="small muted">From your Google directory:</span>
      {people.map((p) => (
        <button key={p.email} type="button" className="btn btn-sm btn-ghost" onClick={() => onChoose(p)}>
          {p.name} · {p.email}
        </button>
      ))}
    </div>
  );
}
