// SPDX-License-Identifier: AGPL-3.0-only
// The ServiceLayer port: one method per service function the tools call. It is derived from the
// tool declarations, so a tool cannot name a method the port lacks. REST routes call the same
// methods with the same Actor, which is how agents get the UI's capabilities and no more.
import type { z } from "zod";
import type { APPLICANT_TOOLS } from "./tools/applicant.ts";
import type { FUNDER_TOOLS } from "./tools/funder.ts";
import type { Actor, ToolSpec } from "./types.ts";

type ServiceOf<T extends Record<string, ToolSpec>> = {
  [K in keyof T as T[K]["service"]]: (actor: Actor, input: z.output<T[K]["input"]>) => Promise<unknown>;
};

export type FunderServices = ServiceOf<typeof FUNDER_TOOLS>;
export type ApplicantServices = ServiceOf<typeof APPLICANT_TOOLS>;
export type ServiceLayer = FunderServices & ApplicantServices;
export type ServiceMethod = keyof ServiceLayer;

/** Thrown by service functions for expected failures; the dispatcher maps it to a tool error. */
export class ServiceError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "conflict" | "invalid_input",
    message: string,
    readonly issues?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
