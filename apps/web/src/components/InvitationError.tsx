// SPDX-License-Identifier: AGPL-3.0-only
// Why an invitation could not be sent, in words a funder can act on. Anything not listed here is
// shown as the server worded it.
import { errorCode } from "../api/directAwards.ts";
import { ErrorBanner } from "./ui.tsx";

const WORDS: Record<string, { title: string; detail: string }> = {
  funder_name_looks_like_link: {
    title: "Your organization's name reads like a web or email address",
    detail: "Invitations are sent under your organization's name, and a name that looks like a link cannot be used. Rename the workspace in Settings (or, if it comes from Passport, correct it there), then try again.",
  },
  too_many_invitations: {
    title: "Too many invitations today",
    detail: "This workspace has reached its limit for invitations in 24 hours. The limit is lower for funders that are not verified with OpenGrants Passport. Try again tomorrow, or link Passport to raise it.",
  },
  too_many_invitations_from_you: { title: "You have sent a lot of invitations today", detail: "You have reached the most invitations one person can send in 24 hours, across all your workspaces. Try again tomorrow." },
  too_many_invitations_from_network: { title: "Too many invitations from this network", detail: "A lot of invitations were sent from your network in the last 24 hours. Try again later." },
  too_many_invitations_to_recipient: { title: "This address has had several invitations", detail: "This email address has been sent the most invitations allowed in a week. Try again later, or use a different contact." },
  invitations_paused: { title: "Invitations are paused for now", detail: "Many invitations were sent across OpenGrants GMS in the last 24 hours, so sending is paused. Try again later." },
  insufficient_scope: { title: "Your role cannot give awards", detail: "Giving an award directly is for workspace admins and program officers. Ask one of them." },
};

export function InvitationError({ error, title }: { error: unknown; title: string }) {
  const known = WORDS[errorCode(error) ?? ""];
  if (!known) return <ErrorBanner error={error} title={title} />;
  return (
    <div className="bnr bnr-dng" role="alert">
      <div>
        <div className="t">{known.title}</div>
        <div className="d">{known.detail}</div>
      </div>
    </div>
  );
}
