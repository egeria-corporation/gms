// SPDX-License-Identifier: AGPL-3.0-only
// The document vault (v1.6.0): an applicant organization's own standing documents (IRS letter,
// audit, financials, board list, budget, annual report, logo, other), each typed and optionally
// dated to expire. Never bank letters, voided checks, ACH forms or anything with an SSN: there is
// no type for them, and a file whose name says it is one is refused. The assistant never reads a
// vault document. Private to the applicant workspace (consultants excluded).
import { ApiError } from "../lib/errors.ts";

export const VAULT_TYPES = ["irs_letter", "audit", "financials", "board_list", "budget", "annual_report", "logo", "other"] as const;
export type VaultType = (typeof VAULT_TYPES)[number];
export const VAULT_TYPE_LABEL: Record<VaultType, string> = {
  irs_letter: "IRS determination letter",
  audit: "Audit",
  financials: "Financial statements",
  board_list: "Board list",
  budget: "Budget",
  annual_report: "Annual report",
  logo: "Logo",
  other: "Other",
};

/** What the upload dialog says, and what a refused file is told. */
export const VAULT_NEVER_MESSAGE =
  "The vault never keeps bank letters, voided checks, ACH forms, W-9s or anything with a Social Security number. Banking details stay with Passport and its payment provider. If this file is a different document, give it a name that says what it is.";

/**
 * Words in a file name that mark a bank or tax form (contract: bank, ach, void, routing, w-9).
 * Whole words only, so "attachment" or "teacher" pass. One place to widen.
 */
export const SENSITIVE_FILENAME = /(^|[^a-z0-9])(bank(s|ing)?|ach|void(ed)?|routing|w[-_. ]?9|ssn)(?=[^a-z0-9]|$)/i;

export function refuseSensitiveFilename(name: string): void {
  if (SENSITIVE_FILENAME.test(name.normalize("NFKC"))) throw new ApiError(422, "sensitive_document", VAULT_NEVER_MESSAGE, [{ code: "sensitive_document", field: "name" }]);
}
