// SPDX-License-Identifier: AGPL-3.0-only
// `/f/:handle/awards` (v1.9.0): the grants a funder has awarded and lists, by year and program, with
// each recipient, the amount (unless the funder hides amounts), the program and what the grant is
// for. Everything here comes from `GET /gms/public/funders/{handle}/awards`, which carries only the
// awards that may be public. A funder that does not list awards has no such page (404).
import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowRight, Award as AwardIcon, ShieldCheck } from "lucide-react";
import { ApiError } from "../../api/client.ts";
import type { PublicAward } from "../../api/awardSharing.ts";
import { useAwardSharingQuery } from "../../api/awardSharingHooks.ts";
import { NotFound } from "../../components/NotFound.tsx";
import { ErrorBanner } from "../../components/ui.tsx";
import { formatMoney } from "../../lib/format.ts";
import { PublicFrame, PublicState } from "./PublicFrame.tsx";
import { UnverifiedFunderBanner } from "./publicExtras.tsx";

import { translator } from "../../i18n/index.tsx";

const t = translator("public");
/** The group of awards without a program (shown last, as "Other grants"). */
const OTHER = "";

/** Awards of one year, grouped by program (A to Z, "Other grants" last). */
function byProgram(awards: PublicAward[]): [string, PublicAward[]][] {
  const groups = new Map<string, PublicAward[]>();
  for (const a of awards) groups.set(a.program ?? OTHER, [...(groups.get(a.program ?? OTHER) ?? []), a]);
  return [...groups.entries()].sort(([x], [y]) => (x === OTHER ? 1 : y === OTHER ? -1 : x.localeCompare(y)));
}

export default function FunderAwards() {
  const { handle = "" } = useParams();
  const page = useAwardSharingQuery((api) => api.funderAwards(handle), [handle]);
  const [year, setYear] = useState<number | "all">("all");

  if (page.status === "loading") return <PublicState title={t("funderAwards.loading")} />;
  if (page.status === "error") {
    if (page.error instanceof ApiError && page.error.status === 404) return <NotFound />;
    return (
      <PublicState title={t("funderAwards.thisPageCouldNotBe")}>
        <ErrorBanner error={page.error} onRetry={page.reload} />
      </PublicState>
    );
  }

  const { funder, awards, years, amountsShown } = page.data;
  const fromPassport = funder.verification ? funder.verification.source === "passport" : !!funder.verificationLevel;
  const shown = year === "all" ? years : years.filter((y) => y === year);

  return (
    <>
      <title>{t("funderAwards.grantsAwardedBy", { name: funder.name })}</title>
      <PublicFrame
        funder={funder}
        nav={
          <>
            <Link to={`/f/${funder.handle}`}>{t("funderAwards.fundingOpportunities")}</Link>
            <Link to={`/f/${funder.handle}/awards`} aria-current="page">
              {t("funderAwards.grantsAwarded")}
            </Link>
          </>
        }
        hero={
          <div className="mission">
            <h1>{t("funderAwards.grantsAwardedBy", { name: funder.name })}</h1>
            <p className="sub" style={{ color: "var(--on-tenant)" }}>
              {awards.length === 0 ? t("funderAwards.noGrantsAreListedYet") : years.length > 1
                  ? t("funderAwards.listedYears", { count: awards.length, from: String(years[years.length - 1]), to: String(years[0]) })
                  : years.length
                    ? t("funderAwards.listedYear", { count: awards.length, year: String(years[0]) })
                    : t("funderAwards.listedCount", { count: awards.length })}
            </p>
            {fromPassport && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "14px", opacity: ".9" }}>
                <ShieldCheck className="ic" aria-hidden="true" />
                {t("funderAwards.claimedInOpengrantsPassport")}
              </span>
            )}
          </div>
        }
      >
        <div className="wrap-c" style={{ display: "flex", flexDirection: "column" }}>
          {!fromPassport && <UnverifiedFunderBanner name={funder.name} />}
          {awards.length === 0 ? (
            <div className="card empty" style={{ minHeight: "200px", justifyContent: "center" }}>
              <AwardIcon className="ic" aria-hidden="true" />
              <h3>{t("funderAwards.noGrantsListedYet")}</h3>
              <p>{t("funderAwards.listsItsGrantsHereOnce", { name: funder.name })}</p>
            </div>
          ) : (
            <>
              {years.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "14px", flexWrap: "wrap", marginBottom: "8px" }}>
                  <span className="seg" role="group" aria-label={t("funderAwards.year")}>
                    <button type="button" className={year === "all" ? "on" : undefined} aria-pressed={year === "all"} onClick={() => setYear("all")}>
                      {t("funderAwards.allYears")}
                    </button>
                    {years.map((y) => (
                      <button key={y} type="button" className={y === year ? "on" : undefined} aria-pressed={y === year} onClick={() => setYear(y)}>
                        {y}
                      </button>
                    ))}
                  </span>
                </div>
              )}
              {shown.map((y) => (
                <section key={y} aria-labelledby={`awards-${y}`}>
                  <span className="eyebrow">{t("funderAwards.awardedIn")}</span>
                  <h2 id={`awards-${y}`} style={{ marginTop: "6px" }}>
                    {y}
                  </h2>
                  {byProgram(awards.filter((a) => a.year === y)).map(([group, rows]) => {
                    const program = group || t("funderAwards.otherGrants");
                    return (
                    <div key={program} style={{ marginBottom: "20px" }}>
                      <h3 style={{ fontSize: "17px", marginBottom: "10px" }}>{program}</h3>
                      <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("funderAwards.scrollable", { program, y: String(y) })}>
                        <table className="tbl" style={{ fontSize: "15px" }}>
                          <caption className="sr">
                            {t("funderAwards.grantsAwardedIn", { y: String(y), program })}
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col">{t("funderAwards.recipient")}</th>
                              <th scope="col">{t("funderAwards.purpose")}</th>
                              {amountsShown && (
                                <th scope="col" className="num">
                                  {t("funderAwards.amount")}
                                </th>
                              )}
                              <th scope="col">
                                <span className="sr">{t("funderAwards.awardPage")}</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((a) => (
                              <tr key={a.slug}>
                                <td className="b">{a.recipient.name}</td>
                                <td style={{ whiteSpace: "normal" }}>{a.purpose}</td>
                                {amountsShown && <td className="num">{a.amount ? formatMoney(a.amount) : "—"}</td>}
                                <td>
                                  <Link to={`/f/${funder.handle}/awards/${a.slug}`} aria-label={t("funderAwards.viewTheGrantTo", { name: a.recipient.name })} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 700 }}>
                                    {t("funderAwards.view")} <ArrowRight className="ic" aria-hidden="true" />
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    );
                  })}
                </section>
              ))}
            </>
          )}
        </div>
      </PublicFrame>
    </>
  );
}
