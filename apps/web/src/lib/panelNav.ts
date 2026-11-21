// SPDX-License-Identifier: AGPL-3.0-only
// Where "Panel & decisions" goes. An open competition whose stages ask for a decision is ready
// to commit; one of those opens its panel, and several open the list on the assignment page.

export interface CommitCandidate {
  id: string;
  status: string;
  stages: readonly { decisionRequired: boolean }[];
}

export function readyToCommit<T extends CommitCandidate>(competitions: readonly T[]): T[] {
  return competitions.filter((c) => c.status === "open" && c.stages.some((s) => s.decisionRequired));
}

/** Path under `/w/:handle`. Null when nothing is ready to commit. */
export function panelDecisionsPath(competitions: readonly CommitCandidate[]): string | null {
  const ready = readyToCommit(competitions);
  if (ready.length === 0) return null;
  if (ready.length === 1) return `/competitions/${ready[0]!.id}/panel`;
  return "/reviews/assign#panels";
}
