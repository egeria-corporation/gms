// SPDX-License-Identifier: AGPL-3.0-only
// Why an invitation could not be sent, in words a funder can act on. Anything not listed here is
// shown as the server worded it.
import { errorCode } from "../api/directAwards.ts";
import { ErrorBanner } from "./ui.tsx";

import { translator } from "../i18n/index.tsx";

const t = translator("shared");

const WORDS: Record<string, { title: string; detail: string }> = {
  funder_name_looks_like_link: {
    get title() {
      return t("invitationError.words.funder_name_looks_like_link.title");
    },
    get detail() {
      return t("invitationError.words.funder_name_looks_like_link.detail");
    },
  },
  too_many_invitations: {
    get title() {
      return t("invitationError.words.too_many_invitations.title");
    },
    get detail() {
      return t("invitationError.words.too_many_invitations.detail");
    },
  },
  too_many_invitations_from_you: { get title() {
    return t("invitationError.words.too_many_invitations_from_you.title");
  }, get detail() {
    return t("invitationError.words.too_many_invitations_from_you.detail");
  } },
  too_many_invitations_from_network: { get title() {
    return t("invitationError.words.too_many_invitations_from_network.title");
  }, get detail() {
    return t("invitationError.words.too_many_invitations_from_network.detail");
  } },
  too_many_invitations_to_recipient: { get title() {
    return t("invitationError.words.too_many_invitations_to_recipient.title");
  }, get detail() {
    return t("invitationError.words.too_many_invitations_to_recipient.detail");
  } },
  invitations_paused: { get title() {
    return t("invitationError.words.invitations_paused.title");
  }, get detail() {
    return t("invitationError.words.invitations_paused.detail");
  } },
  insufficient_scope: { get title() {
    return t("invitationError.words.insufficient_scope.title");
  }, get detail() {
    return t("invitationError.words.insufficient_scope.detail");
  } },
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
