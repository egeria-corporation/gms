// SPDX-License-Identifier: AGPL-3.0-only
import type { CgAward, CreateDisbursementRequest, Disbursement, FunderSource, PayeeCredential } from "@gms/passport-client";
import { ok, type PassportForPayments, type ReadinessInput, type ReleaseDeps, type Tranche, type TrancheUpdate, type AwardForPayments } from "../src/index.ts";

export const NOW = new Date("2027-05-24T16:00:00Z");
export const ORG = "0193a1c0-0000-7000-8000-0000000000a1";
export const PASSPORT_AWARD = "0193a1c0-0000-7000-8000-00000000aa01";

export function tranche(over: Partial<Tranche> = {}): Tranche {
  return {
    id: "trn_0001",
    awardId: "awd_0001",
    seq: 1,
    amountMinor: 7_500_000,
    currency: "USD",
    condition: { type: "onExecution" },
    status: "due",
    dueAt: NOW.toISOString(),
    mode: null,
    passportDisbursementId: null,
    passportStatus: null,
    holdReason: null,
    idempotencyKey: "trn_0001",
    releasedBy: null,
    releasedAt: null,
    external: null,
    ...over,
  };
}

export const award: AwardForPayments = { id: "awd_0001", title: "Mobile Health Navigation for Rural Families", recipientOrgId: ORG, passportAwardId: PASSPORT_AWARD, conditions: [], verificationLevelAtSubmit: "L3" };

export function credential(over: Partial<PayeeCredential> = {}): PayeeCredential {
  return {
    id: "pc_01JALDERCREEK0000000000000",
    version: 4,
    organization: { id: ORG, name: "Alder Creek Family Services", identifiers: {} },
    level: "L3",
    payoutDestination: { provider: "stripe", token: "tok_fixture", tokensByRail: { standard: "tok_fixture" }, bankName: "River City Credit Union", last4: "4821", holderType: "company", holderNameMatch: "match", validations: [], verifiedAt: "2027-01-12T17:00:00Z", status: "active" },
    changeControl: { pendingChange: null, freezeUntil: null, lastChangedAt: null },
    warranty: { cap: { amount: "250000.00", currency: "USD" }, termsUrl: "https://passport.example/warranty" },
    attestation: "fixture.jws",
    issuedAt: NOW.toISOString(),
    ...over,
  };
}

export const source: FunderSource = { id: "src_1", orgId: "funder", provider: "stripe", status: "verified", statusReason: null, bankName: "Riverbend Trust Bank", last4: "0907", canDebit: true, verifiedAt: NOW.toISOString(), createdAt: NOW.toISOString() };

export function passportAward(disbursed = "0.00", awarded = "150000.00"): CgAward {
  return { id: PASSPORT_AWARD, funding: { awardedAmount: { amount: awarded, currency: "USD" }, disbursedAmount: { amount: disbursed, currency: "USD" } } };
}

export function readinessInput(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    tranche: tranche(),
    award,
    agreementExecuted: true,
    conditionSatisfied: true,
    passportLinked: true,
    funderSources: ok([source]),
    credential: ok(credential()),
    passportAward: ok(passportAward()),
    recipientActive: true,
    siblings: [],
    now: NOW,
    ...over,
  };
}

export function disbursement(over: Partial<Disbursement> = {}): Disbursement {
  return {
    id: "dsb_01JFIXTURE0000000000000000",
    awardId: PASSPORT_AWARD,
    funderOrgId: "funder",
    recipientOrgId: ORG,
    credentialId: "pc_01JALDERCREEK0000000000000",
    credentialVersion: 4,
    destinationId: "dest_1",
    amount: { amount: "75000.00", currency: "USD" },
    requestedRail: "auto",
    rail: "standard",
    mode: "facilitated",
    status: "initiated",
    fee: null,
    warrantyEligible: true,
    checks: [],
    timeline: [],
    createdAt: NOW.toISOString(),
    lastModifiedAt: NOW.toISOString(),
    ...over,
  };
}

export interface FakePassport extends PassportForPayments {
  creates: { req: CreateDisbursementRequest; key: string }[];
  credentialReads: number;
}

/** `create` answers each createDisbursement call in turn (the last entry repeats): a value to return or an error to throw. */
export function fakePassport(opts: { award?: CgAward | Error; credentials?: (PayeeCredential | Error)[]; create: (Disbursement | Error)[] }): FakePassport {
  const creds = opts.credentials ?? [credential()];
  const fake: FakePassport = {
    creates: [],
    credentialReads: 0,
    getAward: () => (opts.award instanceof Error ? Promise.reject(opts.award) : Promise.resolve(opts.award ?? passportAward())),
    getPayeeCredential: () => {
      const c = creds[Math.min(fake.credentialReads++, creds.length - 1)]!;
      return c instanceof Error ? Promise.reject(c) : Promise.resolve(c);
    },
    createDisbursement: (req, key) => {
      const r = opts.create[Math.min(fake.creates.length, opts.create.length - 1)]!;
      fake.creates.push({ req, key });
      return r instanceof Error ? Promise.reject(r) : Promise.resolve({ disbursement: r, replayed: false });
    },
  };
  return fake;
}

export function deps(passport: PassportForPayments): ReleaseDeps & { updates: TrancheUpdate[] } {
  const updates: TrancheUpdate[] = [];
  return { passport, now: () => NOW, updates, apply: (u) => void updates.push(u) as unknown as Promise<void> };
}
