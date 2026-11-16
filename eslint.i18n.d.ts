// SPDX-License-Identifier: AGPL-3.0-only
// Types for eslint.i18n.js, so its test (packages/i18n/test/lint-rule.test.ts) typechecks.
import type { Rule } from "eslint";

export declare const TRANSLATED: string[];
export declare const i18nPlugin: { rules: { "no-literal-strings": Rule.RuleModule } };
