// SPDX-License-Identifier: AGPL-3.0-only
// Starting the second step of sign-in. A verified authenticator is challenged. One that was
// started and never finished is removed first, so a second visit can enroll again instead of
// stopping on Supabase's "friendly name already exists".
import type { TotpEnrollment, TotpFactor } from "./types.ts";

export interface SecondStepPort {
  listAllTotpFactors(): Promise<TotpFactor[]>;
  unenrollTotp(factorId: string): Promise<void>;
  enrollTotp(): Promise<TotpEnrollment>;
}

export type SecondStepStart = { kind: "challenge"; factorId: string } | { kind: "enroll"; enrollment: TotpEnrollment };

/**
 * What the second-step screen should show. A verified factor is challenged and left in place.
 * Every unverified factor is removed, then a new enrollment is started.
 */
export async function startSecondStep(port: SecondStepPort): Promise<SecondStepStart> {
  const factors = await port.listAllTotpFactors();
  const verified = factors.find((f) => f.status === "verified");
  if (verified) return { kind: "challenge", factorId: verified.id };
  for (const factor of factors) {
    if (factor.status !== "verified") await port.unenrollTotp(factor.id);
  }
  return { kind: "enroll", enrollment: await port.enrollTotp() };
}
