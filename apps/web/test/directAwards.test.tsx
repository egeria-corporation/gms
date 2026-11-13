// SPDX-License-Identifier: AGPL-3.0-only
// Giving an award directly: the form's checks, the mock's rules (one address, one use, expiry,
// replacement on resend, the daily limit), every state of the claim screen, and the screens end to end.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { errorCode, invitationOf, type DirectAwardInput, type InvitationLookup } from "../src/api/directAwards.ts";
import { createHttpApi } from "../src/api/client.ts";
import { clearClaimToken, getClaimToken } from "../src/lib/claimToken.ts";
import { mockApplicantStore } from "../src/api/applicantHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { directAwardProblems, EMPTY_DIRECT_AWARD, formatDecimalAmount, maskEmail, normalizeAmount, toDirectAwardInput, type DirectAwardForm } from "../src/lib/directAward.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_MEMBERSHIPS, MOCK_USER } from "../src/mocks/fixtures.ts";
import type { MockDirectAwardsApi } from "../src/mocks/directAwards.ts";
import { ClaimView, funderIsVerified, setupOrganizationHref, type ClaimViewProps } from "../src/screens/public/ClaimAward.tsx";

const valid: DirectAwardForm = { ...EMPTY_DIRECT_AWARD, organizationName: "Pine Ridge Youth Alliance", contactEmail: "maria@pineridge.example", title: "Summer programs", amount: "25,000" };

describe("the New award form", () => {
  it("needs an organization, an address, a title and an amount, each with a plain message", () => {
    expect(directAwardProblems(EMPTY_DIRECT_AWARD)).toEqual({
      organizationName: "Enter the organization's name.",
      contactEmail: "Enter the contact's email address.",
      title: "Give the award a title.",
      amount: "Enter the amount in dollars.",
    });
    expect(directAwardProblems(valid)).toEqual({});
  });
  it("checks the address, the amount, the dates and the message", () => {
    expect(directAwardProblems({ ...valid, contactEmail: "maria@" }).contactEmail).toMatch(/full email address/);
    expect(directAwardProblems({ ...valid, amount: "12.345" }).amount).toMatch(/dollars and cents/i);
    expect(directAwardProblems({ ...valid, amount: "0" }).amount).toMatch(/more than zero/);
    expect(directAwardProblems({ ...valid, startDate: "2027-07-01", endDate: "2027-06-30" }).endDate).toMatch(/on or after the start/);
    expect(directAwardProblems({ ...valid, startDate: "2027-07-01", endDate: "2027-07-01" })).toEqual({});
    expect(directAwardProblems({ ...valid, message: "x".repeat(2001) }).message).toMatch(/2000/);
    expect(directAwardProblems({ ...valid, message: "x".repeat(2000) })).toEqual({});
  });
  it("sends the amount as a decimal string and leaves empty options out", () => {
    expect(normalizeAmount("$25,000")).toBe("25000.00");
    expect(normalizeAmount("25000.5")).toBe("25000.50");
    expect(normalizeAmount("1e3")).toBeNull();
    expect(toDirectAwardInput({ ...valid, organizationName: "  Pine Ridge  " })).toEqual({
      recipient: { organizationName: "Pine Ridge", contactEmail: "maria@pineridge.example" },
      title: "Summer programs",
      amount: { value: "25000.00", currency: "USD" },
    });
    expect(toDirectAwardInput({ ...valid, startDate: "2027-07-01", message: " Welcome ", programId: "p1" })).toMatchObject({ startDate: "2027-07-01", message: "Welcome", programId: "p1" });
  });
  it("masks an address to its first letter and domain, and formats amounts", () => {
    expect(maskEmail("Jordan@Example.org")).toBe("J…@example.org");
    expect(formatDecimalAmount("25000.00")).toBe("$25,000");
    expect(formatDecimalAmount("25000.50")).toBe("$25,000.50");
  });
});

// ---- the mock's rules ----------------------------------------------------------------------------

const DAY = 86_400_000;
const ALDER = MOCK_MEMBERSHIPS.find((m) => m.handle === "alder-creek")!.id;
const input = (over: Partial<DirectAwardInput> = {}): DirectAwardInput => ({ recipient: { organizationName: "Pine Ridge Youth Alliance", contactEmail: MOCK_USER.email }, title: "Summer programs", amount: { value: "25000.00", currency: "USD" }, message: "Welcome <b>aboard</b>", ...over });

async function riverbend(opts: { now?: () => Date; email?: string } = {}) {
  const services = createMockServices({ session: demoSession("aal2", opts.email), ...(opts.now ? { now: opts.now } : {}) });
  await services.api.workspace("riverbend");
  const api = services.api as unknown as MockDirectAwardsApi & Services["api"];
  return { services, api };
}
const tokenOf = (api: MockDirectAwardsApi, n = -1) => new URLSearchParams(new URL(api.outbox().at(n)!.link, "http://x").hash.slice(1)).get("token")!;
const codeOf = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => ({ status: (e as { status: number }).status, code: errorCode(e) }));

describe("giving an award directly (mock)", () => {
  it("offers the award to a pending recipient and shows only a masked address", async () => {
    const { api } = await riverbend();
    const award = await api.createDirectAward(input());
    expect(award.status).toBe("offered");
    expect(award.recipient).toMatchObject({ name: "Pine Ridge Youth Alliance", workspaceId: null });
    const invitation = invitationOf(award)!;
    expect(invitation).toMatchObject({ status: "sent", email: "d…@riverbendcf.example" });
    expect(Date.parse(invitation.expiresAt) - Date.parse(invitation.sentAt)).toBe(14 * DAY);
    expect(JSON.stringify(award)).not.toContain(tokenOf(api));
    expect(award.tranches).toEqual([]);
    expect((await api.listAwards()).find((a) => a.id === award.id)).toBeTruthy();
    // The email says whether the funder is verified with Passport, and carries only the claim link.
    expect(api.outbox().at(-1)).toMatchObject({ funderName: "Riverbend Community Foundation", to: MOCK_USER.email });
    expect(api.outbox().at(-1)!.link).toMatch(/^\/awards\/claim#token=[A-Za-z0-9_-]{43}$/);
  });
  it("refuses a bad request in plain words, and a member who is not admin or finance", async () => {
    const { api } = await riverbend();
    await expect(api.createDirectAward(input({ amount: { value: "0", currency: "USD" } }))).rejects.toMatchObject({ status: 422 });
    const reviewer = createMockServices({ session: demoSession() });
    await reviewer.api.workspace("cascade-county"); // a funder workspace where this person is only a reviewer
    expect(await codeOf(reviewer.api.createDirectAward(input()))).toMatchObject({ status: 403 });
  });
  it("limits a funder to 25 invitations in a rolling day, resends included", async () => {
    let now = Date.parse("2027-06-01T09:00:00Z");
    const { api } = await riverbend({ now: () => new Date(now) });
    const first = await api.createDirectAward(input());
    for (let i = 0; i < 24; i++) await api.resendInvitation(first.id);
    expect(await codeOf(api.createDirectAward(input()))).toEqual({ status: 429, code: "too_many_invitations" });
    expect(await codeOf(api.resendInvitation(first.id))).toEqual({ status: 429, code: "too_many_invitations" });
    now += DAY + 1000;
    await expect(api.resendInvitation(first.id)).resolves.toBeTruthy();
  });
  it("replaces the link on resend and lets a new address replace the old one", async () => {
    const { api } = await riverbend();
    const award = await api.createDirectAward(input());
    const old = tokenOf(api);
    const again = await api.resendInvitation(award.id, { contactEmail: "new.person@pineridge.example" });
    expect(invitationOf(again)!.email).toBe("n…@pineridge.example");
    expect(tokenOf(api)).not.toBe(old);
    expect(api.outbox().at(-1)!.to).toBe("new.person@pineridge.example");
    expect(await codeOf(api.lookupAwardInvitation(old))).toEqual({ status: 404, code: "invitation_not_found" });
    expect(await codeOf(api.resendInvitation(award.id, { contactEmail: "nope" }))).toMatchObject({ status: 422 });
  });
  it("works for the address it was sent to, once, for a workspace the person administers", async () => {
    const { api } = await riverbend();
    const award = await api.createDirectAward(input());
    const token = tokenOf(api);
    const looked = await api.lookupAwardInvitation(token);
    expect(looked).toMatchObject({ status: "pending", emailMatches: true, organizationName: "Pine Ridge Youth Alliance", funder: { name: "Riverbend Community Foundation" } });
    expect(looked.workspaces.map((w) => w.name)).toEqual(["Alder Creek Family Services"]);
    // A workspace the person is not an admin of, or a funder workspace, cannot take it.
    expect(await codeOf(api.acceptAwardInvitation({ token, workspaceId: "00000000-0000-4000-8000-000000000000" }))).toEqual({ status: 403, code: "not_workspace_admin" });
    // Passport lists verified representatives for this organization, so a legal name is asked for.
    expect(await codeOf(api.acceptAwardInvitation({ token, workspaceId: looked.workspaces[0]!.id }))).toEqual({ status: 422, code: "signer_name_required" });
    const claimed = await api.acceptAwardInvitation({ token, workspaceId: looked.workspaces[0]!.id, name: "Maria Santos" });
    expect(claimed.awardId).toBe(award.id);
    const after = await api.getAward(award.id);
    expect(after.status).toBe("accepted");
    expect(after.recipient).toMatchObject({ name: "Alder Creek Family Services" });
    expect(invitationOf(after)!.status).toBe("accepted");
    expect(await codeOf(api.acceptAwardInvitation({ token, workspaceId: looked.workspaces[0]!.id }))).toEqual({ status: 409, code: "invitation_used" });
    expect((await api.lookupAwardInvitation(token)).status).toBe("accepted");
  });
  it("never matches by name: a different signed-in address cannot accept", async () => {
    const { api } = await riverbend();
    await api.createDirectAward(input({ recipient: { organizationName: "Alder Creek Family Services", contactEmail: "someone.else@alder.example" } }));
    const token = tokenOf(api);
    const looked = await api.lookupAwardInvitation(token);
    expect(looked.emailMatches).toBe(false);
    expect(looked.workspaces).toEqual([]); // nothing to choose from when the address is not the invited one
    looked.workspaces.push({ id: ALDER, name: "", verification: { source: "none", level: null } });
    const refused = await codeOf(api.acceptAwardInvitation({ token, workspaceId: looked.workspaces[0]!.id }));
    expect(refused).toEqual({ status: 403, code: "email_mismatch" });
    await expect(api.acceptAwardInvitation({ token, workspaceId: looked.workspaces[0]!.id })).rejects.toThrow("Sign in with the address the invitation was sent to: s…@alder.example");
    expect(await codeOf(api.declineAwardInvitation({ token }))).toEqual({ status: 403, code: "email_mismatch" });
  });
  it("compares addresses without regard to case or spaces", async () => {
    const { api } = await riverbend();
    await api.createDirectAward(input({ recipient: { organizationName: "Pine Ridge", contactEmail: ` ${MOCK_USER.email.toUpperCase()} ` } }));
    expect((await api.lookupAwardInvitation(tokenOf(api))).emailMatches).toBe(true);
  });
  it("expires after 14 days, and a resend gives a fresh 14", async () => {
    let now = Date.parse("2027-06-01T09:00:00Z");
    const { api } = await riverbend({ now: () => new Date(now) });
    const award = await api.createDirectAward(input());
    const token = tokenOf(api);
    now += 14 * DAY + 1000;
    expect((await api.lookupAwardInvitation(token)).status).toBe("expired");
    expect(invitationOf(await api.getAward(award.id))!.status).toBe("expired");
    const workspaceId = ALDER;
    expect(await codeOf(api.acceptAwardInvitation({ token, workspaceId }))).toEqual({ status: 410, code: "invitation_expired" });
    await api.resendInvitation(award.id);
    expect(invitationOf(await api.getAward(award.id))!.status).toBe("sent");
    expect((await api.lookupAwardInvitation(tokenOf(api))).status).toBe("pending");
  });
  it("records a decline with its reason, and refuses a resend afterwards", async () => {
    const { api } = await riverbend();
    const award = await api.createDirectAward(input());
    await api.declineAwardInvitation({ token: tokenOf(api), reason: "We are not taking new funding" });
    expect(invitationOf(await api.getAward(award.id))!.status).toBe("declined");
    expect(await codeOf(api.resendInvitation(award.id))).toMatchObject({ status: 409 });
  });
  it("withdraws through the ordinary cancel, which revokes the link", async () => {
    const { api } = await riverbend();
    const award = await api.createDirectAward(input());
    const token = tokenOf(api);
    const cancelled = await api.cancelAward(award.id, "Entered in error");
    expect(cancelled.status).toBe("cancelled");
    expect(invitationOf(cancelled)!.status).toBe("revoked");
    expect((await api.lookupAwardInvitation(token)).status).toBe("revoked");
    expect(await codeOf(api.acceptAwardInvitation({ token, workspaceId: "x" }))).toEqual({ status: 410, code: "invitation_revoked" });
    expect(await codeOf(api.resendInvitation(award.id))).toEqual({ status: 409, code: "invitation_closed" });
  });
  it("saves the award when the email cannot be sent, says so, and a resend delivers it", async () => {
    const { api } = await riverbend();
    api.failMail(true);
    const award = await api.createDirectAward(input());
    expect(award.emailed).toBe(false);
    expect(award.status).toBe("offered");
    expect(api.outbox()).toHaveLength(0);
    api.failMail(false);
    const again = await api.resendInvitation(award.id);
    expect(again.emailed).toBe(true);
    expect(api.outbox()).toHaveLength(1);
  });
  it("leaves the recipient's workspace, handle and verification empty until acceptance", async () => {
    const { api } = await riverbend();
    const award = await api.createDirectAward(input());
    expect(award.recipient).toMatchObject({ workspaceId: null, handle: null, level: null, verification: null });
    expect(award.emailed).toBe(true);
  });
  it("lets finance give and resend an award but not withdraw it", async () => {
    const services = createMockServices({ session: demoSession(), memberships: MOCK_MEMBERSHIPS.map((m) => (m.handle === "riverbend" ? { ...m, role: "finance" } : m)) });
    await services.api.workspace("riverbend");
    const api = services.api as unknown as MockDirectAwardsApi & Services["api"];
    const award = await api.createDirectAward(input());
    await expect(api.resendInvitation(award.id)).resolves.toBeTruthy();
    expect(await codeOf(api.cancelAward(award.id, "Entered in error"))).toMatchObject({ status: 403 });
  });
  it("asks for the second step when the organization's role requires it", async () => {
    const services = createMockServices({ session: demoSession("aal1") });
    await services.api.workspace("riverbend");
    const api = services.api as unknown as MockDirectAwardsApi & Services["api"];
    await api.createDirectAward(input());
    const token = tokenOf(api);
    const looked = await api.lookupAwardInvitation(token);
    expect(await codeOf(api.acceptAwardInvitation({ token, workspaceId: looked.workspaces[0]!.id }))).toEqual({ status: 403, code: "mfa_required" });
  });
});

// ---- every state of the claim screen -------------------------------------------------------------

const lookup = (over: Partial<InvitationLookup> = {}): InvitationLookup => ({
  status: "pending",
  funder: { name: "Riverbend Community Foundation", handle: "riverbend", verification: { source: "passport", level: "L3" } },
  award: { title: "Summer programs", amount: { value: "25000.00", currency: "USD" }, startDate: "2027-07-01", endDate: "2028-06-30", message: "Welcome <b>aboard</b>" },
  organizationName: "Pine Ridge Youth Alliance",
  invitedEmail: "m…@pineridge.example",
  emailMatches: true,
  workspaces: [],
  ...over,
});
const alder = { id: "w1", name: "Alder Creek Family Services", verification: { source: "passport", level: "L3" } as const };
const pine = { id: "w2", name: "Pine Ridge Youth Alliance", verification: { source: "self_declared", level: null } as const };

function view(l: InvitationLookup, over: Partial<ClaimViewProps> = {}) {
  const handlers = { onAccept: vi.fn(), onDecline: vi.fn(), onSwitchAddress: vi.fn() };
  render(
    <MemoryRouter>
      <ClaimView lookup={l} claimUrl="/awards/claim" signedInAs="maria@pineridge.example" {...handlers} {...over} />
    </MemoryRouter>,
  );
  return handlers;
}

describe("the claim screen", () => {
  it("shows the funder, the award and the organization, with the message as plain text", () => {
    view(lookup({ workspaces: [alder] }));
    expect(screen.getByRole("heading", { level: 1, name: "Accept an award from Riverbend Community Foundation" })).toBeInTheDocument();
    expect(screen.getByText("Summer programs")).toBeInTheDocument();
    expect(screen.getByText("$25,000")).toBeInTheDocument();
    expect(screen.getByText("Welcome <b>aboard</b>")).toBeInTheDocument();
    expect(screen.getAllByText("Pine Ridge Youth Alliance").length).toBeGreaterThan(0);
    expect(screen.queryByText("Not verified")).toBeNull();
  });
  it("warns unless the funder is verified with Passport at L1 or above", () => {
    const warning = "This funder's organization is not verified with OpenGrants Passport.";
    cleanup();
    view(lookup({ funder: { name: "Small Fund", handle: "small", verification: { source: "self_declared", level: null } }, workspaces: [alder] }));
    expect(screen.getByText(warning)).toBeInTheDocument();
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    for (const v of [{ source: "passport", level: "L0" }, { source: "passport", level: null }, { source: "none", level: null }, { source: "weird", level: "L3" }, null, undefined]) {
      expect(funderIsVerified(v as never)).toBe(false);
    }
    for (const level of ["L1", "L2", "L3"]) expect(funderIsVerified({ source: "passport", level })).toBe(true);
    cleanup();
    view(lookup({ funder: { name: "Linked Fund", handle: "l", verification: { source: "passport", level: "L0" } }, workspaces: [alder] }));
    expect(screen.getByText(warning)).toBeInTheDocument();
    cleanup();
    view(lookup({ workspaces: [alder] }));
    expect(screen.queryByText(warning)).toBeNull();
  });
  it("with one organization: it is chosen, the consent is plain, and Accept sends its id", async () => {
    const h = view(lookup({ workspaces: [alder] }));
    expect(screen.getByRole("radio", { name: /Alder Creek Family Services/ })).toBeChecked();
    expect(screen.getByText("Accepting shares your organization's record with Riverbend Community Foundation.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Accept award" }));
    expect(h.onAccept).toHaveBeenCalledWith("w1", undefined);
  });
  it("with several: nothing is chosen until the person chooses, and a new organization can be set up", async () => {
    const h = view(lookup({ workspaces: [alder, pine] }));
    expect(screen.getByRole("button", { name: "Accept award" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /Pine Ridge Youth Alliance/ }));
    await userEvent.click(screen.getByRole("button", { name: "Accept award" }));
    expect(h.onAccept).toHaveBeenCalledWith("w2", undefined);
    expect(screen.getByRole("link", { name: "Set up a new organization" })).toHaveAttribute("href", setupOrganizationHref("Pine Ridge Youth Alliance", "/awards/claim"));
  });
  it("with none: sends the person to set up an organization without Passport, then back here", () => {
    view(lookup());
    const link = screen.getByRole("link", { name: "Set up your organization" });
    expect(link.getAttribute("href")).toBe("/onboarding/applicant?start=email&name=Pine%20Ridge%20Youth%20Alliance&next=%2Fawards%2Fclaim");
    expect(screen.queryByRole("button", { name: "Accept award" })).toBeNull();
    expect(screen.getByText(/does not need Passport/)).toBeInTheDocument();
  });
  it("on an address mismatch: says which address, and offers a different sign-in", async () => {
    const h = view(lookup({ emailMatches: false, workspaces: [alder] }));
    expect(screen.getByRole("alert")).toHaveTextContent("Sign in with the address the invitation was sent to: m…@pineridge.example");
    expect(screen.queryByRole("button", { name: "Accept award" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Sign in with a different address" }));
    expect(h.onSwitchAddress).toHaveBeenCalled();
  });
  it.each([
    ["accepted", "This award was already accepted"],
    ["declined", "This invitation was declined"],
    ["expired", "This invitation has expired"],
    ["revoked", "This award was withdrawn"],
  ] as const)("when it is %s: says so and offers no accept", (status, title) => {
    view(lookup({ status, workspaces: [alder] }));
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept award" })).toBeNull();
  });
  it("declines with an optional reason", async () => {
    const h = view(lookup({ workspaces: [alder] }));
    await userEvent.click(screen.getByRole("button", { name: "Decline…" }));
    const d = screen.getByRole("dialog", { name: "Decline this award" });
    await userEvent.type(within(d).getByLabelText(/Reason/), "Not a fit");
    await userEvent.click(within(d).getByRole("button", { name: "Decline award" }));
    expect(h.onDecline).toHaveBeenCalledWith("Not a fit");
  });
  it("declines with no reason too", async () => {
    const h = view(lookup());
    await userEvent.click(screen.getByRole("button", { name: "Decline…" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Decline award" }));
    expect(h.onDecline).toHaveBeenCalledWith("");
  });
  it("explains a refused accept in words", () => {
    const refused = Object.assign(new Error("Only an admin of the organization can accept an award for it."), { errors: [{ code: "not_workspace_admin" }] });
    view(lookup({ workspaces: [alder] }), { error: refused });
    expect(screen.getByText("Only an admin can accept")).toBeInTheDocument();
  });
});

// ---- the screens, end to end in the mock ---------------------------------------------------------

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}
function open(path: string, services: Services) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
      <Where />
    </MemoryRouter>,
  );
}

describe("the funder's screens", () => {
  it("sends an invitation from New award, shows its status, and resends, changes the address and withdraws", async () => {
    const services = createMockServices({ session: demoSession() });
    await services.api.workspace("riverbend");
    open("/w/riverbend/awards/new", services);
    const user = userEvent.setup();
    expect(await screen.findByText(/We'll email this person a link\. They sign in with this address, set up their organization \(Passport not needed\) and accept\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(screen.getByLabelText(/^Organization name/)).toHaveAccessibleDescription("Enter the organization's name.");
    expect(screen.getByText("Enter the contact's email address.")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Organization name/), "Pine Ridge Youth Alliance");
    await user.type(screen.getByLabelText(/^Contact email/), "maria@pineridge.example");
    await user.type(screen.getByLabelText(/^Award title/), "Summer programs");
    await user.type(screen.getByLabelText(/^Amount/), "25000");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    // The award opens with the invitation's status, as an icon and a label.
    expect(await screen.findByRole("region", { name: "Invitation" }, { timeout: 4000 })).toBeInTheDocument();
    const panel = screen.getByRole("region", { name: "Invitation" });
    expect(within(panel).getByText("Invitation sent")).toBeInTheDocument();
    expect(within(panel).getByText(/Sent to m…@pineridge\.example/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Grant agreement" })).toBeNull();

    await user.click(within(panel).getByRole("button", { name: "Resend invitation" }));
    expect(await within(panel).findByText("Invitation sent again")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Change address…" }));
    const change = screen.getByRole("dialog", { name: "Change the contact address" });
    await user.click(within(change).getByRole("button", { name: "Send to this address" }));
    expect(within(change).getByText("Enter the new email address.")).toBeInTheDocument();
    await user.type(within(change).getByLabelText(/^New email address/), "pat@pineridge.example");
    await user.click(within(change).getByRole("button", { name: "Send to this address" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(/Sent to p…@pineridge\.example/)).toBeInTheDocument();

    await user.click(within(screen.getByRole("region", { name: "Invitation" })).getByRole("button", { name: "Withdraw…" }));
    const withdraw = screen.getByRole("dialog", { name: "Withdraw this award" });
    await user.click(within(withdraw).getByRole("button", { name: "Withdraw award" }));
    expect(within(withdraw).getByText("Say why you are withdrawing this award.")).toBeInTheDocument();
    await user.type(within(withdraw).getByLabelText(/^Reason/), "Entered in error");
    await user.click(within(withdraw).getByRole("button", { name: "Withdraw award" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const table = await screen.findByRole("table", { name: "Awards" });
    const row = within(table).getAllByRole("row").find((r) => within(r).queryByText("Pine Ridge Youth Alliance"))!;
    expect(within(row).getByText("Withdrawn")).toBeInTheDocument();
    expect(within(row).getByText("Cancelled")).toBeInTheDocument();
  });

  it("says plainly when the email could not be sent, and offers Resend; finance does not see Withdraw", async () => {
    const services = createMockServices({ session: demoSession(), memberships: MOCK_MEMBERSHIPS.map((m) => (m.handle === "riverbend" ? { ...m, role: "finance" } : m)) });
    await services.api.workspace("riverbend");
    (services.api as unknown as MockDirectAwardsApi).failMail(true);
    open("/w/riverbend/awards/new", services);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Organization name/), "Pine Ridge Youth Alliance");
    await user.type(screen.getByLabelText(/^Contact email/), "maria@pineridge.example");
    await user.type(screen.getByLabelText(/^Award title/), "Summer programs");
    await user.type(screen.getByLabelText(/^Amount/), "25000");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    const panel = await screen.findByRole("region", { name: "Invitation" }, { timeout: 4000 });
    expect(within(panel).getByText("The award was saved, but the email could not be sent")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Withdraw…" })).toBeNull();
    (services.api as unknown as MockDirectAwardsApi).failMail(false);
    await user.click(within(panel).getByRole("button", { name: "Resend invitation" }));
    expect(await within(panel).findByText("Invitation sent again")).toBeInTheDocument();
    expect(within(panel).queryByText("The award was saved, but the email could not be sent")).toBeNull();
  });

  it("refuses a web or email address in the funder's text", () => {
    expect(directAwardProblems({ ...valid, message: "See https://example.org" }).message).toMatch(/cannot contain a web or email address/);
    expect(directAwardProblems({ ...valid, title: "Write to me@x.org" }).title).toMatch(/cannot contain/);
    expect(directAwardProblems({ ...valid, startDate: "2027-07-01" }).endDate).toMatch(/both the start and the end/);
  });

  it("offers New award only to an admin or finance member", async () => {
    const services = createMockServices({ session: demoSession() });
    await services.api.workspace("riverbend");
    open("/w/riverbend/awards", services);
    expect(await screen.findByRole("link", { name: "New award" })).toHaveAttribute("href", "/w/riverbend/awards/new");
  });
});

describe("the grantee's screens", () => {
  it("accepts the award for a workspace, and both sides then show it as accepted", async () => {
    const services = createMockServices({ session: demoSession() });
    await services.api.workspace("riverbend");
    const api = services.api as unknown as MockDirectAwardsApi & Services["api"];
    const award = await api.createDirectAward(input());
    const link = api.outbox().at(-1)!.link;
    open(link, services);
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Accept an award from Riverbend Community Foundation" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Accept award" }));
    // Passport lists representatives for this organization: the claim asks for the signer's legal name.
    await user.type(await screen.findByLabelText(/^Your full legal name/), "Maria Santos");
    await user.click(screen.getByRole("button", { name: "Accept award" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`/w/alder-creek/grants/${award.id}`));
    await services.api.workspace("riverbend");
    expect((await api.getAward(award.id)).status).toBe("accepted");
    expect(mockApplicantStore(services).awards[0]).toMatchObject({ id: award.id, status: "accepted" });
  });

  it("shows a link that is not valid, and a different-address sign-in", async () => {
    const services = createMockServices({ session: demoSession() });
    open("/awards/claim?token=not-a-real-token", services);
    expect(await screen.findByRole("heading", { name: "This invitation link is not valid" })).toBeInTheDocument();
  });

  it("asks a signed-out person to sign in with a next that has no token, and keeps the token for the way back", async () => {
    const token = "abcdefghij_-0123456789ABCD";
    const services = createMockServices({ session: null });
    open(`/awards/claim#token=${token}`, services);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/signin?next=%2Fawards%2Fclaim"));
    expect(getClaimToken()).toBe(token);
    clearClaimToken();
  });

  it("never lets the token into an address: not from the fragment, not from an older ?token= link, not after accepting", async () => {
    const services = createMockServices({ session: demoSession() });
    await services.api.workspace("riverbend");
    const api = services.api as unknown as MockDirectAwardsApi & Services["api"];
    const seen: string[] = [];
    const calls: string[] = [];
    const real = api.lookupAwardInvitation;
    api.lookupAwardInvitation = (t) => (calls.push(t), real(t));
    function Spy() {
      const l = useLocation();
      seen.push(l.pathname + l.search + l.hash);
      return null;
    }
    await api.createDirectAward(input());
    const token = tokenOf(api);
    for (const entry of [`/awards/claim#token=${token}`, `/awards/claim?token=${token}`]) {
      clearClaimToken();
      seen.length = 0;
      calls.length = 0;
      const view = render(
        <MemoryRouter initialEntries={[entry]}>
          <App services={services} />
          <Spy />
        </MemoryRouter>,
      );
      await screen.findByRole("heading", { level: 1, name: /Accept an award from/ });
      expect(calls).toEqual([token]); // the token travels as an argument (a request body), never in an address
      expect(seen.at(-1)).toBe("/awards/claim");
      view.unmount();
    }
    // Accepting for the workspace clears the stored token and lands on the grant, not on an address with a token.
    clearClaimToken();
    seen.length = 0;
    render(
      <MemoryRouter initialEntries={[`/awards/claim#token=${token}`]}>
        <App services={services} />
        <Spy />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Accept award" }));
    await user.type(await screen.findByLabelText(/^Your full legal name/), "Maria Santos");
    await user.click(screen.getByRole("button", { name: "Accept award" }));
    await waitFor(() => expect(seen.at(-1)).toMatch(/^\/w\/alder-creek\/grants\//));
    // The arrival address is the only one that holds it (a fragment, which is never sent to a server).
    expect(seen.slice(1).filter((a) => a.includes(token))).toEqual([]);
    expect(getClaimToken()).toBe("");
  });

  it("sends the token only in a request body, never in a path or query", async () => {
    const urls: string[] = [];
    const bodies: string[] = [];
    const api = createHttpApi({
      baseUrl: "https://api.example",
      token: async () => "jwt",
      identity: async () => ({ email: "x@example.org" }),
      fetch: (async (url: string, init?: RequestInit) => {
        urls.push(String(url));
        bodies.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch,
    });
    const token = "gms_awi_abcdefghijklmnopqrstuvwxyz0123456789ABCD";
    await api.lookupAwardInvitation(token);
    await api.acceptAwardInvitation({ token, workspaceId: "w", name: "Maria Santos" });
    await api.declineAwardInvitation({ token });
    expect(urls.every((u) => !u.includes(token) && !u.includes("?"))).toBe(true);
    expect(bodies.every((b) => b.includes(token))).toBe(true);
  });

  it("shows an address mismatch from a real lookup", async () => {
    const { services, api } = await riverbend();
    await api.createDirectAward(input({ recipient: { organizationName: "Pine Ridge", contactEmail: "maria@pineridge.example" } }));
    open(api.outbox().at(-1)!.link, services);
    expect(await screen.findByText(/Sign in with the address the invitation was sent to: m…@pineridge\.example/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with a different address" })).toBeInTheDocument();
  });
});
