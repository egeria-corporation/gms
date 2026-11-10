// SPDX-License-Identifier: AGPL-3.0-only
import type { z } from "zod";

export interface ProjectionIssue {
  /** Dotted path into the projected record, e.g. `funding.awardedAmount.amount`. */
  path: string;
  message: string;
}

/** A GMS row could not be projected to a valid CommonGrants v0.5.0 model. */
export class ProjectionError extends Error {
  readonly model: string;
  readonly issues: ProjectionIssue[];

  constructor(model: string, issues: ProjectionIssue[]) {
    super(`${model} projection is not a valid CommonGrants record: ${issues.map((i) => `${i.path || "(root)"}: ${i.message}`).join("; ")}`);
    this.name = "ProjectionError";
    this.model = model;
    this.issues = issues;
  }
}

/**
 * Validate `value` against a CommonGrants schema and return it unchanged. The SDK schemas transform
 * dates into objects, so the parsed output is not what goes on the wire; the input is.
 */
export function validated<T>(model: string, schema: z.ZodType, value: T): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ProjectionError(
      model,
      result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    );
  }
  return value;
}
