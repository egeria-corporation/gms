// SPDX-License-Identifier: AGPL-3.0-only
// The "no literal user-visible strings" rule (docs/i18n.md), and the files it applies to: those
// already translated. Each translation track adds its directories to TRANSLATED when they are done.

/**
 * Files whose user-visible text comes from the catalogs (packages/i18n/catalogs). Add a directory
 * here once every string in it is a message; the rule then keeps it that way.
 */
export const TRANSLATED = [
  // D2a: the framework, the switcher, the public and shared screens.
  "apps/web/src/i18n/**/*.{ts,tsx}",
  "apps/web/src/app/**/*.tsx",
  "apps/web/src/components/**/*.tsx",
  "apps/web/src/screens/public/**/*.tsx",
  "apps/web/src/screens/shared/**/*.tsx",
  // D2b: the applicant screens and the form renderer.
  "apps/web/src/forms/**/*.tsx",
  "apps/web/src/screens/applicant/**/*.tsx",
];

// Text that is the same in every language: product names and the formats people know by name.
const SAME_IN_EVERY_LANGUAGE = new Set([
  "OpenGrants",
  "OpenGrants Passport",
  "OpenGrants Grant Management System",
  "Passport",
  "CommonGrants",
  "GMS",
  "MCP",
  "API",
  "CSV",
  "XLSX",
  "PDF",
  "JSON",
  "URL",
  "EIN",
  "UEI",
  "OAuth",
  "Google",
  "Airtable",
  "Zernio",
  "Composio",
  "Resend",
  "Stripe",
  "Claude",
]);

// Attributes a person reads or hears.
const VISIBLE_ATTRIBUTE = /^(aria-(label|description|roledescription|valuetext|placeholder)|alt|title|placeholder|label|hint|help|description|heading|subtitle|caption|message|summary|tooltip|legend|text|emptyText)$/;
const VISIBLE_PROP_SUFFIX = /[a-z](Label|Title|Text|Placeholder|Hint|Help|Message|Description|Heading|Caption)$/;
// Element contents that are code, not prose.
const CODE_ELEMENTS = new Set(["code", "kbd", "pre", "samp", "var"]);

// An element name passed as a prop (`heading="h2"`) is markup, not text.
const TAG_NAME = /^(h[1-6]|p|div|span|section|article|aside|header|footer|li|ul|ol)$/;
const hasWords = (text) => /\p{L}/u.test(text) && !SAME_IN_EVERY_LANGUAGE.has(text.trim()) && !TAG_NAME.test(text.trim());

function elementName(node) {
  const name = node?.openingElement?.name;
  return name?.type === "JSXIdentifier" ? name.name : null;
}

/** String literals a JSX child expression would put on screen: `{"Save"}`, `{ok ? "Yes" : "No"}`, `{busy && "Saving…"}`, `{`${n} left`}`. */
function* visibleStrings(expression) {
  if (!expression) return;
  switch (expression.type) {
    case "Literal":
      if (typeof expression.value === "string") yield [expression, expression.value];
      return;
    case "TemplateLiteral":
      for (const q of expression.quasis) yield [q, q.value.cooked ?? ""];
      return;
    case "ConditionalExpression":
      yield* visibleStrings(expression.consequent);
      yield* visibleStrings(expression.alternate);
      return;
    case "LogicalExpression":
      yield* visibleStrings(expression.right);
      return;
    default:
      return;
  }
}

const noLiteralStrings = {
  meta: {
    type: "problem",
    docs: { description: "User-visible text comes from the message catalogs (docs/i18n.md)" },
    messages: {
      literal: 'Put "{{text}}" in a catalog (packages/i18n/catalogs) and show it with t(…).',
    },
    schema: [],
  },
  create(context) {
    const report = (node, text) => context.report({ node, messageId: "literal", data: { text: text.trim().slice(0, 60) } });
    return {
      JSXText(node) {
        if (CODE_ELEMENTS.has(elementName(node.parent))) return;
        if (hasWords(node.value)) report(node, node.value);
      },
      JSXExpressionContainer(node) {
        if (node.parent?.type !== "JSXElement" && node.parent?.type !== "JSXFragment") return;
        if (CODE_ELEMENTS.has(elementName(node.parent))) return;
        for (const [at, text] of visibleStrings(node.expression)) if (hasWords(text)) report(at, text);
      },
      JSXAttribute(node) {
        const name = node.name.type === "JSXIdentifier" ? node.name.name : null;
        if (!name || !(VISIBLE_ATTRIBUTE.test(name) || VISIBLE_PROP_SUFFIX.test(name))) return;
        const value = node.value;
        if (value?.type === "Literal" && typeof value.value === "string") {
          if (hasWords(value.value)) report(value, value.value);
        } else if (value?.type === "JSXExpressionContainer") {
          for (const [at, text] of visibleStrings(value.expression)) if (hasWords(text)) report(at, text);
        }
      },
    };
  },
};

export const i18nPlugin = { rules: { "no-literal-strings": noLiteralStrings } };
