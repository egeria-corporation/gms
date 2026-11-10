// SPDX-License-Identifier: AGPL-3.0-only
// Header and footer of a funder's public pages, in the funder's brand. The accent pair is checked
// for contrast; a pair that fails WCAG AA falls back to the OpenGrants accent.
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import type { PublicFunder } from "../../api/types.ts";
import { checkBrand, SYSTEM_BRAND } from "../../lib/contrast.ts";

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
            <nav aria-label="Funder page" style={{ display: "flex", alignItems: "center", gap: "22px", fontSize: "14px", fontWeight: 700, flexWrap: "wrap" }}>
              {nav}
              <Link to="/signin" className="btn btn-secondary" style={{ background: "transparent", color: "var(--on-tenant)", borderColor: "color-mix(in srgb, var(--on-tenant) 45%, transparent)" }}>
                Sign in
              </Link>
            </nav>
          </div>
          {hero}
        </div>
      </header>
      {children}
      <footer className="pub-foot" style={{ marginTop: "auto" }}>
        <div className="wrap-c">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "20px", height: "20px" }} />
            <span>Powered by OpenGrants GMS</span>
          </div>
          <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
            {jsonHref && <a href={jsonHref}>CommonGrants JSON</a>}
            <Link to="/">About OpenGrants GMS</Link>
          </div>
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
