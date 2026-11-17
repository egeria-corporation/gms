// SPDX-License-Identifier: AGPL-3.0-only
// Live co-editing in the browser, in mock mode (src/mocks/presence.ts). The draft's channel is an
// in-page hub; it mirrors itself through `window.__gmsPresenceRelay` when a test puts one there
// before the editor opens. `pairContexts` relays between two browser contexts (two people, two
// sessions, nothing shared); `fakeTeammate` speaks on the relay as a teammate who is not a page.
import type { Browser, BrowserContext, Page } from "@playwright/test";

/** The relay a page's hub uses: what it sends goes to `__gmsRelayOut`; `__gmsRelayIn` delivers to it. */
function relayInit() {
  const listeners: ((message: string) => void)[] = [];
  const w = window as unknown as { __gmsPresenceRelay: unknown; __gmsRelayIn: (m: string) => void; __gmsRelayOut?: (m: string) => Promise<void> };
  w.__gmsPresenceRelay = {
    send: (message: string) => void w.__gmsRelayOut?.(message),
    listen: (receive: (message: string) => void) => listeners.push(receive),
  };
  w.__gmsRelayIn = (message: string) => listeners.forEach((receive) => receive(message));
}

/** Puts a relay in a page that is already open, before its editor first opens (it reads the relay once). */
export async function installRelay(page: Page): Promise<void> {
  await page.evaluate(relayInit);
}

export interface Person {
  userId: string;
  name: string;
  email: string;
}

/**
 * Two browser contexts whose drafts' channels reach each other: what one page's hub sends is
 * delivered to the other page, in order. `second` is signed in as another member of the team (the
 * mock keeps its session in sessionStorage).
 */
export async function pairContexts(browser: Browser, second: Person): Promise<{ a: Page; b: Page; contexts: BrowserContext[]; problems: string[] }> {
  const ca = await browser.newContext();
  const cb = await browser.newContext();
  const pages: { a?: Page; b?: Page } = {};
  const problems: string[] = [];
  const queue = { a: Promise.resolve(), b: Promise.resolve() };
  const to = (side: "a" | "b") => async (_source: unknown, message: string) => {
    queue[side] = queue[side].then(async () => {
      await pages[side]?.evaluate((m) => (window as unknown as { __gmsRelayIn?: (m: string) => void }).__gmsRelayIn?.(m), message).catch(() => undefined);
    });
    await queue[side];
  };
  await ca.exposeBinding("__gmsRelayOut", to("b"));
  await cb.exposeBinding("__gmsRelayOut", to("a"));
  await ca.addInitScript(relayInit);
  await cb.addInitScript(relayInit);
  await cb.addInitScript((who) => {
    if (sessionStorage.getItem("gms.mock.session") === null) sessionStorage.setItem("gms.mock.session", JSON.stringify({ userId: who.userId, email: who.email, aal: "aal2", accessToken: "mock.aal2" }));
  }, second);
  pages.a = await ca.newPage();
  pages.b = await cb.newPage();
  for (const [side, page] of Object.entries(pages)) {
    page!.on("pageerror", (e) => problems.push(`${side}: page error: ${e.message}`));
    page!.on("console", (m) => {
      if (m.type() === "error") problems.push(`${side}: console error: ${m.text()}`);
    });
  }
  return { a: pages.a, b: pages.b, contexts: [ca, cb], problems };
}

/**
 * A teammate on a draft's channel who is not a page: joins, says where they are, and holds a
 * question (the soft lock). Needs a relay in the page and its editor open.
 */
export async function fakeTeammate(page: Page, topic: string, who: { userId: string; name: string; section?: string; field?: string }, lock?: string): Promise<void> {
  await page.evaluate(
    ({ topic, who, lock }) => {
      const send = (window as unknown as { __gmsRelayIn: (m: string) => void }).__gmsRelayIn;
      send(JSON.stringify({ t: "hello", topic, from: "teammate-1", meta: who }));
      if (lock) send(JSON.stringify({ t: "send", topic, from: "teammate-1", event: "lock", payload: { by: who.userId, field: lock } }));
    },
    { topic, who, lock },
  );
}
