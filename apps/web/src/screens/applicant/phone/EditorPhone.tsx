// SPDX-License-Identifier: AGPL-3.0-only
// The application editor at phone width, as the 390px artboard draws it: the phone bar, a
// scrolling row of section pills, one section after another, and the validation and comments
// panel as a sheet above the bottom tabs. It is the same editor (../Editor.tsx) with the phone
// frame, so saving, merging and submitting behave identically.
import Editor from "../Editor.tsx";

export default function EditorPhone() {
  return <Editor phone />;
}
