import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";
import "./routes.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using GMS.Models;
using GMS.Auth;
using GMS.Errors;
using GMS.HttpResponses;

// QuickBooks Online sync through Composio (v1.13.0, docs/accounting.md). Record-keeping, not a money
// path: once a person turns the sync on, the jobs Worker writes one expense to the funder's
// QuickBooks for each payment recorded in the GMS (paid elsewhere, or disbursed through Passport and
// mirrored), once. Nothing here pays, schedules or moves money; no bank details are read, stored or
// sent. Edits and voids after posting mark the entry "needs attention"; the GMS never changes the
// books. QuickBooks connects through `/gms/connectors/quickbooks` (a workspace admin, in person).
// Admins and finance staff read, and their agents (payments:read); every write is a person's, in the
// GMS: agent and API-client tokens get 403.

namespace GMS.Models {
  /** A QuickBooks record the funder chose: QuickBooks' id and name (a long run of digits in a name is cut to its last four). */
  model QuickBooksRef {
    /** QuickBooks' own id (digits). */
    id: string;

    name: string;
  }

  model AccountingSettings {
    /** The expense account grants post to. */
    expense: QuickBooksRef | null;

    /** The bank account in QuickBooks' chart of accounts the payments leave from (its QuickBooks id and name, never a bank's number). */
    paidFrom: QuickBooksRef | null;

    /** How programs are tracked in QuickBooks. */
    tracking: "none" | "class" | "department";

    /** A grantee with no vendor yet: `create` one with the organization's name only, or `ask` a person. */
    vendorPolicy: "create" | "ask";

    /** The company's home currency; payments in another currency are not posted. */
    currency: string;

    /** Off until a person turns it on. */
    syncEnabled: boolean;

    /** Payments recorded from this moment on are posted. */
    syncFrom: utcDateTime | null;

    /** The language of the memo on each entry. */
    locale: "en" | "es";

    updatedAt: utcDateTime | null;
  }

  model AccountingSync {
    /** QuickBooks through Composio is set up on this server. */
    configured: boolean;

    connected: boolean;

    /** The stored connection state (`connector_accounts`). */
    connection: string;

    settings: AccountingSettings;

    /** Each program of the workspace, with its class or location. */
    programs: {
      programId: string;
      name: string;
      ref: QuickBooksRef | null;
    }[];

    counts: {
      posted: int32;
      needsAttention: int32;
      failed: int32;
      posting: int32;
    };
  }

  /** What the funder can choose from in QuickBooks, read live: active records, ids and names only. */
  model AccountingOptions {
    expenseAccounts: QuickBooksRef[];
    bankAccounts: QuickBooksRef[];
    classes: QuickBooksRef[];
    departments: QuickBooksRef[];
  }

  model AccountingSettingsInput {
    /** From `expenseAccounts`. */
    expenseId: string;

    /** From `bankAccounts`. */
    paidFromId: string;

    tracking: "none" | "class" | "department";

    /** Program id → a class or location id (null: none for that program). */
    programs?: Record<string | null>;

    vendorPolicy: "create" | "ask";

    /** Three letters (default USD). */
    currency?: string;

    /** Turning it on starts from now: payments recorded before are never posted. 409 `quickbooks_not_connected`. */
    syncEnabled: boolean;
  }

  model AccountingVendors {
    vendorPolicy: "create" | "ask";

    /** Active QuickBooks vendors, ids and names only. */
    vendors: QuickBooksRef[];

    /** Each organization this workspace has awarded, with the vendor chosen and QuickBooks' vendor of exactly its name. */
    grantees: {
      granteeId: string;
      name: string;
      vendor: QuickBooksRef | null;
      suggestion: QuickBooksRef | null;
    }[];
  }

  model AccountingVendorsInput {
    /** `vendorId` null: back to matching by name (or creating one, per `vendorPolicy`). */
    vendors: {
      granteeId: string;
      vendorId: string | null;
    }[];
  }

  union AccountingEntryStatus {
    posting: "posting",
    posted: "posted",

    /** The payment was changed, voided or removed after it was posted. */
    needsAttention: "needs_attention",

    /** Not in QuickBooks; `reason` says why. */
    failed: "failed",

    /** A person fixed QuickBooks after a change and said so. */
    handled: "handled",
  }

  model AccountingEntry {
    id: string;
    status: AccountingEntryStatus;
    reason: "changed" | "voided" | "removed" | "vendor_unclear" | "vendor_refused" | "currency" | "refused" | "unreachable" | null;

    /** QuickBooks' id for the expense. */
    quickbooksId: string | null;

    /** The GMS's reference written on it (QuickBooks' Ref no.). */
    reference: string;

    /** What was written. */
    posted: {
      amountMinor: int64;
      currency: string;
      paidOn: plainDate;
      vendorName: string | null;
    };

    postedAt: utcDateTime | null;

    /** What changed after posting. */
    attention: Record<unknown> | null;

    attentionAt: utcDateTime | null;
    handledAt: utcDateTime | null;
    attempts: int32;
  }

  model AccountingPayment {
    trancheId: string;
    awardId: string;
    awardTitle: string | null;
    grantee: string | null;
    seq: int32;
    amountMinor: int64;
    currency: string;
    paidOn: plainDate | null;
    mode: string | null;
    status: string;
  }

  model AccountingEntries {
    syncEnabled: boolean;
    syncFrom: utcDateTime | null;

    /** Newest first: each recorded payment with its QuickBooks entry, and entries whose payment was removed. */
    items: {
      payment: AccountingPayment | null;
      quickbooks: {
        /** `waiting`: recorded since the sync was turned on, not sent yet. `not_synced`: no entry (the sync was off). */
        status: "posting" | "posted" | "needs_attention" | "failed" | "handled" | "waiting" | "not_synced";

        entry: AccountingEntry | null;

        /** With `compare=true`: whether QuickBooks still holds the entry as posted. */
        inQuickBooks?: "matches" | "differs" | "missing";
      };
    }[];
  }
}

namespace GMS.Routes.Custom {
  @tag("Accounting")
  namespace Accounting {
    /** The QuickBooks sync of this workspace: connection, mapping, switch and counts. Admins and finance staff. */
    @get @route("/accounting") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op sync(): OkT<AccountingSync> | AuthErrors;

    /** Expense and bank accounts, classes and locations in QuickBooks (read live). 409 `quickbooks_not_connected`. */
    @get @route("/accounting/options") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op options(): OkT<AccountingOptions> | AuthErrors | Conflict | Unprocessable | ServiceUnavailable;

    /** Save the mapping and turn the sync on or off. Admins and finance staff, in person. 422 `unknown_account`, `unknown_class`, `unknown_program`. */
    @put @route("/accounting/settings") @useAuth(UserSession)
    op saveSettings(@body body: AccountingSettingsInput): OkT<AccountingSync> | BadRequest | AuthErrors | Conflict | Unprocessable | ServiceUnavailable;

    /** Each grantee's vendor, and QuickBooks' vendors (read live). */
    @get @route("/accounting/vendors") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op vendors(): OkT<AccountingVendors> | AuthErrors | Conflict | Unprocessable | ServiceUnavailable;

    /** Choose the vendor of each grantee. Admins and finance staff, in person. 422 `unknown_vendor`. */
    @put @route("/accounting/vendors") @useAuth(UserSession)
    op saveVendors(@body body: AccountingVendorsInput): OkT<AccountingVendors> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable | ServiceUnavailable;

    /** The reconciliation view, read only. With `compare=true` the entries shown are read back from QuickBooks (at most 25). */
    @get @route("/accounting/entries") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op entries(@query compare?: boolean): OkT<AccountingEntries> | AuthErrors | Conflict | Unprocessable | ServiceUnavailable;

    /** A person fixed QuickBooks after a change or void and says so. The GMS changes nothing in the books. 409 `invalid_transition`. */
    @post @route("/accounting/entries/{id}/handled") @useAuth(UserSession)
    op handled(@path id: string): OkT<AccountingEntry> | AuthErrors | NotFound | Conflict;

    /** Try a payment that is not in QuickBooks again on the next run. 409 `invalid_transition`. */
    @post @route("/accounting/entries/{id}/retry") @useAuth(UserSession)
    op retry(@path id: string): OkT<AccountingEntry> | AuthErrors | NotFound | Conflict;
  }
}
