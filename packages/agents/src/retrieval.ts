// SPDX-License-Identifier: AGPL-3.0-only
// Passage retrieval over an opportunity's published text (description, eligibility, guidelines, FAQ) with a
// small BM25 ranker. Used by the A2A `answer_opportunity_question` skill to answer with citations.

export type PassageSource = 'description' | 'eligibility' | 'guidelines' | 'faq';

export interface Passage {
  id: string;
  opportunityId: string;
  opportunityTitle: string;
  slug: string;
  source: PassageSource;
  heading: string | null;
  text: string;
}

export interface OpportunityText {
  id: string;
  title: string;
  slug: string;
  description_md: string | null;
  eligibility_md: string | null;
  guidelines_md: string | null;
  faq: unknown;
}

const STOP = new Set(
  'a an and are as at be by can do does for from has have how i if in is it its may me my of on or our should that the their them there these they this to was we what when where which who will with you your about any also am been but did get into just more most much must not only other out over same so some such than then too very would'.split(
    ' ',
  ),
);

export function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .match(/[a-z0-9]+/g) ?? []
  )
    .filter((t) => !STOP.has(t) && t.length > 1)
    .map(stem);
}

function stem(t: string): string {
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('es') && !t.endsWith('ses')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

function splitMarkdown(md: string): { heading: string | null; text: string }[] {
  const out: { heading: string | null; text: string }[] = [];
  let heading: string | null = null;
  for (const block of md.split(/\n\s*\n/)) {
    const b = block.trim();
    if (!b) continue;
    const h = /^#{1,6}\s+(.+)$/.exec(b.split('\n')[0]!);
    if (h) {
      heading = h[1]!.trim();
      const rest = b.split('\n').slice(1).join('\n').trim();
      if (rest) out.push({ heading, text: rest });
      continue;
    }
    out.push({ heading, text: b });
  }
  return out;
}

/** Splits an opportunity's published text into citable passages. */
export function passagesFor(opp: OpportunityText): Passage[] {
  const out: Passage[] = [];
  const add = (source: PassageSource, md: string | null) => {
    if (!md) return;
    splitMarkdown(md).forEach((p, i) =>
      out.push({
        id: `${opp.id}:${source}:${i}`,
        opportunityId: opp.id,
        opportunityTitle: opp.title,
        slug: opp.slug,
        source,
        heading: p.heading,
        text: p.text,
      }),
    );
  };
  add('description', opp.description_md);
  add('eligibility', opp.eligibility_md);
  add('guidelines', opp.guidelines_md);
  if (Array.isArray(opp.faq)) {
    opp.faq.forEach((f, i) => {
      const item = f as { q?: unknown; a?: unknown };
      if (typeof item.q === 'string' && typeof item.a === 'string') {
        out.push({
          id: `${opp.id}:faq:${i}`,
          opportunityId: opp.id,
          opportunityTitle: opp.title,
          slug: opp.slug,
          source: 'faq',
          heading: item.q,
          text: `Q: ${item.q}\nA: ${item.a}`,
        });
      }
    });
  }
  return out;
}

/** BM25 (k1 = 1.2, b = 0.75). Returns the top `k` passages with a positive score. */
export function rankPassages(
  passages: Passage[],
  question: string,
  k = 3,
): { passage: Passage; score: number }[] {
  const q = [...new Set(tokenize(question))];
  if (!q.length || !passages.length) return [];
  const docs = passages.map((p) => tokenize(`${p.heading ?? ''} ${p.text}`));
  const avg = docs.reduce((s, d) => s + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const scored = docs.map((d, i) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (n - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += (idf * f * 2.2) / (f + 1.2 * (1 - 0.75 + (0.75 * d.length) / avg));
    }
    // Small boost for FAQ answers, which are written as answers.
    if (passages[i]!.source === 'faq' && score > 0) score *= 1.1;
    return { passage: passages[i]!, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
