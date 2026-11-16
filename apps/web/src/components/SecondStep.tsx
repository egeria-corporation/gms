// SPDX-License-Identifier: AGPL-3.0-only
// The server refuses an admin action until the person has done the second step of sign-in
// (403 `mfa_required`). Workspace pages send the person to that step on their own; the setup pages
// sit outside them, so they show this instead of a dead-end error, with a link that comes back here.
import { Link } from "react-router";
import { errorCode } from "../api/directAwards.ts";
import { signInPath } from "../auth/RequireAuth.tsx";
import { Notice } from "./ui.tsx";

import { translator } from "../i18n/index.tsx";

const t = translator("shared");
/** True when the API refused because the second step of sign-in is still to do. */
export const needsSecondStep = (error: unknown): boolean => errorCode(error) === "mfa_required";

export function SecondStepNotice({ next }: { next: string }) {
  return (
    <Notice tone="warn" title={t("secondStep.setUpTwoStepVerification")}>
      {t.rich("secondStep.adminsSignInWithA", { link: (chunks) => <Link to={signInPath(next, "mfa")}>{chunks}</Link> })}
    </Notice>
  );
}
