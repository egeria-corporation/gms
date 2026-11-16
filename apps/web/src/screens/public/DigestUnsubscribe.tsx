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

import { translator } from "../../i18n/index.tsx";


const t = translator("public");
type State = { status: "working" } | { status: "done"; out: DigestUnsubscribed } | { status: "failed"; expired: boolean; message: string };

export default function DigestUnsubscribe() {
  const api = useDigestsApi();
  const location = useLocation();
  const token = unsubscribeTokenFrom(location.hash, location.search);
  const [state, setState] = useState<State>(token ? { status: "working" } : { status: "failed", expired: false, message: t("digestUnsubscribe.thisLinkIsMissingIts") });

  useEffect(() => {
    if (!token) return;
    let live = true;
    api.unsubscribe(token).then(
      (out) => live && setState({ status: "done", out }),
      (e: unknown) => live && setState({ status: "failed", expired: e instanceof ApiError && e.status === 410, message: e instanceof Error ? e.message : t("digestUnsubscribe.thatDidNotWork") }),
    );
    return () => {
      live = false;
    };
  }, [api, token]);

  return (
    <>
      <title>{t("digestUnsubscribe.unsubscribeOpengrantsGms")}</title>
      <main className="main" style={{ maxWidth: "560px", margin: "48px auto", padding: "0 16px" }}>
        <div className="card">
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {state.status === "working" ? (
              <p role="status">
                <LoaderCircle className="ic" aria-hidden="true" /> {t("digestUnsubscribe.turningThisEmailOff")}
              </p>
            ) : state.status === "done" ? (
              <>
                <h1 style={{ fontSize: "22px" }}>
                  <CircleCheck className="ic ic-lg" aria-hidden="true" /> {t("digestUnsubscribe.youWonTGetThis")}
                </h1>
                <p>
                  {state.out.workspace ? t("digestUnsubscribe.offFor", { label: state.out.label, workspace: state.out.workspace }) : t("digestUnsubscribe.off", { label: state.out.label })}
                </p>
                <p className="small muted">
                  {t.rich("digestUnsubscribe.changedYourMindSignIn", { link: (chunks) => <Link to="/notifications">{chunks}</Link> })}
                </p>
              </>
            ) : (
              <>
                <h1 style={{ fontSize: "22px" }}>
                  <CircleX className="ic ic-lg" aria-hidden="true" /> {state.expired ? t("digestUnsubscribe.thisLinkHasExpired") : t("digestUnsubscribe.thisLinkDidNotWork")}
                </h1>
                <p>{state.message}</p>
                <p className="small muted">
                  <Link to="/notifications">{t("digestUnsubscribe.signInToChooseWhat")}</Link>.
                </p>
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
