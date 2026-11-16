// SPDX-License-Identifier: AGPL-3.0-only
// Where the link in an invitation into a draft lands (`/invitations/draft?token=…`). Behind
// RequireAuth: someone signed out signs in first and comes back here with the token. Accepting
// opens the draft, on the question or section they were asked to write.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { MailCheck, TriangleExclamationPoint } from "lucide-react";
import { ApiError } from "../../api/client.ts";
import { landingPath } from "../../api/invites.ts";
import { useInvitesApi } from "../../api/invitesHooks.ts";
import { useServices } from "../../app/services.tsx";
import { invitationProblem } from "../public/InvitationAccept.tsx";
import { t, useApplicantText } from "./i18n.ts";

type State = { status: "joining" } | { status: "failed"; title: string; detail: string };

export default function JoinDraft() {
  useApplicantText();
  const api = useInvitesApi();
  const { reloadMe } = useServices();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token")?.trim() ?? "";
  const [state, setState] = useState<State>({ status: "joining" });
  // An invitation works once: never post it twice (React runs effects twice in development).
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    if (!token) {
      setState({ status: "failed", ...invitationProblem(new ApiError(400, "Missing token")) });
      return;
    }
    api.acceptDraftInvitation(token).then(
      ({ workspace, draft }) => {
        reloadMe();
        navigate(landingPath(workspace.handle, draft), { replace: true });
      },
      (error: unknown) =>
        setState(
          error instanceof ApiError && error.status === 403
            ? { status: "failed", title: t("joinDraft.otherEmail"), detail: t("joinDraft.otherEmailDetail", { message: error.message }) }
            : { status: "failed", ...invitationProblem(error) },
        ),
    );
  }, [api, token, navigate, reloadMe]);

  return (
    <div className="gms gms-frame" style={{ alignItems: "center", justifyContent: "center" }}>
      <title>{t("joinDraft.joinAnApplicationOpengrantsGms")}</title>
      {state.status === "joining" ? (
        <div className="empty" role="status" aria-busy="true">
          <MailCheck className="ic" aria-hidden="true" />
          <h3>{t("joinDraft.openingTheApplicationYouWereInvited")}</h3>
          <p>{t("joinDraft.oneMoment")}</p>
        </div>
      ) : (
        <div className="empty" role="alert">
          <TriangleExclamationPoint className="ic" aria-hidden="true" />
          <h3>{state.title}</h3>
          <p>{state.detail}</p>
          <div className="acts">
            <Link to="/workspaces" className="btn btn-primary">
              {t("joinDraft.goToYourWorkspaces")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
