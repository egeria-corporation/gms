// SPDX-License-Identifier: AGPL-3.0-or-later
// RFC 4180 CSV: an incremental parser (quotes may span chunk boundaries; used for streamed IRS/OFAC files)
// and a writer that neutralizes spreadsheet formula injection.

export class CsvParser {
  private field = '';
  private row: string[] = [];
  private inQuotes = false;
  /** A quote seen inside a quoted field: either an escaped quote ("") or the closing quote. */
  private pendingQuote = false;
  private pendingCR = false;
  private started = false;

  constructor(private readonly delimiter = ',') {}

  /** Feeds a chunk; returns the rows completed by it. */
  push(chunk: string): string[][] {
    const rows: string[][] = [];
    let text = chunk;
    if (!this.started) {
      this.started = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (this.pendingCR) {
        this.pendingCR = false;
        if (c === '\n') continue;
      }
      if (this.inQuotes) {
        if (this.pendingQuote) {
          this.pendingQuote = false;
          if (c === '"') {
            this.field += '"';
            continue;
          }
          this.inQuotes = false;
          // fall through: c is processed as an unquoted character
        } else if (c === '"') {
          this.pendingQuote = true;
          continue;
        } else {
          this.field += c;
          continue;
        }
      }
      if (c === '"' && this.field === '') {
        this.inQuotes = true;
      } else if (c === this.delimiter) {
        this.row.push(this.field);
        this.field = '';
      } else if (c === '\n' || c === '\r') {
        this.row.push(this.field);
        this.field = '';
        rows.push(this.row);
        this.row = [];
        if (c === '\r') this.pendingCR = true;
      } else {
        this.field += c;
      }
    }
    return rows;
  }

  /** Flushes the final row (files without a trailing newline). */
  end(): string[][] {
    if (this.pendingQuote) {
      this.pendingQuote = false;
      this.inQuotes = false;
    }
    if (this.field !== '' || this.row.length > 0) {
      this.row.push(this.field);
      const r = this.row;
      this.row = [];
      this.field = '';
      return [r];
    }
    return [];
  }
}

export function parseCsv(text: string, delimiter = ','): string[][] {
  const p = new CsvParser(delimiter);
  return [...p.push(text), ...p.end()];
}

/** Parses a stream of text chunks (e.g. a decoded HTTP body) into rows. */
export async function* parseCsvStream(chunks: AsyncIterable<string>, delimiter = ','): AsyncGenerator<string[]> {
  const p = new CsvParser(delimiter);
  for await (const chunk of chunks) yield* p.push(chunk);
  yield* p.end();
}

/** Decodes a byte stream (ReadableStream or async iterable) as UTF-8 text chunks. */
export async function* decodeText(body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>, encoding = 'utf-8'): AsyncGenerator<string> {
  const decoder = new TextDecoder(encoding);
  const iterable: AsyncIterable<Uint8Array> =
    Symbol.asyncIterator in body ? (body as AsyncIterable<Uint8Array>) : readableToIterable(body as ReadableStream<Uint8Array>);
  for await (const chunk of iterable) yield decoder.decode(chunk, { stream: true });
  const tail = decoder.decode();
  if (tail) yield tail;
}

async function* readableToIterable(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Escapes one cell. Text starting with = + - @ (or tab/CR) is prefixed with ' so spreadsheets never run it. */
export function csvCell(value: string | number | boolean | null | undefined, opts: { numeric?: boolean } = {}): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (!opts.numeric && typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header.join(','), ...rows.map((r) => r.join(','))].join('\r\n') + '\r\n';
}
