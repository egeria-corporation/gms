// SPDX-License-Identifier: AGPL-3.0-only
// /gms/connected-apps (v1.12.0, docs/connectors.md): Slack alerts, a person's Google Calendar and an
// applicant's Google Drive. Connecting Slack, Google Drive and Salesforce is `/gms/connectors/{provider}`
// (./admin.ts). The services hold the rules and the authorization; these handlers only parse.
// Everything that connects, posts, writes or copies is a signed-in person's (the services refuse
// agent and API-client tokens); agents may read the settings.
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { created, ok } from "../../lib/errors.ts";
import { parse } from "../../lib/input.ts";
import * as calendar from "../../services/calendar-sync.ts";
import * as alerts from "../../services/connector-alerts.ts";
import * as integrations from "../../services/integrations.ts";
import { jsonBody, svc } from "../http.ts";

export const connectedAppRoutes = new Hono<AppEnv>();

connectedAppRoutes.use("/connected-apps", authenticate());
connectedAppRoutes.use("/connected-apps/*", authenticate());

// ---- Slack alerts (workspace admins) ----
connectedAppRoutes.get("/connected-apps/slack", async (c) => c.json(ok(await alerts.getAlerts(await svc(c)))));
connectedAppRoutes.get("/connected-apps/slack/channels", async (c) => c.json(ok(await alerts.listSlackChannels(await svc(c)))));
connectedAppRoutes.put("/connected-apps/slack", async (c) => c.json(ok(await alerts.putAlerts(await svc(c), parse(alerts.alertsInput, await jsonBody(c))))));
connectedAppRoutes.delete("/connected-apps/slack", async (c) => c.json(ok(await alerts.deleteAlerts(await svc(c)))));

// ---- Google Calendar (each person their own) ----
connectedAppRoutes.get("/connected-apps/calendar", async (c) => c.json(ok(await calendar.getMyCalendar(await svc(c)))));
connectedAppRoutes.post("/connected-apps/calendar", async (c) => c.json(ok(await calendar.connectMyCalendar(await svc(c), parse(calendar.calendarConnectInput, await jsonBody(c))))));
connectedAppRoutes.get("/connected-apps/calendar/calendars", async (c) => c.json(ok(await calendar.listMyCalendars(await svc(c)))));
connectedAppRoutes.put("/connected-apps/calendar", async (c) => c.json(ok(await calendar.chooseMyCalendar(await svc(c), parse(calendar.calendarChooseInput, await jsonBody(c))))));
connectedAppRoutes.post("/connected-apps/calendar/sync", async (c) => c.json(ok(await calendar.syncMyCalendar(await svc(c)))));
connectedAppRoutes.delete("/connected-apps/calendar", async (c) => c.json(ok(await calendar.disconnectMyCalendar(await svc(c)))));

// ---- Google Drive (applicants) ----
/** The picked file's bytes, for the browser to upload like a file from the computer. Nothing is stored. */
connectedAppRoutes.post("/connected-apps/google-drive/fetch", async (c) => {
  const f = await integrations.fetchFromDrive(await svc(c), parse(integrations.driveFetchInput, await jsonBody(c)));
  return new Response(f.bytes as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: {
      "Content-Type": f.mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "Content-Length": String(f.bytes.byteLength),
      "X-File-Name": encodeURIComponent(f.name),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});
connectedAppRoutes.post("/connected-apps/google-drive/save", async (c) => c.json(created(await integrations.saveToDrive(await svc(c), parse(integrations.driveSaveInput, await jsonBody(c)))), 201));
