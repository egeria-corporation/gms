// SPDX-License-Identifier: AGPL-3.0-only
// `/f/:handle/awards/:slug` (v1.9.0): one grant a funder awarded and lists: who awarded whom, the
// amount (unless the funder hides amounts), the program, the year and what it is for. From
// `GET /gms/public/funders/{handle}/awards/{slug}`, which answers only for an award that may be
// public; every other address is the same "not found". The share card and schema.org data for this
// page are written by the front Worker.
import { Link, useParams } from "react-router";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { ApiError } from "../../api/client.ts";
import { useAwardSharingQuery } from "../../api/awardSharingHooks.ts";
import { NotFound } from "../../components/NotFound.tsx";
import { ErrorBanner } from "../../components/ui.tsx";
import { formatDate, formatMoney } from "../../lib/format.ts";
import { PublicFrame, PublicState } from "./PublicFrame.tsx";
import { UnverifiedFunderBanner } from "./publicExtras.tsx";

import { translator } from "../../i18n/index.tsx";

const t = translator("public");
export default function AwardPublic() {
  const { handle = "", slug = "" } = useParams();
  const page = useAwardSharingQuery((api) => api.awardPage(handle, slug), [handle, slug]);

  if (page.status === "loading") return <PublicState title={t("awardPublic.loading")} />;
  if (page.status === "error") {
    if (page.error instanceof ApiError && page.error.status === 404) return <NotFound />;
    return (
      <PublicState title={t("awardPublic.thisPageCouldNotBe")}>
        <ErrorBanner error={page.error} onRetry={page.reload} />
      </PublicState>
    );
  }

  const { funder, award, verified } = page.data;
  const headline = `${funder.name} awarded ${award.recipient.name} a grant`;
  return (
    <>
      <title>{headline}</title>
      <PublicFrame
        funder={funder}
        nav={
          <>
            <Link to={`/f/${funder.handle}`}>{t("awardPublic.fundingOpportunities")}</Link>
            <Link to={`/f/${funder.handle}/awards`}>{t("awardPublic.grantsAwarded")}</Link>
          </>
        }
        hero={
          <div className="mission">
            <span className="eyebrow" style={{ color: "var(--on-tenant)" }}>
              {t("awardPublic.grantAwarded")}
            </span>
            <h1>{headline}</h1>
            <p className="sub" style={{ color: "var(--on-tenant)" }}>
              {award.purpose}
            </p>
          </div>
        }
      >
        <div className="wrap-c" style={{ display: "flex", flexDirection: "column" }}>
          {!verified && <UnverifiedFunderBanner name={funder.name} />}
          <section aria-labelledby="award-facts">
            <h2 id="award-facts" className="sr">
              {t("awardPublic.aboutThisGrant")}
            </h2>
            <div className="card">
              <div className="card-b">
                <dl className="kv" style={{ fontSize: "15px" }}>
                  <dt>{t("awardPublic.recipient")}</dt>
                  <dd>{award.recipient.name}</dd>
                  <dt>{t("awardPublic.funder")}</dt>
                  <dd>
                    {funder.name}
                    {verified && (
                      <span className="bdg bdg-ok" style={{ marginLeft: "8px" }}>
                        <ShieldCheck className="ic" aria-hidden="true" />
                        {t("awardPublic.verifiedWithOpengrantsPassport")}
                      </span>
                    )}
                  </dd>
                  {award.amount && (
                    <>
                      <dt>{t("awardPublic.amount")}</dt>
                      <dd className="b">{formatMoney(award.amount)}</dd>
                    </>
                  )}
                  {award.program && (
                    <>
                      <dt>{t("awardPublic.program")}</dt>
                      <dd>{award.program}</dd>
                    </>
                  )}
                  <dt>{t("awardPublic.awarded")}</dt>
                  <dd>{formatDate(award.awardDate)}</dd>
                  <dt>{t("awardPublic.purpose")}</dt>
                  <dd>{award.purpose}</dd>
                </dl>
              </div>
            </div>
            <p style={{ marginTop: "16px" }}>
              <Link to={`/f/${funder.handle}/awards`} style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 700 }}>
                <ArrowLeft className="ic" aria-hidden="true" />
                {t("awardPublic.allGrantsAwardedBy", { name: funder.name })}
              </Link>
            </p>
          </section>
        </div>
      </PublicFrame>
    </>
  );
}
