// SPDX-License-Identifier: AGPL-3.0-only
// Header and footer of a funder's public pages, in the funder's brand. The accent pair is checked
// for contrast; a pair that fails WCAG AA falls back to the OpenGrants accent.
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import type { PublicFunder } from "../../api/types.ts";
import { checkBrand, SYSTEM_BRAND } from "../../lib/contrast.ts";

import { translator } from "../../i18n/index.tsx";

import { LanguageSwitcher } from "../../components/LanguageSwitcher.tsx";
const t = translator("public");
/** Up to three initials for the logo mark when the funder has not uploaded a logo. */
export function markOf(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(of|the|and|for)$/i.test(w));
  return words
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function tenantStyle(funder: Pick<PublicFunder, "brand">): CSSProperties {
  const { effective } = checkBrand(funder.brand.accent ?? SYSTEM_BRAND.accent, funder.brand.onAccent ?? SYSTEM_BRAND.onAccent);
  return { "--tenant": effective.accent, "--on-tenant": effective.onAccent, display: "flex", flexDirection: "column", minHeight: "100vh", background: "#FFFFFF" } as CSSProperties;
}

/** The attribution line, in the page's language. */
export const poweredByLabel = (): string => t("publicFrame.poweredBy");
/** @deprecated The English line; use `poweredByLabel()`, which follows the page's language. */
export const POWERED_BY_LABEL = "Powered by OpenGrants Grant Management System";

/** On unless the funder turned it off; a server that does not send the setting yet means on. */
export const showsPoweredBy = (funder: Pick<PublicFunder, "poweredBy">): boolean => funder.poweredBy !== false;

/**
 * The attribution line, linked to the landing page. `href` is absolute where the page is shown on
 * someone else's site (the apply widget opens it in a new tab); the public pages use the app's route.
 */
export function PoweredBy({ href, newTab = false }: { href?: string; newTab?: boolean }) {
  const content = (
    <>
      <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "20px", height: "20px" }} />
      <span>{poweredByLabel()}</span>
    </>
  );
  const style = { display: "inline-flex", alignItems: "center", gap: "10px", color: "inherit" } as const;
  return href ? (
    <a className="powered-by" href={href} style={style} {...(newTab ? { target: "_blank", rel: "noopener" } : {})}>
      {content}
    </a>
  ) : (
    <Link className="powered-by" to="/" style={style}>
      {content}
    </Link>
  );
}

export function PublicFrame({ funder, nav, hero, jsonHref, children }: { funder: PublicFunder; nav: ReactNode; hero?: ReactNode; jsonHref?: string; children: ReactNode }) {
  const home = `/f/${funder.handle}`;
  return (
    <div className="gms pub" style={tenantStyle(funder)}>
      <header className="pub-hd">
        <div className="wrap-c">
          <div className="bar">
            <Link to={home} className="lg" style={{ textDecoration: "none" }}>
              {funder.brand.logoUrl ? (
                <img src={funder.brand.logoUrl} alt="" style={{ height: "36px", width: "auto", borderRadius: "8px" }} />
              ) : (
                <span className="mark" aria-hidden="true">
                  {markOf(funder.name)}
                </span>
              )}
              {funder.name}
            </Link>
            <nav aria-label={t("publicFrame.funderPage")} style={{ display: "flex", alignItems: "center", gap: "22px", fontSize: "14px", fontWeight: 700, flexWrap: "wrap" }}>
              {nav}
              <Link to="/signin" className="btn btn-secondary" style={{ background: "transparent", color: "var(--on-tenant)", borderColor: "color-mix(in srgb, var(--on-tenant) 45%, transparent)" }}>
                {t("publicFrame.signIn")}
              </Link>
            </nav>
          </div>
          {hero}
        </div>
      </header>
      <main>{children}</main>
      <footer className="pub-foot" style={{ marginTop: "auto" }}>
        <div className="wrap-c">
          {showsPoweredBy(funder) ? <PoweredBy /> : <span />}
          {jsonHref && (
            <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
              <a href={jsonHref}>{t("publicFrame.commongrantsJson")}</a>
            </div>
          )}
        </div>
        <div className="wrap-c lang-row">
          <LanguageSwitcher />
        </div>
      </footer>
    </div>
  );
}

/** Loading, missing and failed states share the neutral frame: the brand is not known yet. */
export function PublicState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="gms pub" style={{ display: "flex", flexDirection: "column", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <div className="empty">
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}
