// SPDX-License-Identifier: AGPL-3.0-only
// The names the applicant screens show for the vocabularies in lib/outside.ts and lib/writeKeep.ts
// (stages, moves, document types, go/no-go criteria, months), in the page's language. The lib
// tables keep their English names for code and tests; screens read these instead.
import type { OutsideStage } from "../../api/outside.ts";
import { statusLook } from "../../components/status.tsx";
import { intlLocale } from "../../i18n/index.tsx";
import type { LimitKind } from "../../lib/outside.ts";
import type { Criterion, DocType, VariantKey } from "../../lib/writeKeep.ts";
import { t } from "./i18n.ts";

/** "Prospect", "Letter of inquiry"…: the stage's name, as its status badge reads. */
export const stageLabel = (s: OutsideStage | string): string => statusLook("outside", s).label;

/** What a plain move reads as on its button. */
export function moveLabel(s: OutsideStage): string {
  switch (s) {
    case "prospect":
      return t("labels.move.prospect");
    case "deciding":
      return t("labels.move.deciding");
    case "loi":
      return t("labels.move.loi");
    case "invited":
      return t("labels.move.invited");
    case "drafting":
      return t("labels.move.drafting");
    case "submitted":
      return t("labels.move.submitted");
    case "awarded":
      return t("labels.move.awarded");
    case "declined":
      return t("labels.move.declined");
    case "withdrawn":
      return t("labels.move.withdrawn");
    case "not_pursuing":
      return t("labels.move.notPursuing");
  }
}

/** A vault document type's name. */
export function docTypeLabel(d: DocType): string {
  switch (d) {
    case "irs_letter":
      return t("labels.docType.irsLetter");
    case "audit":
      return t("labels.docType.audit");
    case "financials":
      return t("labels.docType.financials");
    case "board_list":
      return t("labels.docType.boardList");
    case "budget":
      return t("labels.docType.budget");
    case "annual_report":
      return t("labels.docType.annualReport");
    case "logo":
      return t("labels.docType.logo");
    default:
      return t("labels.docType.other");
  }
}

/** A go/no-go criterion's name and what it asks. */
export function criterionLabel(c: Criterion): { label: string; help: string } {
  switch (c) {
    case "fit":
      return { label: t("labels.criterion.fit"), help: t("labels.criterion.fitHelp") };
    case "capacity":
      return { label: t("labels.criterion.capacity"), help: t("labels.criterion.capacityHelp") };
    case "effort":
      return { label: t("labels.criterion.effort"), help: t("labels.criterion.effortHelp") };
    case "relationship":
      return { label: t("labels.criterion.relationship"), help: t("labels.criterion.relationshipHelp") };
  }
}

/** "FY 2027", or "FY 2027 (Jul 2026 to Jun 2027)" when the year does not start in January, in the page's language (the API words it in English). */
export function fiscalYearName(fy: number, startMonth: number): string {
  if (startMonth <= 1) return t("labels.fiscalYear", { range: "none", fy: String(fy), from: "", to: "" });
  const at = (year: number, month: number) => new Intl.DateTimeFormat(intlLocale(), { month: "short", year: "numeric", timeZone: "UTC" }).format(Date.UTC(year, month - 1, 1));
  return t("labels.fiscalYear", { range: "months", fy: String(fy), from: at(fy - 1, startMonth), to: at(fy, startMonth - 1) });
}

/** A month's name (1 = January), in the page's language. */
export const monthName = (m: number): string => new Intl.DateTimeFormat(intlLocale(), { month: "long", timeZone: "UTC" }).format(Date.UTC(2026, m - 1, 1));

/** What the vault upload says, and what a refused file name is told. */
export const vaultWarning = (): string => t("labels.vaultWarning");

/** An answer version's name (lib/writeKeep.ts keeps the English one). */
export const variantLabel = (k: VariantKey | "full"): string =>
  k === "short" ? t("answerLibrary.variant.short") : k === "medium" ? t("answerLibrary.variant.medium") : k === "long" ? t("answerLibrary.variant.long") : t("answerLibrary.variant.full");

/** "250 words", "1,500 characters", "No limit": a question's limit in words. */
export function limitPhrase(kind: LimitKind | null | undefined, value: number | null | undefined): string {
  if (!kind || !value) return t("labels.limit.none");
  return kind === "words" ? t("labels.limit.words", { count: value }) : kind === "chars" ? t("labels.limit.chars", { count: value }) : t("labels.limit.charsNoSpaces", { count: value });
}

/** A milestone worked back from the full deadline, by its key in lib/writeKeep.ts. */
export function milestoneTitle(key: string, fallback: string): string {
  return key === "draft" ? t("labels.milestone.draft") : key === "review" ? t("labels.milestone.review") : key === "final" ? t("labels.milestone.final") : fallback;
}
