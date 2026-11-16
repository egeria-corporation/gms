import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { NOT_TRANSLATED, TRANSLATED, i18nPlugin } from "./eslint.i18n.js";

export default tseslint.config(
  {
    ignores: [".claude/**", "**/node_modules/**", "**/dist/**", "**/tsp-output/**", "**/.wrangler/**", "**/.front-worker/**", "**/.e2e-dist/**", "packages/db/src/database.types.ts", "api/base/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // No literal user-visible strings in the screens that are translated (eslint.i18n.js, docs/i18n.md).
    files: TRANSLATED,
    ignores: NOT_TRANSLATED,
    plugins: { i18n: i18nPlugin },
    rules: { "i18n/no-literal-strings": "error" },
  },
  {
    files: ["scripts/**", "**/scripts/**"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly", TextDecoder: "readonly" } },
    rules: { "no-console": "off" },
  },
);
