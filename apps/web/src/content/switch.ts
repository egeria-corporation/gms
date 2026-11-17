// SPDX-License-Identifier: AGPL-3.0-only
// The switch pages (`/switch`, `/switch/{system}`): what each system exports and how, what moves
// over, and where each fact comes from. Facts are from the research of 15 November 2026 as
// corrected after a source check, and only those; every system cites its sources, every list price
// and every line about who owns a product carries its own source link, and every page carries the
// date stamp. Product names are text, never logos. Tone: factual and respectful; where we differ,
// we say so plainly. Source labels are neutral (the owner and the address) where the page could not
// be opened to read its title.
//
// Languages (docs/i18n.md): each system's facts (summary, exports, what moves over, its export step
// and questions, owners and prices) stay as written, with their sources. The pages' own text (the
// steps, what stays behind, how the GMS differs, the common questions, the form's choices and the
// page titles) is in the `public` catalog under `switchContent.*`, read through `switchText()` and
// `seoFor(entry, locale)`. The English constants below are that same text in English.
import { formatDateTimeIn, type Key, type Locale } from "@gms/i18n";
import { getLocale, translate } from "../i18n/current.ts";

/** The month the facts were last checked, and how it reads in English. */
export const FACTS_AS_OF_MONTH = "2026-11";
export const FACTS_AS_OF = "November 2026";
export const LIST_PRICE_LABEL = `list price as published, as of ${FACTS_AS_OF}`;
export const TRADEMARK_NOTE = `Product names are trademarks of their owners. Facts as of ${FACTS_AS_OF}; tell us if something changed.`;
export const OUR_NAME = "the OpenGrants Grant Management System";
export const OUR_PRICE = "Free, with unlimited seats";

/**
 * The import wizard inside a workspace: `/w/{workspace}/import` (built with the importers). One
 * constant to change if the wizard lives elsewhere.
 */
export const IMPORT_WIZARD_SEGMENT = "import";
export const importWizardPath = (workspaceHandle: string): string => `/w/${workspaceHandle}/${IMPORT_WIZARD_SEGMENT}`;

export interface Source {
  label: string;
  url: string;
}

/** A statement that needs its own source on the page: who owns a product, or a published price. */
export interface Claim {
  text: string;
  source: Source;
}

export const PEAK_SOURCE: Source = { label: "PEAK Grantmaking (peakgrantmaking.org)", url: "https://peakgrantmaking.org/insights/make-technology-transformational" };

/** How a system's price reads: a published list price with its source, or "priced by quote". */
export type Price = { kind: "list"; product: string; text: string; source: Source } | { kind: "quote" };
export const PRICED_BY_QUOTE = "Priced by quote";

export type SwitchSlug = "good-grants" | "submittable" | "surveymonkey-apply" | "foundant" | "zengine" | "fluxx" | "smartsimple" | "cybergrants" | "openwater" | "spreadsheets";

export interface Seo {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
}

export interface SwitchEntry {
  slug: SwitchSlug;
  /** How the name reads in a heading and a sentence. */
  name: string;
  /** How it is listed on /switch and in the form's select. */
  listName: string;
  kind: "system" | "spreadsheets";
  /** One line for /switch. */
  summary: string;
  /** Who owns the product, each with its own source. */
  news: Claim[];
  /** What you can export and how. */
  exports: string[];
  /** What comes over. */
  movesOver: string[];
  /** Step one, for this system. */
  exportStep: string;
  /** The GMS reads this system directly through its API, read-only, with the funder's own credentials (no file to export). */
  pull?: true;
  /** A list price only where the research gives one with a source (shown with LIST_PRICE_LABEL); "priced by quote" where the owner publishes none; null where the research says nothing. */
  price: Price | null;
  sources: Source[];
  /** Questions for this system, shown before the common ones. */
  faq: [string, string][];
}

const SUBMITTABLE_WIZEHIVE: Source = { label: "Submittable blog (submittable.com)", url: "https://www.submittable.com/blog/submittable-joins-forces-with-wizehive" };
const FOUNDANT_SMARTSIMPLE: Source = { label: "Foundant news (resources.foundant.com)", url: "https://resources.foundant.com/news/foundant-technologies-and-smartsimple-software-announce-strategic-merger-to-revolutionize-philanthropic-and-grant-management-solutions" };
const FOUNDANT_GROUP: Source = { label: "Foundant (foundant.com/about)", url: "https://www.foundant.com/about/foundant-smartsimple-givingdata" };
const QUOTE: Price = { kind: "quote" };

const ENTRIES: Omit<SwitchEntry, "kind">[] = [
  {
    slug: "good-grants",
    name: "Good Grants",
    listName: "Good Grants",
    summary: "Export applications, reviews and contracts as CSV or Excel; they come over as history.",
    news: [],
    exports: ["CSV or Excel exports of applications, reviews, file details and contracts.", "A zip of up to 100 applications per download. Download links expire after 48 hours.", "The Good Grants API (version 2.3), on the Premium plan."],
    movesOver: ["Past applications and their answers, as read-only history", "Reviews, as read-only history", "Awards from contracts, with payments recorded as paid elsewhere"],
    exportStep: "Export applications, reviews and contracts from Good Grants as CSV. An Excel export works too, once saved as CSV.",
    price: { kind: "list", product: "Good Grants", text: "€3,200 or €6,400 a year", source: { label: "Good Grants (goodgrants.com/pricing)", url: "https://goodgrants.com/pricing" } },
    sources: [
      { label: "Good Grants (goodgrants.com/pricing)", url: "https://goodgrants.com/pricing" },
      { label: "Good Grants docs (docs.goodgrants.com)", url: "https://docs.goodgrants.com/api-reference" },
    ],
    faq: [["Do we need the Good Grants API?", "No. The import wizard reads the CSV exports. The API, on the Premium plan, is another way to get the same records out."]],
  },
  {
    slug: "submittable",
    name: "Submittable",
    listName: "Submittable",
    summary: "Export submissions as CSV and PDF from the submission list in classic Submittable, or from Downloads in Submittable Next.",
    news: [{ text: "Submittable acquired WizeHive, the maker of Zengine, on 8 August 2024.", source: SUBMITTABLE_WIZEHIVE }],
    exports: ["From the submission list: a CSV file, one PDF per submission (as a zip), or the files plus the PDF (as a zip).", "In Submittable Next: the Downloads page."],
    movesOver: ["Submissions, with their answers and files, as read-only history", "Reviews, as read-only history", "Awards, with payments recorded as paid elsewhere"],
    exportStep: "From the submission list (or the Downloads page in Submittable Next), export the CSV, and the PDF zip if you want each submission as it was sent.",
    price: QUOTE,
    sources: [
      { label: "Submittable help center (submittable.help)", url: "https://submittable.help/en/articles/904906" },
      { label: "Submittable Next help center (next.support.submittable.com)", url: "https://next.support.submittable.com/hc/en-us/articles/36503809146903" },
    ],
    faq: [["We use Submittable Next. Is anything different?", "Only where you export: use the Downloads page. The import works the same way."]],
  },
  {
    slug: "surveymonkey-apply",
    name: "SurveyMonkey Apply",
    listName: "SurveyMonkey Apply",
    summary: "Export each program's applications from Data Exports as CSV or XLSX.",
    news: [],
    exports: ["Data Exports as CSV or XLSX, with up to 100 columns and one program in each export.", "A bulk download of application PDFs, as a zip."],
    movesOver: ["Past applications and their answers, one program at a time, as read-only history", "Awards, with payments recorded as paid elsewhere"],
    exportStep: "In Data Exports, export each program as CSV (or as XLSX, saved as CSV). An export holds one program and up to 100 columns, so a program with more fields takes more than one export.",
    price: QUOTE,
    sources: [{ label: "SurveyMonkey help center (help.surveymonkey.com)", url: "https://help.surveymonkey.com/en/apply/analyze/data-exports" }],
    faq: [["We have several programs. Do we import them together?", "One at a time: one export per program, each with its own dry run."]],
  },
  {
    slug: "foundant",
    name: "Foundant GLM",
    listName: "Foundant GLM",
    summary: "Export each process's applications, awards and payments as CSV or XLS.",
    news: [
      { text: "Foundant and SmartSimple merged in August 2024.", source: FOUNDANT_SMARTSIMPLE },
      { text: "GivingData later joined the same group.", source: FOUNDANT_GROUP },
    ],
    exports: ["CSV or XLS files from Export Data and from the report builder, one process at a time."],
    movesOver: ["Past applications and their answers, as read-only history", "Awards", "Payments, recorded as paid elsewhere"],
    exportStep: "From Export Data or the report builder, export the applications, awards and payments of each process as CSV (or as XLS, saved as CSV).",
    price: QUOTE,
    sources: [{ label: "Foundant (foundant.com)", url: "https://foundant.com/products/grant-management-software-for-foundations" }],
    faq: [["Do the payments recorded in GLM come over?", "Yes, as payments the foundation made elsewhere, with their amounts and dates. Nothing moves money, and bank details are never imported."]],
  },
  {
    slug: "zengine",
    name: "Zengine",
    listName: "Zengine (WizeHive)",
    summary: "The GMS reads your Zengine records directly, read-only, with an access token of your own.",
    news: [{ text: "Zengine has been part of Submittable since August 2024, when Submittable acquired WizeHive.", source: SUBMITTABLE_WIZEHIVE }],
    exports: ["The Zengine REST API, with OAuth, at up to 250 requests every 5 minutes.", "The GMS reads it for you, read-only, with an access token you get from Zengine: no export to write."],
    movesOver: ["Past applications, reviews and reports from the forms you pick, as read-only history", "Awards, with payments recorded as paid elsewhere"],
    exportStep: "Get an access token for your own Zengine account. Nothing is exported by hand: the GMS reads the form you pick through the API, read-only, and deletes the token when the import is finished.",
    pull: true,
    price: null,
    sources: [{ label: "Zengine developer docs (zenginehq.github.io)", url: "https://zenginehq.github.io/developers/rest-api" }],
    faq: [["Do we have to write code to export from Zengine?", "No. The GMS reads your records through the REST API itself, read-only, with your own access token, and writes nothing to Zengine. A CSV export of your own works too."]],
  },
  {
    slug: "fluxx",
    name: "Fluxx",
    listName: "Fluxx",
    summary: "The GMS reads grant requests, payments and reports straight from your Fluxx instance, read-only, with an API application of your own.",
    news: [{ text: "Fluxx acquired Grantseeker on 12 November 2025.", source: { label: "Fluxx blog (fluxx.io)", url: "https://fluxx.io/blog/fluxx-acquires-grantseeker-to-build-fully-connected-grantmaking-ecosystem" } }],
    exports: ["The REST API (version 2), for each Fluxx instance.", "Each instance has its own field dictionary, so the fields to map differ from one foundation to the next.", "The GMS reads it for you, read-only, with an API application you create in Fluxx: no export to write."],
    movesOver: ["Grant requests, declined ones included, as read-only history", "Reports, as read-only history", "Awards, with payments recorded as paid elsewhere"],
    exportStep: "In Fluxx, an administrator creates an API application at your instance's /oauth/applications page. Nothing is exported by hand: the GMS reads through the REST API, read-only, and deletes the application's id and secret when the import is finished.",
    pull: true,
    price: { kind: "list", product: "Fluxx Grantmaker", text: "from $13,000 a year, plus a one-time setup fee", source: { label: "Fluxx (fluxx.io/demo)", url: "https://www.fluxx.io/demo" } },
    sources: [{ label: "Rockefeller Archive Center on GitHub (fluxx_exporter)", url: "https://github.com/RockefellerArchiveCenter/fluxx_exporter" }],
    faq: [["Our Fluxx fields are our own. Will they map?", "The import wizard shows each of your columns and suggests where it goes. You confirm the mapping before the dry run."]],
  },
  {
    slug: "smartsimple",
    name: "SmartSimple",
    listName: "SmartSimple",
    summary: "Export lists as Excel or CSV, or use OData feeds or the SmartConnect API.",
    news: [
      { text: "SmartSimple and Foundant merged in August 2024.", source: FOUNDANT_SMARTSIMPLE },
      { text: "GivingData later joined the same group.", source: FOUNDANT_GROUP },
    ],
    exports: ["Excel or CSV list exports.", "OData feeds.", "The SmartConnect API, at up to 1,000 calls an hour."],
    movesOver: ["Past applications (Level 1 records) and their answers, as read-only history", "Reviews (Level 2 records), as read-only history", "Awards, with payments (Level 2 records) recorded as paid elsewhere"],
    exportStep: "Export the Level 1 list (applications) and the Level 2 lists (reviews and payments) as CSV.",
    price: QUOTE,
    sources: [{ label: "SmartSimple wiki (wiki.smartsimple.com)", url: "https://wiki.smartsimple.com/wiki/SmartConnect_-_RESTful_API" }],
    faq: [],
  },
  {
    slug: "cybergrants",
    name: "Bonterra CyberGrants",
    listName: "Bonterra CyberGrants",
    summary: "Export reports and application snapshots; awards and payment history come over without bank fields.",
    news: [],
    exports: ["Report exports.", "Application snapshots.", "The Insights API.", "A Snowflake data share."],
    movesOver: ["Past applications and their answers, as read-only history", "Impact reports, as read-only history", "Awards, with payment history recorded as paid elsewhere and bank fields dropped"],
    exportStep: "Export reports of your applications, awards and payments as CSV.",
    price: QUOTE,
    sources: [{ label: "Bonterra (bonterratech.com)", url: "https://bonterratech.com/pricing/corporate-social-responsibility" }],
    faq: [],
  },
  {
    slug: "openwater",
    name: "OpenWater",
    listName: "OpenWater",
    summary: "Export as Excel, CSV, JSON or PDF, or in bulk as a zip.",
    news: [],
    exports: ["Excel, CSV, JSON or PDF exports, and bulk downloads as a zip.", "A REST API, available as a paid add-on."],
    movesOver: ["Past applications and their answers, as read-only history", "Reviews (judging data), as read-only history", "Awards, with payments recorded as paid elsewhere"],
    exportStep: "Export applications and reviews as CSV.",
    price: QUOTE,
    sources: [{ label: "OpenWater help center (help.getopenwater.com)", url: "https://help.getopenwater.com/en/articles/3110614-openwater-rest-api" }],
    faq: [["Do we need the OpenWater REST API?", "No. The import wizard reads the CSV exports."]],
  },
];

const SPREADSHEETS: SwitchEntry = {
  slug: "spreadsheets",
  name: "spreadsheets, Airtable or GrantHub",
  listName: "Spreadsheets, Airtable or GrantHub",
  kind: "spreadsheets",
  summary: "Bring your trackers and past awards over from a CSV file, a Google Sheet or Airtable.",
  news: [],
  exports: ["A CSV file from Excel, Google Sheets, Airtable or any other tool.", "The CSV exports you kept from GrantHub, if you used it.", "Google Sheets and Airtable can also be read directly, where this server has those connections set up."],
  movesOver: ["Trackers of applications", "Past awards"],
  exportStep: "Save each tracker as a CSV file, with the column names in the first row.",
  price: null,
  sources: [],
  faq: [["Our tracker is messy. Will it work?", "The import wizard suggests a match for each column and shows a dry run with every row it would skip or could not read, so you can fix the file before anything is saved."]],
};

export const SWITCH_ENTRIES: SwitchEntry[] = [...ENTRIES.map((e) => ({ ...e, kind: "system" as const })), SPREADSHEETS];
export const switchEntry = (slug: string | undefined): SwitchEntry | undefined => SWITCH_ENTRIES.find((e) => e.slug === slug);

export const STEPS = (entry: SwitchEntry): [string, string][] => [
  [entry.pull ? `Get your ${entry.name} credentials` : `Export from ${entry.kind === "spreadsheets" ? "your spreadsheets" : entry.name}`, entry.exportStep],
  entry.pull
    ? [`Connect ${entry.name} in the import wizard`, `Sign up free, then open Import in your workspace and choose ${entry.name}. The GMS only reads from it.`]
    : ["Upload the files to the import wizard", "Sign up free, then open Import in your workspace. CSV files work on every install."],
  ["Review the dry run", "Before anything is saved, see what will be created, skipped or has an error, with counts and amounts by year."],
  ["Import", "Awards are created, with past payments recorded as paid elsewhere, and past applications, reviews and reports are kept as read-only history. Nothing moves money."],
];

export const STAYS_BEHIND = {
  what: "Bank account and routing numbers, personal identity numbers, dates of birth and government ID numbers are dropped automatically and never stored.",
  why: "The GMS never holds bank or identity data. Funders who pay through OpenGrants do it with OpenGrants Passport, where each organization links and verifies its own bank account; everyone else records what they paid elsewhere.",
};

export const DIFFERENCES: [string, string][] = [
  ["Free", "No licence fee and no price per seat, for funders and grantees, hosted or self-hosted."],
  ["Unlimited seats", "Invite your whole team, your reviewers and your board."],
  ["Open source (AGPL-3.0)", "The code is public. You can run your own copy and take your data with you."],
  ["CommonGrants", "Opportunities and awards are published in CommonGrants v0.5.0, an open standard for grants data, so other tools can read them."],
  ["Applicants track every grant", "Grantees keep one record of every application, including those to funders on other systems."],
];

export const COMMON_FAQ: [string, string][] = [
  ["Is the migration really free?", "Yes. A person at OpenGrants helps you plan the export and checks the dry run with you, at no charge. The GMS itself is free too."],
  ["Do we have to move everything at once?", "No. You can start with one program or the current cycle and bring past awards over later as history."],
  ["Can we keep using our current system for a while?", "Yes. Importing changes nothing in the system you export from, and a row already imported is not created twice if you import again."],
  ["What happens to bank details?", "They are never imported. Past payments come over as the amounts and dates paid elsewhere."],
  ["Can we leave later?", "Yes. Export everything as CommonGrants JSON or CSV at any time."],
  ["Who answers the request?", "A person at OpenGrants, by email, at the work address you give. Nothing is sent to anyone else."],
];

// ------------------------------------------------------------------------------------ form options

/** The form's select, in the order of the pages, as the API lists them (MIGRATION_SYSTEMS). */
export const SYSTEM_OPTIONS: { value: SwitchSlug | "other"; label: string }[] = [...SWITCH_ENTRIES.map((e) => ({ value: e.slug, label: e.listName })), { value: "other", label: "Something else" }];
export const PROGRAM_OPTIONS = [
  { value: "1", label: "1" },
  { value: "2-5", label: "2 to 5" },
  { value: "6-20", label: "6 to 20" },
  { value: "21+", label: "More than 20" },
  { value: "unsure", label: "Not sure" },
] as const;
export const PAST_AWARD_OPTIONS = [
  { value: "0-99", label: "Fewer than 100" },
  { value: "100-999", label: "100 to 999" },
  { value: "1000-9999", label: "1,000 to 9,999" },
  { value: "10000+", label: "10,000 or more" },
  { value: "unsure", label: "Not sure" },
] as const;
export const TIMING_OPTIONS = [
  { value: "asap", label: "As soon as possible" },
  { value: "3-months", label: "In the next 3 months" },
  { value: "6-months", label: "In 3 to 6 months" },
  { value: "12-months", label: "In 6 to 12 months" },
  { value: "exploring", label: "Just looking for now" },
] as const;
export const NOTE_MAX = 2000;

// ------------------------------------------------------------------------------------ in a language

const OPTION_KEY = {
  other: "switchContent.option.system.other",
  programs: { "1": "switchContent.option.programs.one", "2-5": "switchContent.option.programs.n2to5", "6-20": "switchContent.option.programs.n6to20", "21+": "switchContent.option.programs.over20", unsure: "switchContent.option.unsure" },
  pastAwards: { "0-99": "switchContent.option.pastAwards.under100", "100-999": "switchContent.option.pastAwards.n100to999", "1000-9999": "switchContent.option.pastAwards.n1000to9999", "10000+": "switchContent.option.pastAwards.over10000", unsure: "switchContent.option.unsure" },
  timing: { asap: "switchContent.option.timing.asap", "3-months": "switchContent.option.timing.n3months", "6-months": "switchContent.option.timing.n6months", "12-months": "switchContent.option.timing.n12months", exploring: "switchContent.option.timing.exploring" },
} as const;

/** The switch pages' own text in a language (the current one by default); system facts stay as written. */
export function switchText(locale: Locale = getLocale()) {
  const t = (key: Key<"public">, values?: Record<string, string>) => translate("public", key, values, locale);
  const factsAsOf = formatDateTimeIn(locale, `${FACTS_AS_OF_MONTH}-01`, { month: "long", year: "numeric", timeZone: "UTC" }) ?? FACTS_AS_OF;
  return {
    factsAsOf,
    ourName: t("switchContent.ourName"),
    ourPrice: t("switchContent.ourPrice"),
    pricedByQuote: t("switchContent.pricedByQuote"),
    listPriceLabel: t("switchContent.listPriceLabel", { date: factsAsOf }),
    trademarkNote: t("switchContent.trademarkNote", { date: factsAsOf }),
    staysBehind: { what: t("switchContent.staysBehind.what"), why: t("switchContent.staysBehind.why") },
    differences: [
      [t("switchContent.differences.free.title"), t("switchContent.differences.free.detail")],
      [t("switchContent.differences.seats.title"), t("switchContent.differences.seats.detail")],
      [t("switchContent.differences.openSource.title"), t("switchContent.differences.openSource.detail")],
      [t("switchContent.differences.commonGrants.title"), t("switchContent.differences.commonGrants.detail")],
      [t("switchContent.differences.tracking.title"), t("switchContent.differences.tracking.detail")],
    ] as [string, string][],
    commonFaq: [
      [t("switchContent.faq.free.q"), t("switchContent.faq.free.a")],
      [t("switchContent.faq.atOnce.q"), t("switchContent.faq.atOnce.a")],
      [t("switchContent.faq.keepUsing.q"), t("switchContent.faq.keepUsing.a")],
      [t("switchContent.faq.bank.q"), t("switchContent.faq.bank.a")],
      [t("switchContent.faq.leave.q"), t("switchContent.faq.leave.a")],
      [t("switchContent.faq.who.q"), t("switchContent.faq.who.a")],
    ] as [string, string][],
    /** Step one is the system's own export step, as written. */
    steps: (entry: SwitchEntry): [string, string][] => [
      [entry.pull ? t("switchContent.steps.credentials", { name: entry.name }) : entry.kind === "spreadsheets" ? t("switchContent.steps.exportSpreadsheets") : t("switchContent.steps.exportFrom", { name: entry.name }), entry.exportStep],
      entry.pull ? [t("switchContent.steps.connect.title", { name: entry.name }), t("switchContent.steps.connect.detail", { name: entry.name })] : [t("switchContent.steps.upload.title"), t("switchContent.steps.upload.detail")],
      [t("switchContent.steps.dryRun.title"), t("switchContent.steps.dryRun.detail")],
      [t("switchContent.steps.import.title"), t("switchContent.steps.import.detail")],
    ],
    /** A choice's label in the request form; systems are listed by their names. */
    systemLabel: (o: (typeof SYSTEM_OPTIONS)[number]): string => (o.value === "other" ? t(OPTION_KEY.other) : o.label),
    programsLabel: (value: (typeof PROGRAM_OPTIONS)[number]["value"]): string => t(OPTION_KEY.programs[value]),
    pastAwardsLabel: (value: (typeof PAST_AWARD_OPTIONS)[number]["value"]): string => t(OPTION_KEY.pastAwards[value]),
    timingLabel: (value: (typeof TIMING_OPTIONS)[number]["value"]): string => t(OPTION_KEY.timing[value]),
  };
}

// ------------------------------------------------------------------------------------ page metadata

/** Title, description and Open Graph text per page, for the front worker to serve to crawlers, in a language (English by default). */
export function seoFor(entry: SwitchEntry | null, locale: Locale = "en"): Seo {
  if (locale !== "en") {
    const t = (key: Key<"public">, values?: Record<string, string>) => translate("public", key, values, locale);
    const date = switchText(locale).factsAsOf;
    return entry
      ? { title: t("switchContent.seo.systemTitle", { name: entry.listName }), description: t("switchContent.seo.systemDescription", { name: entry.name, date }), ogTitle: t("switchContent.seo.systemOgTitle", { name: entry.name }), ogDescription: t("switchContent.seo.systemOgDescription", { summary: entry.summary }) }
      : { title: t("switchContent.seo.indexTitle"), description: t("switchContent.seo.indexDescription", { date }), ogTitle: t("switchContent.seo.indexOgTitle"), ogDescription: t("switchContent.seo.indexOgDescription") };
  }
  if (!entry)
    return {
      title: "Switch to OpenGrants GMS: what moves over, and a free migration",
      description: `What moves over to the free, open-source OpenGrants Grant Management System from Good Grants, Submittable, SurveyMonkey Apply, Foundant GLM, Zengine, Fluxx, SmartSimple, Bonterra CyberGrants, OpenWater and spreadsheets. Facts as of ${FACTS_AS_OF}.`,
      ogTitle: "Switching to the OpenGrants Grant Management System",
      ogDescription: "What each system exports, what comes over, and a free, human-run migration. Free, unlimited seats, open source.",
    };
  return {
    title: `Moving from ${entry.listName} to OpenGrants GMS`,
    description: `What you can export from ${entry.name}, what comes over to the free, open-source OpenGrants Grant Management System, what stays behind, and how to ask for a free migration. Facts as of ${FACTS_AS_OF}.`,
    ogTitle: `Moving from ${entry.name} to the OpenGrants Grant Management System`,
    ogDescription: `${entry.summary} Free, unlimited seats, open source.`,
  };
}
