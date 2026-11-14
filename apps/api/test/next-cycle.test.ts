// SPDX-License-Identifier: AGPL-3.0-only
// The next cycle (v1.7.0): a reminder on the date given with a decline, and a funding alert on
// the program name through the GMS's own alerts service.
import { beforeEach, describe, expect, it } from "vitest";
import { sendKeepReminders, sendNextCycleReminders } from "../src/jobs.ts";
import { harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
const data = async <T>(method: string, path: string, body?: unknown) => {
  const r = await s.call<{ data: T }>(s.applicant, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const base = () => ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>" }, ports: { mailer: h.mailer, directory: h.directory } });
const today = () => h.clock.now.toISOString().slice(0, 10);

let id: string;
beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  h.directory.users.set(USER_APPLICANT, { email: "maria.santos@aldercreek.example", name: "Maria Santos" });
  id = (await data<{ id: string }>("POST", "/gms/outside-applications", { title: "Clinic grant 2027", funderName: "Northwind", programName: "Rural Health Fund" })).id;
  await data("POST", `/gms/outside-applications/${id}/submit`, { submittedAt: "2027-01-10", method: "portal" });
});

describe("next cycle", () => {
  it("reminds the owner on the next-cycle date of a declined application, once", async () => {
    await data("POST", `/gms/outside-applications/${id}/decision`, { outcome: "declined", notes: "Strong, but outside this round's focus.", nextCycleOn: today() });
    h.mailer.sent.length = 0;
    expect(await sendNextCycleReminders(base())).toMatchObject({ checked: 1, reminded: 1, sent: 1, failed: 0 });
    expect(h.mailer.sent.map((m) => `${m.to[0]} ${m.subject}`)).toEqual(["maria.santos@aldercreek.example Next funding cycle: Rural Health Fund"]);
    expect(h.mailer.sent[0]!.text).toContain(`https://app.gms.test/w/alder-creek/outside/${id}`);
    // The decline notes (the funder's feedback) stay out of the email.
    expect(h.mailer.sent[0]!.text).not.toContain("outside this round");
    await sendKeepReminders(base());
    expect(h.mailer.sent).toHaveLength(1);
    // Reopened since: nothing.
    await data("POST", `/gms/outside-applications/${id}/reopen`);
    h.mailer.sent.length = 0;
    expect((await sendNextCycleReminders(base())).checked).toBe(0);
  });

  it("sets a funding alert on the program name through the GMS's alerts, once", async () => {
    const r = await s.call<{ data: { id: string; name: string; query: string; frequency: string } }>(s.applicant, "POST", `/gms/outside-applications/${id}/next-cycle-alert`, {});
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ name: "Reopens: Rural Health Fund", query: "Rural Health Fund", frequency: "weekly" });
    const again = await s.call<{ data: { id: string } }>(s.applicant, "POST", `/gms/outside-applications/${id}/next-cycle-alert`, {});
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(r.body.data.id);
    expect((await data<{ id: string }[]>("GET", "/gms/discover/alerts")).map((a) => a.id)).toEqual([r.body.data.id]);
    // Not OpenGrants' API: no call reached it.
    expect(h.ledger.events.filter((e) => e.eventType === "outside_application.alert_created")).toHaveLength(1);
    expect((await s.call(s.funder, "POST", `/gms/outside-applications/${id}/next-cycle-alert`, {})).status).toBe(403);
  });
});
