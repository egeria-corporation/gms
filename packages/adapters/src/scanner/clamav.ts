// SPDX-License-Identifier: AGPL-3.0-only
// ClamAV scanner over clamd's TCP protocol: "zINSTREAM\0", then chunks each prefixed with a 4-byte big-endian
// length, terminated by a zero-length chunk. Replies are "stream: OK" or "stream: <signature> FOUND".
import { Socket } from 'node:net';
import type { Scanner, ScanResult } from '../types';

export class ScannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScannerError';
  }
}

export interface ClamAvOptions {
  host: string;
  port?: number;
  timeoutMs?: number;
  chunkSize?: number;
}

/** Parses "host", "host:port", "[::1]:3310" (default port 3310). */
export function parseClamAvHost(value: string): { host: string; port: number } {
  const v = value.trim();
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(v);
  if (v6) return { host: v6[1]!, port: v6[2] ? Number(v6[2]) : 3310 };
  const idx = v.lastIndexOf(':');
  if (idx > 0 && v.indexOf(':') === idx) {
    const port = Number(v.slice(idx + 1));
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new ScannerError(`invalid CLAMAV_HOST port: ${value}`);
    return { host: v.slice(0, idx), port };
  }
  return { host: v, port: 3310 };
}

export function parseClamAvReply(reply: string): ScanResult {
  const text = reply.replace(/\0/g, '').trim();
  if (/^(stream|instream\(.*\)):\s*OK$/i.test(text) || /:\s*OK$/.test(text)) return { status: 'clean' };
  const found = /:\s*(.+?)\s+FOUND$/.exec(text);
  if (found) return { status: 'infected', signature: found[1]! };
  throw new ScannerError(`clamd error: ${text.slice(0, 200) || 'empty reply'}`);
}

export class ClamAvScanner implements Scanner {
  readonly name = 'clamav' as const;
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly chunkSize: number;

  constructor(opts: ClamAvOptions) {
    this.host = opts.host;
    this.port = opts.port ?? 3310;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.chunkSize = Math.max(1, opts.chunkSize ?? 64 * 1024);
  }

  static fromEnv(value = process.env.CLAMAV_HOST): ClamAvScanner {
    if (!value) throw new ScannerError('CLAMAV_HOST is not set');
    return new ClamAvScanner(parseClamAvHost(value));
  }

  scan(data: Uint8Array): Promise<ScanResult> {
    return new Promise<ScanResult>((resolve, reject) => {
      const socket = new Socket();
      const chunks: Buffer[] = [];
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        fn();
      };
      socket.setTimeout(this.timeoutMs, () => finish(() => reject(new ScannerError(`clamd timed out after ${this.timeoutMs}ms`))));
      socket.on('error', (err) => finish(() => reject(new ScannerError(`clamd connection failed: ${err.message}`))));
      socket.on('data', (d: Buffer) => {
        chunks.push(d);
        // zINSTREAM replies are NUL-terminated.
        if (d.includes(0)) {
          const reply = Buffer.concat(chunks).toString('utf8');
          finish(() => {
            try {
              resolve(parseClamAvReply(reply));
            } catch (e) {
              reject(e);
            }
          });
        }
      });
      socket.on('end', () => {
        const reply = Buffer.concat(chunks).toString('utf8');
        finish(() => {
          try {
            resolve(parseClamAvReply(reply));
          } catch (e) {
            reject(e);
          }
        });
      });
      socket.connect(this.port, this.host, () => {
        socket.write('zINSTREAM\0');
        for (let off = 0; off < data.byteLength; off += this.chunkSize) {
          const part = data.subarray(off, Math.min(off + this.chunkSize, data.byteLength));
          const len = Buffer.alloc(4);
          len.writeUInt32BE(part.byteLength, 0);
          socket.write(len);
          socket.write(part);
        }
        socket.write(Buffer.alloc(4)); // zero-length chunk ends the stream
      });
    });
  }
}
