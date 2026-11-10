// SPDX-License-Identifier: AGPL-3.0-only
// JSON Forms-style UI schema: validation at save time and rule evaluation at render/validate time.
import { getPath, isPlainObject, scopeToPointer } from "./pointer.ts";
import { resolveRef } from "./schema-subset.ts";
import { WIDGETS, type ControlOptions, type DefinitionError, type FormSchema, type UiControl, type UiElement, type UiRule } from "./types.ts";
import { validateAgainstSchema } from "./validate.ts";

const LAYOUTS = new Set(["VerticalLayout", "HorizontalLayout", "Group", "Categorization", "Category"]);
const EFFECTS = new Set(["SHOW", "HIDE", "ENABLE", "DISABLE"]);

/** Resolves a control scope ("#/properties/a/properties/b") to its schema node, following $refs. */
export function schemaAtScope(root: FormSchema, scope: string): FormSchema | undefined {
  const pointer = scopeToPointer(scope);
  let node: FormSchema | undefined = root;
  for (const seg of pointer.split("/").slice(1)) {
    if (node?.$ref) node = resolveRef(root, node.$ref);
    if (node?.type === "array" && node.items) node = node.items.$ref ? resolveRef(root, node.items.$ref) : node.items;
    node = node?.properties?.[seg.replace(/~1/g, "/").replace(/~0/g, "~")];
    if (!node) return undefined;
  }
  return node?.$ref ? resolveRef(root, node.$ref) : node;
}

export function validateUiSchema(ui: unknown, jsonSchema: FormSchema): DefinitionError[] {
  const errors: DefinitionError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  const seen = new Set<string>();

  const checkRule = (rule: unknown, path: string) => {
    if (!isPlainObject(rule)) return err(path, "rule must be an object");
    if (typeof rule.effect !== "string" || !EFFECTS.has(rule.effect)) err(`${path}/effect`, "effect must be SHOW, HIDE, ENABLE or DISABLE");
    const c = rule.condition;
    if (!isPlainObject(c) || typeof c.scope !== "string" || !isPlainObject(c.schema)) {
      return err(`${path}/condition`, "condition needs a scope and a schema");
    }
    if (c.scope !== "#" && !schemaAtScope(jsonSchema, c.scope)) err(`${path}/condition/scope`, `scope ${c.scope} does not match a field in the form`);
  };

  const walk = (el: unknown, path: string, parentType: string | null) => {
    if (!isPlainObject(el) || typeof el.type !== "string") return err(path, "must be a UI element with a type");
    if (el.rule !== undefined) checkRule(el.rule, `${path}/rule`);
    if (el.type === "Control") {
      if (typeof el.scope !== "string" || !el.scope.startsWith("#/")) return err(`${path}/scope`, 'a Control needs a scope such as "#/properties/name"');
      if (!schemaAtScope(jsonSchema, el.scope)) err(`${path}/scope`, `scope ${el.scope} does not match a field in the form`);
      if (seen.has(el.scope)) err(`${path}/scope`, `scope ${el.scope} is used by more than one control`);
      seen.add(el.scope);
      if (el.options !== undefined) {
        if (!isPlainObject(el.options)) err(`${path}/options`, "must be an object");
        else {
          const o = el.options;
          if (o.widget !== undefined && !(WIDGETS as readonly unknown[]).includes(o.widget)) err(`${path}/options/widget`, `unknown widget ${JSON.stringify(o.widget)}`);
          for (const k of ["reviewerVisible", "pii", "outcome"]) if (o[k] !== undefined && typeof o[k] !== "boolean") err(`${path}/options/${k}`, "must be true or false");
        }
      }
      return;
    }
    if (!LAYOUTS.has(el.type)) return err(`${path}/type`, `unsupported element type "${el.type}"`);
    if (el.type === "Category" && parentType !== "Categorization") err(path, "a Category must sit inside a Categorization");
    if ((el.type === "Group" || el.type === "Category") && typeof el.label !== "string") err(`${path}/label`, `a ${el.type} needs a label`);
    if (!Array.isArray(el.elements)) return err(`${path}/elements`, "must be a list of elements");
    el.elements.forEach((child, i) => {
      if (el.type === "Categorization" && (!isPlainObject(child) || child.type !== "Category")) err(`${path}/elements/${i}`, "a Categorization may only contain Category elements");
      walk(child, `${path}/elements/${i}`, el.type as string);
    });
  };
  walk(ui, "#", null);
  return errors;
}

export interface ControlInfo {
  /** JSON pointer into the response. */
  path: string;
  scope: string;
  label?: string;
  options?: ControlOptions;
}

export function collectControls(ui: UiElement): ControlInfo[] {
  const out: ControlInfo[] = [];
  const walk = (el: UiElement) => {
    if (el.type === "Control") out.push({ path: scopeToPointer(el.scope), scope: el.scope, label: el.label, options: el.options });
    else for (const child of el.elements ?? []) walk(child);
  };
  if (isPlainObject(ui)) walk(ui);
  return out;
}

/** True when the rule's condition holds. An undefined value at the condition scope never matches. */
export function ruleMatches(rule: UiRule, response: unknown): boolean {
  const value = rule.condition.scope === "#" ? response : getPath(response, scopeToPointer(rule.condition.scope));
  if (value === undefined) return false;
  return validateAgainstSchema(rule.condition.schema, value, rule.condition.schema, response).length === 0;
}

export interface ControlState extends ControlInfo {
  visible: boolean;
  enabled: boolean;
}
export interface UiState {
  controls: ControlState[];
  /** Pointers of controls hidden by a rule on themselves or on an enclosing layout. */
  hidden: string[];
  disabled: string[];
}

/** Evaluates every rule against a response. Layout rules cascade to the controls they contain. */
export function evaluateUi(ui: UiElement, response: unknown): UiState {
  const controls: ControlState[] = [];
  const walk = (el: UiElement, visible: boolean, enabled: boolean) => {
    if (el.rule) {
      const m = ruleMatches(el.rule, response);
      if (el.rule.effect === "SHOW") visible &&= m;
      else if (el.rule.effect === "HIDE") visible &&= !m;
      else if (el.rule.effect === "ENABLE") enabled &&= m;
      else enabled &&= !m;
    }
    if (el.type === "Control") {
      const c = el as UiControl;
      controls.push({ path: scopeToPointer(c.scope), scope: c.scope, label: c.label, options: c.options, visible, enabled });
    } else for (const child of el.elements ?? []) walk(child, visible, enabled);
  };
  if (isPlainObject(ui)) walk(ui, true, true);
  return {
    controls,
    hidden: controls.filter((c) => !c.visible).map((c) => c.path),
    disabled: controls.filter((c) => !c.enabled).map((c) => c.path),
  };
}
