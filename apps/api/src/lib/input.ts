// SPDX-License-Identifier: AGPL-3.0-only
import type { z } from "zod";
import { ApiError } from "./errors.ts";

/** Parse a request body with a zod schema; a failure is a 400 with one entry per issue. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  throw new ApiError(
    400,
    "bad_request",
    "The request body is not valid",
    r.error.issues.map((i) => ({ code: "invalid_field", field: i.path.map(String).join("."), detail: i.message })),
  );
}

/** A 422 that lists what is wrong with a record the caller is trying to save or publish. */
export const unprocessable = (message: string, problems: { path: string; message: string }[]) =>
  new ApiError(
    422,
    "unprocessable",
    message,
    problems.map((p) => ({ code: "invalid_field", field: p.path, detail: p.message })),
  );
