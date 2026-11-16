// SPDX-License-Identifier: AGPL-3.0-only
// Pieces the template gallery's pages share: the neutral OpenGrants frame, the kind and author
// lines, the licence note, the read-only preview of an item's content and the status of a
// submission. Status is always an icon and a label.
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { BadgeCheck, BookOpen, CircleCheck, CircleX, ClipboardCheck, FileText, Hourglass, LayoutTemplate, ListChecks, Mail, Package, ShieldOff, Undo2, type LucideIcon } from "lucide-react";
import type { FormDefinition } from "@gms/forms";
import { KIND_LABEL, LICENCE, type GalleryAuthor, type GalleryForm, type GalleryKind, type GallerySnapshot, type GalleryStripped, type GallerySubmission, type GalleryTags } from "../../api/gallery.ts";
import { useServices } from "../../app/services.tsx";
import { FormView } from "../../forms/FormView.tsx";

import { translator } from "../../i18n/index.tsx";

import { LanguageSwitcher } from "../../components/LanguageSwitcher.tsx";
const tr = translator("public");
export const KIND_ICON: Record<GalleryKind, LucideIcon> = { application_form: FileText, report_form: ClipboardCheck, rubric: ListChecks, email_template: Mail, program_kit: Package };

export function KindBadge({ kind }: { kind: GalleryKind }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className="bdg bdg-info" style={{ alignSelf: "flex-start" }}>
      <Icon className="ic" aria-hidden="true" />
      {KIND_LABEL[kind]}
    </span>
  );
}

/** Who shared it. "Verified by Passport" only for a workspace linked to Passport. */
export function AuthorLine({ author }: { author: GalleryAuthor }) {
  if (author.kind === "opengrants") {
    return (
      <span className="row small" style={{ gap: "6px" }}>
        <BookOpen className="ic ic-sm" aria-hidden="true" />
        {author.name}
      </span>
    );
  }
  return (
    <span className="row small" style={{ gap: "8px", flexWrap: "wrap" }}>
      <span>{tr("galleryParts.sharedBy", { name: author.name })}</span>
      {author.verified ? (
        <span className="lvl lvl-3" title={tr("galleryParts.thisFunderSOrganizationIs")}>
          <BadgeCheck className="ic" aria-hidden="true" />
          {tr("galleryParts.verifiedByPassport")}
        </span>
      ) : (
        <span className="lvl lvl-na" title={tr("galleryParts.thisFunderHasNotBeen")}>
          <ShieldOff className="ic" aria-hidden="true" />
          {tr("galleryParts.notVerified")}
        </span>
      )}
    </span>
  );
}

export function LicenceNote({ author }: { author?: GalleryAuthor }) {
  return (
    <p className="small muted">
      {author
        ? tr.rich("galleryParts.sharedUnderCredit", { licence: LICENCE.name, author: author.kind === "opengrants" ? "OpenGrants" : author.name, link: (chunks) => <a href={LICENCE.url} rel="license noreferrer" target="_blank">{chunks}</a> })
        : tr.rich("galleryParts.sharedUnderCreditAuthor", { licence: LICENCE.name, link: (chunks) => <a href={LICENCE.url} rel="license noreferrer" target="_blank">{chunks}</a> })}
    </p>
  );
}

export function TagList({ tags }: { tags: GalleryTags }) {
  const all = [...tags.fieldOfWork, ...tags.grantSize, ...tags.audience];
  if (!all.length) return null;
  return (
    <ul aria-label={tr("galleryParts.tags")} className="row" style={{ gap: "6px", flexWrap: "wrap", listStyle: "none", padding: 0, margin: 0 }}>
      {all.map((t) => (
        <li key={t} className="tag">
          {t}
        </li>
      ))}
    </ul>
  );
}

const SUBMISSION: Record<GallerySubmission["status"], { icon: LucideIcon; label: string; tone: string }> = {
  pending: {
    icon: Hourglass,
    get label() {
      return tr("galleryParts.submission.pending.label");
    },
    tone: "warn",
  },
  approved: {
    icon: CircleCheck,
    get label() {
      return tr("galleryParts.submission.approved.label");
    },
    tone: "ok",
  },
  rejected: {
    icon: CircleX,
    get label() {
      return tr("galleryParts.submission.rejected.label");
    },
    tone: "dng",
  },
  withdrawn: {
    icon: Undo2,
    get label() {
      return tr("galleryParts.submission.withdrawn.label");
    },
    tone: "neutral",
  },
};
export function SubmissionBadge({ status }: { status: GallerySubmission["status"] }) {
  const { icon: Icon, label, tone } = SUBMISSION[status];
  return (
    <span className={`bdg bdg-${tone}`}>
      <Icon className="ic" aria-hidden="true" />
      {label}
    </span>
  );
}

const WHAT: Record<GalleryStripped["what"], string> = { 
  get default() {
    return tr("galleryParts.what.default");
  }, 
  get help() {
    return tr("galleryParts.what.help");
  }, 
  get text() {
    return tr("galleryParts.what.text");
  }, 
  get name() {
    return tr("galleryParts.what.name");
  } };
const FOUND: Record<string, string> = { 
  get email() {
    return tr("galleryParts.found.email");
  }, 
  get phone() {
    return tr("galleryParts.found.phone");
  }, 
  get link() {
    return tr("galleryParts.found.link");
  }, 
  get "organization name"() {
    return tr("galleryParts.found.organization_name");
  } };

/** What was taken out before sharing. The values themselves are never kept. */
export function StrippedList({ stripped, empty = tr("galleryParts.nothingNeededToBeTaken") }: { stripped: GalleryStripped[]; empty?: string }) {
  if (!stripped.length) return <p className="small muted">{empty}</p>;
  return (
    <ul className="small" style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" }}>
      {stripped.map((s, i) => (
        <li key={`${s.path}-${s.what}-${i}`}>
          <span className="b">{s.where}</span>: {WHAT[s.what]}
          {s.what === "name" ? "" : ` (${s.found.map((f) => FOUND[f] ?? f).join(", ")})`}
        </li>
      ))}
    </ul>
  );
}

function FormPreview({ form, index }: { form: GalleryForm; index: number }) {
  const definition = useMemo<FormDefinition>(() => ({ id: `gallery-${index}`, version: 1, title: form.title, jsonSchema: form.jsonSchema, uiSchema: form.uiSchema } as unknown as FormDefinition), [form, index]);
  return (
    <div className="card" role="region" aria-label={tr("galleryParts.form", { title: form.title })}>
      <div className="card-h">
        <h3>{form.title}</h3>
        <span className="tag">{form.purpose === "report" ? tr("galleryParts.reportForm") : tr("galleryParts.applicationForm")}</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {form.description && <p>{form.description}</p>}
        {form.instructions && (
          <div className="bnr bnr-info" style={{ display: "block" }}>
            <span className="b">{tr("galleryParts.instructionsForApplicants")} </span>
            {form.instructions}
          </div>
        )}
        <FormView form={definition} response={{}} mode="print" />
      </div>
    </div>
  );
}

interface CriterionLike {
  key?: string;
  label?: string;
  description?: string;
  weight?: number;
  guidance?: string;
  scale?: { type?: string; min?: number; max?: number; options?: { value: string; label?: string }[] };
}

/** The item's content, read-only: forms in the form renderer, rubric criteria, email text. */
export function SnapshotPreview({ snapshot }: { snapshot: GallerySnapshot }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {snapshot.forms.map((f, i) => (
        <FormPreview key={`f${i}`} form={f} index={i} />
      ))}
      {snapshot.rubrics.map((r, i) => {
        const criteria = r.criteria as CriterionLike[];
        const total = criteria.reduce((n, c) => n + (c.weight ?? 0), 0);
        return (
          <div key={`r${i}`} className="card" role="region" aria-label={tr("galleryParts.rubric", { name: r.name })}>
            <div className="card-h">
              <h3>{r.name}</h3>
              <span className="tag">
                {tr("galleryParts.criteria", { count: criteria.length })}
              </span>
            </div>
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label={tr("galleryParts.criteriaScrollable", { name: r.name })} style={{ border: 0, borderRadius: 0 }}>
              <table className="tbl" aria-label={tr("galleryParts.criteria", { name: r.name })}>
                <thead>
                  <tr>
                    <th>{tr("galleryParts.criterion")}</th>
                    <th>{tr("galleryParts.scale")}</th>
                    <th>{tr("galleryParts.weight")}</th>
                    <th>{tr("galleryParts.howToScore")}</th>
                  </tr>
                </thead>
                <tbody>
                  {criteria.map((c, j) => (
                    <tr key={c.key ?? j}>
                      <td style={{ whiteSpace: "normal" }}>
                        <div className="b">{c.label}</div>
                        {c.description && <div className="small muted">{c.description}</div>}
                      </td>
                      <td>{c.scale?.type === "categorical" ? (c.scale.options ?? []).map((o) => o.label ?? o.value).join(" / ") : tr("galleryParts.to", { value: c.scale?.min ?? 1, value2: c.scale?.max ?? 5 })}</td>
                      <td>{total ? `${Math.round(((c.weight ?? 0) / total) * 100)}%` : "—"}</td>
                      <td className="small" style={{ whiteSpace: "normal" }}>
                        {c.guidance ?? <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {snapshot.emails.map((m, i) => (
        <div key={`e${i}`} className="card" role="region" aria-label={tr("galleryParts.email", { name: m.name })}>
          <div className="card-h">
            <h3>{m.name}</h3>
            <span className="tag">{tr("galleryParts.email2")}</span>
          </div>
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div>
              <span className="eyebrow">{tr("galleryParts.subject")}</span>
              <div className="b">{m.subject}</div>
            </div>
            <div>
              <span className="eyebrow">{tr("galleryParts.message")}</span>
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{m.body}</div>
            </div>
            <p className="small muted">{tr("galleryParts.wordsInDoubleBracesSuch")}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The gallery's own neutral frame (not a funder's brand). */
export function GalleryFrame({ children }: { children: ReactNode }) {
  const { sessionState } = useServices();
  const signedIn = sessionState.status === "signedIn";
  return (
    <div className="gms pub gms-frame" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <header style={{ borderBottom: "1px solid var(--og-gray-200)", background: "var(--og-white)" }}>
        <div className="wrap-c" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "24px", minHeight: "64px", flexWrap: "wrap" }}>
          <Link to="/" style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none", fontFamily: "var(--font-display)", fontWeight: 700, color: "var(--og-navy-dark)", fontSize: "16px" }}>
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" style={{ height: "22px", width: "auto", display: "block" }} />
            <span style={{ color: "var(--og-teal-dark)", fontWeight: 500 }}>GMS</span>
          </Link>
          <nav aria-label={tr("galleryParts.primary")} style={{ display: "flex", alignItems: "center", gap: "24px", fontSize: "14px", fontWeight: 700, flexWrap: "wrap" }}>
            <Link to="/templates" style={{ color: "var(--og-gray-800)", display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <LayoutTemplate className="ic" aria-hidden="true" />
              {tr("galleryParts.templateGallery")}
            </Link>
            {signedIn ? (
              <Link to="/workspaces" className="btn btn-secondary">
                {tr("galleryParts.yourWorkspaces")}
              </Link>
            ) : (
              <Link to="/signin" className="btn btn-secondary">
                {tr("galleryParts.signIn")}
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main style={{ flex: 1 }}>{children}</main>
      <footer className="pub-foot">
        <div className="wrap-c">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "20px", height: "20px" }} />
            <span>{tr("galleryParts.poweredByOpengrantsGmsFree")}</span>
          </div>
          <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
            <a href={LICENCE.url} rel="license noreferrer" target="_blank">
              {tr("galleryParts.templates", { name: LICENCE.name })}
            </a>
            <Link to="/">{tr("galleryParts.aboutOpengrantsGms")}</Link>
          </div>
        </div>
        <div className="wrap-c lang-row">
          <LanguageSwitcher />
        </div>
      </footer>
    </div>
  );
}
