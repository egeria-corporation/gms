import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";
import "./routes.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using CommonGrants.Fields;
using GMS.Models;
using GMS.Auth;
using GMS.Errors;
using GMS.HttpResponses;

// Funds (v1.9.0): one funder workspace, many funds. Community foundations, fiscal sponsors and
// intermediaries run many funds from one office, each with its own advisors, budget and public
// face. A program belongs to one fund; opportunities, competitions, applications and awards belong
// to it through their program. Every funder workspace has a default fund, which holds the programs
// made before funds existed and any program that names no fund.
//
// A member whose scope names `fundIds` (a fund advisor: an existing role, reviewer or program
// officer, invited as "Advisor for {fund}") sees and acts only on those funds' programs and
// everything under them, on every route and MCP tool; any other record answers 404. Admins,
// members without a fund scope and workspace API clients see every fund.

namespace GMS.Models {
  /** The theme palette a fund's colour comes from. Never a hex value. */
  union FundColor {
    teal: "teal",
    blue: "blue",
    mint: "mint",
    navy: "navy",
    gray: "gray",
  }

  model FundBrand {
    color: FundColor | null;

    /** An https link to the fund's logo */
    logoUrl: url | null;
  }

  model FundBrandInput {
    color?: FundColor | null;
    logoUrl?: url | null;
  }

  /** The fund's own budget for one fiscal year. */
  model FundBudget {
    fiscalYear: int32;

    /** Integer minor units of `currency` */
    amountMinor: int64;

    currency: string;
  }

  /** A fiscal year of a fund: its budget beside its programs' budgets for that year. */
  model FundYearTotal {
    fiscalYear: int32;
    currency: string;

    /** The fund's own budget; null when none is set for the year */
    budgetMinor: int64 | null;

    /** The budgets of the fund's programs in this fiscal year and currency */
    programsMinor: int64;

    programCount: int32;

    /** `budgetMinor` less `programsMinor`; negative when the programs are budgeted past the fund; null without a fund budget */
    availableMinor: int64 | null;

    over: boolean;
  }

  model Fund {
    id: CommonGrants.Types.uuid;
    name: string;

    /** The fund's public address: `/f/{handle}/{slug}` */
    slug: string;

    description: string | null;
    brand: FundBrand;

    /** The fund that holds programs made without naming a fund */
    isDefault: boolean;

    budgets: FundBudget[];
    totals: FundYearTotal[];
    programCount: int32;
    programIds: CommonGrants.Types.uuid[];
    createdAt: utcDateTime;
    updatedAt: utcDateTime;
  }

  model FundAdvisor {
    userId: CommonGrants.Types.uuid;
    role: "reviewer" | "program_officer" | string;
    name: string | null;
    email: string | null;
  }

  model FundDetail {
    ...Fund;

    /** Members whose scope names this fund */
    advisors: FundAdvisor[];
  }

  model FundList {
    items: Fund[];

    /** True when the caller is a fund advisor and `items` holds only their funds */
    scoped: boolean;
  }

  model FundInput {
    name: string;

    /** Lowercase letters, digits and hyphens; made from the name when absent. Words the funder's own pages use (`o`, `awards`, `embed`, …) are refused */
    slug?: string;

    /** At most 500 characters */
    description?: string | null;

    brand?: FundBrandInput;
  }

  model FundPatch {
    name?: string;
    slug?: string;
    description?: string | null;
    brand?: FundBrandInput;
  }

  model FundBudgetInput {
    @minValue(1990) @maxValue(2200) fiscalYear: int32;
    @minValue(0) amountMinor: int64;

    /** USD when absent */
    currency?: string;
  }

  model FundBudgetsInput {
    /** One per fiscal year; replaces the fund's budgets */
    budgets: FundBudgetInput[];
  }

  model FundAdvisorInput {
    @format("email") email: string;

    /** An existing role; the invitation adds a scope naming this fund */
    role: "reviewer" | "program_officer";

    expiresInDays?: int32;
  }

  model FundAdvisorInvitation {
    id: CommonGrants.Types.uuid;
    email: string;
    role: string;
    organization: string | null;
    expiresAt: utcDateTime;

    /** Shown once, for the invitation link */
    token: string;

    emailed: boolean;
    acceptUrl: url;
    fund: {
      id: CommonGrants.Types.uuid;
      name: string;
    };
  }

  /** What the public pages show of a fund: never its budgets or its advisors. */
  model PublicFund {
    name: string;
    slug: string;
    description: string | null;
    brand: FundBrand;

    /** The fund that holds programs made without naming a fund: the pages name no fund for it */
    isDefault: boolean;
  }

  /** A fund as the funder page groups its opportunities (`FunderPage.funds`, when the server sends it). */
  model PublicFundSection {
    ...PublicFund;

    /** The fund's published opportunities, by id */
    opportunityIds: CommonGrants.Types.uuid[];
  }

  model FundPage {
    funder: PublicFunder;
    fund: PublicFund;

    /** The fund's published opportunities */
    opportunities: PublicOpportunityCard[];

    open: PublicOpportunityCard[];
    forecasted: PublicOpportunityCard[];
  }
}

namespace GMS.Routes.Custom {
  @tag("Funds")
  namespace Funds {
    /** The funds the caller sees, the default first: each with its budget per fiscal year beside its programs'. A fund advisor sees their funds only (`scoped: true`). */
    @get @route("/funds") @useAuth(GmsOAuth<["programs:read"]> | UserSession)
    op list(): OkT<FundList> | AuthErrors;

    /** Admins. 409 when the address is taken. */
    @post @route("/funds") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op create(@body body: FundInput): CreatedT<Fund> | BadRequest | AuthErrors | Conflict;

    /** One fund with its programs' totals and its advisors. 404 for a fund outside the caller's scope. */
    @get @route("/funds/{id}") @useAuth(GmsOAuth<["programs:read"]> | UserSession)
    op read(@path id: CommonGrants.Types.uuid): OkT<FundDetail> | AuthErrors | NotFound;

    /** Admins. Changing the address changes the fund's public page link. */
    @patch @route("/funds/{id}") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op update(@path id: CommonGrants.Types.uuid, @body body: FundPatch): OkT<Fund> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Admins. The fund's own budget per fiscal year, both values on the ledger. */
    @put @route("/funds/{id}/budgets") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op putBudgets(@path id: CommonGrants.Types.uuid, @body body: FundBudgetsInput): OkT<Fund> | BadRequest | AuthErrors | NotFound;

    /** Admins, signed in: "Advisor for {fund}", an invitation with an existing role and a scope naming this fund. Changes who sees what, so there is no MCP tool for it. */
    @post @route("/funds/{id}/advisors") @useAuth(UserSession)
    op inviteAdvisor(@path id: CommonGrants.Types.uuid, @body body: FundAdvisorInput): CreatedT<FundAdvisorInvitation> | BadRequest | AuthErrors | NotFound | Unprocessable | TooManyRequests;
  }

  @tag("Public pages")
  namespace FundPages {
    /** Published data behind `/f/{handle}/{fundSlug}`: the funder, the fund and its published opportunities. No token; published fields only. */
    @summary("Fund public page data")
    @get
    @route("/public/funders/{handle}/funds/{slug}")
    op fundPage(@path handle: string, @path slug: string): OkT<FundPage> | NotFound;
  }
}
