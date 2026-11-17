// SPDX-License-Identifier: AGPL-3.0-only
// The OpenGrants starter library: nine gallery items every install ships with (migration 0036,
// generated from this file by apps/api/scripts/gallery-starters.ts; a test keeps the two equal).
// Written to be used as they are: plain questions, word limits a small organization can meet, and
// help text that says why a question is asked. Every form here passes the form builder's checks.
// Once 0036 is applied on a database, a change to this file needs a new migration as well.

/** A form in a gallery snapshot: everything `createForm` takes, nothing that links to a workspace. */
export interface FormSnap {
  title: string;
  description: string | null;
  instructions: string | null;
  purpose: "application" | "report" | "loi" | "amendment" | "site_visit" | "other";
  jsonSchema: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
  mappingFromCommonGrants: Record<string, unknown>;
  mappingToCommonGrants: Record<string, unknown>;
  fieldMeta: Record<string, unknown>;
}
export interface RubricCriterionSnap {
  key: string;
  label: string;
  description?: string;
  weight: number;
  scale: { type: "numeric"; min: number; max: number } | { type: "categorical"; options: { value: string; label?: string; score: number }[] };
  guidance?: string;
}
export interface RubricSnap {
  name: string;
  criteria: RubricCriterionSnap[];
  overall: { recommendations?: string[]; spreadThreshold?: number };
}
export interface EmailSnap {
  name: string;
  subject: string;
  body: string;
}
export interface Snapshot {
  forms: FormSnap[];
  rubrics: RubricSnap[];
  emails: EmailSnap[];
}
export type GalleryKind = "application_form" | "report_form" | "rubric" | "email_template" | "program_kit";
export interface GalleryTags {
  fieldOfWork: string[];
  grantSize: string[];
  audience: string[];
}
export interface StarterItem {
  id: string;
  slug: string;
  kind: GalleryKind;
  title: string;
  summary: string;
  tags: GalleryTags;
  snapshot: Snapshot;
}

// ------------------------------------------------------------------------------- form helpers

type Field =
  | { key: string; title: string; type: "text"; required?: boolean; help?: string; max?: number }
  | { key: string; title: string; type: "long"; required?: boolean; help?: string; words: number }
  | { key: string; title: string; type: "money" | "file" | "email" | "phone" | "date" | "yesno"; required?: boolean; help?: string }
  | { key: string; title: string; type: "count"; required?: boolean; help?: string; unit: string }
  | { key: string; title: string; type: "choice" | "multi"; required?: boolean; help?: string; options: string[] };

interface Section {
  label: string;
  fields: Field[];
}

function schemaOf(f: Field): Record<string, unknown> {
  switch (f.type) {
    case "text":
      return { type: "string", title: f.title, maxLength: f.max ?? 200 };
    case "long":
      return { type: "string", title: f.title, "x-wordCount": { max: f.words } };
    case "money":
    case "file":
      return { type: "object", title: f.title };
    case "email":
      return { type: "string", format: "email", title: f.title };
    case "phone":
      return { type: "string", title: f.title };
    case "date":
      return { type: "string", format: "date", title: f.title };
    case "yesno":
      return { type: "boolean", title: f.title };
    case "count":
      return { type: "integer", minimum: 0, title: f.title };
    case "choice":
      return { type: "string", title: f.title, enum: f.options };
    case "multi":
      return { type: "array", title: f.title, items: { type: "string", enum: f.options }, uniqueItems: true };
  }
}

function controlOf(f: Field): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (f.help) options.help = f.help;
  if (f.type === "money") Object.assign(options, { widget: "money", widgetOptions: { currency: "USD" } });
  if (f.type === "file") options.widget = "fileRef";
  if (f.type === "phone") Object.assign(options, { widget: "phone", pii: true });
  if (f.type === "email") options.pii = true;
  if (f.type === "count") Object.assign(options, { outcome: true, unit: f.unit });
  return { type: "Control", scope: `#/properties/${f.key}`, ...(Object.keys(options).length ? { options } : {}) };
}

function form(def: { title: string; description: string; instructions: string; purpose: FormSnap["purpose"]; sections: Section[]; toCommonGrants?: Record<string, unknown> }): FormSnap {
  const fields = def.sections.flatMap((s) => s.fields);
  return {
    title: def.title,
    description: def.description,
    instructions: def.instructions,
    purpose: def.purpose,
    jsonSchema: {
      type: "object",
      required: fields.filter((f) => f.required !== false).map((f) => f.key),
      properties: Object.fromEntries(fields.map((f) => [f.key, schemaOf(f)])),
    },
    uiSchema: { type: "VerticalLayout", elements: def.sections.map((s) => ({ type: "Group", label: s.label, elements: s.fields.map(controlOf) })) },
    mappingFromCommonGrants: {},
    mappingToCommonGrants: def.toCommonGrants ?? {},
    fieldMeta: {},
  };
}

const contact: Section = {
  label: "Contact for this application",
  fields: [
    { key: "contactName", title: "Contact name", type: "text", help: "The person we should talk to about this request." },
    { key: "contactEmail", title: "Contact email", type: "email" },
    { key: "contactPhone", title: "Contact phone", type: "phone", required: false },
  ],
};
const TO_CG = { title: { field: "projectTitle" }, requestedAmount: { field: "requestedAmount" } };

// --------------------------------------------------------------------------------- the forms

const COMMON_APPLICATION = form({
  title: "Common application",
  description: "A complete project application most funders can use as it is: the project, the need behind it, the plan, the budget and who will lead the work.",
  instructions:
    "Thank you for applying. Answer in plain language, as you would explain your work to a neighbor. Short answers are fine: the word limits are a ceiling, not a target. You can save and come back at any time before you submit.",
  purpose: "application",
  sections: [
    {
      label: "Your project",
      fields: [
        { key: "projectTitle", title: "Project title", type: "text", help: "A short name we can use when we talk about your project." },
        { key: "summary", title: "Project summary", type: "long", words: 150, help: "In a few sentences: what you will do, for whom, and what will change." },
        { key: "need", title: "The need", type: "long", words: 300, help: "What problem or opportunity does this project respond to? Local facts or stories help more than national figures." },
        { key: "plan", title: "What you will do", type: "long", words: 300, help: "The main activities, in the order they will happen." },
        { key: "whoBenefits", title: "Who will benefit", type: "long", words: 200, help: "Who the project is for, roughly how many people, and where they live." },
        { key: "outcomes", title: "What will change, and how you will know", type: "long", words: 300, help: "Two or three results you expect, and how you will track them. Simple measures are welcome." },
        { key: "startDate", title: "Project start date", type: "date" },
        { key: "endDate", title: "Project end date", type: "date" },
      ],
    },
    {
      label: "Funding",
      fields: [
        { key: "requestedAmount", title: "Amount requested", type: "money" },
        { key: "projectBudgetTotal", title: "Total project cost", type: "money", help: "Include every source, not only this request." },
        { key: "otherFunding", title: "Other funding for this project", type: "long", words: 150, required: false, help: "Other grants, earned income or in-kind support, secured or pending." },
        { key: "budget", title: "Project budget", type: "file", help: "Upload a one-page budget as a PDF or spreadsheet. Any clear format works." },
      ],
    },
    {
      label: "Your organization",
      fields: [
        { key: "mission", title: "Your mission", type: "long", words: 100 },
        { key: "leadership", title: "Who will lead this work", type: "long", words: 200, help: "The people responsible for the project and the experience they bring." },
        { key: "communityVoice", title: "How the people you serve shape this work", type: "long", words: 200, required: false },
      ],
    },
    contact,
  ],
  toCommonGrants: TO_CG,
});

const GENERAL_OPERATING = form({
  title: "General operating support application",
  description: "Unrestricted support for an organization's whole mission, not one project. Asks about the work, last year's results and the year ahead.",
  instructions:
    "General operating support funds your organization as a whole: salaries, rent, technology and the work itself. Tell us about the organization, not a single project. Use the documents you already have; we do not need anything written just for us.",
  purpose: "application",
  sections: [
    {
      label: "Your organization",
      fields: [
        { key: "projectTitle", title: "What should we call this request?", type: "text", help: "For example, \"2027 operating support\"." },
        { key: "mission", title: "Your mission and what you do", type: "long", words: 250 },
        { key: "whoYouServe", title: "Who you serve, and where", type: "long", words: 200 },
        { key: "lastYear", title: "What you accomplished last year", type: "long", words: 250, help: "A few results you are proud of. Numbers, stories or both." },
        { key: "yearAhead", title: "Your plans for the coming year", type: "long", words: 250 },
        { key: "challenges", title: "What is hard right now", type: "long", words: 150, required: false, help: "Optional. Knowing your challenges helps us be a better partner; it never counts against you." },
      ],
    },
    {
      label: "Funding",
      fields: [
        { key: "requestedAmount", title: "Amount requested", type: "money" },
        { key: "operatingBudget", title: "This year's operating budget", type: "money" },
        { key: "useOfSupport", title: "How flexible support would help", type: "long", words: 200 },
        { key: "financials", title: "Most recent financial statements", type: "file", help: "An audit, a review or your board-approved statements, whichever you have." },
        { key: "budget", title: "Current year budget", type: "file" },
      ],
    },
    contact,
  ],
  toCommonGrants: TO_CG,
});

const CAPACITY_SMALL = form({
  title: "Small capacity-building grant application",
  description: "A short application for a small grant that strengthens how an organization works: fundraising, technology, training, planning and the like.",
  instructions:
    "Capacity-building grants help your organization work better: new systems, skills or plans that will last after the grant ends. This application is short on purpose. Tell us what you want to strengthen and how.",
  purpose: "application",
  sections: [
    {
      label: "What you want to strengthen",
      fields: [
        { key: "projectTitle", title: "Name of the effort", type: "text", help: "For example, \"New donor database\" or \"Board training\"." },
        { key: "area", title: "Main area", type: "choice", options: ["Fundraising", "Technology", "Staff training", "Board development", "Finance and accounting", "Communications", "Strategic planning", "Evaluation", "Other"] },
        { key: "need", title: "Why now", type: "long", words: 200, help: "What gets in the way today, and what it costs your organization." },
      ],
    },
    {
      label: "Your plan",
      fields: [
        { key: "plan", title: "What you will do", type: "long", words: 200 },
        { key: "helpers", title: "Who will help", type: "long", words: 100, required: false, help: "A consultant, a trainer or a vendor, if you plan to work with one." },
        { key: "success", title: "How you will know it worked", type: "long", words: 150 },
      ],
    },
    {
      label: "Funding",
      fields: [
        { key: "requestedAmount", title: "Amount requested", type: "money" },
        { key: "spending", title: "How you will spend it", type: "long", words: 150, help: "A simple list is fine: what you will buy or pay for, and roughly what each costs." },
        { key: "quote", title: "A quote or estimate", type: "file", required: false },
      ],
    },
    contact,
  ],
  toCommonGrants: TO_CG,
});

const INTERIM_REPORT = form({
  title: "Interim report",
  description: "A mid-grant check-in: progress so far, numbers to date, any change of plan and spending to date.",
  instructions:
    "This check-in helps us understand how the work is going and whether we can help. It is not a test. If plans have changed, say so: changes are normal, and we would rather hear early.",
  purpose: "report",
  sections: [
    {
      label: "Progress",
      fields: [
        { key: "progress", title: "Progress so far", type: "long", words: 300, help: "What you have done since the grant started." },
        { key: "peopleServed", title: "People served so far", type: "count", unit: "people served", required: false, help: "Leave it blank if counting people does not fit your work." },
        { key: "plansChanged", title: "Have your plans changed?", type: "yesno" },
        { key: "changes", title: "What changed, and why", type: "long", words: 200, required: false },
        { key: "challenges", title: "Challenges", type: "long", words: 200, required: false },
      ],
    },
    {
      label: "Money",
      fields: [
        { key: "spentToDate", title: "Grant funds spent so far", type: "money" },
        { key: "budgetChanges", title: "Changes to the budget", type: "long", words: 150, required: false },
      ],
    },
    {
      label: "Anything else",
      fields: [
        { key: "supportNeeded", title: "Is there anything we can do to help?", type: "long", words: 150, required: false },
        { key: "attachments", title: "Photos or documents", type: "file", required: false, help: "Optional: anything that shows the work." },
      ],
    },
  ],
});

const FINAL_REPORT = form({
  title: "Final report",
  description: "The end-of-grant report: what was accomplished, results against the goals, what was learned and how the money was spent.",
  instructions:
    "Thank you for the work this grant supported. Tell us what happened, including what did not go to plan: what you learned is as useful to us as what you achieved. Your answers from the application and any interim report are a good starting point.",
  purpose: "report",
  sections: [
    {
      label: "Results",
      fields: [
        { key: "accomplished", title: "What you accomplished", type: "long", words: 300 },
        { key: "goals", title: "How the results compare with your goals", type: "long", words: 300 },
        { key: "peopleServed", title: "People served in all", type: "count", unit: "people served", required: false, help: "Leave it blank if counting people does not fit your work." },
        { key: "story", title: "A story of change", type: "long", words: 250, required: false, help: "Optional: one person, family or place this work made a difference for. Share only what they agreed to share." },
        { key: "learned", title: "What you learned", type: "long", words: 200 },
      ],
    },
    {
      label: "Money",
      fields: [
        { key: "totalSpent", title: "Grant funds spent in all", type: "money" },
        { key: "budgetVsActual", title: "Budget compared with actual spending", type: "file", help: "Your project budget with a column for what you actually spent." },
      ],
    },
    {
      label: "Looking ahead",
      fields: [
        { key: "next", title: "What happens next", type: "long", words: 150 },
        { key: "feedback", title: "How could we have been a better funder?", type: "long", words: 150, required: false },
      ],
    },
  ],
});

// ------------------------------------------------------------------------------- the rubric

const scale = { type: "numeric" as const, min: 1, max: 5 };
const FIVE_CRITERION: RubricSnap = {
  name: "Five-criterion rubric",
  criteria: [
    { key: "need", label: "Need and fit", weight: 1, scale, description: "Is the need clear, and does the project fit this opportunity?", guidance: "5: a clear, local need and a close fit. 3: the need is plausible and the fit is partial. 1: the need is unclear or outside what this opportunity funds." },
    { key: "approach", label: "Approach", weight: 1, scale, description: "Is the plan realistic and likely to work?", guidance: "5: concrete steps, a sensible timeline, built on what has worked. 3: a reasonable plan with gaps. 1: the activities do not lead to the results described." },
    { key: "capacity", label: "Capacity", weight: 1, scale, description: "Can the organization do what it proposes?", guidance: "5: experienced people and the systems to deliver. 3: some experience, some risk. 1: no clear way to deliver. Small organizations are not scored down for being small." },
    { key: "budget", label: "Budget", weight: 1, scale, description: "Is the budget reasonable and tied to the plan?", guidance: "5: every cost follows from the plan and the amounts are realistic. 3: mostly reasonable, some questions. 1: the budget does not match the plan." },
    { key: "impact", label: "Community impact", weight: 1, scale, description: "Will the project make a real difference for the people it serves?", guidance: "5: meaningful change for people who need it most, shaped with them. 3: some benefit. 1: little lasting difference." },
  ],
  overall: { recommendations: ["Fund", "Fund with conditions", "Do not fund"] },
};

// ------------------------------------------------------------------------------- the emails

const AWARD_EMAIL: EmailSnap = {
  name: "Award letter",
  subject: "Good news: {{funder.name}} is awarding {{award.amount}} for {{award.title}}",
  body:
    "Hello {{recipient.name}},\n\nWe are delighted to tell you that {{funder.name}} is awarding **{{award.amount}}** for **{{award.title}}**.\n\nThank you for the care you put into your application. Our reviewers were moved by your work and by what you hope to achieve.\n\nWhat happens next:\n\n1. Review the award and its conditions.\n2. Sign the grant agreement.\n3. Once both sides have signed, we will schedule the first payment.\n\n[Review the award and sign]({{links.award}})\n\nIf anything in the award is unclear, or the timing does not work for you, reply to this email. We would much rather sort it out now.\n\nCongratulations, and thank you for the work you do.\n\n{{funder.name}}",
};

const DECLINE_EMAIL: EmailSnap = {
  name: "Decline",
  subject: "Your application to {{funder.name}}",
  body:
    "Hello {{recipient.name}},\n\nThank you for applying to {{opportunity.title}} and for the time you gave to **{{application.title}}**.\n\nWe are sorry to tell you that {{funder.name}} is not able to fund it this time. We received many more strong applications than we could support, and this decision is not a judgment of the value of your work.\n\nYour application stays in your records, so you can reuse what you wrote: [View your application]({{links.status}})\n\nWe hope you will apply again. If you would like feedback on your application, reply to this email and we will do our best to help.\n\nWith thanks and best wishes,\n\n{{funder.name}}",
};

// ------------------------------------------------------------------------------- the library

const ANY = { fieldOfWork: ["Any field"] };
const id = (n: number) => `36000000-0000-7000-8000-${String(n).padStart(12, "0")}`;

export const STARTER_ITEMS: StarterItem[] = [
  {
    id: id(1),
    slug: "common-application",
    kind: "application_form",
    title: "Common application",
    summary: "A complete project application most funders can use as it is: the project, the need, the plan, the budget and who leads the work. About 30 minutes for an applicant who knows the project.",
    tags: { ...ANY, grantSize: ["$10,000 to $50,000", "$50,000 to $250,000"], audience: ["Nonprofits", "Community groups"] },
    snapshot: { forms: [COMMON_APPLICATION], rubrics: [], emails: [] },
  },
  {
    id: id(2),
    slug: "general-operating-support",
    kind: "application_form",
    title: "General operating support application",
    summary: "Unrestricted support for an organization's whole mission. Asks about the work, last year's results and the year ahead, and uses documents organizations already have.",
    tags: { ...ANY, grantSize: ["Any size"], audience: ["Nonprofits"] },
    snapshot: { forms: [GENERAL_OPERATING], rubrics: [], emails: [] },
  },
  {
    id: id(3),
    slug: "small-capacity-building",
    kind: "application_form",
    title: "Small capacity-building grant application",
    summary: "A short application for small grants that strengthen how an organization works: fundraising, technology, training, board development or planning.",
    tags: { ...ANY, grantSize: ["Under $10,000"], audience: ["Small organizations", "Nonprofits", "Community groups"] },
    snapshot: { forms: [CAPACITY_SMALL], rubrics: [], emails: [] },
  },
  {
    id: id(4),
    slug: "five-criterion-rubric",
    kind: "rubric",
    title: "Five-criterion rubric",
    summary: "Need and fit, approach, capacity, budget and community impact, each scored 1 to 5 with guidance for every score, so reviewers score the same way.",
    tags: { ...ANY, grantSize: ["Any size"], audience: ["Nonprofits", "Community groups", "Schools"] },
    snapshot: { forms: [], rubrics: [FIVE_CRITERION], emails: [] },
  },
  {
    id: id(5),
    slug: "interim-report",
    kind: "report_form",
    title: "Interim report",
    summary: "A short mid-grant check-in: progress so far, people served to date, any change of plan and spending to date. Written so grantees can say plans changed.",
    tags: { ...ANY, grantSize: ["Any size"], audience: ["Nonprofits", "Community groups", "Schools"] },
    snapshot: { forms: [INTERIM_REPORT], rubrics: [], emails: [] },
  },
  {
    id: id(6),
    slug: "final-report",
    kind: "report_form",
    title: "Final report",
    summary: "The end-of-grant report: results against the goals, people served, what was learned, how the money was spent and a question about how you could be a better funder.",
    tags: { ...ANY, grantSize: ["Any size"], audience: ["Nonprofits", "Community groups", "Schools"] },
    snapshot: { forms: [FINAL_REPORT], rubrics: [], emails: [] },
  },
  {
    id: id(7),
    slug: "award-letter-email",
    kind: "email_template",
    title: "Award letter email",
    summary: "A warm award email with the amount, what happens next and a link to review and sign. Uses the merge fields the GMS fills in for every award.",
    tags: { ...ANY, grantSize: ["Any size"], audience: ["Nonprofits", "Community groups", "Schools"] },
    snapshot: { forms: [], rubrics: [], emails: [AWARD_EMAIL] },
  },
  {
    id: id(8),
    slug: "decline-email",
    kind: "email_template",
    title: "Decline email",
    summary: "A kind, clear decline: thanks the applicant, says the decision is not a judgment of their work, keeps their application available and offers feedback.",
    tags: { ...ANY, grantSize: ["Any size"], audience: ["Nonprofits", "Community groups", "Schools"] },
    snapshot: { forms: [], rubrics: [], emails: [DECLINE_EMAIL] },
  },
  {
    id: id(9),
    slug: "small-grants-program-kit",
    kind: "program_kit",
    title: "Small grants program kit",
    summary: "Everything to run a first grant round: the common application, the five-criterion rubric, the final report, and the award and decline emails. Copy it and adjust what you need.",
    tags: { ...ANY, grantSize: ["Under $10,000", "$10,000 to $50,000"], audience: ["Nonprofits", "Community groups", "Small organizations"] },
    snapshot: { forms: [COMMON_APPLICATION, FINAL_REPORT], rubrics: [FIVE_CRITERION], emails: [AWARD_EMAIL, DECLINE_EMAIL] },
  },
];

/** When the starter library was published (shown on the pages as the published date). */
export const STARTERS_PUBLISHED_AT = "2026-11-15T00:00:00Z";
