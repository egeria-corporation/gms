// SPDX-License-Identifier: AGPL-3.0-only
// The switch pages (`/switch`, `/switch/{system}`): what each system exports and how, what moves
// over, and where each fact comes from. Facts are from the research of 15 November 2026 and only
// those; every system cites its sources and every page carries the date stamp. Product names are
// text, never logos. Tone: factual and respectful; where we differ, we say so plainly.

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

export const PEAK_SOURCE: Source = { label: "PEAK Grantmaking: Make technology transformational", url: "https://peakgrantmaking.org/insights/make-technology-transformational" };

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
  /** News about who owns or replaces the product, when there is any. */
  background: string | null;
  /** What you can export and how. */
  exports: string[];
  /** What comes over. */
  movesOver: string[];
  /** Step one, for this system. */
  exportStep: string;
  /** Only where the research gives one; shown with LIST_PRICE_LABEL. */
  listPrice: string | null;
  sources: Source[];
  /** Questions for this system, shown before the common ones. */
  faq: [string, string][];
}

const ENTRIES: Omit<SwitchEntry, "kind">[] = [
  {
    slug: "good-grants",
    name: "Good Grants",
    listName: "Good Grants",
    summary: "Export applications, reviews and contracts as CSV or Excel; they come over as history.",
    background: null,
    exports: ["CSV or Excel exports of applications, reviews, file details and contracts.", "A zip of up to 100 applications per download. Download links expire after 48 hours.", "The Good Grants API (version 2.3), on the Premium plan."],
    movesOver: ["Applications", "Reviews", "Contracts, kept as the history of past cycles"],
    exportStep: "Export applications, reviews and contracts from Good Grants as CSV. An Excel export works too, once saved as CSV.",
    listPrice: "€3,200 or €6,400 a year",
    sources: [
      { label: "Good Grants pricing", url: "https://goodgrants.com/pricing" },
      { label: "Good Grants API reference", url: "https://docs.goodgrants.com/api-reference" },
    ],
    faq: [["Do we need the Good Grants API?", "No. The import wizard reads the CSV exports. The API, on the Premium plan, is another way to get the same records out."]],
  },
  {
    slug: "submittable",
    name: "Submittable",
    listName: "Submittable",
    summary: "Export submissions as CSV and PDF from the submission list, or from Downloads in Submittable Next.",
    background: "Submittable bought WizeHive, the maker of Zengine, in August 2024. This page covers both classic Submittable and Submittable Next.",
    exports: ["From the submission list: a CSV file, one PDF per submission (as a zip), or the files plus the PDF (as a zip).", "In Submittable Next: the Downloads page."],
    movesOver: ["Submissions, with their files", "Awards, kept as history"],
    exportStep: "From the submission list (or the Downloads page in Submittable Next), export the CSV, and the PDF zip if you want each submission as it was sent.",
    listPrice: null,
    sources: [
      { label: "Submittable help center", url: "https://submittable.help/en/articles/904906" },
      { label: "Submittable Next help center", url: "https://next.support.submittable.com/hc/en-us/articles/36503809146903" },
    ],
    faq: [["We use Submittable Next. Is anything different?", "Only where you export: use the Downloads page. The import works the same way."]],
  },
  {
    slug: "surveymonkey-apply",
    name: "SurveyMonkey Apply",
    listName: "SurveyMonkey Apply",
    summary: "Export each program's applications from Data Exports as CSV or XLSX.",
    background: null,
    exports: ["Data Exports as CSV or XLSX, with up to 100 columns and one program in each export.", "A bulk download of application PDFs, as a zip."],
    movesOver: ["Applications, one program at a time"],
    exportStep: "In Data Exports, export each program as CSV (or as XLSX, saved as CSV). An export holds one program and up to 100 columns, so a program with more fields takes more than one export.",
    listPrice: null,
    sources: [{ label: "SurveyMonkey Apply help: Data Exports", url: "https://help.surveymonkey.com/en/apply/analyze/data-exports" }],
    faq: [["We have several programs. Do we import them together?", "One at a time: one export per program, each with its own dry run."]],
  },
  {
    slug: "foundant",
    name: "Foundant GLM",
    listName: "Foundant GLM",
    summary: "Export each process's applications, awards and payments as CSV or XLS.",
    background: "Foundant merged with SmartSimple and GivingData in August 2024. No successor to GLM has been announced.",
    exports: ["CSV or XLS files from Export Data and from the report builder, one process at a time."],
    movesOver: ["Applications", "Awards", "Payments, recorded as paid elsewhere"],
    exportStep: "From Export Data or the report builder, export the applications, awards and payments of each process as CSV (or as XLS, saved as CSV).",
    listPrice: "$6,500, $9,900 or $13,900 a year, plus $2,500 to $4,500 for setup",
    sources: [{ label: "Foundant: grant management software for foundations", url: "https://foundant.com/products/grant-management-software-for-foundations" }],
    faq: [["Do the payments recorded in GLM come over?", "Yes, as payments the foundation made elsewhere, with their amounts and dates. Nothing moves money, and bank details are never imported."]],
  },
  {
    slug: "zengine",
    name: "Zengine",
    listName: "Zengine (WizeHive)",
    summary: "Records come out through the Zengine REST API; we can help with the export.",
    background: "Submittable bought WizeHive in August 2024, and Zengine customers are moving to Submittable Next.",
    exports: ["The Zengine REST API, with OAuth, at up to 250 requests every 5 minutes."],
    movesOver: ["Records, through the API"],
    exportStep: "Export your records through the Zengine REST API into CSV files. If you would rather not write that export yourself, ask for the free migration and a person at OpenGrants helps with it.",
    listPrice: null,
    sources: [{ label: "Zengine developer docs: REST API", url: "https://zenginehq.github.io/developers/rest-api" }],
    faq: [["Our Zengine account is moving to Submittable Next. Can we move here instead?", "Yes. Export your records from Zengine and import them here, and ask for the free migration if you want help."]],
  },
  {
    slug: "fluxx",
    name: "Fluxx",
    listName: "Fluxx",
    summary: "Grant requests, payments, reports, documents and organizations come out through each instance's REST API.",
    background: "Fluxx bought Grantseeker in November 2025.",
    exports: ["The REST API (version 2), for each Fluxx instance.", "Each instance has its own field dictionary, so the fields to map differ from one foundation to the next."],
    movesOver: ["Grant requests", "Payments, recorded as paid elsewhere", "Reports", "Documents", "Organizations"],
    exportStep: "Export through your instance's REST API into CSV files. The Rockefeller Archive Center publishes an open-source Fluxx exporter you can start from.",
    listPrice: "from $13,000 a year, plus setup",
    sources: [{ label: "Rockefeller Archive Center: fluxx_exporter (GitHub)", url: "https://github.com/RockefellerArchiveCenter/fluxx_exporter" }],
    faq: [["Our Fluxx fields are our own. Will they map?", "The import wizard shows each of your columns and suggests where it goes. You confirm the mapping before the dry run."]],
  },
  {
    slug: "smartsimple",
    name: "SmartSimple",
    listName: "SmartSimple",
    summary: "Export lists as Excel or CSV, or use OData feeds or the SmartConnect API.",
    background: "SmartSimple is part of Foundant, after the merger of August 2024.",
    exports: ["Excel or CSV list exports.", "OData feeds.", "The SmartConnect API, at up to 1,000 calls an hour."],
    movesOver: ["Applications (Level 1 records)", "Reviews and payments (Level 2 records); payments are recorded as paid elsewhere"],
    exportStep: "Export the Level 1 list (applications) and the Level 2 lists (reviews and payments) as CSV.",
    listPrice: null,
    sources: [{ label: "SmartSimple wiki: SmartConnect RESTful API", url: "https://wiki.smartsimple.com/wiki/SmartConnect_-_RESTful_API" }],
    faq: [],
  },
  {
    slug: "cybergrants",
    name: "Bonterra CyberGrants",
    listName: "Bonterra CyberGrants",
    summary: "Export reports and application snapshots; awards and payment history come over without bank fields.",
    background: null,
    exports: ["Report exports.", "Application snapshots.", "The Insights API.", "A Snowflake data share."],
    movesOver: ["Applications", "Awards", "Payment history, with bank fields dropped"],
    exportStep: "Export reports of your applications, awards and payments as CSV.",
    listPrice: null,
    sources: [{ label: "Bonterra: corporate social responsibility pricing", url: "https://bonterratech.com/pricing/corporate-social-responsibility" }],
    faq: [],
  },
  {
    slug: "openwater",
    name: "OpenWater",
    listName: "OpenWater",
    summary: "Export as Excel, CSV, JSON or PDF, or in bulk as a zip.",
    background: "OpenWater is owned by ASI.",
    exports: ["Excel, CSV, JSON or PDF exports, and bulk downloads as a zip.", `A REST API, available as an add-on at $2,000 a year (${LIST_PRICE_LABEL}).`],
    movesOver: ["Applications", "Reviews"],
    exportStep: "Export applications and reviews as CSV.",
    listPrice: "from $5,100 a year",
    sources: [{ label: "OpenWater help: REST API", url: "https://help.getopenwater.com/en/articles/3110614-openwater-rest-api" }],
    faq: [["Do we need the OpenWater REST API?", "No. The import wizard reads the CSV exports."]],
  },
];

const SPREADSHEETS: SwitchEntry = {
  slug: "spreadsheets",
  name: "spreadsheets, Airtable or GrantHub",
  listName: "Spreadsheets, Airtable or GrantHub",
  kind: "spreadsheets",
  summary: "Bring your trackers and past awards over from a CSV file, a Google Sheet or Airtable.",
  background: "GrantHub was discontinued in January 2026. If you kept its exports, start from those.",
  exports: ["A CSV file from Excel, Google Sheets, Airtable or any other tool.", "Google Sheets and Airtable can also be read directly, where this server has those connections set up."],
  movesOver: ["Trackers of applications", "Past awards"],
  exportStep: "Save each tracker as a CSV file, with the column names in the first row.",
  listPrice: null,
  sources: [],
  faq: [["Our tracker is messy. Will it work?", "The import wizard suggests a match for each column and shows a dry run with every row it would skip or could not read, so you can fix the file before anything is saved."]],
};

export const SWITCH_ENTRIES: SwitchEntry[] = [...ENTRIES.map((e) => ({ ...e, kind: "system" as const })), SPREADSHEETS];
export const switchEntry = (slug: string | undefined): SwitchEntry | undefined => SWITCH_ENTRIES.find((e) => e.slug === slug);

export const STEPS = (entry: SwitchEntry): [string, string][] => [
  [`Export from ${entry.kind === "spreadsheets" ? "your spreadsheets" : entry.name}`, entry.exportStep],
  ["Upload the files to the import wizard", "Sign up free, then open Import in your workspace. CSV files work on every install."],
  ["Review the dry run", "Before anything is saved, see what will be created, skipped or has an error, with counts and amounts by year."],
  ["Import", "Applications, awards and past payments are created. Payments are recorded as paid elsewhere; nothing moves money."],
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

// ------------------------------------------------------------------------------------ page metadata

/** Title, description and Open Graph text per page, for the front worker to serve to crawlers. */
export function seoFor(entry: SwitchEntry | null): Seo {
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
