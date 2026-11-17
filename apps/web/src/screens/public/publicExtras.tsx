// SPDX-License-Identifier: AGPL-3.0-only
// Sections of the public funder and opportunity pages that a funder chooses to publish: past
// awards (only while the funder lists its awards), questions about applying, and guideline documents.
import { Fragment, useState } from "react";
import { Download, FileText, ShieldOff } from "lucide-react";
import type { PastAward, PublicDocument, PublicExtras } from "../../api/applicantFull.ts";
import { useFullQuery } from "../../api/applicantFullHooks.ts";
import { useLaunchQuery } from "../../api/launchHooks.ts";
import { ContactLine } from "../../components/launch.tsx";
import { downloadCsv } from "../../lib/browser.ts";
import { formatMinor } from "../../lib/format.ts";

import { translator } from "../../i18n/index.tsx";

const t = translator("public");
export function PastAwards({ awards, handle }: { awards: PastAward[]; handle: string }) {
  const years = [...new Set(awards.map((a) => a.year))].sort().reverse();
  const [year, setYear] = useState(years[0] ?? "");
  const rows = awards.filter((a) => a.year === year);
  return (
    <section id="past">
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", marginBottom: "16px" }}>
        <div>
          <span className="eyebrow">{t("publicExtras.transparency")}</span>
          <h2 style={{ marginBottom: "0", marginTop: "6px" }}>{t("publicExtras.pastAwards")}</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "14px", flexWrap: "wrap" }}>
          <span className="seg" role="group" aria-label={t("publicExtras.year")}>
            {years.map((y) => (
              <button key={y} type="button" className={y === year ? "on" : undefined} aria-pressed={y === year} onClick={() => setYear(y)}>
                {y}
              </button>
            ))}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => downloadCsv([["Year", "Recipient", "Amount", "Currency", "Purpose"], ...awards.map((a) => [a.year, a.recipient, a.amountMinor === null ? "" : (a.amountMinor / 100).toFixed(2), a.amountMinor === null ? "" : a.currency, a.purpose])], `${handle}-past-awards.csv`)}
          >
            <Download className="ic" aria-hidden="true" />
            {t("publicExtras.downloadCsv")}
          </button>
        </div>
      </div>
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("publicExtras.pastAwardsScrollable")}>
        <table className="tbl" style={{ fontSize: "15px" }}>
          <caption className="sr">{t("publicExtras.awardsMadeIn", { year: String(year) })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("publicExtras.year")}</th>
              <th scope="col">{t("publicExtras.recipient")}</th>
              <th scope="col" className="num">
                {t("publicExtras.amount")}
              </th>
              <th scope="col">{t("publicExtras.purpose")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => (
              <tr key={`${a.recipient}-${i}`}>
                <td>{a.year}</td>
                <td className="b">{a.recipient}</td>
                <td className="num">{a.amountMinor === null ? <><span aria-hidden="true">—</span><span className="sr">{t("publicExtras.amountNotShown")}</span></> : formatMinor(a.amountMinor, a.currency)}</td>
                <td style={{ whiteSpace: "normal" }}>{a.page ? <a href={new URL(a.page, window.location.origin).pathname}>{a.purpose}</a> : a.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Faq({ faq, contactEmail }: { faq: PublicExtras["faq"]; contactEmail: string | null }) {
  if (faq.length === 0) return null;
  return (
    <section id="faq">
      <span className="eyebrow">{t("publicExtras.help")}</span>
      <h2 style={{ marginTop: "6px" }}>{t("publicExtras.questionsAboutApplying")}</h2>
      {faq.map((f) => (
        <details key={f.question}>
          <summary>{f.question}</summary>
          <p>{f.answer}</p>
        </details>
      ))}
      {contactEmail ? (
        <p style={{ marginTop: "16px", fontSize: "15px" }}>
          {t.rich("publicExtras.somethingElseWriteTo", { contactEmail, link: (chunks) => <a href={`mailto:${contactEmail}`}>{chunks}</a> })}
        </p>
      ) : null}
    </section>
  );
}

/** The people a funder names on its public page. Renders nothing when it names nobody. */
export function PublicContacts({ handle }: { handle: string; name?: string }) {
  const q = useLaunchQuery((api) => api.publicContacts(handle), [handle]);
  const contacts = q.data ?? [];
  if (contacts.length === 0) return null;
  return (
    <section id="contact" aria-labelledby="contact-h">
      <span className="eyebrow">{t("publicExtras.contact")}</span>
      <h2 id="contact-h" style={{ marginTop: "6px" }}>
        {t("publicExtras.whoToAsk")}
      </h2>
      <div className="card">
        <div className="card-b">
          <dl className="kv" style={{ fontSize: "15px" }}>
            {contacts.map((c) => (
              <Fragment key={`${c.name}|${c.email}`}>
                <dt>{c.title ?? t("publicExtras.contact")}</dt>
                <dd>
                  <ContactLine contact={c} />
                </dd>
              </Fragment>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

/** Past awards and questions for `/f/:handle`. Renders nothing until the funder publishes either. */
export function FunderExtras({ handle }: { handle: string }) {
  const query = useFullQuery((api) => api.publicExtras(handle), [handle]);
  const { pastAwards, faq, contactEmail } = query.status === "ready" ? query.data : { pastAwards: [], faq: [], contactEmail: null };
  return (
    <>
      {pastAwards.length > 0 ? <PastAwards awards={pastAwards} handle={handle} /> : null}
      <Faq faq={faq} contactEmail={contactEmail} />
      <PublicContacts handle={handle} />
    </>
  );
}

export function DocumentList({ documents }: { documents: PublicDocument[] }) {
  if (documents.length === 0) return <p style={{ fontSize: "15px", color: "var(--og-gray-600)" }}>{t("publicExtras.noGuidelineDocumentsArePublished")}</p>;
  return (
    <ul style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {documents.map((d) => (
        <li key={d.url}>
          <a href={d.url} className="doc" style={{ textDecoration: "none", color: "inherit" }}>
            <span className="ft">
              <FileText className="ic" aria-hidden="true" />
            </span>
            <span className="grow">
              <span className="nm">{d.name}</span>
            </span>
            <Download className="ic" aria-hidden="true" />
            <span className="sr">{t("publicExtras.download")}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function OpportunityDocuments({ handle, slug }: { handle: string; slug: string }) {
  const query = useFullQuery((api) => api.publicDocuments(handle, slug), [handle, slug]);
  return query.status === "ready" ? <DocumentList documents={query.data} /> : null;
}

/** The funder's own published questions, as extra entries in an opportunity's FAQ list. */
export function PublishedFaq({ handle }: { handle: string }) {
  const query = useFullQuery((api) => api.publicExtras(handle), [handle]);
  if (query.status !== "ready") return null;
  return (
    <>
      {query.data.faq.map((f) => (
        <details key={f.question}>
          <summary>{f.question}</summary>
          <p>{f.answer}</p>
        </details>
      ))}
    </>
  );
}

/**
 * A funder whose organization is not verified with Passport, said plainly before anyone applies
 * (review NP-16). Applicants decide whether to share their details with it.
 */
export function UnverifiedFunderBanner({ name }: { name: string }) {
  return (
    <div className="bnr bnr-warn" role="note">
      <ShieldOff className="ic" aria-hidden="true" />
      <div>
        <div className="t">{t("publicExtras.notVerifiedWithOpengrantsPassport")}</div>
        <div className="d">{t("publicExtras.opengrantsHasNotCheckedThat", { name })}</div>
      </div>
    </div>
  );
}
