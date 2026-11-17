// SPDX-License-Identifier: AGPL-3.0-only
// `/join/:token` (E4): an intermediary's co-branded onboarding page, for its funds' grantees and
// affiliated funders. It names the intermediary and its funds and shows the logo it uploaded, with
// its alt text; colours come only from the theme. Grantees go on into the normal applicant sign-up;
// funders set up a funder workspace here with funder setup's first step. Either way the new
// workspace is counted for this link, by its id.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowRight, Building2, Handshake, Landmark, Link2Off } from "lucide-react";
import { forgetReferral, rememberReferral } from "../../api/loops.ts";
import { useLoopsApi, useLoopsQuery } from "../../api/loopsHooks.ts";
import { useServices } from "../../app/services.tsx";
import { VerificationBadge } from "../../components/status.tsx";
import { ErrorBanner, Loading, Notice } from "../../components/ui.tsx";
import { translator } from "../../i18n/index.tsx";
import { FunderQuickStart, LoopsFrame } from "./loopsParts.tsx";

const t = translator("public");
const isNotFound = (e: unknown) => (e as { status?: number } | null)?.status === 404;

/** Back from the applicant sign-up: count the organization the person just set up, then open it. */
function JoinedAsGrantee({ token }: { token: string }) {
  const { meState } = useServices();
  const loops = useLoopsApi();
  const navigate = useNavigate();
  const ran = useRef(false);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (ran.current || meState.status !== "ready") return;
    ran.current = true;
    const mine = meState.me.workspaces.filter((w) => w.kind === "applicant" && w.role === "admin").reverse();
    void (async () => {
      for (const w of mine) {
        const r = await loops.claim({ workspaceId: w.id, source: "onboarding", token }).catch(() => null);
        if (r) {
          forgetReferral();
          return setDone(w.handle);
        }
      }
      setDone(mine[0]?.handle ?? "");
    })();
  }, [loops, meState, token]);
  if (done === null) return <Loading />;
  return (
    <Notice tone="ok" title={t("join.grantee.ready")}>
      {done ? (
        <button type="button" className="btn btn-primary" onClick={() => navigate(`/w/${done}`)}>
          {t("join.grantee.open")}
          <ArrowRight className="ic" aria-hidden="true" />
        </button>
      ) : null}
    </Notice>
  );
}

export default function Join() {
  const { token = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const query = useLoopsQuery((api) => api.onboardingPage(token), [token]);
  const [funderSetup, setFunderSetup] = useState(params.get("setup") === "1");
  const page = query.status === "ready" ? query.data : null;
  useEffect(() => {
    if (page) rememberReferral({ source: "onboarding", token, name: page.intermediary.name });
  }, [page, token]);

  return (
    <LoopsFrame>
      <title>{page ? t("join.pageTitle", { name: page.intermediary.name }) : t("join.pageTitleGeneric")}</title>
      <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "24px", paddingTop: "32px", paddingBottom: "48px", maxWidth: "880px" }}>
        {query.status === "loading" && <Loading />}
        {query.status === "error" &&
          (isNotFound(query.error) ? (
            <section className="card" aria-labelledby="join-gone">
              <div className="card-b row" style={{ gap: "12px", alignItems: "flex-start" }}>
                <Link2Off className="ic ic-md" aria-hidden="true" />
                <div>
                  <h1 id="join-gone" style={{ fontSize: "20px" }}>
                    {t("join.gone.title")}
                  </h1>
                  <p className="muted">{t("join.gone.text")}</p>
                  <Link to="/for-funders">{t("join.gone.forFunders")}</Link>
                </div>
              </div>
            </section>
          ) : (
            <ErrorBanner error={query.error} onRetry={query.reload} />
          ))}
        {page && (
          <>
            <header className="row" style={{ gap: "20px", alignItems: "center", flexWrap: "wrap" }}>
              {page.logo && <img src={page.logo.url} alt={page.logo.alt} style={{ maxHeight: "72px", maxWidth: "220px", width: "auto", objectFit: "contain" }} />}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: "1 1 320px" }}>
                <span className="eyebrow">{t("join.eyebrow")}</span>
                <h1 style={{ fontSize: "30px", color: "var(--og-navy-dark)" }}>{t("join.title", { name: page.intermediary.name })}</h1>
                <div>
                  <VerificationBadge verification={page.intermediary.verification} />
                </div>
              </div>
            </header>
            <p style={{ fontSize: "17px" }}>{t("join.lede", { name: page.intermediary.name })}</p>
            <section className="card" aria-labelledby="join-funds">
              <div className="card-h">
                <h2 id="join-funds" style={{ fontSize: "16px" }} className="row">
                  <Landmark className="ic" aria-hidden="true" />
                  {t("join.funds", { name: page.intermediary.name })}
                </h2>
              </div>
              <div className="card-b">
                <ul style={{ margin: 0, paddingLeft: "20px" }}>
                  {page.funds.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            </section>
            {params.get("joined") === "applicant" ? (
              <JoinedAsGrantee token={token} />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", alignItems: "start" }}>
                <section className="card" aria-labelledby="join-grantee">
                  <div className="card-h">
                    <h2 id="join-grantee" style={{ fontSize: "16px" }} className="row">
                      <Building2 className="ic" aria-hidden="true" />
                      {t("join.grantee.title")}
                    </h2>
                  </div>
                  <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <p>{t("join.grantee.text", { name: page.intermediary.name })}</p>
                    <div>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          rememberReferral({ source: "onboarding", token, name: page.intermediary.name });
                          navigate(`/onboarding/applicant?next=${encodeURIComponent(`/join/${token}?joined=applicant`)}`);
                        }}
                      >
                        {t("join.grantee.start")}
                        <ArrowRight className="ic" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </section>
                <section className="card" aria-labelledby="join-funder">
                  <div className="card-h">
                    <h2 id="join-funder" style={{ fontSize: "16px" }} className="row">
                      <Handshake className="ic" aria-hidden="true" />
                      {t("join.funder.title")}
                    </h2>
                  </div>
                  <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {funderSetup ? (
                      <FunderQuickStart source="onboarding" token={token} joiningWith={page.intermediary.name} headingId="join-funder" />
                    ) : (
                      <>
                        <p>{t("join.funder.text", { name: page.intermediary.name })}</p>
                        <div>
                          <button type="button" className="btn btn-secondary" onClick={() => setFunderSetup(true)}>
                            {t("join.funder.start")}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </section>
              </div>
            )}
            <p className="small muted">{t("join.free")}</p>
          </>
        )}
      </div>
    </LoopsFrame>
  );
}
