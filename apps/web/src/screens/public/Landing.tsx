// SPDX-License-Identifier: AGPL-3.0-only
// The public home page. The message: sign up with an email and use the GMS; Passport is a
// worthwhile optional add-on, never a requirement. Styles are the `.landing-*` classes in app.css.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useServices } from "../../app/services.tsx";
import { env } from "../../env.ts";
import { userbackActive, whoCanSeeAnswer } from "../../lib/userback.ts";
import { usePassportFlags } from "../../api/launchHooks.ts";
import { PassportButton } from "../../components/PassportButton.tsx";
import { ArrowRight, Bot, Check, ChevronDown, Download, ExternalLink, Menu, ShieldCheck, ShieldOff, X } from "lucide-react";

import { translator } from "../../i18n/index.tsx";

const tr = translator("public");
const DEPLOY_GUIDE = "https://github.com/egeria-corporation/gms/blob/main/DEPLOY_WITH_AGENT.md";
/** The WCAG 2.2 AA conformance report (VPAT 2.5 format) that buyers ask for. */
const ACCESSIBILITY_REPORT = "https://github.com/egeria-corporation/gms/blob/main/docs/accessibility.md";

const FUNDER_STEPS = (): Array<[string, string]> => ([
  [tr("landing.funderSteps.n0.n0"), tr("landing.funderSteps.n0.n1")],
  [tr("landing.funderSteps.n1.n0"), tr("landing.funderSteps.n1.n1")],
  [tr("landing.funderSteps.n2.n0"), tr("landing.funderSteps.n2.n1")],
]);
const GRANTEE_STEPS = (): Array<[string, string]> => ([
  [tr("landing.granteeSteps.n0.n0"), tr("landing.granteeSteps.n0.n1")],
  [tr("landing.granteeSteps.n1.n0"), tr("landing.granteeSteps.n1.n1")],
  [tr("landing.granteeSteps.n2.n0"), tr("landing.granteeSteps.n2.n1")],
]);

const FUNDER_CAN = () => ([
  tr("landing.funderCan.n0"),
  tr("landing.funderCan.n1"),
  tr("landing.funderCan.n2"),
  tr("landing.funderCan.n3"),
  tr("landing.funderCan.n4"),
  tr("landing.funderCan.n5"),
]);
const GRANTEE_CAN = () => ([
  tr("landing.granteeCan.n0"),
  tr("landing.granteeCan.n1"),
  tr("landing.granteeCan.n2"),
  tr("landing.granteeCan.n3"),
  tr("landing.granteeCan.n4"),
  tr("landing.granteeCan.n5"),
]);

/** How the page presents Passport: an add-on worth having, and optional. */
const PASSPORT_PITCH = () => tr("landing.passportPitch");

const FAQ = (): Array<[string, string]> => ([
  [tr("landing.faq.n0.n0"), tr("landing.faq.n0.n1")],
  [tr("landing.faq.n1.n0"), tr("landing.faq.n1.n1")],
  [tr("landing.faq.n2.n0"), tr("landing.faq.n2.n1")],
  [tr("landing.faq.n3.n0"), tr("landing.faq.n3.n1")],
  [tr("landing.faq.n4.n0"), tr("landing.faq.n4.n1")],
  [tr("landing.faq.n5.n0"), whoCanSeeAnswer(userbackActive({ token: env.userbackToken, useMocks: env.useMocks }))],
]);

function Header() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  // Escape closes the menu and returns focus to its button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        menuRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const close = () => setOpen(false);
  return (
    <header className="landing-hd">
      <div className="wrap-c bar">
        <Link to="/" className="landing-logo">
          <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
          <span className="suffix">GMS</span>
        </Link>
        <nav aria-label={tr("landing.main")} className="landing-links" id="landing-links" data-open={open} onClick={(e) => (e.target as HTMLElement).closest("a") && close()}>
          <a href="#funders">{tr("landing.forFunders")}</a>
          <a href="#grantees">{tr("landing.forGrantees")}</a>
          <a href="#how">{tr("landing.howItWorks")}</a>
          <a href="#selfhost">{tr("landing.selfHost")}</a>
        </nav>
        <div className="landing-tools">
          <button ref={menuRef} type="button" className="btn btn-ghost landing-menu-btn" aria-expanded={open} aria-controls="landing-links" onClick={() => setOpen((v) => !v)}>
            {open ? <X className="ic" aria-hidden="true" /> : <Menu className="ic" aria-hidden="true" />}
            {tr("landing.menu")}
          </button>
          <Link to="/signin" className="btn btn-secondary">
            {tr("landing.signIn")}
          </Link>
        </div>
      </div>
    </header>
  );
}

function Steps({ items }: { items: Array<[string, string]> }) {
  return (
    <ol className="landing-steps">
      {items.map(([t, d]) => (
        <li key={t}>
          <span>
            <span className="t">{t}</span>
            {d}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function Landing() {
  // The example funder and opportunity exist only in the demo data (mock mode).
  const { mock: demo } = useServices();
  const flags = usePassportFlags();
  return (
    <>
      <title>{tr("landing.opengrantsGmsFreeGrantsManagement")}</title>
      <div className="gms pub" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <Header />
        <main>
          <section className="landing-sec landing-hero" aria-labelledby="landing-h1">
            <div className="wrap-c landing-stack">
              <span className="og-eyebrow">
                <ShieldCheck className="ic" aria-hidden="true" />
                {tr("landing.freeAndOpenSource")}
              </span>
              <h1 id="landing-h1">{tr("landing.giveAndManageGrantsFree")}</h1>
              <p className="landing-lede">
                {tr("landing.fundersCreateOpportunitiesAndAwards")}
              </p>
              <div className="landing-cta">
                <Link to="/signin?as=funder" className="btn btn-cta btn-lg">
                  {tr("landing.iMAFunderStart")}
                  <ArrowRight className="ic" aria-hidden="true" />
                </Link>
                <Link to="/signin?as=grantee" className="btn btn-cta btn-lg">
                  {tr("landing.iMAGranteeOr")}
                  <ArrowRight className="ic" aria-hidden="true" />
                </Link>
              </div>
              {flags.signIn && (
                <div className="landing-passport-line">
                  <span>{tr("landing.alreadyUseOpengrantsPassport")}</span>
                  <PassportButton className="btn btn-secondary btn-sm" />
                </div>
              )}
              <ul className="landing-facts" aria-label={tr("landing.atAGlance")}>
                {[tr("landing.freeForFunders"), tr("landing.freeForGrantees"), tr("landing.emailSignInNoPassword"), tr("landing.openSource")].map((f) => (
                  <li key={f}>
                    <Check className="ic" aria-hidden="true" />
                    {f}
                  </li>
                ))}
              </ul>
              {demo && (
                <div className="landing-links-row">
                  <Link to="/f/riverbend">{tr("landing.seeAnExampleFunderPage")}</Link>
                  <Link to="/f/riverbend/o/community-health-2027">{tr("landing.viewALiveOpportunity")}</Link>
                  <Link to="/w/alder-creek/find">{tr("landing.findFunding")}</Link>
                </div>
              )}
            </div>
          </section>

          <section className="landing-sec" id="how" aria-labelledby="how-h">
            <div className="wrap-c">
              <h2 id="how-h">{tr("landing.startInThreeSteps")}</h2>
              <p className="landing-sub">{tr("landing.pickTheSideYouAre")}</p>
              <div className="landing-cols">
                <div className="card landing-card" id="funders">
                  <h3>{tr("landing.funders")}</h3>
                  <Steps items={FUNDER_STEPS()} />
                  <Link to="/signin?as=funder" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
                    {tr("landing.startAsAFunder")}
                  </Link>
                  <Link to="/switch" className="small">{tr("landing.switchingFromAnotherSystemSee")}</Link>
                </div>
                <div className="card landing-card" id="grantees">
                  <h3>{tr("landing.granteesAndApplicants")}</h3>
                  <Steps items={GRANTEE_STEPS()} />
                  <Link to="/signin?as=grantee" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
                    {tr("landing.startAsAGrantee")}
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <section className="landing-sec" aria-labelledby="can-h">
            <div className="wrap-c">
              <h2 id="can-h">{tr("landing.whatYouCanDoWithout")}</h2>
              <p className="landing-sub">{tr("landing.everythingHereWorksWithJust")}</p>
              <div className="tbl-wrap" tabIndex={0} role="region" aria-label={tr("landing.whatYouCanDoWithout2")}>
                <table className="tbl landing-tbl" aria-labelledby="can-h">
                  <thead>
                    <tr>
                      <th scope="col">{tr("landing.funders")}</th>
                      <th scope="col">{tr("landing.grantees")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: Math.max(FUNDER_CAN().length, GRANTEE_CAN().length) }, (_, i) => (
                      <tr key={i}>
                        <td>
                          {FUNDER_CAN()[i] && (
                            <>
                              <Check className="ic" aria-hidden="true" />
                              {FUNDER_CAN()[i]}
                            </>
                          )}
                        </td>
                        <td>
                          {GRANTEE_CAN()[i] && (
                            <>
                              <Check className="ic" aria-hidden="true" />
                              {GRANTEE_CAN()[i]}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {flags.linking && (
            <section className="landing-sec" aria-labelledby="adds-h">
              <div className="wrap-c">
                <div className="card landing-adds">
                  <h2 id="adds-h" style={{ marginBottom: 0 }}>
                    {tr("landing.whatPassportAddsIfYou")}
                  </h2>
                  <p className="landing-sub" style={{ marginBottom: 0 }}>
                    {PASSPORT_PITCH()}
                  </p>
                  <ul>
                    <li>
                      <ShieldCheck className="ic" aria-hidden="true" />
                      <span>
                        {tr.rich("landing.yourOrganizationShowsAsVerified", { span: (chunks) => <span className="lvl lvl-3">{chunks}</span> })}
                        <span className="lvl lvl-na">
                          <ShieldOff className="ic" aria-hidden="true" />
                          {tr("landing.notVerified")}
                        </span>
                        .
                      </span>
                    </li>
                    <li>
                      <Check className="ic" aria-hidden="true" />
                      {tr("landing.formsFillThemselvesFromOne")}
                    </li>
                    <li>
                      <Check className="ic" aria-hidden="true" />
                      {tr("landing.fundersCanSendPaymentsThrough")}
                    </li>
                  </ul>
                  <a href="https://passport.opengrants.io" className="landing-links-row" style={{ fontWeight: 700 }}>
                    {tr("landing.learnAboutOpengrantsPassport")}
                    <ExternalLink className="ic" aria-hidden="true" />
                  </a>
                </div>
              </div>
            </section>
          )}

          <section className="landing-sec" id="selfhost" aria-labelledby="oss-h">
            <div className="wrap-c landing-stack">
              <h2 id="oss-h" style={{ marginBottom: 0 }}>
                {tr("landing.openSourceAndYouCan")}
              </h2>
              <p className="landing-sub" style={{ marginBottom: 0 }}>
                {tr("landing.pointClaudeCodeOrAnother")}
              </p>
              <div className="landing-links-row">
                <a href={DEPLOY_GUIDE}>
                  <Download className="ic" aria-hidden="true" />
                  {tr("landing.deployWithAnAgent")}
                </a>
                <a href="https://github.com/egeria-corporation/gms">
                  <ExternalLink className="ic" aria-hidden="true" />
                  {tr("landing.sourceAgpl")}
                </a>
                <a href="/openapi.json">
                  <ExternalLink className="ic" aria-hidden="true" />
                  API
                </a>
                <a href="https://commongrants.org">
                  <ExternalLink className="ic" aria-hidden="true" />
                  CommonGrants
                </a>
                <Link to="/agents">
                  <Bot className="ic" aria-hidden="true" />
                  {tr("landing.forAgentsMcp")}
                </Link>
              </div>
            </div>
          </section>

          <section className="landing-sec" aria-labelledby="faq-h">
            <div className="wrap-c landing-faq" style={{ maxWidth: "820px" }}>
              <h2 id="faq-h">{tr("landing.questionsPeopleAsk")}</h2>
              {FAQ().map(([q, a]) => (
                <details key={q}>
                  <summary>
                    {q}
                    <ChevronDown className="ic" aria-hidden="true" />
                  </summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </section>
        </main>
        <footer className="pub-foot" style={{ marginTop: "auto" }}>
          <div className="wrap-c">
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "20px", height: "20px" }} />
              <span>{tr("landing.opengrantsGmsGmsOpengrantsIo")}</span>
            </div>
            <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
              <Link to="/agents">{tr("landing.forAgents")}</Link>
              <Link to="/templates">{tr("landing.templateGallery")}</Link>
              <a href="/openapi.json">API</a>
              <a href="https://commongrants.org">{tr("landing.commongrantsSpec")}</a>
              <a href="https://github.com/egeria-corporation/gms">{tr("landing.source")}</a>
              <a href={ACCESSIBILITY_REPORT}>{tr("landing.accessibility")}</a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
