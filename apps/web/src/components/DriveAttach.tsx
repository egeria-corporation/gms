// SPDX-License-Identifier: AGPL-3.0-only
// Google Drive for applicants (v1.12.0): "Attach from Google Drive" beside an upload control, and
// "Save the as-submitted copy to Drive" on a submitted application. The Picker asks Google for a
// short-lived `drive.file` token for the GMS's own Google project; the person picks one file, the
// GMS copies it through the workspace's Drive connection, and the copy goes through the very same
// upload as a file from the computer (same size and type checks). Nothing shows unless this server
// has Google Drive set up.
import { Suspense, useState } from "react";
import { CircleCheck, FolderUp, HardDriveDownload } from "lucide-react";
import { Link } from "react-router";
import { useConnectedAppsMutation } from "../api/connectedAppsHooks.ts";
import type { DriveSaveInput, DriveSaved } from "../api/connectedApps.ts";
import { useAppConfig } from "../api/launchHooks.ts";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { translator, useExtrasMessages } from "../i18n/index.tsx";
import { pickDriveFile, type PickedFile, type PickerConfig } from "../lib/googlePicker.ts";
import { MOCK_DRIVE_FILE_ID } from "../mocks/connectedApps.ts";

const t = translator("extras");

const pickerConfig = (): PickerConfig | null => (env.googlePickerApiKey && env.googleOAuthClientId ? { apiKey: env.googlePickerApiKey, clientId: env.googleOAuthClientId } : null);
/** In mock mode there is no Google: the "picked" file is the mock store's. */
const mockPick = async (): Promise<PickedFile> => ({ id: MOCK_DRIVE_FILE_ID, name: "Budget 2027.pdf" });

function useDriveOn(): boolean {
  const ws = useCurrentWorkspace();
  const available = useAppConfig().available?.googleDrive === true;
  return !!ws && ws.kind === "applicant" && available && (env.useMocks || !!pickerConfig());
}

/** What went wrong, and the way to Connected apps when Drive is not connected yet. */
function Problem({ error }: { error: unknown }) {
  const ws = useCurrentWorkspace();
  if (error === null) return null;
  const notConnected = (error as { errors?: { code?: string }[] } | null)?.errors?.some((x) => x.code === "drive_not_connected") === true;
  return (
    <span className="err-msg" role="alert">
      {error instanceof Error && error.message ? error.message : t("driveAttach.failed")}
      {notConnected && ws && (
        <>
          {" "}
          <Link to={`/w/${ws.handle}/settings/apps`}>{t("driveAttach.openConnectedApps")}</Link>
        </>
      )}
    </span>
  );
}

/**
 * "Attach from Google Drive": `onFile` is the same function the upload control calls with a file
 * from the computer. `pick` exists so tests can stand in for Google.
 */
type AttachProps = { onFile: (file: File) => unknown; pick?: (config: PickerConfig, title: string) => Promise<PickedFile | null>; disabled?: boolean };
export function DriveAttachButton(props: AttachProps) {
  // Its words load only where Drive is on, and wait here, never by suspending the screen (or a dialog) around it.
  return useDriveOn() ? (
    <Suspense fallback={null}>
      <DriveAttachOn {...props} />
    </Suspense>
  ) : null;
}
function DriveAttachOn({ onFile, pick, disabled }: AttachProps) {
  useExtrasMessages();
  const [done, setDone] = useState<string | null>(null);
  const copy = useConnectedAppsMutation(async (api) => {
    const config = pickerConfig();
    const picked = env.useMocks && !pick ? await mockPick() : config ? await (pick ?? pickDriveFile)(config, t("driveAttach.pickerTitle")) : null;
    if (!picked) return null;
    const file = await api.fetchDriveFile(picked.id);
    await onFile(file);
    return file.name;
  });
  return (
    <span className="col" style={{ gap: "4px", alignItems: "flex-start" }}>
      <button
        type="button"
        className="btn btn-sm btn-secondary"
        disabled={disabled || copy.state === "saving"}
        onClick={async () => {
          setDone(null);
          const name = await copy.run();
          if (name) setDone(name);
        }}
      >
        <FolderUp className="ic" aria-hidden="true" />
        {copy.state === "saving" ? t("driveAttach.copying") : t("driveAttach.attachFromDrive")}
      </button>
      <Problem error={copy.error} />
      {done && (
        <span className="small" role="status">
          <CircleCheck className="ic" aria-hidden="true" /> {t("driveAttach.copied", { name: done })}
        </span>
      )}
    </span>
  );
}

/** "Save the as-submitted copy to Google Drive": the PDF of what was submitted, created in My Drive. */
export function SaveToDriveButton(props: { kind: DriveSaveInput["kind"]; id: string }) {
  return useDriveOn() ? (
    <Suspense fallback={null}>
      <SaveToDriveOn {...props} />
    </Suspense>
  ) : null;
}
function SaveToDriveOn({ kind, id }: { kind: DriveSaveInput["kind"]; id: string }) {
  useExtrasMessages();
  const [saved, setSaved] = useState<DriveSaved | null>(null);
  const save = useConnectedAppsMutation((api) => api.saveToDrive({ kind, id }));
  return (
    <span className="col" style={{ gap: "4px", alignItems: "flex-start" }}>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        disabled={save.state === "saving"}
        onClick={async () => {
          setSaved(null);
          const out = await save.run();
          if (out) setSaved(out);
        }}
      >
        <HardDriveDownload className="ic" aria-hidden="true" />
        {save.state === "saving" ? t("driveAttach.saving") : t("driveAttach.saveToDrive")}
      </button>
      <Problem error={save.error} />
      {saved && (
        <span className="small" role="status">
          <CircleCheck className="ic" aria-hidden="true" /> {t("driveAttach.savedToDrive", { name: saved.fileName })}{" "}
          <a href={saved.url} target="_blank" rel="noopener noreferrer">
            {t("driveAttach.openInDrive")}
          </a>
        </span>
      )}
    </span>
  );
}
