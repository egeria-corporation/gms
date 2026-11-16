// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { SearchX } from "lucide-react";

import { translator } from "../i18n/index.tsx";

const t = translator("shared");
export function NotFound() {
  return (
    <div className="gms gms-frame" style={{ alignItems: "center", justifyContent: "center" }}>
      <title>{t("notFound.pageNotFoundOpengrantsGms")}</title>
      <main className="empty">
        <SearchX className="ic" aria-hidden="true" />
        <h1 className="empty-h">{t("notFound.pageNotFound")}</h1>
        <p>{t("notFound.thisPageDoesNotExist")}</p>
        <div className="acts">
          <Link to="/" className="btn btn-primary">
            {t("notFound.goToOpengrantsGms")}
          </Link>
          <Link to="/workspaces">{t("notFound.switchWorkspace")}</Link>
        </div>
      </main>
    </div>
  );
}
