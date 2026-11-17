// SPDX-License-Identifier: AGPL-3.0-only
// Header and footer of the switch pages: the OpenGrants GMS brand, a way back to every system, and
// the trademark and date note on every page. Styles are the `.landing-*` classes in app.css.
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ChevronDown, ExternalLink } from "lucide-react";
import { switchText } from "../../../content/switch.ts";

import { translator } from "../../../i18n/index.tsx";

import { LanguageSwitcher } from "../../../components/LanguageSwitcher.tsx";
const t = translator("public");
export function SwitchFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <title>{title}</title>
      <div className="gms pub" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <header className="landing-hd">
          <div className="wrap-c bar">
            <Link to="/" className="landing-logo">
              <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
              <span className="suffix">GMS</span>
            </Link>
            <nav aria-label={t("switchFrame.switching")} className="landing-tools">
              <Link to="/switch" className="btn btn-ghost">
                {t("switchFrame.allSystems")}
              </Link>
              <Link to="/signin?as=funder" className="btn btn-secondary">
                {t("switchFrame.signIn")}
              </Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="pub-foot" style={{ marginTop: "auto" }}>
          <div className="wrap-c" style={{ flexDirection: "column", alignItems: "flex-start", gap: "12px" }}>
            <p data-testid="switch-note" style={{ margin: 0 }}>
              {t.rich("switchFrame.writeToHelloAgentsOpengrants", { TRADEMARK_NOTE: switchText().trademarkNote, link: (chunks) => <a href="mailto:hello@agents.opengrants.io">{chunks}</a> })}
            </p>
            <div style={{ display: "flex", gap: "18px", flexWrap: "wrap", width: "100%", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "20px", height: "20px" }} />
                <span>{t("switchFrame.opengrantsGmsGmsOpengrantsIo")}</span>
              </div>
              <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
                <Link to="/">{t("switchFrame.home")}</Link>
                <Link to="/switch">{t("switchFrame.switching")}</Link>
                <a href="https://commongrants.org">
                  CommonGrants <ExternalLink className="ic ic-sm" aria-hidden="true" />
                </a>
                <a href="https://github.com/egeria-corporation/gms">
                  {t("switchFrame.sourceAgpl")} <ExternalLink className="ic ic-sm" aria-hidden="true" />
                </a>
              </div>
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

/** A source link: opens the owner's own page; the name is text, never a logo. */
export function SourceLink({ label, url }: { label: string; url: string }) {
  return (
    <a href={url} rel="noopener noreferrer external" target="_blank">
      {label} <ExternalLink className="ic ic-sm" aria-hidden="true" />
      <span className="sr"> {t("switchFrame.opensInANewTab")}</span>
    </a>
  );
}

/** Questions and answers, each one open and shut with the keyboard. */
export function FaqList({ items }: { items: [string, string][] }) {
  return (
    <>
      {items.map(([q, a]) => (
        <details key={q}>
          <summary>
            {q}
            <ChevronDown className="ic" aria-hidden="true" />
          </summary>
          <p>{a}</p>
        </details>
      ))}
    </>
  );
}
