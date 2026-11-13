// SPDX-License-Identifier: AGPL-3.0-only
// The public home page. The message: sign up with an email and use the GMS; Passport is an
// optional upgrade, never a requirement. Styles are the `.landing-*` classes in app.css.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useServices } from "../../app/services.tsx";
import { usePassportFlags } from "../../api/launchHooks.ts";
import { PassportButton } from "../../components/PassportButton.tsx";
import { ArrowRight, Bot, Check, ChevronDown, Download, ExternalLink, Menu, ShieldCheck, ShieldOff, X } from "lucide-react";

const DEPLOY_GUIDE = "https://github.com/egeria-corporation/gms/blob/main/DEPLOY_WITH_AGENT.md";

const FUNDER_STEPS: Array<[string, string]> = [
  ["Sign up with your email", "We send a code. No password."],
  ["Name your organization", "Then invite your team."],
  ["Publish an opportunity", "Review applications, decide and send award letters."],
];
const GRANTEE_STEPS: Array<[string, string]> = [
  ["Sign up with your email", "We send a code. No password."],
  ["Enter your organization", "Its name and a contact email."],
  ["Apply, accept and report", "Apply to open opportunities, accept an award, sign the agreement and send reports."],
];

const FUNDER_CAN = [
  "Publish opportunities on your own page, with application and report forms",
  "Review, score and decide, then send award letters",
  "Agreements, payment schedules and reporting requirements",
  "Record payments you make your usual way (cheque, bank transfer)",
  "Export everything (CommonGrants JSON, CSV)",
];
const GRANTEE_CAN = [
  "Apply to opportunities, with your team",
  "Accept awards and sign agreements in the app",
  "See your payment schedule and the payments your funder records",
  "Send reports and request changes to an award",
  "Message your funder in one thread",
  "Keep one status view across funders",
];

const FAQ: Array<[string, string]> = [
  ["Do I need OpenGrants Passport?", "No. Sign up with your email. Passport is optional and adds verification and payments through Passport."],
  ["Is it really free?", "Yes, for funders and grantees, hosted or self-hosted."],
  ["How do payments work without Passport?", "The funder pays the way they already do and records the payment here; the grantee sees it. The GMS never holds bank details."],
  ["What does “Not verified” mean?", "The organization entered its own details. Funders see that label so they know to check. Connecting Passport later replaces it."],
  ["Why does an admin need an authenticator app?", "Admins can change awards and payment records, so we ask for a second step at sign-in. It takes a minute with any authenticator app."],
  ["Who can see my organization's information?", "Only funders you apply to or accept an award from."],
];

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
        <nav aria-label="Main" className="landing-links" id="landing-links" data-open={open} onClick={(e) => (e.target as HTMLElement).closest("a") && close()}>
          <a href="#funders">For funders</a>
          <a href="#grantees">For grantees</a>
          <a href="#how">How it works</a>
          <a href="#selfhost">Self-host</a>
        </nav>
        <div className="landing-tools">
          <button ref={menuRef} type="button" className="btn btn-ghost landing-menu-btn" aria-expanded={open} aria-controls="landing-links" onClick={() => setOpen((v) => !v)}>
            {open ? <X className="ic" aria-hidden="true" /> : <Menu className="ic" aria-hidden="true" />}
            Menu
          </button>
          <Link to="/signin" className="btn btn-secondary">
            Sign in
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
      <title>{"OpenGrants GMS: free grants management for funders and grantees"}</title>
      <div className="gms pub" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <Header />
        <main>
          <section className="landing-sec landing-hero" aria-labelledby="landing-h1">
            <div className="wrap-c landing-stack">
              <span className="og-eyebrow">
                <ShieldCheck className="ic" aria-hidden="true" />
                Free and open source
              </span>
              <h1 id="landing-h1">Give and manage grants, free. Sign up with your email.</h1>
              <p className="landing-lede">
                Funders create opportunities and awards, collect reports and keep track of payments. Grantees accept awards, sign agreements and send reports.{" "}
                <b>No Passport account needed.</b>
              </p>
              <div className="landing-cta">
                <Link to="/signin?as=funder" className="btn btn-cta btn-lg">
                  I’m a funder: start free
                  <ArrowRight className="ic" aria-hidden="true" />
                </Link>
                <Link to="/signin?as=grantee" className="btn btn-cta btn-lg">
                  I’m a grantee or applicant: start free
                  <ArrowRight className="ic" aria-hidden="true" />
                </Link>
              </div>
              {flags.signIn && (
                <div className="landing-passport-line">
                  <span>Already use OpenGrants Passport?</span>
                  <PassportButton className="btn btn-secondary btn-sm" />
                </div>
              )}
              <ul className="landing-facts" aria-label="At a glance">
                {["Free for funders", "Free for grantees", "Email sign-in, no password", "No Passport required", "Open source"].map((f) => (
                  <li key={f}>
                    <Check className="ic" aria-hidden="true" />
                    {f}
                  </li>
                ))}
              </ul>
              {demo && (
                <div className="landing-links-row">
                  <Link to="/f/riverbend">See an example funder page</Link>
                  <Link to="/f/riverbend/o/community-health-2027">View a live opportunity</Link>
                  <Link to="/w/alder-creek/find">Find funding</Link>
                </div>
              )}
            </div>
          </section>

          <section className="landing-sec" id="how" aria-labelledby="how-h">
            <div className="wrap-c">
              <h2 id="how-h">Start in three steps</h2>
              <p className="landing-sub">Pick the side you are on. Both start with an email address.</p>
              <div className="landing-cols">
                <div className="card landing-card" id="funders">
                  <h3>Funders</h3>
                  <Steps items={FUNDER_STEPS} />
                  <Link to="/signin?as=funder" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
                    Start as a funder
                  </Link>
                </div>
                <div className="card landing-card" id="grantees">
                  <h3>Grantees and applicants</h3>
                  <Steps items={GRANTEE_STEPS} />
                  <Link to="/signin?as=grantee" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
                    Start as a grantee
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <section className="landing-sec" aria-labelledby="can-h">
            <div className="wrap-c">
              <h2 id="can-h">What you can do without Passport</h2>
              <p className="landing-sub">Everything here works with just an email sign-in.</p>
              <div className="tbl-wrap">
                <table className="tbl landing-tbl">
                  <thead>
                    <tr>
                      <th scope="col">Funders</th>
                      <th scope="col">Grantees</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: Math.max(FUNDER_CAN.length, GRANTEE_CAN.length) }, (_, i) => (
                      <tr key={i}>
                        <td>
                          {FUNDER_CAN[i] && (
                            <>
                              <Check className="ic" aria-hidden="true" />
                              {FUNDER_CAN[i]}
                            </>
                          )}
                        </td>
                        <td>
                          {GRANTEE_CAN[i] && (
                            <>
                              <Check className="ic" aria-hidden="true" />
                              {GRANTEE_CAN[i]}
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
                    What Passport adds, if you want it
                  </h2>
                  <ul>
                    <li>
                      <ShieldCheck className="ic" aria-hidden="true" />
                      <span>
                        Your organization shows as <span className="lvl lvl-3">Verified</span>. Without Passport it shows as{" "}
                        <span className="lvl lvl-na">
                          <ShieldOff className="ic" aria-hidden="true" />
                          Not verified
                        </span>
                        .
                      </span>
                    </li>
                    <li>
                      <Check className="ic" aria-hidden="true" />
                      Forms fill themselves from one record you keep up to date.
                    </li>
                    <li>
                      <Check className="ic" aria-hidden="true" />
                      Funders can send payments through Passport to a bank account the organization verified, with safeguards on changes.
                    </li>
                  </ul>
                  <a href="https://passport.opengrants.io" className="landing-links-row" style={{ fontWeight: 700 }}>
                    Learn about OpenGrants Passport
                    <ExternalLink className="ic" aria-hidden="true" />
                  </a>
                </div>
              </div>
            </section>
          )}

          <section className="landing-sec" id="selfhost" aria-labelledby="oss-h">
            <div className="wrap-c landing-stack">
              <h2 id="oss-h" style={{ marginBottom: 0 }}>
                Open source, and you can run your own
              </h2>
              <p className="landing-sub" style={{ marginBottom: 0 }}>
                Point Claude Code or another coding agent at the repository and it sets up the GMS on your own Supabase and Cloudflare accounts, asking before it creates anything. Our test deploys took about 10 minutes.
              </p>
              <div className="landing-links-row">
                <a href={DEPLOY_GUIDE}>
                  <Download className="ic" aria-hidden="true" />
                  Deploy with an agent
                </a>
                <a href="https://github.com/egeria-corporation/gms">
                  <ExternalLink className="ic" aria-hidden="true" />
                  Source (AGPL)
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
                  For agents (MCP)
                </Link>
              </div>
            </div>
          </section>

          <section className="landing-sec" aria-labelledby="faq-h">
            <div className="wrap-c landing-faq" style={{ maxWidth: "820px" }}>
              <h2 id="faq-h">Questions people ask</h2>
              {FAQ.map(([q, a]) => (
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
              <span>OpenGrants GMS · gms.opengrants.io</span>
            </div>
            <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
              <Link to="/agents">For agents</Link>
              <a href="/openapi.json">API</a>
              <a href="https://commongrants.org">CommonGrants spec</a>
              <a href="https://github.com/egeria-corporation/gms">Source</a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
