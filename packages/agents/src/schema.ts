// SPDX-License-Identifier: AGPL-3.0-or-later
// zod v4 → JSON Schema (2020-12) for tool input/output schemas and OpenAPI components.
import { z } from 'zod';

export type JsonObject = Record<string, unknown>;

/** JSON Schema for a zod schema. `io: 'input'` describes what callers send (defaults optional, transforms ignored). */
export function jsonSchemaOf(schema: z.ZodType, io: 'input' | 'output' = 'input'): JsonObject {
  const s = z.toJSONSchema(schema, { io, unrepresentable: 'any', target: 'draft-2020-12' }) as JsonObject;
  delete s.$schema;
  return s;
}

/** MCP requires tool schemas to be objects; wrap anything else. */
export function objectSchema(s: JsonObject): JsonObject {
  if (s.type === 'object') return s;
  return { type: 'object', properties: { value: s }, required: ['value'] };
}
