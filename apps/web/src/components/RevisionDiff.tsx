// SPDX-License-Identifier: AGPL-3.0-only
// What changed when an applicant answered a revision request: side by side at desktop width, one
// column at phone width (the `.diff .cols` grid stacks under 720px). Removed words are struck,
// added words are tinted, and the summary names the fields and the word-count change so a reader
// can skip a trivial diff. Never color alone: each side is labelled Before / After.
import type { RevisionChange, RevisionDiff as Revision } from "../api/applicantMore.ts";
import { formatDate } from "../lib/format.ts";

type Part = { text: string; kind: "same" | "del" | "ins" };

/** Word-level diff by longest common subsequence. Answers are short, so the table stays small. */
export function diffWords(before: string, after: string): { before: Part[]; after: Part[] } {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const left: Part[] = [];
  const right: Part[] = [];
  const push = (list: Part[], text: string, kind: Part["kind"]) => {
    const last = list[list.length - 1];
    if (last && last.kind === kind) last.text += text;
    else list.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(left, a[i]!, "same");
      push(right, b[j]!, "same");
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) push(left, a[i++]!, "del");
    else push(right, b[j++]!, "ins");
  }
  while (i < n) push(left, a[i++]!, "del");
  while (j < m) push(right, b[j++]!, "ins");
  return { before: left, after: right };
}

const fieldName = (path: string) => {
  const key = path.replace(/^\//, "").split("/")[0] ?? path;
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
};
const delta = (n: number) => (n === 0 ? "same length" : `${n > 0 ? "+" : "−"}${Math.abs(n)} word${Math.abs(n) === 1 ? "" : "s"}`);

function Change({ change, label }: { change: RevisionChange; label: string }) {
  const parts = diffWords(change.before ?? "", change.after ?? "");
  return (
    <div className="diff">
      <div className="hd">
        <span>{label}</span>
        <span>
          {change.wordsBefore} → {change.wordsAfter} words ({delta(change.wordDelta)})
        </span>
      </div>
      <div className="cols">
        <div>
          <div className="eyebrow" style={{ marginBottom: "4px" }}>
            Before
          </div>
          {parts.before.length === 0 ? <span className="muted">Empty</span> : parts.before.map((p, i) => (p.kind === "del" ? <del key={i} className="del">{p.text}</del> : <span key={i}>{p.text}</span>))}
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: "4px" }}>
            After
          </div>
          {parts.after.length === 0 ? <span className="muted">Empty</span> : parts.after.map((p, i) => (p.kind === "ins" ? <ins key={i} className="ins" style={{ textDecoration: "none" }}>{p.text}</ins> : <span key={i}>{p.text}</span>))}
        </div>
      </div>
    </div>
  );
}

export function RevisionDiff({ revision, labels = {} }: { revision: Revision; labels?: Record<string, string> }) {
  const changes = revision.changes;
  const net = changes.reduce((s, c) => s + c.wordDelta, 0);
  const name = (c: RevisionChange) => labels[c.path] ?? labels[c.path.replace(/^\//, "")] ?? fieldName(c.path);
  if (!changes.length) return <p className="small muted">Resubmitted without changes to the answers.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <p className="small muted">
        What changed since the request of {formatDate(revision.requestedAt)}: {changes.map(name).join(", ")} · {delta(net)} in all
      </p>
      {changes.map((c) => (
        <Change key={`${c.formId}${c.path}`} change={c} label={name(c)} />
      ))}
    </div>
  );
}
