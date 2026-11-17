// SPDX-License-Identifier: AGPL-3.0-only
// `/for-funders` (E4, loop 2: applicant demand pulls in funders). A funder arrives from the footer
// of an application package an applicant sent them (`?ref=`), or from a peer's invitation
// (`?invite=`). The page names the applicant's region and, from ten up, how many organizations
// there already keep their applications here: a number only, never a name. "Receive applications
// here, free" leads into funder setup, in place, and a workspace made here is counted for the link.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ClipboardList, Gift, MapPin, Scale, UserPlus, Users } from "lucide-react";
import { pendingReferral, rememberReferral, type ReferralSource } from "../../api/loops.ts";
import { useLoopsQuery } from "../../api/loopsHooks.ts";
import { ErrorBanner, Loading } from "../../components/ui.tsx";
import { translator } from "../../i18n/index.tsx";
import { FunderQuickStart, LoopsFrame } from "./loopsParts.tsx";

const t = translator("public");
const TOKEN = /^[A-Za-z0-9_-]{10,80}$/;

const BENEFITS = () => [
  { icon: Gift, title: t("forFunders.benefit.free.title"), text: t("forFunders.benefit.free.text") },
  { icon: ClipboardList, title: t("forFunders.benefit.complete.title"), text: t("forFunders.benefit.complete.text") },
  { icon: Scale, title: t("forFunders.benefit.review.title"), text: t("forFunders.benefit.review.text") },
  { icon: Users, title: t("forFunders.benefit.applicants.title"), text: t("forFunders.benefit.applicants.text") },
];

export default function ForFunders() {
  const [params] = useSearchParams();
  const ref = params.get("ref");
  const invite = params.get("invite");
  const query = useLoopsQuery((api) => api.forFunders({ ref: ref && TOKEN.test(ref) ? ref : null, invite: invite && TOKEN.test(invite) ? invite : null }), [ref, invite]);
  const [setup, setSetup] = useState(params.get("setup") === "1");
  const start = useRef<HTMLElement>(null);
  // The link the person came from, kept for setup (an invitation first: it is personal).
  const pending = pendingReferral();
  const source: ReferralSource | null = invite ? "invite" : ref ? "package" : pending && pending.source !== "onboarding" ? pending.source : null;
  const token = invite ?? ref ?? (source ? pending?.token : null) ?? null;
  useEffect(() => {
    if (source && token) rememberReferral({ source, token, name: null });
  }, [source, token]);
  useEffect(() => {
    if (setup) start.current?.querySelector("input")?.focus();
  }, [setup]);

  const page = query.status === "ready" ? query.data : null;
  return (
    <LoopsFrame>
      <title>{t("forFunders.pageTitle")}</title>
      <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "24px", paddingTop: "32px", paddingBottom: "48px", maxWidth: "880px" }}>
        {query.status === "loading" && <Loading />}
        {query.status === "error" && <ErrorBanner error={query.error} onRetry={query.reload} />}
        {page?.invitation && (
          <section className="card" aria-labelledby="ff-invited">
            <div className="card-b row" style={{ gap: "12px", alignItems: "flex-start" }}>
              <UserPlus className="ic ic-md" aria-hidden="true" />
              <div>
                <h2 id="ff-invited" style={{ fontSize: "16px" }}>
                  {page.invitation.inviter ? t("forFunders.invitedBy", { inviter: page.invitation.inviter, funder: page.invitation.funder.name }) : t("forFunders.invitedByFunder", { funder: page.invitation.funder.name })}
                </h2>
                <p className="small muted">{t("forFunders.invitedNote")}</p>
              </div>
            </div>
          </section>
        )}
        <header style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <span className="eyebrow">{t("forFunders.eyebrow")}</span>
          <h1 style={{ fontSize: "34px", color: "var(--og-navy-dark)" }}>{t("forFunders.title")}</h1>
          <p style={{ fontSize: "17px" }}>{t("forFunders.lede")}</p>
        </header>
        {page?.ref?.region && (
          <section className="card" aria-labelledby="ff-region">
            <div className="card-b row" style={{ gap: "12px", alignItems: "flex-start" }}>
              <MapPin className="ic ic-md" aria-hidden="true" />
              <div>
                <h2 id="ff-region" style={{ fontSize: "16px" }}>
                  {t("forFunders.fromRegion", { region: page.ref.region.name })}
                </h2>
                <p>{page.ref.organizations !== null ? t("forFunders.regionCount", { count: page.ref.organizations, region: page.ref.region.name }) : t("forFunders.regionNoCount", { region: page.ref.region.name })}</p>
              </div>
            </div>
          </section>
        )}
        <ul aria-label={t("forFunders.whatYouGet")} style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
          {BENEFITS().map((b) => (
            <li key={b.title} className="card">
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <b.icon className="ic ic-md" aria-hidden="true" />
                <h3 style={{ fontSize: "15px" }}>{b.title}</h3>
                <p className="small">{b.text}</p>
              </div>
            </li>
          ))}
        </ul>
        <section ref={start} className="card" aria-labelledby="ff-start" id="start">
          <div className="card-h">
            <h2 id="ff-start" style={{ fontSize: "18px" }}>
              {t("forFunders.cta")}
            </h2>
          </div>
          <div className="card-b">
            {setup ? (
              <FunderQuickStart source={source ?? "package"} token={source ? token : null} headingId="ff-start" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <p className="muted">{t("forFunders.ctaNote")}</p>
                <div>
                  <button type="button" className="btn btn-primary" onClick={() => setSetup(true)}>
                    {t("forFunders.cta")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </LoopsFrame>
  );
}
