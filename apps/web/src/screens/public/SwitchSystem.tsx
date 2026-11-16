// SPDX-License-Identifier: AGPL-3.0-only
// `/switch/{system}`: moving from one system to the GMS. What that system exports and how (with
// the source of each fact), what comes over, what stays behind and why, the steps, how we differ,
// the list price where one is published, questions, and the free migration request.
import { Link, useParams } from "react-router";
import { ArrowRight, CalendarClock, Check, Download, FileInput, ShieldCheck, Tag } from "lucide-react";
import { NotFound } from "../../components/NotFound.tsx";
import { COMMON_FAQ, DIFFERENCES, FACTS_AS_OF, IMPORT_WIZARD_SEGMENT, LIST_PRICE_LABEL, OUR_NAME, OUR_PRICE, PRICED_BY_QUOTE, STAYS_BEHIND, STEPS, seoFor, switchEntry, type SwitchEntry } from "../../content/switch.ts";
import { MigrationRequestForm } from "./switch/MigrationRequestForm.tsx";
import { FaqList, SourceLink, SwitchFrame } from "./switch/SwitchFrame.tsx";

import { translator } from "../../i18n/index.tsx";

const tr = translator("public");
function Checks({ items }: { items: string[] }) {
  return (
    <ul style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px" }}>
      {items.map((line) => (
        <li key={line} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
          <Check className="ic" aria-hidden="true" style={{ color: "var(--og-teal-dark)", marginTop: "4px", flex: "none" }} />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

function Page({ entry }: { entry: SwitchEntry }) {
  const heading = tr("switchSystem.movingFromTo", { name: entry.name, OUR_NAME });
  return (
    <SwitchFrame title={seoFor(entry).title}>
      <section className="landing-sec landing-hero" aria-labelledby="switch-h1">
        <div className="wrap-c landing-stack">
          <span className="og-eyebrow">
            <CalendarClock className="ic" aria-hidden="true" />
            {tr("switchSystem.switchingFactsAsOf", { FACTS_AS_OF })}
          </span>
          <h1 id="switch-h1">{heading}</h1>
          <p className="landing-lede">{entry.summary}</p>
          {entry.news.length > 0 && (
            <ul aria-label={tr("switchSystem.whoOwnsIt")} style={{ display: "flex", flexDirection: "column", gap: "4px", maxWidth: "680px" }}>
              {entry.news.map((n) => (
                <li key={n.text} data-claim="ownership">
                  {n.text} <span className="muted">{tr("switchSystem.source")}</span> <SourceLink {...n.source} />
                </li>
              ))}
            </ul>
          )}
          <div className="landing-links-row">
            <a href="#request" className="btn btn-cta">
              {tr("switchSystem.requestAFreeMigration")}
              <ArrowRight className="ic" aria-hidden="true" />
            </a>
            <Link to="/signin?as=funder" className="btn btn-secondary">
              {tr("switchSystem.startFree")}
            </Link>
          </div>
        </div>
      </section>

      <section className="landing-sec" aria-labelledby="exports-h">
        <div className="wrap-c">
          <h2 id="exports-h">{tr("switchSystem.whatYouCanExportAnd")}</h2>
          <div className="landing-cols">
            <div className="card landing-card">
              <h3>
                <Download className="ic" aria-hidden="true" /> {entry.kind === "spreadsheets" ? tr("switchSystem.fromSpreadsheets") : tr("switchSystem.fromSystem", { name: entry.name })}
              </h3>
              <Checks items={entry.exports} />
              {entry.sources.length > 0 && (
                <div>
                  <p className="muted" style={{ fontSize: "14px" }}>
                    {tr("switchSystem.sourcesAsOf", { count: entry.sources.length, date: FACTS_AS_OF })}
                  </p>
                  <ul className="landing-links-row" aria-label={tr("switchSystem.sources")} style={{ marginTop: "4px" }}>
                    {entry.sources.map((s) => (
                      <li key={s.url}>
                        <SourceLink {...s} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="card landing-card">
              <h3>
                <FileInput className="ic" aria-hidden="true" /> {tr("switchSystem.whatComesOver")}
              </h3>
              <Checks items={entry.movesOver} />
              <p className="muted" style={{ fontSize: "14px" }}>
                {tr("switchSystem.pastPaymentsAreRecordedAs")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-sec" aria-labelledby="behind-h">
        <div className="wrap-c">
          <div className="card landing-adds">
            <h2 id="behind-h" style={{ marginBottom: 0 }}>
              {tr("switchSystem.whatStaysBehind")}
            </h2>
            <ul>
              <li>
                <ShieldCheck className="ic" aria-hidden="true" />
                <span>{STAYS_BEHIND.what}</span>
              </li>
            </ul>
            <p className="landing-sub" style={{ marginBottom: 0 }}>
              {STAYS_BEHIND.why}
            </p>
          </div>
        </div>
      </section>

      <section className="landing-sec" aria-labelledby="steps-h">
        <div className="wrap-c">
          <h2 id="steps-h">{tr("switchSystem.theSteps")}</h2>
          <p className="landing-sub">
            {tr.rich("switchSystem.theImportWizardIsUnder", { IMPORT_WIZARD_SEGMENT, code: (chunks) => <code>{chunks}</code> })}
          </p>
          <ol className="landing-steps" style={{ maxWidth: "720px" }}>
            {STEPS(entry).map(([t, d]) => (
              <li key={t}>
                <span>
                  <span className="t">{t}</span>
                  {d}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="landing-sec" aria-labelledby="differ-h">
        <div className="wrap-c">
          <h2 id="differ-h">{tr("switchSystem.howTheGmsDiffers")}</h2>
          <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
            {DIFFERENCES.map(([t, d]) => (
              <li key={t} className="card landing-card">
                <h3>
                  <Check className="ic" aria-hidden="true" style={{ color: "var(--og-teal-dark)" }} /> {t}
                </h3>
                <p>{d}</p>
              </li>
            ))}
          </ul>
          {entry.price && (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label={tr("switchSystem.priceScrollable")} style={{ marginTop: "24px", maxWidth: "760px" }}>
              <table className="tbl landing-tbl">
                <caption className="sr">{tr("switchSystem.price")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{tr("switchSystem.system")}</th>
                    <th scope="col">{tr("switchSystem.priceAsOf", { FACTS_AS_OF })}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{entry.price.kind === "list" ? entry.price.product : entry.name}</td>
                    {entry.price.kind === "list" ? (
                      <td data-claim="price">
                        <Tag className="ic" aria-hidden="true" />
                        {entry.price.text} <span className="muted">({LIST_PRICE_LABEL})</span>. <span className="muted">{tr("switchSystem.source")}</span> <SourceLink {...entry.price.source} />
                      </td>
                    ) : (
                      <td>
                        <Tag className="ic" aria-hidden="true" />
                        {PRICED_BY_QUOTE}
                      </td>
                    )}
                  </tr>
                  <tr>
                    <td>{tr("switchSystem.opengrantsGms")}</td>
                    <td>
                      <Check className="ic" aria-hidden="true" />
                      {OUR_PRICE}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="landing-sec" aria-labelledby="faq-h">
        <div className="wrap-c landing-faq" style={{ maxWidth: "820px" }}>
          <h2 id="faq-h">{tr("switchSystem.questionsPeopleAsk")}</h2>
          <FaqList items={[...entry.faq, ...COMMON_FAQ]} />
        </div>
      </section>

      <section className="landing-sec" id="request" aria-labelledby="request-h">
        <div className="wrap-c landing-stack">
          <div>
            <h2 id="request-h">{tr("switchSystem.requestAFreeMigration")}</h2>
            <p className="landing-sub" style={{ marginBottom: 0 }}>
              {tr("switchSystem.aPersonAtOpengrantsPlans")}
            </p>
          </div>
          <MigrationRequestForm defaultSystem={entry.slug} labelledBy="request-h" />
        </div>
      </section>
    </SwitchFrame>
  );
}

export default function SwitchSystem() {
  const { system } = useParams();
  const entry = switchEntry(system);
  // Keyed by system so moving between pages starts a fresh form.
  return entry ? <Page key={entry.slug} entry={entry} /> : <NotFound />;
}
