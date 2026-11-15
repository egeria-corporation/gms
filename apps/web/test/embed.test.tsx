// SPDX-License-Identifier: AGPL-3.0-only
// The apply widget, its copy-paste snippet, and the funder's "Powered by" setting on every public
// surface, against the mock API.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { EMBED_MAX_HEIGHT, EMBED_MESSAGE, EMBED_MIN_HEIGHT, embedFrameId, embedIframe, embedResizeScript, embedSnippet, postEmbedHeight } from "../src/lib/embed.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_MEMBERSHIPS } from "../src/mocks/fixtures.ts";
import { IDS, seedStore } from "../src/mocks/store.ts";

const ORIGIN = window.location.origin;
const POWERED = "Powered by OpenGrants Grant Management System";

function open(path: string, store = seedStore()) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App services={createMockServices({ session: null, store })} />
    </MemoryRouter>,
  );
}
const widget = (slug: string, store = seedStore()) => open(`/embed/f/riverbend/o/${slug}`, store);
const poweredOff = () => {
  const store = seedStore();
  store.workspaces[0]!.record.settings = { ...store.workspaces[0]!.record.settings, poweredBy: false };
  return store;
};

describe("the apply widget", () => {
  it("offers Apply in a new tab while the call takes applications, with a short eligibility summary", async () => {
    widget("community-health-2027");
    const card = await screen.findByRole("article", { name: "Community Health Grants 2027, Riverbend Community Foundation" });
    expect(within(card).getByRole("heading", { level: 1, name: "Community Health Grants 2027" })).toBeInTheDocument();
    expect(within(card).getByText("Riverbend Community Foundation")).toBeInTheDocument();
    expect(within(card).getByText("Taking applications")).toBeInTheDocument();
    expect(within(card).getByText(/^Full proposal closes /)).toBeInTheDocument();
    // Three rule labels and a count of the rest.
    expect(within(card).getByText(/· and 1 more$/)).toBeInTheDocument();
    const apply = within(card).getByRole("link", { name: "Apply to Community Health Grants 2027 (opens in a new tab)" });
    expect(apply).toHaveAttribute("href", `${ORIGIN}/f/riverbend/o/community-health-2027`);
    expect(apply).toHaveAttribute("target", "_blank");
    expect(apply).toHaveAttribute("rel", "noopener");
    const powered = within(card).getByRole("link", { name: POWERED });
    expect(powered).toHaveAttribute("href", `${ORIGIN}/`);
    expect(powered).toHaveAttribute("target", "_blank");
    // A widget, not the app: no sign-in control, no app frame.
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(document.querySelector(".gms-frame")).toBeNull();
  });

  it("says when an open call is not taking applications yet, instead of Apply", async () => {
    widget("housing-stability-2027");
    const card = await screen.findByRole("article");
    expect(within(card).getByText("Not taking applications yet")).toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: /^Apply/ })).toBeNull();
    expect(within(card).getByRole("link", { name: "View details of Housing Stability Grants 2027 (opens in a new tab)" })).toHaveAttribute("href", `${ORIGIN}/f/riverbend/o/housing-stability-2027`);
    // No rules: the applicant types stand in.
    expect(within(card).getByText(/Who can apply:/).parentElement).toHaveTextContent(/501\(c\)\(3\)/);
  });

  it("shows a forecasted call with its opening date, and a closed call as closed", async () => {
    widget("youth-opportunity-2028");
    let card = await screen.findByRole("article");
    expect(within(card).getByText("Forecasted")).toBeInTheDocument();
    expect(within(card).getByText(/^Opens /)).toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: /^Apply/ })).toBeNull();

    const store = seedStore();
    store.workspaces[0]!.opportunities.find((o) => o.slug === "community-health-2027")!.status = "closed";
    document.body.innerHTML = "";
    widget("community-health-2027", store);
    card = await screen.findByRole("article");
    expect(within(card).getByText("Closed")).toBeInTheDocument();
    expect(within(card).getByText("No longer taking applications")).toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: /^Apply/ })).toBeNull();
  });

  it("says so when the call is not published", async () => {
    widget("no-such-call");
    expect(await screen.findByText("This opportunity is not available.")).toBeInTheDocument();
    expect(screen.queryByText(POWERED)).toBeNull();
  });

  it("posts only its height to the page that frames it", () => {
    const sent: unknown[][] = [];
    postEmbedHeight({ postMessage: (...args: unknown[]) => sent.push(args) } as unknown as Window, 301.2);
    expect(sent).toEqual([[{ type: EMBED_MESSAGE, height: 302 }, "*"]]);
  });
});

describe("Powered by, and the funder's setting", () => {
  it("is in the footer of the funder page and the opportunity page, linked to the landing page", async () => {
    open("/f/riverbend");
    expect(await screen.findByRole("link", { name: POWERED })).toHaveAttribute("href", "/");
    document.body.innerHTML = "";
    open("/f/riverbend/o/community-health-2027");
    expect(await screen.findByRole("link", { name: POWERED })).toHaveAttribute("href", "/");
  });

  it("is hidden everywhere for a funder that turned it off", async () => {
    open("/f/riverbend", poweredOff());
    await screen.findByRole("heading", { level: 1, name: "Riverbend Community Foundation" });
    expect(screen.queryByText(POWERED)).toBeNull();
    document.body.innerHTML = "";
    open("/f/riverbend/o/community-health-2027", poweredOff());
    await screen.findByRole("link", { name: "View as CommonGrants JSON" });
    expect(screen.queryByText(POWERED)).toBeNull();
    document.body.innerHTML = "";
    widget("community-health-2027", poweredOff());
    await screen.findByRole("article");
    expect(screen.queryByText(POWERED)).toBeNull();
  });
});

describe("funder page cards", () => {
  it("say Apply only while the call takes applications, else View details", async () => {
    open("/f/riverbend");
    const taking = (await screen.findByRole("heading", { name: "Community Health Grants 2027" })).closest("article")!;
    expect(within(taking).getByRole("link", { name: "Apply to Community Health Grants 2027" })).toBeInTheDocument();
    const notYet = screen.getByRole("heading", { name: "Housing Stability Grants 2027" }).closest("article")!;
    expect(within(notYet).queryByRole("link", { name: /^Apply/ })).toBeNull();
    expect(within(notYet).getByRole("link", { name: "View details of Housing Stability Grants 2027" })).toHaveAttribute("href", "/f/riverbend/o/housing-stability-2027");
  });
});

describe("the embed snippet", () => {
  const input = { origin: "https://gms.opengrants.io", handle: "riverbend", slug: "community-health-2027", title: `Health "2027" <script>alert(1)</script>`, funderName: "O'Brien & Sons" };
  const parse = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;

  it("is one iframe with a fixed height, its title escaped", () => {
    const body = parse(embedSnippet(input, { resize: false }));
    expect(body.children).toHaveLength(1);
    const frame = body.querySelector("iframe")!;
    expect(body.querySelector("script")).toBeNull();
    expect(frame.getAttribute("src")).toBe("https://gms.opengrants.io/embed/f/riverbend/o/community-health-2027");
    expect(frame.getAttribute("title")).toBe(`${input.title} from O'Brien & Sons: apply`);
    expect(frame.getAttribute("height")).toMatch(/^\d+$/);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    expect(embedIframe(input)).not.toContain("<script>");
    expect(embedIframe(input)).toContain("&quot;2027&quot; &lt;script&gt;");
  });

  it("encodes what goes into the address and the id", () => {
    const odd = { ...input, handle: "river bend", slug: 'a"b</script>' };
    const frame = parse(embedIframe(odd)).querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe("https://gms.opengrants.io/embed/f/river%20bend/o/a%22b%3C%2Fscript%3E");
    expect(frame.id).toMatch(/^[a-z0-9-]+$/);
    expect(embedResizeScript(odd)).not.toMatch(/<\/script>[\s\S]*<\/script>/);
  });

  it("refuses an origin that is not http(s), and keeps only the origin of one that is", () => {
    expect(() => embedSnippet({ ...input, origin: "javascript:alert(1)" }, { resize: true })).toThrow();
    expect(embedIframe({ ...input, origin: "https://gms.example/some/path?q=1" })).toContain('src="https://gms.example/embed/f/');
  });

  it("resizes the iframe only on a height message from the GMS origin and that iframe", () => {
    const html = embedSnippet({ ...input, origin: ORIGIN }, { resize: true });
    const body = parse(html);
    expect(body.querySelectorAll("iframe")).toHaveLength(1);
    expect(body.querySelectorAll("script")).toHaveLength(1);

    const frame = document.createElement("iframe");
    frame.id = embedFrameId(input.handle, input.slug);
    document.body.appendChild(frame);
    // Run the snippet's script as the host page would.
    new Function(body.querySelector("script")!.textContent!)();
    const send = (data: unknown, opts: { origin?: string; source?: Window | null } = {}) =>
      window.dispatchEvent(new MessageEvent("message", { data, origin: opts.origin ?? ORIGIN, source: opts.source === undefined ? frame.contentWindow : opts.source }));

    send({ type: EMBED_MESSAGE, height: 410.4 });
    expect(frame.style.height).toBe("411px");
    send({ type: EMBED_MESSAGE, height: 999 }, { origin: "https://evil.example" });
    send({ type: EMBED_MESSAGE, height: 999 }, { source: window });
    send({ type: "other", height: 999 });
    send({ type: EMBED_MESSAGE, height: "999" });
    expect(frame.style.height).toBe("411px");
    send({ type: EMBED_MESSAGE, height: 1e9 });
    expect(frame.style.height).toBe(`${EMBED_MAX_HEIGHT}px`);
    send({ type: EMBED_MESSAGE, height: 0 });
    expect(frame.style.height).toBe(`${EMBED_MIN_HEIGHT}px`);
    frame.remove();
  });
});

describe("the embed panel in the opportunity builder", () => {
  const builder = (path: string, store = seedStore()) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <App services={createMockServices({ session: demoSession(), store })} />
      </MemoryRouter>,
    );

  it("gives the snippet, a copy button and a live preview for a published opportunity", async () => {
    builder(`/w/riverbend/opportunities/${IDS.oppHealth27}/edit#publish`);
    const panel = await screen.findByRole("region", { name: "Embed on your website" });
    const code = within(panel).getByRole("textbox", { name: "Embed code" }) as HTMLTextAreaElement;
    expect(code.value).toContain(`src="${ORIGIN}/embed/f/riverbend/o/community-health-2027"`);
    expect(code.value).not.toContain("<script>");
    await userEvent.click(within(panel).getByRole("checkbox", { name: /Resize to fit/ }));
    expect(code.value).toContain("<script>");
    expect(code.value).toContain(EMBED_MESSAGE);
    expect(within(panel).getByRole("button", { name: "Copy the embed code" })).toBeInTheDocument();
    const preview = await within(panel).findByRole("region", { name: "Widget preview" });
    expect(within(preview).getByRole("link", { name: "Apply to Community Health Grants 2027 (opens in a new tab)" })).toBeInTheDocument();
    expect(within(preview).getByRole("link", { name: POWERED })).toBeInTheDocument();
  });

  it("asks for publishing first", async () => {
    builder("/w/riverbend/opportunities/new#publish");
    const panel = await screen.findByRole("region", { name: "Embed on your website" });
    expect(within(panel).getByText("Publish to embed")).toBeInTheDocument();
    expect(within(panel).queryByRole("textbox", { name: "Embed code" })).toBeNull();
  });
});

describe("the Public page setting", () => {
  const SWITCH = { name: `Show “${POWERED}”` };

  it("is on by default; an admin turns it off and the public pages drop the line", async () => {
    const store = seedStore();
    render(
      <MemoryRouter initialEntries={["/w/riverbend/settings/public-page"]}>
        <App services={createMockServices({ session: demoSession(), store })} />
      </MemoryRouter>,
    );
    const toggle = await screen.findByRole("switch", SWITCH);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole("switch", SWITCH)).toHaveAttribute("aria-checked", "false"));
    expect(store.workspaces[0]!.record.settings.poweredBy).toBe(false);
    expect(screen.getByRole("link", { name: "Public page" })).toHaveAttribute("aria-current", "page");

    document.body.innerHTML = "";
    open("/f/riverbend", store);
    await screen.findByRole("heading", { level: 1, name: "Riverbend Community Foundation" });
    expect(screen.queryByText(POWERED)).toBeNull();
  });

  it("is for admins only", async () => {
    render(
      <MemoryRouter initialEntries={["/w/riverbend/settings/public-page"]}>
        <App services={createMockServices({ session: demoSession(), memberships: MOCK_MEMBERSHIPS.map((m) => (m.handle === "riverbend" ? { ...m, role: "program_officer" } : m)) })} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("switch", SWITCH)).toBeDisabled();
    expect(screen.getByText("Only workspace admins can change this.")).toBeInTheDocument();
  });
});
