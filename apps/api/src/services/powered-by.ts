// SPDX-License-Identifier: AGPL-3.0-only
// The funder's "Powered by OpenGrants Grant Management System" setting. Kept apart from the
// public-page services so any of them (public pages, the widget, letters) can read it without an
// import cycle.
import type { Row } from "./repos/types.ts";

/**
 * Whether the funder's public pages, widget and application receipt email carry "Powered by
 * OpenGrants Grant Management System". On unless an admin turned it off (`settings.poweredBy`).
 */
export const poweredByOf = (w: Pick<Row<"workspaces">, "settings">): boolean => (w.settings as { poweredBy?: unknown } | null)?.poweredBy !== false;
