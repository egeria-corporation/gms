// SPDX-License-Identifier: AGPL-3.0-only
// The "no literal user-visible strings" rule (eslint.i18n.js).
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { i18nPlugin } from "../../../eslint.i18n.js";

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } } });

tester.run("no-literal-strings", i18nPlugin.rules["no-literal-strings"], {
  valid: [
    { code: 'const a = <p>{t("x.y")}</p>;' },
    { code: 'const a = <p className="muted">{name} · {role}</p>;' },
    { code: "const a = <p>OpenGrants</p>;" },
    { code: "const a = <code>gms_lang=es</code>;" },
    { code: 'const a = <a href="/x" rel="noopener" target="_blank">{label}</a>;' },
    { code: 'const a = <input type="email" autoComplete="email" aria-label={t("x.email")} />;' },
    { code: "const a = <p>{count > 1 ? plural : one}</p>;" },
  ],
  invalid: [
    { code: "const a = <p>Save</p>;", errors: [{ messageId: "literal" }] },
    { code: 'const a = <button aria-label="Close">x</button>;', errors: 2 },
    { code: 'const a = <p>{"Save"}</p>;', errors: 1 },
    { code: 'const a = <p>{busy ? "Saving…" : "Save"}</p>;', errors: 2 },
    { code: 'const a = <p>{busy && "Saving…"}</p>;', errors: 1 },
    { code: "const a = <p>{`${n} left`}</p>;", errors: 1 },
    { code: 'const a = <img alt="Logo" src="/a.png" />;', errors: 1 },
    { code: 'const a = <Dialog confirmLabel="Delete" />;', errors: 1 },
    { code: "const a = <input placeholder={`Search ${what}`} />;", errors: 1 },
  ],
});
