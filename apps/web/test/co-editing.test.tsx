// SPDX-License-Identifier: AGPL-3.0-only
// Live co-editing with presence (lib/presence.ts, docs/co-editing.md), against the in-page hub that
// stands in for the draft's private Realtime channel:
//   - the room's soft lock: taken on a keystroke, said again while typing goes on, let go on blur,
//     after LOCK_IDLE_MS, or on leaving; never taken by a reader;
//   - who may join: a person refused a pass, or refused by the channel, joins nothing and receives
//     nothing (the API and the realtime policies are tested in apps/api/test/presence.test.ts and
//     supabase/tests/database/50_co_editing.test.sql);
//   - both editors: who is here and where, the question someone types in read-only, their saves
//     shown without touching what this person types, "{name} changed this" with the other version;
//   - degraded mode: no channel, and the editor works as before with a quiet note;
//   - axe on the presence pieces in English and Spanish.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { ApplicantApi } from "../src/api/applicant.ts";
import { ApiError } from "../src/api/client.ts";
import { provideApplicantApi, provideMockApplicantStore } from "../src/api/applicantHooks.ts";
import type { OutsideApi } from "../src/api/outside.ts";
import { mockOutsideStore, provideOutsideApi } from "../src/api/outsideHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { changeLocale } from "../src/i18n/current.ts";
import { createDraftRoom, LOCK_IDLE_MS, LOCK_REFRESH_MS, LOCK_STALE_MS, providePresence, type Clock, type LockMessage, type RoomSnapshot } from "../src/lib/presence.ts";
import { APPLICANT_IDS, createMockApplicantApi, seedApplicantStore } from "../src/mocks/applicant.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { LOI_FORM } from "../src/mocks/forms.ts";
import { createMockOutsideApi, OUTSIDE_IDS } from "../src/mocks/outside.ts";
import { createMockPresenceApi, createPresenceHub, type PresenceHub } from "../src/mocks/presence.ts";
import { conflictsOf, keepOthersChanges, RECENT_CHANGE_MS, sectionFor, sectionsOf, withLocks } from "../src/screens/applicant/editorSync.ts";

const APP = `app_${APPLICANT_IDS.appHealth}`;
const TOPIC = `draft:application:${APPLICANT_IDS.appHealth}`;
const LENA = { userId: APPLICANT_IDS.lena, name: "Lena Fischer" };
const JAMAL = { userId: APPLICANT_IDS.jamal, name: "Jamal Reed" };
const PROJECT = sectionFor(sectionsOf(LOI_FORM), "/projectTitle")!.label;

/** Timers the test moves by hand. */
function manualClock(): Clock & { advance(ms: number): void } {
  let now = 1_000_000;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout: (fn, ms) => (timers.set(++next, { at: now + ms, fn }), next),
    clearTimeout: (id) => void timers.delete(id as number),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** A room on the hub that records what it sees and the locks that pass by. */
function watcher(hub: PresenceHub, who: { userId: string; name: string } = JAMAL, opts: { canWrite?: boolean; clock?: Clock } = {}) {
  const seen: { snap: RoomSnapshot; saved: string[] } = { snap: { status: "connecting", peers: [] }, saved: [] };
  const room = createDraftRoom({ transport: hub, topic: TOPIC, me: who, canWrite: opts.canWrite ?? true, ...(opts.clock ? { clock: opts.clock } : {}), onChange: (s) => (seen.snap = s), onSaved: (m) => seen.saved.push(`${m.target} ${m.fields.join(",")}`) });
  return { room, seen, lockOf: (userId: string) => seen.snap.peers.find((p) => p.userId === userId)?.lock };
}

afterEach(async () => {
  await changeLocale("en");
});

describe("the soft lock", () => {
  it("is taken on the first keystroke, said again while typing goes on, and let go on blur", async () => {
    const hub = createPresenceHub();
    const clock = manualClock();
    const said: LockMessage[] = [];
    const lena = watcher(hub, LENA, { clock });
    const jamal = watcher(hub);
    // Count what Lena says on the channel.
    const spy = hub.open(TOPIC, { userId: "spy", name: "Spy" }, { presence: () => undefined, lock: (m) => said.push(m), saved: () => undefined, status: () => undefined });
    await flush();
    expect(jamal.seen.snap.status).toBe("live");
    expect(jamal.seen.snap.peers.map((p) => p.name).sort()).toEqual(["Lena Fischer", "Spy"]);

    lena.room.focus({ section: PROJECT, field: "/projectTitle" });
    lena.room.input("/projectTitle");
    await flush();
    expect(jamal.lockOf(LENA.userId)).toBe("/projectTitle");
    expect(jamal.seen.snap.peers.find((p) => p.userId === LENA.userId)).toMatchObject({ section: PROJECT, field: "/projectTitle" });

    // More keystrokes say nothing new until LOCK_REFRESH_MS has passed.
    lena.room.input("/projectTitle");
    clock.advance(LOCK_REFRESH_MS - 1);
    lena.room.input("/projectTitle");
    await flush();
    expect(said.filter((m) => m.field === "/projectTitle")).toHaveLength(1);
    clock.advance(1);
    lena.room.input("/projectTitle");
    await flush();
    expect(said.filter((m) => m.field === "/projectTitle")).toHaveLength(2);

    lena.room.blur("/projectTitle");
    await flush();
    expect(jamal.lockOf(LENA.userId)).toBeUndefined();
    expect(said.at(-1)).toEqual({ by: LENA.userId, field: null });
    spy.leave();
  });

  it("lets go after a minute without a keystroke, and when the holder leaves", async () => {
    const hub = createPresenceHub();
    const clock = manualClock();
    const lena = watcher(hub, LENA, { clock });
    const jamal = watcher(hub);
    await flush();
    lena.room.input("/need");
    await flush();
    expect(jamal.lockOf(LENA.userId)).toBe("/need");
    clock.advance(LOCK_IDLE_MS - 1);
    await flush();
    expect(jamal.lockOf(LENA.userId)).toBe("/need");
    clock.advance(1);
    await flush();
    expect(jamal.lockOf(LENA.userId)).toBeUndefined();

    lena.room.input("/need");
    await flush();
    expect(jamal.lockOf(LENA.userId)).toBe("/need");
    lena.room.leave();
    await flush();
    expect(jamal.seen.snap.peers).toEqual([]);
  });

  it("is dropped by the others when its holder goes quiet without letting go", async () => {
    const hub = createPresenceHub();
    const clock = manualClock();
    const jamal = watcher(hub, JAMAL, { clock });
    // A holder whose tab froze: it said one lock and nothing more, and is still on the channel.
    const frozen = hub.open(TOPIC, LENA, { presence: () => undefined, lock: () => undefined, saved: () => undefined, status: () => undefined });
    await flush();
    frozen.send("lock", { by: LENA.userId, field: "/need" });
    await flush();
    expect(jamal.lockOf(LENA.userId)).toBe("/need");
    clock.advance(LOCK_STALE_MS + LOCK_REFRESH_MS);
    await flush();
    expect(jamal.lockOf(LENA.userId)).toBeUndefined();
    frozen.leave();
  });

  it("is never taken by someone who may only read, and is told to whoever joins", async () => {
    const hub = createPresenceHub();
    const reader = watcher(hub, LENA, { canWrite: false });
    const jamal = watcher(hub);
    await flush();
    reader.room.input("/need");
    reader.room.saved(APPLICANT_IDS.formFull, ["/need"]);
    await flush();
    expect(jamal.lockOf(LENA.userId)).toBeUndefined();
    expect(jamal.seen.saved).toEqual([]);

    jamal.room.input("/projectTitle");
    await flush();
    const late = watcher(hub, { userId: APPLICANT_IDS.maria, name: "Maria Santos" });
    await flush();
    expect(late.lockOf(JAMAL.userId)).toBe("/projectTitle");
  });
});

describe("who joins the draft's channel", () => {
  it("a channel that refuses the person joins nothing and delivers nothing to them", async () => {
    const hub = createPresenceHub({ authorize: (_topic, me) => me.userId !== "outsider" });
    const outsider = watcher(hub, { userId: "outsider", name: "Someone else" });
    const lena = watcher(hub, LENA);
    await flush();
    lena.room.input("/need");
    lena.room.saved(APPLICANT_IDS.formFull, ["/need"]);
    await flush();
    expect(outsider.seen.snap).toEqual({ status: "paused", peers: [] });
    expect(outsider.seen.saved).toEqual([]);
    expect(hub.members(TOPIC).map((m) => m.name)).toEqual(["Lena Fischer"]);
    expect(lena.seen.snap.peers).toEqual([]);
  });
});

describe("live updates in the form", () => {
  it("keeps someone else's save when the form hands back a copy from before it, and nothing else", () => {
    const recent = { at: 1000, before: new Map([["/familiesServed", 240]]) };
    const current = { projectTitle: "Maria types", familiesServed: 512 };
    // A stale copy: Maria's keystroke landed on the form as it was before Lena's save arrived.
    const stale = { projectTitle: "Maria types!", familiesServed: 240 };
    expect(keepOthersChanges(current, stale, recent, "/projectTitle", 1500)).toEqual({ projectTitle: "Maria types!", familiesServed: 512 });
    // The question Maria is in is hers; later than RECENT_CHANGE_MS, everything is taken as it comes.
    expect(keepOthersChanges(current, stale, recent, "/familiesServed", 1500)).toBe(stale);
    expect(keepOthersChanges(current, stale, recent, "/projectTitle", 1000 + RECENT_CHANGE_MS + 1)).toBe(stale);
    // A new value (an upload finishing) is never undone.
    expect(keepOthersChanges(current, { ...stale, familiesServed: 300 }, recent, "/projectTitle", 1500).familiesServed).toBe(300);
  });

  it("finds the questions both sides changed, and shows the locked ones read-only", () => {
    expect(conflictsOf({ need: "a", title: "t" }, { need: "theirs", title: "t" }, { need: "mine", title: "t" })).toEqual(["/need"]);
    expect(conflictsOf({ need: "a" }, { need: "same" }, { need: "same" })).toEqual([]);
    expect(conflictsOf({ need: "a" }, { need: "theirs" }, { need: "a" })).toEqual([]);
    const locked = withLocks(LOI_FORM, ["/projectTitle"]);
    expect(withLocks(LOI_FORM, ["/projectTitle"])).toBe(locked);
    expect(withLocks(LOI_FORM, [])).toBe(LOI_FORM);
    expect(JSON.stringify(locked.uiSchema)).toContain('{"type":"VerticalLayout","rule":{"effect":"DISABLE"');
    expect(sectionsOf(locked).map((s) => s.label)).toEqual(sectionsOf(LOI_FORM).map((s) => s.label));
  });
});

// ------------------------------------------------------------------------------------ the editors

function openEditor(opts: { hub?: PresenceHub | null; refuse?: boolean; api?: (base: ApplicantApi) => ApplicantApi; outsideApi?: (base: OutsideApi) => OutsideApi; path?: string } = {}) {
  const services = createMockServices({ session: demoSession() });
  const store = seedApplicantStore();
  const session = () => services.auth.getSession();
  const base = createMockApplicantApi({ session, store });
  provideMockApplicantStore(services, store);
  provideApplicantApi(services, opts.api ? opts.api(base) : base);
  const outside = createMockOutsideApi({ session, applicant: store, store: mockOutsideStore(services) });
  provideOutsideApi(services, opts.outsideApi ? opts.outsideApi(outside) : outside);
  const hub = opts.hub === undefined ? createPresenceHub() : opts.hub;
  providePresence(services, { transport: hub, api: createMockPresenceApi({ session, ...(opts.refuse ? { refuse: () => true } : {}) }) });
  const view = render(
    <MemoryRouter initialEntries={[opts.path ?? `/w/alder-creek/applications/${APP}/edit`]}>
      <App services={services} />
    </MemoryRouter>,
  );
  const lenaApi = createMockApplicantApi({ session: async () => demoSession(), store, actor: LENA });
  // Without a channel there is no hub to speak on; a spare one keeps the type simple.
  return { ...view, store, hub: hub ?? createPresenceHub(), outside, lenaApi, services };
}
const lenaIn = (hub: PresenceHub, topic = TOPIC) => createDraftRoom({ transport: hub, topic, me: LENA, canWrite: true, onChange: () => undefined, onSaved: () => undefined });
const rail = (locale: "en" | "es" = "en") => screen.getByRole("navigation", { name: locale === "en" ? "Application sections" : "Secciones de la solicitud" });

describe("the application editor", () => {
  it("shows who is here and where, and the question someone types in read-only until they let go", async () => {
    const { hub } = openEditor();
    const title = await screen.findByRole("textbox", { name: /Project title/ });
    const lena = lenaIn(hub);
    expect(await screen.findByLabelText(/Editing now: .*Lena Fischer/)).toBeInTheDocument();

    lena.focus({ section: PROJECT, field: "/need" });
    expect(await within(rail()).findByText("Lena Fischer is editing")).toBeInTheDocument();
    // At the question too, inside its field.
    await waitFor(() => expect(screen.getByRole("textbox", { name: /What need does this project address/ }).closest(".fld")).toHaveTextContent("Lena Fischer is editing"));

    lena.focus({ section: PROJECT, field: "/projectTitle" });
    lena.input("/projectTitle");
    await waitFor(() => expect(screen.getByRole("textbox", { name: /Project title/ })).toBeDisabled());
    // The note is placed in the field once the form has drawn it again (the next tick).
    await waitFor(() => expect(screen.getByRole("textbox", { name: /Project title/ }).closest(".fld")).toHaveTextContent("Being edited by Lena Fischer"));
    // Every other question stays open.
    expect(screen.getByRole("textbox", { name: /What need does this project address/ })).toBeEnabled();

    lena.blur("/projectTitle");
    await waitFor(() => expect(screen.getByRole("textbox", { name: /Project title/ })).toBeEnabled());
    expect(screen.queryByText("Being edited by Lena Fischer")).toBeNull();
    void title;
    lena.leave();
    await waitFor(() => expect(screen.queryByText("Lena Fischer is editing")).toBeNull());
  });

  it("shows a teammate's save within moments and keeps what this person is typing elsewhere", async () => {
    const { hub, store, lenaApi } = openEditor();
    const title = await screen.findByRole("textbox", { name: /Project title/ });
    const lena = lenaIn(hub);
    await screen.findByLabelText(/Editing now: .*Lena Fischer/);
    await userEvent.click(title);
    await userEvent.clear(title);
    await userEvent.type(title, "Maria is typing");
    await lenaApi.saveForm(APP, APPLICANT_IDS.formFull, { familiesServed: 512 });
    lena.saved(APPLICANT_IDS.formFull, ["/familiesServed"]);
    await waitFor(() => expect(screen.getByRole("spinbutton", { name: /Families served/ })).toHaveValue(512));
    expect(screen.getByRole("textbox", { name: /Project title/ })).toHaveValue("Maria is typing");
    await waitFor(() => expect(store.applications[0]!.forms[0]!.response.projectTitle).toBe("Maria is typing"), { timeout: 3000 });
    expect(store.applications[0]!.forms[0]!.response.familiesServed).toBe(512);
    lena.leave();
  });

  it("keeps this person's unsaved words when a teammate saves the same question, and offers theirs", async () => {
    // Maria's saves do not get through (she is offline for a moment), so her words stay unsaved.
    const { hub, lenaApi } = openEditor({ api: (base) => ({ ...base, saveForm: async () => Promise.reject(new ApiError(503, "The service is not reachable")) }) });
    const need = await screen.findByRole("textbox", { name: /What need does this project address/ });
    const lena = lenaIn(hub);
    await screen.findByLabelText(/Editing now: .*Lena Fischer/);
    await userEvent.click(need);
    await userEvent.clear(need);
    await userEvent.type(need, "Maria's words");
    await lenaApi.saveForm(APP, APPLICANT_IDS.formFull, { need: "Lena's words" });
    lena.saved(APPLICANT_IDS.formFull, ["/need"]);

    const note = await screen.findByText("Lena Fischer changed this");
    const field = screen.getByRole("textbox", { name: /What need does this project address/ });
    expect(field).toHaveValue("Maria's words");
    const box = note.closest(".bnr") as HTMLElement;
    expect(within(box).queryByText("Lena's words")).not.toBeVisible();
    await userEvent.click(within(box).getByRole("button", { name: "View their version" }));
    expect(within(box).getByText("Lena's words")).toBeVisible();
    expect(within(box).getByRole("button", { name: "Hide their version" })).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(within(box).getByRole("button", { name: "Use their version" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: /What need does this project address/ })).toHaveValue("Lena's words"));
    expect(screen.queryByText("Lena Fischer changed this")).toBeNull();
    lena.leave();
  });

  it("works as before without the live channel, and says so quietly", async () => {
    const { store } = openEditor({ hub: null });
    const title = await screen.findByRole("textbox", { name: /Project title/ });
    expect(await screen.findByText(/Live updates are paused/)).toBeInTheDocument();
    expect(screen.getByLabelText("Editing now: Maria Santos")).toBeInTheDocument();
    await userEvent.clear(title);
    await userEvent.type(title, "Saved without the channel");
    await waitFor(() => expect(store.applications[0]!.forms[0]!.response.projectTitle).toBe("Saved without the channel"), { timeout: 3000 });
  });

  it("joins nothing when the pass is refused, so nothing of the draft reaches this person", async () => {
    const { hub } = openEditor({ refuse: true });
    await screen.findByRole("textbox", { name: /Project title/ });
    expect(await screen.findByText(/Live updates are paused/)).toBeInTheDocument();
    const lena = lenaIn(hub);
    lena.input("/projectTitle");
    await flush();
    expect(hub.members(TOPIC).map((m) => m.name)).toEqual(["Lena Fischer"]);
    expect(screen.getByRole("textbox", { name: /Project title/ })).toBeEnabled();
    expect(screen.queryByText(/Lena Fischer/)).toBeNull();
    lena.leave();
  });

  it("leaves the channel as soon as a save for the draft is refused (403), and stays out", async () => {
    // Maria was removed from the team: the API refuses her save before Realtime's next check would.
    const { hub } = openEditor({ api: (base) => ({ ...base, saveForm: async () => Promise.reject(new ApiError(403, "You are not a member of this workspace", [{ code: "workspace_mismatch" }])) }) });
    const title = await screen.findByRole("textbox", { name: /Project title/ });
    const lena = lenaIn(hub);
    await screen.findByLabelText(/Editing now: .*Lena Fischer/);
    expect(hub.members(TOPIC).map((m) => m.name).sort()).toEqual(["Lena Fischer", "Maria Santos"]);
    await userEvent.clear(title);
    await userEvent.type(title, "x");
    await waitFor(() => expect(hub.members(TOPIC).map((m) => m.name)).toEqual(["Lena Fischer"]), { timeout: 3000 });
    expect(await screen.findByText(/Live updates are paused/)).toBeInTheDocument();
    // Nothing more of the draft's channel reaches her: no lock, no presence.
    lena.input("/need");
    await flush();
    expect(screen.getByRole("textbox", { name: /What need does this project address/ })).toBeEnabled();
    expect(screen.queryByText(/Lena Fischer/)).toBeNull();
    lena.leave();
  });

  it("leaves the channel when reading the draft again answers 404, and a 503 changes nothing", async () => {
    let answer: "ok" | "404" | "503" = "ok";
    const { hub, lenaApi } = openEditor({
      api: (base) => ({
        ...base,
        application: async (id: string) => (answer === "ok" ? base.application(id) : Promise.reject(answer === "404" ? new ApiError(404, "Application not found", [{ code: "not_found" }]) : new ApiError(503, "The service is not reachable"))),
      }),
    });
    await screen.findByRole("textbox", { name: /Project title/ });
    const lena = lenaIn(hub);
    await screen.findByLabelText(/Editing now: .*Lena Fischer/);
    answer = "503";
    await lenaApi.saveForm(APP, APPLICANT_IDS.formFull, { familiesServed: 7 });
    lena.saved(APPLICANT_IDS.formFull, ["/familiesServed"]);
    await flush();
    expect(hub.members(TOPIC).map((m) => m.name).sort()).toEqual(["Lena Fischer", "Maria Santos"]);
    answer = "404";
    lena.saved(APPLICANT_IDS.formFull, ["/familiesServed"]);
    await waitFor(() => expect(hub.members(TOPIC).map((m) => m.name)).toEqual(["Lena Fischer"]));
    expect(await screen.findByText(/Live updates are paused/)).toBeInTheDocument();
    lena.leave();
  });

  it("pauses when the connection drops and comes back", async () => {
    const { hub } = openEditor();
    await screen.findByRole("textbox", { name: /Project title/ });
    const lena = lenaIn(hub);
    lena.input("/projectTitle");
    await waitFor(() => expect(screen.getByRole("textbox", { name: /Project title/ })).toBeDisabled());
    hub.setOnline(false);
    expect(await screen.findByText(/Live updates are paused/)).toBeInTheDocument();
    // Out of the channel nobody is known to hold a question.
    await waitFor(() => expect(screen.getByRole("textbox", { name: /Project title/ })).toBeEnabled());
    hub.setOnline(true);
    await waitFor(() => expect(screen.queryByText(/Live updates are paused/)).toBeNull());
    lena.leave();
  });
});

describe("the outside application's questions", () => {
  const OUTSIDE_TOPIC = `draft:outside:${OUTSIDE_IDS.northwind.replace(/^oap_/, "")}`;

  it("locks a question someone types in, and takes their saved answer when this person has none unsaved", async () => {
    const { hub, outside } = openEditor({ path: `/w/alder-creek/outside/${OUTSIDE_IDS.northwind}` });
    const answers = await screen.findAllByRole("textbox", { name: /^Answer to question/ });
    const first = answers[0]!;
    const qid = first.id.replace(/^oq-answer-/, "");
    const lena = lenaIn(hub, OUTSIDE_TOPIC);
    expect(await screen.findByLabelText(/Editing now: .*Lena Fischer/)).toBeInTheDocument();

    lena.focus({ field: qid });
    lena.input(qid);
    await waitFor(() => expect(first).toHaveAttribute("readonly"));
    const card = first.closest("article") as HTMLElement;
    expect(within(card).getByText("Being edited by Lena Fischer")).toBeInTheDocument();
    expect(first).toHaveAccessibleDescription(/Being edited by Lena Fischer/);

    await outside.putAnswer(qid, { body: "Lena wrote this answer." });
    lena.saved(qid, [qid]);
    lena.blur(qid);
    await waitFor(() => expect(first).toHaveValue("Lena wrote this answer."));
    await waitFor(() => expect(first).not.toHaveAttribute("readonly"));
    lena.leave();
  });

  it("leaves the channel as soon as saving an answer is refused (403)", async () => {
    const { hub } = openEditor({ path: `/w/alder-creek/outside/${OUTSIDE_IDS.northwind}`, outsideApi: (base) => ({ ...base, putAnswer: async () => Promise.reject(new ApiError(403, "You are not a member of this workspace", [{ code: "workspace_mismatch" }])) }) });
    const first = (await screen.findAllByRole("textbox", { name: /^Answer to question/ }))[0]!;
    const lena = lenaIn(hub, OUTSIDE_TOPIC);
    await screen.findByLabelText(/Editing now: .*Lena Fischer/);
    await userEvent.click(first);
    await userEvent.type(first, " more");
    const card = first.closest("article") as HTMLElement;
    const save = within(card).queryByRole("button", { name: /^Save/ });
    if (save) await userEvent.click(save);
    else await userEvent.tab();
    await waitFor(() => expect(hub.members(OUTSIDE_TOPIC).map((m) => m.name)).toEqual(["Lena Fischer"]), { timeout: 3000 });
    expect(await screen.findByText(/Live updates are paused/)).toBeInTheDocument();
    lena.leave();
  });

  it("keeps this person's unsaved answer when someone else saves it, and says who", async () => {
    const { hub, outside } = openEditor({ path: `/w/alder-creek/outside/${OUTSIDE_IDS.northwind}` });
    const first = (await screen.findAllByRole("textbox", { name: /^Answer to question/ }))[0]!;
    const qid = first.id.replace(/^oq-answer-/, "");
    const lena = lenaIn(hub, OUTSIDE_TOPIC);
    await screen.findByLabelText(/Editing now: .*Lena Fischer/);
    await userEvent.click(first);
    await userEvent.clear(first);
    await userEvent.type(first, "Maria's unsaved answer");
    const store = outside.store.applications.find((a) => a.id === OUTSIDE_IDS.northwind)!;
    await outside.putAnswer(qid, { body: "Lena's saved answer" });
    // Saved by someone else: the mock signs every version as Maria, so name Lena as its author.
    store.questions.find((x) => x.id === qid)!.versions.at(-1)!.createdBy = LENA.userId;
    lena.saved(qid, [qid]);
    const card = first.closest("article") as HTMLElement;
    expect(await within(card).findByText(/changed this$/)).toBeInTheDocument();
    expect(first).toHaveValue("Maria's unsaved answer");
    await userEvent.click(within(card).getByRole("button", { name: "View their version" }));
    expect(within(card).getByText("Lena's saved answer")).toBeVisible();
    await userEvent.click(within(card).getByRole("button", { name: "Keep mine" }));
    expect(first).toHaveValue("Maria's unsaved answer");
    lena.leave();
  });
});

// ------------------------------------------------------------------------------------ accessibility

async function axeViolations() {
  const result = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
  });
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(" | ")}`);
}

describe.each([
  ["en", { editing: "Lena Fischer is editing", locked: "Being edited by Lena Fischer", changed: "Lena Fischer changed this", view: "View their version", paused: /Live updates are paused/ }],
  ["es", { editing: "Lena Fischer está editando", locked: "En edición por Lena Fischer", changed: "Lena Fischer cambió esta respuesta", view: "Ver la otra versión", paused: /Las actualizaciones en vivo están en pausa/ }],
] as const)("the presence pieces pass axe (%s)", (locale, words) => {
  it("chips, the lock, the changed note and its other version", async () => {
    await changeLocale(locale);
    const { hub, lenaApi } = openEditor({ api: (base) => ({ ...base, saveForm: async () => Promise.reject(new ApiError(503, "The service is not reachable")) }) });
    // The full proposal is in English only: its questions keep the funder's words in both languages.
    const need = await screen.findByRole("textbox", { name: /What need does this project address/ });
    const lena = lenaIn(hub);
    lena.focus({ section: PROJECT, field: "/startDate" });
    lena.input("/projectTitle");
    expect(await screen.findByText(words.locked)).toBeInTheDocument();
    expect(within(rail(locale)).getByText(words.editing)).toBeInTheDocument();
    await userEvent.click(need);
    await userEvent.type(need, " más");
    await lenaApi.saveForm(APP, APPLICANT_IDS.formFull, { need: "Lena's words" });
    lena.saved(APPLICANT_IDS.formFull, ["/need"]);
    await screen.findByText(words.changed);
    await userEvent.click(screen.getByRole("button", { name: words.view }));
    expect(await axeViolations()).toEqual([]);
    lena.leave();
  });

  it("the paused note", async () => {
    await changeLocale(locale);
    openEditor({ hub: null });
    expect(await screen.findByText(words.paused)).toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);
  });
});
