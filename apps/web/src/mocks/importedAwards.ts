// SPDX-License-Identifier: AGPL-3.0-only
// A non-dry-run import has to land where a tester looks next: Awards (`listAwards`) and Grantees.
// Those two lists live in different mock stores. The funder and money mocks register here when
// they are created, and both the CSV import and the import wizard publish a row.

export interface ImportedAward {
  id: string;
  title: string;
  recipientName: string;
  amountMinor: number;
  paidMinor: number | null;
  status: "active" | "completed";
  programName: string | null;
}

type PlaceGrantee = (row: ImportedAward) => Promise<string>;
type PlaceAward = (row: ImportedAward, recipientWorkspaceId: string) => Promise<void>;

let placeGrantee: PlaceGrantee | null = null;
let placeAward: PlaceAward | null = null;

/** The latest mock registers. A second `createMockApi` replaces the first, which is the one the app holds. */
export function bindImportedAwards(next: { grantee?: PlaceGrantee; award?: PlaceAward }): void {
  if (next.grantee) placeGrantee = next.grantee;
  if (next.award) placeAward = next.award;
}

export async function publishImportedAward(row: ImportedAward): Promise<void> {
  const recipientWorkspaceId = placeGrantee ? await placeGrantee(row) : crypto.randomUUID();
  if (placeAward) await placeAward(row, recipientWorkspaceId);
}
