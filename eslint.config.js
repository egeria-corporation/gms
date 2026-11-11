import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [".claude/**", "**/node_modules/**", "**/dist/**", "**/tsp-output/**", "**/.wrangler/**", "**/.front-worker/**", "packages/db/src/database.types.ts", "api/base/**"],
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
    files: ["scripts/**", "**/scripts/**"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly", TextDecoder: "readonly" } },
    rules: { "no-console": "off" },
  },
);
