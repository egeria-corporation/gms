// SPDX-License-Identifier: AGPL-3.0-only
// Paying a tranche. There is one money path: Passport. Facilitated mode asks Passport to move the
// money; resolve mode tells Passport about a payment the funder made through its own bank. Nothing
// here stores a destination or adds to an award's disbursed amount.
import {
  CredentialVersionStaleError,
  PassportApiError,
  PassportUnavailableError,
  minorToMoney,
  moneyToMinor,
  type CgAward,
  type CreateDisbursementRequest,
  type Disbursement,
  type PassportRail,
  type PayeeCredential,
} from "@gms/passport-client";
import type { TrancheStatus } from "@gms/workflow";
import type { ReadinessSummary } from "./readiness.ts";
import { pathTo, trancheStatusFor } from "./status.ts";
import type { AwardForPayments, ExternalPaymentRecord, Tranche, TrancheUpdate } from "./types.ts";

/** The Passport calls a release needs. `PassportClient` satisfies it. */
export interface PassportForPayments {
  getAward(awardId: string): Promise<CgAward>;
  getPayeeCredential(orgId: string): Promise<PayeeCredential>;
  createDisbursement(req: CreateDisbursementRequest, idempotencyKey: string): Promise<{ disbursement: Disbursement; replayed: boolean }>;
}

export interface ReleaseDeps {
  passport: PassportForPayments;
  now: () => Date;
  /**
   * Apply an update through the tranche state machine and store it. Called with `releasing` before
   * Passport is asked to pay, so a crash between the two leaves a tranche that is safe to retry.
   */
  apply: (update: TrancheUpdate) => Promise<void>;
}

export type BlockCode = "wrong_status" | "not_ready" | "not_mirrored" | "award_headroom" | "passport_unavailable" | "no_credential";

/** The release did not start. The tranche is unchanged. */
export class ReleaseBlockedError extends Error {
  constructor(
    readonly code: BlockCode,
    message: string,
  ) {
    super(message);
    this.name = "ReleaseBlockedError";
  }
}

export interface ReleaseContext {
  tranche: Tranche;
  award: AwardForPayments;
  /** Evaluated immediately before this call. A release starts only when every line passes. */
  readiness: ReadinessSummary;
  /** `workspace.settings.defaultRail`; defaults to `auto` (Passport then uses a standard payout). */
  rail?: PassportRail;
  /** `user:<id>` — releasing money is a human-gated action. */
  actor: string;
}

export type ReleaseOutcome =
  | { result: "accepted"; status: TrancheStatus; disbursement: Disbursement; replayed: boolean }
  /** Passport refused: no money moved and the tranche is back in `due` (or `held`). */
  | { result: "refused"; status: TrancheStatus; code: string; message: string }
  /** Passport did not answer. The tranche stays `releasing`; repeat the call, the Idempotency-Key makes it safe. */
  | { result: "unconfirmed"; status: "releasing" };

const RELEASABLE: TrancheStatus[] = ["due", "ready"];

/** Passport limits memos to 140 characters. */
export function memoFor(award: AwardForPayments, tranche: Tranche): string {
  const suffix = ` — tranche ${tranche.seq}`;
  return award.title.slice(0, 140 - suffix.length) + suffix;
}

async function readPassport<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PassportUnavailableError) throw new ReleaseBlockedError("passport_unavailable", "Passport could not be reached. Nothing was released.");
    throw e;
  }
}

async function currentCredential(deps: ReleaseDeps, orgId: string): Promise<PayeeCredential> {
  try {
    return await readPassport(() => deps.passport.getPayeeCredential(orgId));
  } catch (e) {
    if (e instanceof PassportApiError && e.status === 404) throw new ReleaseBlockedError("no_credential", "This organization has no payee credential at Passport.");
    throw e;
  }
}

export async function releaseFacilitated(deps: ReleaseDeps, ctx: ReleaseContext): Promise<ReleaseOutcome> {
  const { tranche, award } = ctx;
  // A tranche already `releasing` is a retry of an unconfirmed call: the same key resumes it at Passport.
  const resuming = tranche.status === "releasing" && tranche.mode === "facilitated";
  if (!resuming) {
    if (!RELEASABLE.includes(tranche.status)) throw new ReleaseBlockedError("wrong_status", `A ${tranche.status} tranche cannot be released`);
    if (!ctx.readiness.releasable) throw new ReleaseBlockedError("not_ready", `Readiness: ${ctx.readiness.text}`);
  }
  if (!award.passportAwardId) throw new ReleaseBlockedError("not_mirrored", "Connect Passport to pay: this award is not mirrored to Passport.");
  const passportAwardId = award.passportAwardId;

  // Re-read the award: Passport is authoritative for the amount already disbursed.
  if (!resuming) {
    const pa = await readPassport(() => deps.passport.getAward(passportAwardId));
    const awarded = moneyToMinor(pa.funding?.awardedAmount);
    const disbursed = moneyToMinor(pa.funding?.disbursedAmount) ?? 0;
    if (awarded === null || awarded - disbursed < tranche.amountMinor) throw new ReleaseBlockedError("award_headroom", "This payment would exceed what remains of the award at Passport.");
  }
  let credential = await currentCredential(deps, award.recipientOrgId);

  let status: TrancheStatus = tranche.status;
  const move = async (target: TrancheStatus, patch: TrancheUpdate["patch"], reason?: string) => {
    const path = pathTo(status, target);
    if (!path.length && !Object.keys(patch).length) return;
    status = path[path.length - 1] ?? status;
    await deps.apply({ trancheId: tranche.id, path, patch: { ...patch, status }, ...(reason ? { reason } : {}) });
  };

  if (!resuming) await move("releasing", { mode: "facilitated", releasedBy: ctx.actor, releasedAt: deps.now().toISOString(), holdReason: null });

  const request = (c: PayeeCredential): CreateDisbursementRequest => ({
    awardId: passportAwardId,
    recipientOrgId: award.recipientOrgId,
    credentialId: c.id,
    credentialVersion: c.version,
    amount: minorToMoney(tranche.amountMinor, tranche.currency),
    rail: ctx.rail ?? "auto",
    mode: "facilitated",
    memo: memoFor(award, tranche),
    feePaidBy: "source",
  });

  for (let attempt = 1; ; attempt++) {
    try {
      const { disbursement, replayed } = await deps.passport.createDisbursement(request(credential), tranche.idempotencyKey);
      const target = trancheStatusFor(disbursement.status);
      await move(
        target,
        { passportDisbursementId: disbursement.id, passportStatus: disbursement.status, holdReason: target === "held" ? (disbursement.statusReason ?? "pending_destination_change") : null },
        disbursement.statusReason,
      );
      return { result: "accepted", status, disbursement, replayed };
    } catch (e) {
      if (e instanceof CredentialVersionStaleError) {
        if (attempt === 1) {
          // The credential changed between resolve and pay. Re-resolve once; a refusal stores nothing
          // at Passport, so the same Idempotency-Key is still free.
          try {
            credential = await deps.passport.getPayeeCredential(award.recipientOrgId);
            continue;
          } catch (again) {
            if (!(again instanceof PassportUnavailableError)) throw again;
          }
        }
        await move("failed", { passportStatus: "refused" }, e.code);
        await deps.apply({ trancheId: tranche.id, path: ["held"], patch: { status: "held", holdReason: "credential_version_stale" }, reason: e.code });
        return { result: "refused", status: "held", code: e.code, message: "The payee credential changed while this payment was being released. Review the grantee's payee status, then release again." };
      }
      if (e instanceof PassportUnavailableError) return { result: "unconfirmed", status: "releasing" };
      if (e instanceof PassportApiError) {
        await move("failed", { passportStatus: "refused" }, e.code);
        return { result: "refused", status, code: e.code, message: e.message };
      }
      throw e;
    }
  }
}

export interface RecordExternalContext {
  tranche: Tranche;
  award: AwardForPayments;
  external: { reference: string; paidAt: string; destinationLast4: string };
  actor: string;
}

export type RecordExternalOutcome =
  /** Passport recorded the payment and matched the last four digits to the credential. */
  | { result: "recorded"; disbursement: Disbursement }
  /** Passport could not verify the payment (422). Settled locally; shown in Payments center as unverified. */
  | { result: "unverified"; code: string; message: string };

/** Resolve mode: record a tranche the funder paid through its own bank, then tell Passport. */
export async function recordExternal(deps: ReleaseDeps, ctx: RecordExternalContext): Promise<RecordExternalOutcome> {
  const { tranche, award, external } = ctx;
  if (!RELEASABLE.includes(tranche.status)) throw new ReleaseBlockedError("wrong_status", `A ${tranche.status} tranche cannot be recorded as paid`);
  if (!award.passportAwardId) throw new ReleaseBlockedError("not_mirrored", "Connect Passport to record payments: this award is not mirrored to Passport.");
  if (!/^[0-9]{4}$/.test(external.destinationLast4)) throw new ReleaseBlockedError("not_ready", "Enter the last four digits of the account that was paid.");
  const passportAwardId = award.passportAwardId;
  let credential = await currentCredential(deps, award.recipientOrgId);

  const record: ExternalPaymentRecord = { reference: external.reference, paidAt: external.paidAt, last4: external.destinationLast4 };
  const settle = (patch: TrancheUpdate["patch"], reason?: string) =>
    deps.apply({
      trancheId: tranche.id,
      path: ["settled"],
      patch: { status: "settled", mode: "resolve", external: record, releasedBy: ctx.actor, releasedAt: deps.now().toISOString(), holdReason: null, ...patch },
      ...(reason ? { reason } : {}),
    });

  for (let attempt = 1; ; attempt++) {
    try {
      const { disbursement } = await deps.passport.createDisbursement(
        {
          awardId: passportAwardId,
          recipientOrgId: award.recipientOrgId,
          credentialId: credential.id,
          credentialVersion: credential.version,
          amount: minorToMoney(tranche.amountMinor, tranche.currency),
          mode: "resolve",
          memo: memoFor(award, tranche),
          external,
        },
        tranche.idempotencyKey,
      );
      await settle({ passportDisbursementId: disbursement.id, passportStatus: disbursement.status });
      return { result: "recorded", disbursement };
    } catch (e) {
      if (e instanceof CredentialVersionStaleError && attempt === 1) {
        credential = await currentCredential(deps, award.recipientOrgId);
        continue;
      }
      if (e instanceof PassportApiError && e.status === 422) {
        await settle({ passportStatus: "unverified" }, e.code);
        return { result: "unverified", code: e.code, message: e.message };
      }
      if (e instanceof PassportUnavailableError) throw new ReleaseBlockedError("passport_unavailable", "Passport could not be reached. The payment was not recorded.");
      throw e;
    }
  }
}
