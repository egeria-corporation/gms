// SPDX-License-Identifier: AGPL-3.0-only
// The page an email's "Stop getting this email" link opens. No sign-in: the signed token in the
// link's fragment turns that one digest off as the page opens (one click from the email). Nothing
// else changes; the person can turn it back on in their settings after signing in.
import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { ApiError } from "../../api/client.ts";
import { unsubscribeTokenFrom, type DigestUnsubscribed } from "../../api/digests.ts";
import { useDigestsApi } from "../../api/digestsHooks.ts";

type State = { status: "working" } | { status: "done"; out: DigestUnsubscribed } | { status: "failed"; expired: boolean; message: string };

export default function DigestUnsubscribe() {
  const api = useDigestsApi();
  const location = useLocation();
  const token = unsubscribeTokenFrom(location.hash, location.search);
  const [state, setState] = useState<State>(token ? { status: "working" } : { status: "failed", expired: false, message: "This link is missing its code. Open it again from the email." });

  useEffect(() => {
    if (!token) return;
    let live = true;
    api.unsubscribe(token).then(
      (out) => live && setState({ status: "done", out }),
      (e: unknown) => live && setState({ status: "failed", expired: e instanceof ApiError && e.status === 410, message: e instanceof Error ? e.message : "That did not work" }),
    );
    return () => {
      live = false;
    };
  }, [api, token]);

  return (
    <>
      <title>Unsubscribe — OpenGrants GMS</title>
      <main className="main" style={{ maxWidth: "560px", margin: "48px auto", padding: "0 16px" }}>
        <div className="card">
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {state.status === "working" ? (
              <p role="status">
                <LoaderCircle className="ic" aria-hidden="true" /> Turning this email off…
              </p>
            ) : state.status === "done" ? (
              <>
                <h1 style={{ fontSize: "22px" }}>
                  <CircleCheck className="ic ic-lg" aria-hidden="true" /> You won't get this email anymore
                </h1>
                <p>
                  "{state.out.label}"{state.out.workspace ? ` for ${state.out.workspace}` : ""} is off. Other emails you chose are not changed.
                </p>
                <p className="small muted">
                  Changed your mind? <Link to="/notifications">Sign in to choose what we email you</Link>.
                </p>
              </>
            ) : (
              <>
                <h1 style={{ fontSize: "22px" }}>
                  <CircleX className="ic ic-lg" aria-hidden="true" /> {state.expired ? "This link has expired" : "This link did not work"}
                </h1>
                <p>{state.message}</p>
                <p className="small muted">
                  <Link to="/notifications">Sign in to choose what we email you</Link>.
                </p>
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
