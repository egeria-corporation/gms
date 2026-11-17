// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { SearchX } from "lucide-react";

export function NotFound() {
  return (
    <div className="gms gms-frame" style={{ alignItems: "center", justifyContent: "center" }}>
      <title>Page not found — OpenGrants GMS</title>
      <main className="empty">
        <SearchX className="ic" aria-hidden="true" />
        <h1 className="empty-h">Page not found</h1>
        <p>This page does not exist, or you do not have access to the workspace it belongs to.</p>
        <div className="acts">
          <Link to="/" className="btn btn-primary">
            Go to OpenGrants GMS
          </Link>
          <Link to="/workspaces">Switch workspace</Link>
        </div>
      </main>
    </div>
  );
}
