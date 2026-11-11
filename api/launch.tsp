import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";

// Launch preparation: the install's switches, a person's own sessions, the organization's verified
// representatives, the signer rule, budget categories and their mapping, a funder's named contacts
// and the Google Workspace export. Nothing here carries bank or identity data: a representative is
// a name, a title and a verification level, never a contact detail or a document number.

namespace GMS.Models;

/** What this server has switched on. Read before sign-in so the web app can hide controls. */
model InstallConfig {
  /** False: `POST /gms/tranches/{id}/release` answers 409 `facilitated_payments_disabled` and payments are recorded after being paid outside the GMS. */
  facilitatedPayments: boolean;

  /** False: every drafting route under `/gms/assist/` answers 404. */
  assistantEnabled: boolean;
}

/** One sign-in session of the calling person. */
model AccountSession {
  id: CommonGrants.Types.uuid;
  createdAt: utcDateTime;
  lastActiveAt: utcDateTime | null;
  userAgent: string | null;

  /** A short description such as "Chrome on macOS", when recognizable */
  device: string | null;

  /** The network address of the session, shown only to the person it belongs to */
  ip: string | null;

  /** `aal2` when the session passed two-step verification */
  aal: string | null;

  mfa: boolean;

  /** True for the session making this request; it cannot be ended here (sign out instead) */
  current: boolean;
}

model EndedSession {
  ended: true;
  id: CommonGrants.Types.uuid;
}

/** A person Passport has verified as able to act for the organization. No contact details. */
model Representative {
  id: string;
  name: string;
  title: string | null;

  /** Passport's role, e.g. `control_officer` or `second_representative` */
  role: string;

  isControlOfficer: boolean;
  verified: true;
  verificationLevel: "L2" | "L3";
  verifiedAt: utcDateTime;
}

model Representatives {
  /** `ok`: Passport answered. `not_linked`: no consent on file. `not_shared`: the consent does not cover representatives. `unknown`: Passport could not be reached. */
  state: "ok" | "not_linked" | "not_shared" | "unknown";

  items: Representative[];

  /** Where representatives are managed, in Passport */
  manageUrl?: string | null;
}

/** Which rule let a person accept or sign for the recipient organization. Also on the ledger and the signature record. */
model SignerAuthority {
  /** `passport_representative`: the typed legal name matched a verified representative. `admin_role`: Passport could not say, so the workspace admin role stood. */
  rule: "passport_representative" | "admin_role";

  /** Why the admin-role rule applied: `passport_not_linked`, `representatives_not_shared`, `passport_unavailable` or `no_verified_representatives` */
  reason: string | null;

  representativeId: string | null;
  verificationLevel: string | null;
}

/** Accepting an offer. When Passport lists verified representatives the typed legal name is required and must match one (422 `signer_name_required`, 403 `not_a_representative`). */
model AcceptOfferInput {
  name?: string;
}

model BudgetCategories {
  programId: CommonGrants.Types.uuid;
  categories: string[];
}

model BudgetCategoriesInput {
  /** Up to 50 unique names of at most 100 characters */
  categories: string[];
}

model BudgetCategoryMapping {
  /** The funder's budget category */
  category: string;

  /** The category in the grantee's own books. Several may map to one funder category. */
  ownCategory: string;
}

model BudgetMapping {
  awardId: PrefixedId;

  /** The funder's categories: the program's list, else the categories of the approved budget */
  categories: string[];

  mapping: BudgetCategoryMapping[];
}

model BudgetMappingInput {
  mapping: BudgetCategoryMapping[];
}

model ProgramOwner {
  userId: CommonGrants.Types.uuid;
  name: string | null;
}

model OutcomeTotal {
  /** The report field's own name */
  key: string;

  label: string;
  unit: string | null;
  total: float64;

  /** Accepted reports that carried a number for this field */
  reports: int32;
}

/** Numeric report fields marked `outcome: true` in the form's `fieldMeta` (or the control's options), added up over accepted reports. */
model ProgramOutcomes {
  reportsAccepted: int32;
  totals: OutcomeTotal[];
}

/** A person the funder names for the organizations it works with. Kept in the workspace's `settings.contacts`. */
model FunderContact {
  name: string;
  title?: string | null;
  email: string;
  phone?: string | null;

  /** True: also shown on the public funder page */
  public?: boolean;
}

model FunderContactsInput {
  /** At most 20 */
  contacts: FunderContact[];
}

model InterviewSlot {
  /** `slot_1`, `slot_2`, … in the order offered */
  id: string;

  at: utcDateTime;
}

model DriveExportInput {
  /** `letter`: an award's letter. `agreement`: an agreement, executed once executed. `snapshot`: an application as submitted. */
  documentKind: "letter" | "agreement" | "snapshot";

  /** The award, agreement or application id */
  subjectId: GmsId;

  /** The Drive folder the person chose in the Google Picker */
  folderId: string;
}

model DriveExportResult {
  documentKind: "letter" | "agreement" | "snapshot";
  subjectId: PrefixedId;
  fileId: string | null;
  fileName: string;
  url: string;
}

model DirectoryPersonSuggestion {
  email: string;
  name: string | null;
}
