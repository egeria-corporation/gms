// SPDX-License-Identifier: AGPL-3.0-only
// The checks every catalog passes (D2-COMMON): every English key has a Spanish value, no Spanish
// value is empty or still English, the two languages use the same placeholders and tags, every
// message is valid ICU, and the Spanish keeps to the glossary in docs/i18n.md.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TYPE, parse, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { NAMESPACES, type Namespace } from "../src/index.ts";
import { ALL_CATALOGS } from "../src/all.ts";

const allow = JSON.parse(readFileSync(new URL("../catalogs/same-as-english.json", import.meta.url), "utf8")) as { values: string[]; keys: string[] };
const SAME_VALUES = new Set(allow.values);
const SAME_KEYS = new Set(allow.keys);

/** Argument and tag names a message uses, with the plural and select arguments marked. */
function shape(elements: MessageFormatElement[], into = new Set<string>()): Set<string> {
  for (const el of elements) {
    if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time) into.add(`{${el.value}}`);
    else if (el.type === TYPE.plural) {
      into.add(`{${el.value}, plural}`);
      for (const option of Object.values(el.options)) shape(option.value, into);
    } else if (el.type === TYPE.select) {
      into.add(`{${el.value}, select}`);
      for (const option of Object.values(el.options)) shape(option.value, into);
    } else if (el.type === TYPE.tag) {
      into.add(`<${el.value}>`);
      shape(el.children, into);
    }
  }
  return into;
}

/** The words a message shows, without its placeholders and tags. */
function words(elements: MessageFormatElement[]): string {
  return elements
    .map((el) => {
      if (el.type === TYPE.literal) return el.value;
      if (el.type === TYPE.tag) return words(el.children);
      if (el.type === TYPE.plural || el.type === TYPE.select) return Object.values(el.options).map((o) => words(o.value)).join(" ");
      return " ";
    })
    .join("");
}

const parsed = (ns: Namespace, locale: "en" | "es", key: string): MessageFormatElement[] => {
  const message = ALL_CATALOGS[locale][ns][key];
  if (typeof message !== "string") throw new Error(`${locale}/${ns}.json: ${key} is not text`);
  return parse(message);
};

// Words the glossary rules out, and what to write instead (docs/i18n.md).
const NOT_THE_GLOSSARY: [RegExp, string][] = [
  // "Aplicación" is right only for software; an application to a funder is a "solicitud".
  [/\baplicaci[oó]n(es)?\b/i, "solicitud (application); aplicación only for software, in the phrases SOFTWARE lists"],
  [/\baplicar\b/i, "presentar una solicitud (apply)"],
  [/\baplicantes?\b/i, "solicitante (applicant)"],
  [/\bbecas?\b/i, "subvención (grant)"],
  [/\bdonaci[oó]n(es)?\b/i, "subvención (grant)"],
  [/\bfundador(a|es|as)?\b/i, "financiador (funder)"],
  [/\bplazos? finale?s?\b/i, "fecha límite (deadline)"],
  [/\boportunidad(es)?\b/i, "convocatoria (opportunity)"],
  [/\bsomet(er|a|ido|ida)\b/i, "enviar (submit)"],
  [/\bloguear|logueo|login\b/i, "iniciar sesión (sign in)"],
  [/\bpanel de revisi[oó]n\b/i, "comité de revisión (panel)"],
  [/\bpuntajes?\b/i, "puntuación (score)"],
  [/\bexpedientes? para la junta\b/i, "carpeta para la junta (board docket)"],
  [/\bcampos? de combinaci[oó]n\b/i, "campo combinado (merge field)"],
  [/\b(grants?|funders?|applicants?|workspaces?|deadlines?)\b/i, "the English word left in the Spanish text"],
  // One quotation style in Spanish: «comillas latinas».
  [/[“”]/, "«…» (quotation marks)"],
];

// The software phrases where "aplicación" is the right word: an authenticator, calendar or connected
// app, an app's id or secret, a SAML or web application, and "in the app".
const SOFTWARE = [
  /\baplicaci[oó]n(es)? (de autenticaci[oó]n|de calendario|conectadas?|SAML|web|como)\b/gi,
  /\b(Id\.|id\.|[Ss]ecreto|opciones) de (la )?aplicaci[oó]n\b/g,
  /\ben la aplicaci[oó]n\b/gi,
  /\b(otra|esa) aplicaci[oó]n\b/gi,
  /\b[Cc]onectar aplicaciones\b/g,
];

// Product names ("OpenGrants Grant Management System") are not translated, so they are not checked.
const NAMES = [...SAME_VALUES].sort((a, b) => b.length - a.length);
/** A Spanish value's prose: no placeholders, tags, code, paths, addresses, product names or software phrases. */
const prose = (v: string) =>
  SOFTWARE.reduce(
    (text, re) => text.replace(re, " "),
    NAMES.reduce((text, name) => text.split(name).join(" "), v.replace(/<code\d*>.*?<\/code\d*>/g, " ").replace(/\{[^{}]*\}/g, " ").replace(/<\/?[a-z0-9]+>/g, " ").replace(/\/[\w./-]+/g, " ").replace(/\S+@\S+/g, " ")),
  );
const offGlossary = (v: string) => NOT_THE_GLOSSARY.filter(([re]) => re.test(prose(v))).map(([, instead]) => instead);

describe("the glossary check", () => {
  it.each([
    ["Su beca fue aprobada.", "subvención (grant)"],
    ["Recibió una donación del programa.", "subvención (grant)"],
    ["Envíe su aplicación antes del viernes.", "solicitud"],
    ["El estado de la aplicación cambió.", "solicitud"],
    ["Aplicaciones recibidas", "solicitud"],
    ["El fundador revisa cada solicitud.", "financiador (funder)"],
    ["Plazo final: 15 de noviembre de 2026", "fecha límite (deadline)"],
    ["Puntaje promedio", "puntuación (score)"],
    ["Expediente para la junta", "carpeta para la junta (board docket)"],
  ])("finds the variant in %j", (text, instead) => {
    expect(offGlossary(text).some((x) => x.startsWith(instead))).toBe(true);
  });

  it.each(["Abra su aplicación de autenticación.", "Aplicaciones conectadas", "Id. de la aplicación", "Las opciones de la aplicación se aplican de inmediato.", "Envíe su solicitud al financiador antes de la fecha límite."])(
    "lets %j through",
    (text) => expect(offGlossary(text)).toEqual([]),
  );
});

describe.each(NAMESPACES)("the %s catalog", (ns) => {
  const en = ALL_CATALOGS.en[ns];
  const es = ALL_CATALOGS.es[ns];
  const keys = Object.keys(en);

  it("has a Spanish value for every English key, and no other keys", () => {
    expect(keys.filter((k) => !(k in es))).toEqual([]);
    expect(Object.keys(es).filter((k) => !(k in en))).toEqual([]);
  });

  it("uses flat keys dotted by screen", () => {
    expect(keys.filter((k) => !/^[a-z][A-Za-z0-9]*(\.[a-zA-Z0-9_]+)+$/.test(k))).toEqual([]);
  });

  it("has no empty value", () => {
    expect(keys.filter((k) => !String(en[k]).trim())).toEqual([]);
    expect(keys.filter((k) => !String(es[k] ?? "x").trim())).toEqual([]);
  });

  it("has no Spanish value still in English, except names and formats on the list", () => {
    const same = keys.filter((k) => {
      if (es[k] !== en[k] || SAME_KEYS.has(`${ns}:${k}`) || SAME_VALUES.has(String(en[k]))) return false;
      // Only placeholders and punctuation ("{name} · {role}") read the same in every language.
      return /\p{L}/u.test(words(parsed(ns, "en", k)));
    });
    expect(same).toEqual([]);
  });

  it("is valid ICU in both languages, with the same placeholders, plurals and tags", () => {
    const mismatched = keys.filter((k) => k in es).filter((k) => [...shape(parsed(ns, "en", k))].sort().join() !== [...shape(parsed(ns, "es", k))].sort().join());
    expect(mismatched).toEqual([]);
  });

  it("keeps to the glossary", () => {
    const off = Object.entries(es).flatMap(([k, v]) => offGlossary(String(v)).map((instead) => `${k}: use ${instead}`));
    expect(off).toEqual([]);
  });
});
