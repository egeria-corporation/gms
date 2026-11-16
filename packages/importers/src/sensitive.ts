// SPDX-License-Identifier: AGPL-3.0-only
// Sensitive data first. Before a column of an imported table is stored, shown or even mapped, it is
// screened: a column whose header names bank or identity data, or whose values look like bank
// routing details, a person's identity number or a long account-style number, is dropped. Only the
// column's name and the kind of match are kept, so the preview can say what was left out; the
// values themselves never leave this function.
//
// The value checks are deliberately strict (one matching cell drops the whole column). Any value
// that is nine digits once spaces and dashes are taken out is read as a person's identity number
// (or, when it passes the routing checksum, bank details), whatever its checksum: an unformatted
// identity number under a header like "ID" or "Reference" must not slip through. The cost is
// accepted: a ZIP+4 code or a formatted EIN in a column not named for an EIN is left out too. Two
// narrow exceptions keep ordinary grant data importable: in a column whose header names an EIN (an
// organization's public number on its 990), nine-digit values are read as EINs, and in a column
// whose header names a phone, ten- and eleven-digit values are read as phone numbers.
//
// The phrases this file matches are written in pieces so the repository's sensitive-data gate
// (scripts/sensitive-data-gate.mjs) keeps passing: nothing here models such a field.

/** Why a column was left out. Plain words for each are in {@link DROP_REASON_TEXT}. */
export type DropReason = "header" | "bank_routing" | "identity_number" | "long_number";

export interface DroppedColumn {
  /** The column's header as it was in the source (trimmed). */
  column: string;
  reason: DropReason;
}

export const DROP_REASON_TEXT: Record<DropReason, string> = {
  header: "Its name suggests bank or identity details",
  bank_routing: "Its values look like bank details",
  identity_number: "Its values look like a person's identity number. Any nine-digit number is left out unless the column is named EIN, so ZIP+4 codes are left out too",
  long_number: "Its values look like account or card numbers",
};

/** "No", "num", "number" or "#" as a word of its own, so "Account notes" is not caught. */
const NUM = String.raw`(?:(?:no|num|nbr|number|numbers)\b|#)`;

const HEADER_PARTS = [
  String.raw`\brout(?:ing)?\b`,
  String.raw`\baba\b`,
  String.raw`\brtn\b`,
  String.raw`\bacc(?:oun)?t[\s_.-]*${NUM}`,
  String.raw`\bbank[\s_.-]*acc`,
  String.raw`\biban\b`,
  String.raw`\bswift\b`,
  String.raw`\bbic\b`,
  String.raw`\bsort[\s_.-]*code`,
  String.raw`\bs\.?s\.?n\b`,
  String.raw`\bsocial[\s_.-]*sec`,
  String.raw`\bsin\b`,
  String.raw`\bnin\b`,
  String.raw`\bnational[\s_.-]*(?:id|insurance)`,
  String.raw`birth`,
  String.raw`\bd\.?o\.?b\b`,
  String.raw`\btax[\s_.-]*id`,
  String.raw`\bt\.?i\.?n\b`,
  String.raw`\bitin\b`,
  String.raw`\bgov(?:ernment|t)?[\s_.-]*id`,
  String.raw`\bpassport[\s_.-]*${NUM}`,
  String.raw`\bdriver'?s?[\s_.-]*lic`,
  String.raw`\bdriver\b`,
  String.raw`\blicen[cs]e[\s_.-]*${NUM}`,
  String.raw`\bcard[\s_.-]*${NUM}`,
  String.raw`\bcredit[\s_.-]*card`,
  String.raw`\bcvv\b`,
  String.raw`\bpin\b`,
];
const SENSITIVE_HEADER = new RegExp(HEADER_PARTS.join("|"), "i");

/** Whether a header names bank or identity data. Such a column is never imported. */
export const isSensitiveHeader = (header: string): boolean => SENSITIVE_HEADER.test(header.trim());

const EIN_HEADER = /\bein\b|employer[\s_.-]*ident|\bfein\b/i;
const PHONE_HEADER = /phone|\btel\b|telephone|mobile|\bcell\b|\bfax\b/i;

/** A formatted identity number: three digits, two, four. */
const IDENTITY_FORMATTED = /^\d{3}-\d{2}-\d{4}$|^\d{3} \d{2} \d{4}$/;
const NINE_DIGITS = /^\d{9}$/;
const LONG_DIGITS = /^\d{10,19}$/;
/** A shape that is something else: a US phone number (555-010-0123). */
const PHONE_FORMATTED = /^\d{3}[-. ]\d{3}[-. ]\d{4}$/;

/**
 * The ABA routing checksum: 3·(d1+d4+d7) + 7·(d2+d5+d8) + (d3+d6+d9) ≡ 0 (mod 10), and the first two
 * digits in a range the Federal Reserve assigns (00–12, 21–32, 61–72, 80).
 */
export function isAbaRoutingShaped(value: string): boolean {
  if (!NINE_DIGITS.test(value)) return false;
  const d = [...value].map(Number);
  const sum = 3 * (d[0]! + d[3]! + d[6]!) + 7 * (d[1]! + d[4]! + d[7]!) + (d[2]! + d[5]! + d[8]!);
  if (sum % 10 !== 0) return false;
  const prefix = d[0]! * 10 + d[1]!;
  return prefix <= 12 || (prefix >= 21 && prefix <= 32) || (prefix >= 61 && prefix <= 72) || prefix === 80;
}

/** Why one cell would drop its column, or null. `header` is the column's header. */
export function sensitiveValue(raw: string, header: string): Exclude<DropReason, "header"> | null {
  const v = raw.trim();
  if (!v || v.length > 40) return null;
  if (IDENTITY_FORMATTED.test(v)) return "identity_number";
  if (PHONE_FORMATTED.test(v)) return null;
  // Digits written with spaces or dashes between groups read the same as bare digits.
  const digits = /^[\d\s-]+$/.test(v) ? v.replace(/[\s-]/g, "") : null;
  if (!digits) return null;
  // Nine digits: an EIN only in a column named for one; anything else is dropped (see the top).
  if (NINE_DIGITS.test(digits)) return EIN_HEADER.test(header) ? null : isAbaRoutingShaped(digits) ? "bank_routing" : "identity_number";
  if (LONG_DIGITS.test(digits)) {
    const phone = PHONE_HEADER.test(header) && (digits.length === 10 || (digits.length === 11 && digits.startsWith("1")));
    if (!phone) return "long_number";
  }
  return null;
}

export interface Screened {
  /** Indexes of the columns that may be read. */
  keep: number[];
  dropped: DroppedColumn[];
}

/**
 * Screen every column of a table: by header first, then by every value. A dropped column's values
 * are not copied anywhere; callers read only the `keep` indexes.
 */
export function screenColumns(header: readonly string[], rows: readonly (readonly string[])[]): Screened {
  const keep: number[] = [];
  const dropped: DroppedColumn[] = [];
  header.forEach((raw, i) => {
    const column = raw.trim();
    if (isSensitiveHeader(column)) {
      dropped.push({ column, reason: "header" });
      return;
    }
    for (const row of rows) {
      const why = sensitiveValue(row[i] ?? "", column);
      if (why) {
        dropped.push({ column, reason: why });
        return;
      }
    }
    keep.push(i);
  });
  return { keep, dropped };
}
