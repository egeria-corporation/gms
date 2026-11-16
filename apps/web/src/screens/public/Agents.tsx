// SPDX-License-Identifier: AGPL-3.0-only
// For agents and the people who connect them: what the GMS offers over MCP, how to connect, and
// which actions always come back to a person. When an API is configured, the live tool reference
// is read from its /llms.txt, so this page cannot drift from what the server actually serves.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Bot, Check, ExternalLink, Lock, ShieldCheck } from "lucide-react";
import { env } from "../../env.ts";

import { translator } from "../../i18n/index.tsx";

import { LanguageSwitcher } from "../../components/LanguageSwitcher.tsx";
const t = translator("public");
const ORIGIN = env.apiBaseUrl || "https://gms.opengrants.io";

/** Calls that pause for a person's approval when an agent makes them. */
const GATED = (): { tool: string; what: string; humanOnly: boolean }[] => ([
  { tool: "submit_application", what: t("agents.gated.n0.what"), humanOnly: false },
  { tool: "decline_application", what: t("agents.gated.n1.what"), humanOnly: false },
  { tool: "commit_decisions", what: t("agents.gated.n2.what"), humanOnly: false },
  { tool: "send_communication", what: t("agents.gated.n3.what"), humanOnly: false },
  { tool: "accept_award", what: t("agents.gated.n4.what"), humanOnly: true },
  { tool: "sign_agreement", what: t("agents.gated.n5.what"), humanOnly: true },
  { tool: "release_tranche", what: t("agents.gated.n6.what"), humanOnly: true },
]);

const CAN_DO = () => ([
  t("agents.canDo.n0"),
  t("agents.canDo.n1"),
  t("agents.canDo.n2"),
  t("agents.canDo.n3"),
  t("agents.canDo.n4"),
]);

export default function Agents() {
  const [reference, setReference] = useState<{ status: "idle" | "loading" | "ready" | "unavailable"; text?: string }>({ status: env.useMocks ? "idle" : "loading" });
  useEffect(() => {
    if (env.useMocks || !env.apiBaseUrl) return;
    let live = true;
    fetch(`${env.apiBaseUrl}/llms.txt`).then(
      async (r) => {
        if (!live) return;
        setReference(r.ok ? { status: "ready", text: await r.text() } : { status: "unavailable" });
      },
      () => live && setReference({ status: "unavailable" }),
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <>
      <title>{t("agents.forAgentsOpengrantsGms")}</title>
      <div className="gms pub gms-frame">
        <header style={{ borderBottom: "1px solid var(--og-gray-200)", background: "var(--og-white)" }}>
          <div className="wrap-c" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "24px", minHeight: "64px", flexWrap: "wrap" }}>
            <Link to="/" style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none", fontFamily: "var(--font-display)", fontWeight: 700, color: "var(--og-navy-dark)", fontSize: "16px" }}>
              <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" style={{ height: "22px", width: "auto", display: "block" }} />
              <span style={{ color: "var(--og-teal-dark)", fontWeight: 500 }}>GMS</span>
            </Link>
            <nav aria-label={t("agents.primary")} style={{ display: "flex", alignItems: "center", gap: "24px", fontSize: "14px", fontWeight: 700, flexWrap: "wrap" }}>
              <Link to="/" style={{ color: "var(--og-gray-800)" }}>
                {t("agents.home")}
              </Link>
              <Link to="/signin" className="btn btn-secondary">
                {t("agents.signIn")}
              </Link>
            </nav>
          </div>
        </header>
        <main>
          <section style={{ background: "var(--grad-hero)", padding: "48px 0 40px", borderTop: 0 }}>
            <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <span className="og-eyebrow" style={{ color: "var(--og-teal-dark)" }}>
                <Bot className="ic" aria-hidden="true" />
                {t("agents.forAgents")}
              </span>
              <h1 style={{ fontSize: "40px", maxWidth: "760px", color: "var(--og-navy-dark)" }}>{t("agents.agentsAreFirstClassUsers")}</h1>
              <p style={{ fontSize: "18px", maxWidth: "720px", lineHeight: 1.6 }}>
                {t("agents.everythingAPersonCanDo")}
              </p>
            </div>
          </section>

          <section>
            <div className="wrap-c" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px" }}>
              <div className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <h2 style={{ fontSize: "20px", marginBottom: 0 }}>{t("agents.connect")}</h2>
                <ol style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "15px", listStyle: "decimal", paddingLeft: "20px" }}>
                  <li>
                    {t.rich("agents.addTheMcpServerMcp", { ORIGIN, code: (chunks) => <code>{chunks}</code> })}
                  </li>
                  <li>{t("agents.theClientRegistersItselfAnd")}</li>
                  <li>{t("agents.aSignedInPersonPicks")}</li>
                  <li>{t("agents.theAgentSTokenIs")}</li>
                </ol>
                <p className="help">
                  {t.rich("agents.discoveryWellKnownOauthProtected", { ORIGIN, code: (chunks) => <code>{chunks}</code>, code2: (chunks) => <code>{chunks}</code>, code3: (chunks) => <code>{chunks}</code>, code4: (chunks) => <code>{chunks}</code> })}
                </p>
              </div>
              <div className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <h2 style={{ fontSize: "20px", marginBottom: 0 }}>{t("agents.whatAnAgentCanDo")}</h2>
                <ul style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px" }}>
                  {CAN_DO().map((line) => (
                    <li key={line} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                      <Check className="ic" aria-hidden="true" style={{ color: "var(--og-teal-dark)", marginTop: "5px" }} />
                      {line}
                    </li>
                  ))}
                </ul>
                <p className="help">{t.rich("agents.theSameDataIsReadable", { code: (chunks) => <code>{chunks}</code> })}</p>
              </div>
            </div>
          </section>

          <section>
            <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <h2>{t("agents.humanGates")}</h2>
              <p style={{ maxWidth: "760px" }}>
                {t.rich("agents.whenAnAgentCallsOne", { code: (chunks) => <code>{chunks}</code>, code2: (chunks) => <code>{chunks}</code> })}
              </p>
              <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("agents.toolsThatNeedAPerson")}>
                <table className="tbl" style={{ fontSize: "15px" }}>
                  <caption className="sr">{t("agents.toolsThatNeedAPerson2")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("agents.action")}</th>
                      <th scope="col">{t("agents.tool")}</th>
                      <th scope="col">{t("agents.whoCompletesIt")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {GATED().map((g) => (
                      <tr key={g.tool}>
                        <td style={{ whiteSpace: "normal" }}>{g.what}</td>
                        <td>
                          <code>{g.tool}</code>
                        </td>
                        <td style={{ whiteSpace: "normal" }}>
                          {g.humanOnly ? (
                            <span className="bdg bdg-warn">
                              <Lock className="ic" aria-hidden="true" />
                              {t("agents.aPersonAlways")}
                            </span>
                          ) : (
                            <span className="bdg bdg-agent">
                              <ShieldCheck className="ic" aria-hidden="true" />
                              {t("agents.aPersonApprovesTheAgent")}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="help">{t("agents.theGmsNeverStoresBank")}</p>
            </div>
          </section>

          <section>
            <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <h2>{t("agents.toolReference")}</h2>
              {reference.status === "ready" ? (
                <pre style={{ whiteSpace: "pre-wrap", maxHeight: "560px", overflow: "auto" }} tabIndex={0} role="region" aria-label={t("agents.toolReferenceFromLlmsTxt")}>
                  {reference.text}
                </pre>
              ) : (
                <p>
                  {reference.status === "loading" ? `${t("agents.loadingTheReference")} ` : reference.status === "unavailable" ? `${t("agents.theReferenceCouldNotBe")} ` : ""}
                  {t.rich("agents.fullListServedAt", {
                    origin: ORIGIN,
                    short: (chunks) => (
                      <a href={`${ORIGIN}/llms.txt`}>
                        {chunks} <ExternalLink className="ic ic-sm" aria-hidden="true" />
                      </a>
                    ),
                    full: (chunks) => <a href={`${ORIGIN}/llms-full.txt`}>{chunks}</a>,
                  })}
                </p>
              )}
            </div>
          </section>
        </main>
        <footer className="pub-foot" style={{ marginTop: "auto" }}>
          <div className="wrap-c">
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "20px", height: "20px" }} />
              <span>{t("agents.opengrantsGms")}</span>
            </div>
            <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
              <Link to="/">{t("agents.home")}</Link>
              <a href={`${ORIGIN}/openapi.json`}>{t("agents.openapi")}</a>
            </div>
          </div>
          <div className="wrap-c lang-row">
            <LanguageSwitcher />
          </div>
        </footer>
      </div>
    </>
  );
}
