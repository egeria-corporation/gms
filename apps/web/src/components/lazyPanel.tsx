// SPDX-License-Identifier: AGPL-3.0-only
// A panel loaded when it is first shown, not with the screen around it: the v1.12.0 parts a screen
// shows only sometimes (Share this call on the Publish step, imported history, the award kit's
// extras, the organization profile panel, the Google Drive buttons). The screen draws without it
// for the moment the chunk takes to arrive; nothing it shows depends on the panel being there.
import { lazy, Suspense, type ComponentType, type JSX } from "react";

export function lazyPanel<P extends object>(load: () => Promise<ComponentType<P>>): (props: P) => JSX.Element {
  const Panel = lazy(async () => ({ default: await load() }));
  return function LazyPanel(props: P) {
    return (
      <Suspense fallback={null}>
        <Panel {...props} />
      </Suspense>
    );
  };
}
