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

const OTHER = "Other grants";

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

  if (page.status === "loading") return <PublicState title="Loading…" />;
  if (page.status === "error") {
    if (page.error instanceof ApiError && page.error.status === 404) return <NotFound />;
    return (
      <PublicState title="This page could not be loaded">
        <ErrorBanner error={page.error} onRetry={page.reload} />
      </PublicState>
    );
  }

  const { funder, awards, years, amountsShown } = page.data;
  const fromPassport = funder.verification ? funder.verification.source === "passport" : !!funder.verificationLevel;
  const shown = year === "all" ? years : years.filter((y) => y === year);

  return (
    <>
      <title>{`Grants awarded by ${funder.name}`}</title>
      <PublicFrame
        funder={funder}
        nav={
          <>
            <Link to={`/f/${funder.handle}`}>Funding opportunities</Link>
            <Link to={`/f/${funder.handle}/awards`} aria-current="page">
              Grants awarded
            </Link>
          </>
        }
        hero={
          <div className="mission">
            <h1>Grants awarded by {funder.name}</h1>
            <p className="sub" style={{ color: "var(--on-tenant)" }}>
              {awards.length === 0 ? "No grants are listed yet." : `${awards.length} ${awards.length === 1 ? "grant" : "grants"} listed${years.length > 1 ? `, ${years[years.length - 1]} to ${years[0]}` : years.length ? ` in ${years[0]}` : ""}.`}
            </p>
            {fromPassport && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "14px", opacity: ".9" }}>
                <ShieldCheck className="ic" aria-hidden="true" />
                Claimed in OpenGrants Passport
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
              <h3>No grants listed yet</h3>
              <p>{funder.name} lists its grants here once they are accepted.</p>
            </div>
          ) : (
            <>
              {years.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "14px", flexWrap: "wrap", marginBottom: "8px" }}>
                  <span className="seg" role="group" aria-label="Year">
                    <button type="button" className={year === "all" ? "on" : undefined} aria-pressed={year === "all"} onClick={() => setYear("all")}>
                      All years
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
                  <span className="eyebrow">Awarded in</span>
                  <h2 id={`awards-${y}`} style={{ marginTop: "6px" }}>
                    {y}
                  </h2>
                  {byProgram(awards.filter((a) => a.year === y)).map(([program, rows]) => (
                    <div key={program} style={{ marginBottom: "20px" }}>
                      <h3 style={{ fontSize: "17px", marginBottom: "10px" }}>{program}</h3>
                      <div className="tbl-wrap" tabIndex={0} role="region" aria-label={`${program}, ${y}, scrollable`}>
                        <table className="tbl" style={{ fontSize: "15px" }}>
                          <caption className="sr">
                            Grants awarded in {y}, {program}
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col">Recipient</th>
                              <th scope="col">Purpose</th>
                              {amountsShown && (
                                <th scope="col" className="num">
                                  Amount
                                </th>
                              )}
                              <th scope="col">
                                <span className="sr">Award page</span>
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
                                  <Link to={`/f/${funder.handle}/awards/${a.slug}`} aria-label={`View the grant to ${a.recipient.name}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 700 }}>
                                    View <ArrowRight className="ic" aria-hidden="true" />
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </>
          )}
        </div>
      </PublicFrame>
    </>
  );
}
