// SPDX-License-Identifier: AGPL-3.0-only
// The form builder's words in the page's language: field kinds, the Passport fields a field can be
// prefilled from, and how a condition reads. lib/form-model.ts and @gms/forms name these in
// English for the stored form; the builder shows them by id, and anything it does not know as written.
import type { PrefillPath } from "@gms/forms";
import type { FieldKind, FormModel, ShowWhen } from "../../lib/form-model.ts";
import { t } from "./i18n.ts";

const KIND: Record<FieldKind, () => string> = {
  text: () => t("formBuilder.kind.text"),
  longText: () => t("formBuilder.kind.longText"),
  number: () => t("formBuilder.kind.number"),
  money: () => t("formBuilder.kind.money"),
  date: () => t("formBuilder.kind.date"),
  select: () => t("formBuilder.kind.select"),
  multiSelect: () => t("formBuilder.kind.multiSelect"),
  boolean: () => t("formBuilder.kind.boolean"),
  file: () => t("formBuilder.kind.file"),
  address: () => t("formBuilder.kind.address"),
  phone: () => t("formBuilder.kind.phone"),
  email: () => t("formBuilder.kind.email"),
  richText: () => t("formBuilder.kind.richText"),
  budgetTable: () => t("formBuilder.kind.budgetTable"),
  signature: () => t("formBuilder.kind.signature"),
  passportField: () => t("formBuilder.kind.passportField"),
  other: () => t("formBuilder.kind.other"),
};
export const fieldKindLabel = (kind: FieldKind): string => KIND[kind]?.() ?? kind;

const PREFILL: Record<string, () => string> = {
  "name": () => t("formBuilder.prefill.name"),
  "identifiers.org:us:ein.id": () => t("formBuilder.prefill.identifiersOrgUsEinId"),
  "orgType.term": () => t("formBuilder.prefill.orgTypeTerm"),
  "orgType.code": () => t("formBuilder.prefill.orgTypeCode"),
  "status.value": () => t("formBuilder.prefill.statusValue"),
  "addresses.primary.street1": () => t("formBuilder.prefill.addressesPrimaryStreet1"),
  "addresses.primary.street2": () => t("formBuilder.prefill.addressesPrimaryStreet2"),
  "addresses.primary.city": () => t("formBuilder.prefill.addressesPrimaryCity"),
  "addresses.primary.stateOrProvince": () => t("formBuilder.prefill.addressesPrimaryStateOrProvince"),
  "addresses.primary.postalCode": () => t("formBuilder.prefill.addressesPrimaryPostalCode"),
  "addresses.primary.country": () => t("formBuilder.prefill.addressesPrimaryCountry"),
  "phones.primary.number": () => t("formBuilder.prefill.phonesPrimaryNumber"),
  "emails.primary": () => t("formBuilder.prefill.emailsPrimary"),
  "mission": () => t("formBuilder.prefill.mission"),
  "yearFounded": () => t("formBuilder.prefill.yearFounded"),
  "socials.website": () => t("formBuilder.prefill.socialsWebsite"),
  "customFields.verificationLevel.value": () => t("formBuilder.prefill.customFieldsVerificationLevelValue"),
  "customFields.verifiedAt.value": () => t("formBuilder.prefill.customFieldsVerifiedAtValue"),
  "customFields.attestation.value": () => t("formBuilder.prefill.customFieldsAttestationValue"),
  "profile.commonApp.financials.budget": () => t("formBuilder.prefill.profileCommonAppFinancialsBudget"),
  "profile.commonApp.fiscalYearEnd": () => t("formBuilder.prefill.profileCommonAppFiscalYearEnd"),
  "profile.commonApp.staffCount": () => t("formBuilder.prefill.profileCommonAppStaffCount"),
  "profile.commonApp.financials.totalRevenue": () => t("formBuilder.prefill.profileCommonAppFinancialsTotalRevenue"),
  "profile.commonApp.financials.totalExpenses": () => t("formBuilder.prefill.profileCommonAppFinancialsTotalExpenses"),
  "profile.commonApp.financials.netAssets": () => t("formBuilder.prefill.profileCommonAppFinancialsNetAssets"),
  "profile.commonApp.irs.subsection": () => t("formBuilder.prefill.profileCommonAppIrsSubsection"),
  "profile.commonApp.irs.ntee": () => t("formBuilder.prefill.profileCommonAppIrsNtee"),
};
export const prefillLabel = (p: Pick<PrefillPath, "path" | "label">): string => PREFILL[p.path]?.() ?? p.label;

/** "Applicant type = Yes": the field a condition depends on and the answer that shows this one. */
export function conditionText(model: FormModel, when: ShowWhen): string {
  const source = model.sections.flatMap((s) => s.fields).find((f) => f.key === when.field);
  const value = typeof when.equals === "boolean" ? (when.equals ? t("formBuilder.condition.yes") : t("formBuilder.condition.no")) : when.equals;
  return t("formBuilder.condition.equals", { field: source?.label ?? when.field, value });
}
