// SPDX-License-Identifier: AGPL-3.0-only
// `/partners` (E4): the partner directory. Intermediaries (workspaces that run several funds) that
// asked to be listed and that an operator approved: name, region, number of funds, how verified,
// and a link to their public page. Nothing else about them, and nothing about who they fund.
import { ExternalLink, Handshake, Landmark, MapPin } from "lucide-react";
import { Link } from "react-router";
import { useLoopsQuery } from "../../api/loopsHooks.ts";
import { VerificationBadge } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Loading } from "../../components/ui.tsx";
import { translator } from "../../i18n/index.tsx";
import { LoopsFrame } from "./loopsParts.tsx";

const t = translator("public");

export default function Partners() {
  const query = useLoopsQuery((api) => api.partners(), []);
  return (
    <LoopsFrame>
      <title>{t("partners.pageTitle")}</title>
      <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "20px", paddingTop: "32px", paddingBottom: "48px" }}>
        <header style={{ display: "flex", flexDirection: "column", gap: "10px", maxWidth: "720px" }}>
          <h1 style={{ fontSize: "30px", color: "var(--og-navy-dark)" }} className="row">
            <Handshake className="ic ic-lg" aria-hidden="true" />
            {t("partners.title")}
          </h1>
          <p>{t("partners.lede")}</p>
        </header>
        {query.status === "loading" && <Loading label={t("partners.loading")} />}
        {query.status === "error" && <ErrorBanner error={query.error} onRetry={query.reload} />}
        {query.status === "ready" &&
          (query.data.length === 0 ? (
            <div className="card">
              <EmptyState icon={Handshake} title={t("partners.empty")}>
                {t("partners.emptyNote")}
              </EmptyState>
            </div>
          ) : (
            <ul aria-label={t("partners.listLabel")} style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
              {query.data.map((p) => (
                <li key={p.handle} className="card" aria-labelledby={`partner-${p.handle}`}>
                  <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <h2 id={`partner-${p.handle}`} style={{ fontSize: "17px" }}>
                      {p.name}
                    </h2>
                    <div>
                      <VerificationBadge verification={p.verification} />
                    </div>
                    <dl className="kv">
                      <dt>
                        <MapPin className="ic ic-sm" aria-hidden="true" /> {t("partners.region")}
                      </dt>
                      <dd>{p.region}</dd>
                      <dt>
                        <Landmark className="ic ic-sm" aria-hidden="true" /> {t("partners.funds")}
                      </dt>
                      <dd>{t("partners.fundCount", { count: p.funds })}</dd>
                    </dl>
                  </div>
                  <div className="card-f">
                    <Link to={`/f/${p.handle}`} className="b row" style={{ gap: "6px" }}>
                      {t("partners.publicPage", { name: p.name })}
                      <ExternalLink className="ic ic-sm" aria-hidden="true" />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ))}
        <p className="small muted">
          {t.rich("partners.howToJoin", { link: (chunks) => <Link to="/for-funders">{chunks}</Link> })}
        </p>
      </div>
    </LoopsFrame>
  );
}
