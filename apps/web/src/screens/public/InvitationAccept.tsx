// SPDX-License-Identifier: AGPL-3.0-only
// Where the link in an invitation email lands (`/invitations/accept?token=…`). Behind RequireAuth:
// someone signed out signs in first and comes back here with the token still in the address.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { MailCheck, TriangleExclamationPoint } from "lucide-react";
import { ApiError } from "../../api/client.ts";
import { useServices } from "../../app/services.tsx";
import { isReviewOnly } from "../../lib/roles.ts";

type State = { status: "joining" } | { status: "failed"; title: string; detail: string };

/** Why joining did not work, in words the invited person can act on. */
export function invitationProblem(error: unknown): { title: string; detail: string } {
  if (error instanceof ApiError && (error.status === 404 || error.status === 410)) {
    return {
      title: "This invitation can't be used",
      detail: "It has already been used, has expired, or the link is incomplete. Ask the person who invited you to send a new one.",
    };
  }
  if (error instanceof ApiError && (error.status === 400 || error.status === 422)) {
    return { title: "This invitation link is incomplete", detail: "Open the link from your invitation email again, or paste the whole link." };
  }
  return { title: "You could not be added just now", detail: "Nothing was changed. Try the link again in a moment." };
}

export default function InvitationAccept() {
  const { api, reloadMe } = useServices();
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
    api.acceptInvitation(token).then(
      ({ workspace, role }) => {
        reloadMe();
        // Reviewers work in the reviewer portal; everyone else opens the workspace.
        navigate(isReviewOnly(role) ? "/review/assignments" : `/w/${workspace.handle}`, { replace: true });
      },
      (error: unknown) => setState({ status: "failed", ...invitationProblem(error) }),
    );
  }, [api, token, navigate, reloadMe]);

  return (
    <div className="gms gms-frame" style={{ alignItems: "center", justifyContent: "center" }}>
      <title>Join a workspace — OpenGrants GMS</title>
      {state.status === "joining" ? (
        <div className="empty" role="status" aria-busy="true">
          <MailCheck className="ic" aria-hidden="true" />
          <h3>Adding you to the workspace</h3>
          <p>One moment.</p>
        </div>
      ) : (
        <div className="empty" role="alert">
          <TriangleExclamationPoint className="ic" aria-hidden="true" />
          <h3>{state.title}</h3>
          <p>{state.detail}</p>
          <div className="acts">
            <Link to="/workspaces" className="btn btn-primary">
              Go to your workspaces
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
