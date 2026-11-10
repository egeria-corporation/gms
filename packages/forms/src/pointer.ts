// SPDX-License-Identifier: AGPL-3.0-only
// JSON pointer helpers. Response paths are JSON pointers ("/budget/0/amount"); mapping `field`
// values may be pointers or CommonGrants dot paths ("addresses.primary.city").
import type { Json, JsonObject } from "./types.ts";

export function parsePointer(pointer: string): string[] {
  if (pointer === "" || pointer === "/") return [];
  const body = pointer.startsWith("/") ? pointer.slice(1) : pointer;
  return body.split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function formatPointer(segments: readonly (string | number)[]): string {
  if (segments.length === 0) return "";
  return "/" + segments.map((s) => String(s).replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
}

/** Accepts a JSON pointer ("/a/b") or a dot path ("a.b"); returns segments. */
export function parsePath(path: string): string[] {
  if (path === "" || path === "#") return [];
  if (path.startsWith("#/")) return parsePointer(path.slice(1));
  if (path.startsWith("/")) return parsePointer(path);
  return path.split(".");
}

export function getAt(root: unknown, segments: readonly string[]): Json | undefined {
  let cur: unknown = root;
  for (const seg of segments) {
    if (Array.isArray(cur)) {
      const i = Number(seg);
      if (!Number.isInteger(i)) return undefined;
      cur = cur[i];
    } else if (cur !== null && typeof cur === "object") {
      if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    } else return undefined;
  }
  return cur as Json | undefined;
}

export function getPath(root: unknown, path: string): Json | undefined {
  return getAt(root, parsePath(path));
}

const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

/** Sets a value, creating intermediate objects. Mutates `root`. */
export function setAt(root: JsonObject, segments: readonly string[], value: Json): void {
  if (segments.length === 0) throw new Error("cannot set the root");
  let cur: Record<string, Json> | Json[] = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] as string;
    if (UNSAFE.has(seg)) throw new Error(`unsafe path segment "${seg}"`);
    const last = i === segments.length - 1;
    const key: string | number = Array.isArray(cur) ? Number(seg) : seg;
    if (last) {
      (cur as Record<string | number, Json>)[key] = value;
      return;
    }
    let next = (cur as Record<string | number, Json>)[key];
    if (next === null || typeof next !== "object") {
      next = {};
      (cur as Record<string | number, Json>)[key] = next;
    }
    cur = next as Record<string, Json> | Json[];
  }
}

export function deleteAt(root: JsonObject, segments: readonly string[]): void {
  if (segments.length === 0) return;
  const parent = getAt(root, segments.slice(0, -1));
  const last = segments[segments.length - 1] as string;
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else if (parent !== null && typeof parent === "object") delete (parent as JsonObject)[last];
}

/** True when `path` equals `ancestor` or sits beneath it. */
export function isAtOrUnder(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(ancestor + "/") || ancestor === "";
}

/** "#/properties/a/properties/b" → "/a/b". */
export function scopeToPointer(scope: string): string {
  if (scope === "#" || scope === "") return "";
  const segs = parsePointer(scope.replace(/^#/, ""));
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i] as string;
    if (s === "properties" && i + 1 < segs.length) {
      out.push(segs[++i] as string);
    } else if (s === "items") {
      continue;
    } else out.push(s);
  }
  return formatPointer(out);
}

export function pointerToScope(pointer: string): string {
  const segs = parsePointer(pointer);
  return "#" + segs.map((s) => "/properties/" + s.replace(/~/g, "~0").replace(/\//g, "~1")).join("");
}

export function isPlainObject(v: unknown): v is JsonObject {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return (
    ka.length === kb.length &&
    ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}
