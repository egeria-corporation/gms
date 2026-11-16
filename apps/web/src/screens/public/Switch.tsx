// SPDX-License-Identifier: AGPL-3.0-only
// `/switch`: every system the switch pages cover, plus spreadsheets, with one line each, and the
// free migration request for anyone whose system is not listed.
import { Link } from "react-router";
import { ArrowRight, CalendarClock, Check } from "lucide-react";
import { PEAK_SOURCE, SWITCH_ENTRIES, seoFor, switchText } from "../../content/switch.ts";
import { MigrationRequestForm } from "./switch/MigrationRequestForm.tsx";
import { FaqList, SourceLink, SwitchFrame } from "./switch/SwitchFrame.tsx";

import { getLocale, translator } from "../../i18n/index.tsx";


const t = translator("public");
export default function Switch() {
  const text = switchText();
  return (
    <SwitchFrame title={seoFor(null, getLocale()).title}>
      <section className="landing-sec landing-hero" aria-labelledby="switch-h1">
        <div className="wrap-c landing-stack">
          <span className="og-eyebrow">
            <CalendarClock className="ic" aria-hidden="true" />
            {t("switch.switchingFactsAsOf", { FACTS_AS_OF: text.factsAsOf })}
          </span>
          <h1 id="switch-h1">{t("switch.switchingTo", { OUR_NAME: text.ourName })}</h1>
          <p className="landing-lede">
            {t("switch.mostFundersKeepAGrants")}
          </p>
          <p style={{ fontSize: "14px" }}>
            {t("switch.source")} <SourceLink {...PEAK_SOURCE} />
          </p>
          <ul className="landing-facts" aria-label={t("switch.atAGlance")}>
            {["Free", t("switch.unlimitedSeats"), t("switch.openSourceAgpl30"), "CommonGrants", t("switch.freeHumanRunMigration")].map((f) => (
              <li key={f}>
                <Check className="ic" aria-hidden="true" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="landing-sec" aria-labelledby="systems-h">
        <div className="wrap-c">
          <h2 id="systems-h">{t("switch.chooseTheSystemYouUse")}</h2>
          <p className="landing-sub">{t("switch.eachPageSaysWhatYou")}</p>
          <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
            {SWITCH_ENTRIES.map((e) => (
              <li key={e.slug} className="card landing-card">
                <h3>
                  <Link to={`/switch/${e.slug}`}>
                    {e.listName}
                    <ArrowRight className="ic" aria-hidden="true" style={{ marginLeft: "6px", verticalAlign: "-3px" }} />
                  </Link>
                </h3>
                <p>{e.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="landing-sec" aria-labelledby="faq-h">
        <div className="wrap-c landing-faq" style={{ maxWidth: "820px" }}>
          <h2 id="faq-h">{t("switch.questionsPeopleAsk")}</h2>
          <FaqList items={text.commonFaq} />
        </div>
      </section>

      <section className="landing-sec" id="request" aria-labelledby="request-h">
        <div className="wrap-c landing-stack">
          <div>
            <h2 id="request-h">{t("switch.requestAFreeMigration")}</h2>
            <p className="landing-sub" style={{ marginBottom: 0 }}>
              {t("switch.whateverYouUseTodayA")}
            </p>
          </div>
          <MigrationRequestForm labelledBy="request-h" />
        </div>
      </section>
    </SwitchFrame>
  );
}
