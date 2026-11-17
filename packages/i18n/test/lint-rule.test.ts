// SPDX-License-Identifier: AGPL-3.0-only
// The "no literal user-visible strings" rule (eslint.i18n.js).
import { readFileSync } from "node:fs";
import { RuleTester } from "eslint";
import { describe, expect, it } from "vitest";
import { NOT_TRANSLATED, TRANSLATED, i18nPlugin } from "../../../eslint.i18n.js";

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

describe("where the rule applies", () => {
  it("covers every screen, component and app shell file", () => {
    for (const dir of ["screens", "components", "app"]) expect(TRANSLATED).toContain(`apps/web/src/${dir}/**/*.tsx`);
  });

  it("skips only a short, commented list", () => {
    expect(NOT_TRANSLATED.length).toBeLessThanOrEqual(3);
    const source = readFileSync(new URL("../../../eslint.i18n.js", import.meta.url), "utf8");
    const list = source.slice(source.indexOf("export const NOT_TRANSLATED"), source.indexOf("];", source.indexOf("export const NOT_TRANSLATED")));
    // Each entry has its reason on the line above it.
    for (const entry of NOT_TRANSLATED) expect(list).toMatch(new RegExp(`//[^\\n]*\\n\\s*"${entry.replace(/[*.]/g, "\\$&")}"`));
  });
});
