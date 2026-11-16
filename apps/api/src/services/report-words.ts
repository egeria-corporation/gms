// SPDX-License-Identifier: AGPL-3.0-only
// A report's CSV header row in the reader's language. The data sets name their columns in English
// (report-engine.ts, and the API's JSON stays English); a CSV a person downloads, from the builder or
// a scheduled file, gets its header row from the email catalog's `csv.*` words in the language of the
// request. A column the catalog does not name keeps its English name. Cells are unchanged.
import { DEFAULT_LOCALE, type Key, type Locale } from "@gms/i18n";
import { SERVER_CATALOGS, serverTranslator } from "@gms/i18n/server";
import { csvCell, type Definition, type OutColumn } from "./report-engine.ts";

/** The output columns with their names in `locale`. */
export function columnsIn(locale: Locale | undefined, definition: Pick<Definition, "dataSet" | "aggregates">, columns: readonly OutColumn[]): OutColumn[] {
  if (!locale || locale === DEFAULT_LOCALE) return [...columns];
  const t = serverTranslator(locale, "email");
  const name = (column: string): string | null => {
    const key = `csv.col.${definition.dataSet}.${column}`;
    return key in SERVER_CATALOGS[locale].email ? t(key as Key<"email">) : null;
  };
  return columns.map((c) => {
    if (c.key === "count") return { ...c, label: t("csv.aggregate.count") };
    const agg = definition.aggregates.find((a) => a.fn !== "count" && `${a.fn}:${a.column}` === c.key);
    if (agg) {
      const column = agg.column ? name(agg.column) : null;
      return column ? { ...c, label: t(agg.fn === "sum" ? "csv.aggregate.sumOf" : "csv.aggregate.avgOf", { column: column.toLowerCase() }) } : c;
    }
    const label = name(c.key);
    return label ? { ...c, label } : c;
  });
}

const headerLine = (columns: readonly OutColumn[]) => columns.map((c) => csvCell(c.label)).join(",");

/**
 * A stored CSV (written with English headers) with its header row in another language: replaced
 * only when the file's first line is exactly the English header these columns give; otherwise the
 * file is sent as it was stored.
 */
export function withHeaderIn(body: ReadableStream<Uint8Array> | string, english: readonly OutColumn[], localized: readonly OutColumn[]): ReadableStream<Uint8Array> | string {
  const from = headerLine(english);
  const to = headerLine(localized);
  if (from === to) return body;
  if (typeof body === "string") return body.startsWith(`${from}\r\n`) ? to + body.slice(from.length) : body;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const reader = body.getReader();
  let head: string | null = "";
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (head === null) {
        if (done) controller.close();
        else controller.enqueue(value);
        return;
      }
      // Until the first line has arrived: hold it, then send it (in the other language when it matches) and the rest as read.
      head += done ? dec.decode() : dec.decode(value, { stream: true });
      const end = head.indexOf("\r\n");
      if (end < 0 && !done) return;
      const first = end < 0 ? head : head.slice(0, end);
      const rest = end < 0 ? "" : head.slice(end);
      head = null;
      controller.enqueue(enc.encode((first === from ? to : first) + rest));
      if (done) controller.close();
    },
    cancel: (reason) => reader.cancel(reason),
  });
}
