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
  const heading = `Moving from ${entry.name} to ${OUR_NAME}`;
  return (
    <SwitchFrame title={seoFor(entry).title}>
      <section className="landing-sec landing-hero" aria-labelledby="switch-h1">
        <div className="wrap-c landing-stack">
          <span className="og-eyebrow">
            <CalendarClock className="ic" aria-hidden="true" />
            Switching · facts as of {FACTS_AS_OF}
          </span>
          <h1 id="switch-h1">{heading}</h1>
          <p className="landing-lede">{entry.summary}</p>
          {entry.news.length > 0 && (
            <ul aria-label="Who owns it" style={{ display: "flex", flexDirection: "column", gap: "4px", maxWidth: "680px" }}>
              {entry.news.map((n) => (
                <li key={n.text} data-claim="ownership">
                  {n.text} <span className="muted">Source:</span> <SourceLink {...n.source} />
                </li>
              ))}
            </ul>
          )}
          <div className="landing-links-row">
            <a href="#request" className="btn btn-cta">
              Request a free migration
              <ArrowRight className="ic" aria-hidden="true" />
            </a>
            <Link to="/signin?as=funder" className="btn btn-secondary">
              Start free
            </Link>
          </div>
        </div>
      </section>

      <section className="landing-sec" aria-labelledby="exports-h">
        <div className="wrap-c">
          <h2 id="exports-h">What you can export, and what comes over</h2>
          <div className="landing-cols">
            <div className="card landing-card">
              <h3>
                <Download className="ic" aria-hidden="true" /> From {entry.kind === "spreadsheets" ? "your spreadsheets" : entry.name}
              </h3>
              <Checks items={entry.exports} />
              {entry.sources.length > 0 && (
                <div>
                  <p className="muted" style={{ fontSize: "14px" }}>
                    Source{entry.sources.length > 1 ? "s" : ""}, as of {FACTS_AS_OF}:
                  </p>
                  <ul className="landing-links-row" aria-label="Sources" style={{ marginTop: "4px" }}>
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
                <FileInput className="ic" aria-hidden="true" /> What comes over
              </h3>
              <Checks items={entry.movesOver} />
              <p className="muted" style={{ fontSize: "14px" }}>
                Past payments are recorded as paid elsewhere. Nothing moves money.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-sec" aria-labelledby="behind-h">
        <div className="wrap-c">
          <div className="card landing-adds">
            <h2 id="behind-h" style={{ marginBottom: 0 }}>
              What stays behind
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
          <h2 id="steps-h">The steps</h2>
          <p className="landing-sub">
            The import wizard is under Import in your workspace (<code>/w/your-workspace/{IMPORT_WIZARD_SEGMENT}</code>).
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
          <h2 id="differ-h">How the GMS differs</h2>
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
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Price, scrollable" style={{ marginTop: "24px", maxWidth: "760px" }}>
              <table className="tbl landing-tbl">
                <caption className="sr">Price</caption>
                <thead>
                  <tr>
                    <th scope="col">System</th>
                    <th scope="col">Price, as of {FACTS_AS_OF}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{entry.price.kind === "list" ? entry.price.product : entry.name}</td>
                    {entry.price.kind === "list" ? (
                      <td data-claim="price">
                        <Tag className="ic" aria-hidden="true" />
                        {entry.price.text} <span className="muted">({LIST_PRICE_LABEL})</span>. <span className="muted">Source:</span> <SourceLink {...entry.price.source} />
                      </td>
                    ) : (
                      <td>
                        <Tag className="ic" aria-hidden="true" />
                        {PRICED_BY_QUOTE}
                      </td>
                    )}
                  </tr>
                  <tr>
                    <td>OpenGrants GMS</td>
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
          <h2 id="faq-h">Questions people ask</h2>
          <FaqList items={[...entry.faq, ...COMMON_FAQ]} />
        </div>
      </section>

      <section className="landing-sec" id="request" aria-labelledby="request-h">
        <div className="wrap-c landing-stack">
          <div>
            <h2 id="request-h">Request a free migration</h2>
            <p className="landing-sub" style={{ marginBottom: 0 }}>
              A person at OpenGrants plans the move with you and checks the dry run before anything is imported. There is no charge. You see exactly what is sent before it goes.
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
