// SPDX-License-Identifier: AGPL-3.0-only
// `/switch`: every system the switch pages cover, plus spreadsheets, with one line each, and the
// free migration request for anyone whose system is not listed.
import { Link } from "react-router";
import { ArrowRight, CalendarClock, Check } from "lucide-react";
import { COMMON_FAQ, FACTS_AS_OF, OUR_NAME, PEAK_SOURCE, SWITCH_ENTRIES, seoFor } from "../../content/switch.ts";
import { MigrationRequestForm } from "./switch/MigrationRequestForm.tsx";
import { FaqList, SourceLink, SwitchFrame } from "./switch/SwitchFrame.tsx";

export default function Switch() {
  return (
    <SwitchFrame title={seoFor(null).title}>
      <section className="landing-sec landing-hero" aria-labelledby="switch-h1">
        <div className="wrap-c landing-stack">
          <span className="og-eyebrow">
            <CalendarClock className="ic" aria-hidden="true" />
            Switching · facts as of {FACTS_AS_OF}
          </span>
          <h1 id="switch-h1">Switching to {OUR_NAME}</h1>
          <p className="landing-lede">
            Most funders keep a grants system for about five years, and about a quarter were actively looking for a new one in 2024. Here is what moves over from the system you use today, how, and what stays behind.
          </p>
          <p style={{ fontSize: "14px" }}>
            Source: <SourceLink {...PEAK_SOURCE} />
          </p>
          <ul className="landing-facts" aria-label="At a glance">
            {["Free", "Unlimited seats", "Open source (AGPL-3.0)", "CommonGrants", "Free, human-run migration"].map((f) => (
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
          <h2 id="systems-h">Choose the system you use today</h2>
          <p className="landing-sub">Each page says what you can export and how, what comes over, and where each fact comes from.</p>
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
          <h2 id="faq-h">Questions people ask</h2>
          <FaqList items={COMMON_FAQ} />
        </div>
      </section>

      <section className="landing-sec" id="request" aria-labelledby="request-h">
        <div className="wrap-c landing-stack">
          <div>
            <h2 id="request-h">Request a free migration</h2>
            <p className="landing-sub" style={{ marginBottom: 0 }}>
              Whatever you use today, a person at OpenGrants plans the move with you and checks the dry run before anything is imported. There is no charge. You see exactly what is sent before it goes.
            </p>
          </div>
          <MigrationRequestForm labelledBy="request-h" />
        </div>
      </section>
    </SwitchFrame>
  );
}
