// SPDX-License-Identifier: AGPL-3.0-only
// The Google Picker, for choosing the Drive folder a letter or agreement is exported to. The GMS
// holds the `drive.file` scope only, which reaches nothing until the person picks it here.
//
// Nothing from Google is loaded until the person asks to export: the two scripts are added on the
// first call. The short-lived token requested here carries `drive.file` and nothing else, is used
// only to open the Picker, and is never stored or sent to the GMS. The GMS receives the folder id.

const GAPI_SRC = "https://apis.google.com/js/api.js";
const GSI_SRC = "https://accounts.google.com/gsi/client";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface PickerConfig {
  apiKey: string;
  clientId: string;
}
export interface PickedFolder {
  id: string;
  name: string;
}

/** Thrown when the scripts cannot load or Google refuses the token; the message is fit to show. */
export class PickerError extends Error {}

// The slices of Google's globals this file uses.
interface PickerDoc {
  id: string;
  name?: string;
}
interface PickerResult {
  action: string;
  docs?: PickerDoc[];
}
interface PickerView {
  setIncludeFolders(on: boolean): PickerView;
  setSelectFolderEnabled(on: boolean): PickerView;
  setMimeTypes(types: string): PickerView;
}
interface PickerBuilder {
  addView(view: PickerView): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(cb: (r: PickerResult) => void): PickerBuilder;
  build(): { setVisible(on: boolean): void };
}
interface GoogleGlobals {
  gapi?: { load(name: string, cb: () => void): void };
  google?: {
    accounts?: { oauth2?: { initTokenClient(o: { client_id: string; scope: string; callback: (r: { access_token?: string; error?: string }) => void; error_callback?: (e: { type?: string }) => void }): { requestAccessToken(): void } } };
    picker?: { DocsView: new (viewId?: unknown) => PickerView; PickerBuilder: new () => PickerBuilder; ViewId: { FOLDERS: unknown }; Action: { PICKED: string; CANCEL: string } };
  };
}

const loading = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = loading.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => {
        loading.delete(src);
        el.remove();
        reject(new PickerError("Google's file picker could not be loaded. Check your connection, or whether a browser extension blocks Google scripts."));
      };
      document.head.appendChild(el);
    });
    loading.set(src, p);
  }
  return p;
}

/** The Google Cloud project number is the part of an OAuth client id before the first hyphen. */
export function appIdOf(clientId: string): string {
  return clientId.split("-")[0] ?? "";
}

/**
 * Opens the Picker in folder mode. Resolves to the chosen folder, or null when the person closes
 * the Picker without choosing.
 */
export async function pickDriveFolder(config: PickerConfig): Promise<PickedFolder | null> {
  await Promise.all([loadScript(GAPI_SRC), loadScript(GSI_SRC)]);
  const g = window as unknown as GoogleGlobals;
  if (!g.gapi || !g.google?.accounts?.oauth2) throw new PickerError("Google's file picker did not start.");
  await new Promise<void>((resolve) => g.gapi!.load("picker", resolve));
  const picker = g.google.picker;
  if (!picker) throw new PickerError("Google's file picker did not start.");

  const token = await new Promise<string>((resolve, reject) => {
    g.google!.accounts!.oauth2!.initTokenClient({
      client_id: config.clientId,
      scope: DRIVE_FILE_SCOPE,
      callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new PickerError("Google did not grant access to choose a folder."))),
      error_callback: (e) => reject(new PickerError(e.type === "popup_closed" ? "The Google sign-in window was closed before a folder was chosen." : "The Google sign-in window could not open. Allow pop-ups for this site and try again.")),
    }).requestAccessToken();
  });

  return new Promise<PickedFolder | null>((resolve) => {
    const view = new picker.DocsView(picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME);
    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(config.apiKey)
      .setAppId(appIdOf(config.clientId))
      .setTitle("Choose a Drive folder")
      .setCallback((r) => {
        if (r.action === picker.Action.PICKED) {
          const doc = r.docs?.[0];
          resolve(doc ? { id: doc.id, name: doc.name ?? "the chosen folder" } : null);
        } else if (r.action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}
