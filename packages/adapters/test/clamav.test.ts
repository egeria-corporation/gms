// SPDX-License-Identifier: AGPL-3.0-or-later
// ClamAV INSTREAM against a tiny fake clamd TCP server.
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ClamAvScanner, parseClamAvHost, parseClamAvReply, ScannerError } from '../src/scanner/clamav';

const EICAR_MARKER = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE';

interface FakeClamd {
  server: Server;
  port: number;
  received: { command: string; chunks: number[]; payload: Buffer }[];
}

/** Parses zINSTREAM framing exactly like clamd and replies based on the payload. */
function startFakeClamd(mode: 'normal' | 'silent' | 'error' = 'normal'): Promise<FakeClamd> {
  const received: FakeClamd['received'] = [];
  const server = createServer((socket: Socket) => {
    let buf = Buffer.alloc(0);
    let command: string | null = null;
    const chunks: number[] = [];
    const parts: Buffer[] = [];
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (command === null) {
        const nul = buf.indexOf(0);
        if (nul < 0) return;
        command = buf.subarray(0, nul).toString();
        buf = buf.subarray(nul + 1);
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          const payload = Buffer.concat(parts);
          received.push({ command, chunks, payload });
          if (mode === 'silent') return;
          if (mode === 'error') socket.end('INSTREAM size limit exceeded. ERROR\0');
          else if (payload.includes(EICAR_MARKER)) socket.end('stream: Eicar-Test-Signature FOUND\0');
          else socket.end('stream: OK\0');
          buf = Buffer.alloc(0);
          return;
        }
        if (buf.length < 4 + len) return;
        chunks.push(len);
        parts.push(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port, received })));
}

let current: FakeClamd | null = null;
afterEach(async () => {
  if (current) await new Promise((r) => current!.server.close(r));
  current = null;
});

describe('ClamAvScanner', () => {
  it('streams chunks with 4-byte big-endian lengths and reports clean files', async () => {
    current = await startFakeClamd();
    const scanner = new ClamAvScanner({ host: '127.0.0.1', port: current.port, chunkSize: 4 });
    const data = new TextEncoder().encode('hello budget.pdf');
    expect(await scanner.scan(data)).toEqual({ status: 'clean' });
    expect(current.received[0]!.command).toBe('zINSTREAM');
    expect(current.received[0]!.chunks).toEqual([4, 4, 4, 4]);
    expect(current.received[0]!.payload.toString()).toBe('hello budget.pdf');
  });

  it('reports infected files with the signature', async () => {
    current = await startFakeClamd();
    const scanner = new ClamAvScanner({ host: '127.0.0.1', port: current.port });
    expect(await scanner.scan(new TextEncoder().encode(`X5O!P%@AP ${EICAR_MARKER}`))).toEqual({ status: 'infected', signature: 'Eicar-Test-Signature' });
  });

  it('scans empty files', async () => {
    current = await startFakeClamd();
    expect(await new ClamAvScanner({ host: '127.0.0.1', port: current.port }).scan(new Uint8Array())).toEqual({ status: 'clean' });
  });

  it('times out when clamd does not answer', async () => {
    current = await startFakeClamd('silent');
    const scanner = new ClamAvScanner({ host: '127.0.0.1', port: current.port, timeoutMs: 200 });
    await expect(scanner.scan(new Uint8Array([1]))).rejects.toThrow(/timed out/);
  });

  it('surfaces clamd errors and connection failures', async () => {
    current = await startFakeClamd('error');
    await expect(new ClamAvScanner({ host: '127.0.0.1', port: current.port }).scan(new Uint8Array([1]))).rejects.toBeInstanceOf(ScannerError);
    await expect(new ClamAvScanner({ host: '127.0.0.1', port: 1, timeoutMs: 1000 }).scan(new Uint8Array([1]))).rejects.toThrow(ScannerError);
  });

  it('parses CLAMAV_HOST and replies', () => {
    expect(parseClamAvHost('clamd')).toEqual({ host: 'clamd', port: 3310 });
    expect(parseClamAvHost('clamd.internal:3311')).toEqual({ host: 'clamd.internal', port: 3311 });
    expect(parseClamAvHost('[::1]:3312')).toEqual({ host: '::1', port: 3312 });
    expect(() => parseClamAvHost('x:99999')).toThrow();
    expect(parseClamAvReply('stream: OK\0')).toEqual({ status: 'clean' });
    expect(() => parseClamAvReply('')).toThrow(ScannerError);
    expect(() => ClamAvScanner.fromEnv('')).toThrow();
  });
});
