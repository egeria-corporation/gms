// SPDX-License-Identifier: AGPL-3.0-only
// PNG in and out for the share cards, with the platform's own zlib (CompressionStream, which
// Workers, browsers and Node all have): RGB out, 8-bit RGB or RGBA in.
import type { Rgba } from "./raster.ts";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function through(data: Uint8Array<ArrayBuffer>, stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> }): Promise<Uint8Array<ArrayBuffer>> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  return new Uint8Array(await new Response(source.pipeThrough(stream)).arrayBuffer());
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Encodes RGB pixels (3 bytes a pixel, rows top to bottom) as a PNG. */
export async function encodePng(rgb: Uint8Array, width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
  // Every row uses the Sub filter: flat backgrounds become runs of zeros, which compress well.
  const rowBytes = width * 3;
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const src = y * rowBytes;
    const dst = y * (rowBytes + 1);
    raw[dst] = 1;
    for (let i = 0; i < rowBytes; i++) raw[dst + 1 + i] = rgb[src + i]! - (i >= 3 ? rgb[src + i - 3]! : 0);
  }
  const idat = await through(raw, new CompressionStream("deflate"));
  const chunks: [string, Uint8Array][] = [];
  const ihdr = new Uint8Array(13);
  const h = new DataView(ihdr.buffer);
  h.setUint32(0, width);
  h.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  chunks.push(["IHDR", ihdr], ["IDAT", idat], ["IEND", new Uint8Array(0)]);
  const out = new Uint8Array(8 + chunks.reduce((n, [, d]) => n + 12 + d.length, 0));
  out.set(SIGNATURE, 0);
  const view = new DataView(out.buffer);
  let p = 8;
  for (const [type, data] of chunks) {
    view.setUint32(p, data.length);
    for (let i = 0; i < 4; i++) out[p + 4 + i] = type.charCodeAt(i);
    out.set(data, p + 8);
    view.setUint32(p + 8 + data.length, crc32(out, p + 4, p + 8 + data.length));
    p += 12 + data.length;
  }
  return out;
}

/** Width and height from a PNG's header; null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG (the bundled brand images) to RGBA. */
export async function decodePng(bytes: Uint8Array): Promise<Rgba> {
  const size = pngSize(bytes);
  if (!size) throw new Error("Not a PNG");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const [depth, colour, interlace] = [bytes[24], bytes[25], bytes[28]];
  if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) throw new Error("Unsupported PNG");
  const parts: Uint8Array[] = [];
  for (let p = 8; p + 8 <= bytes.length; ) {
    const length = v.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    if (type === "IDAT") parts.push(bytes.subarray(p + 8, p + 8 + length));
    if (type === "IEND") break;
    p += 12 + length;
  }
  const joined = new Uint8Array(parts.reduce((n, d) => n + d.length, 0));
  parts.reduce((at, d) => (joined.set(d, at), at + d.length), 0);
  const raw = await through(joined, new DecompressionStream("deflate"));
  const bpp = colour === 6 ? 4 : 3;
  const { width, height } = size;
  const rowBytes = width * bpp;
  const cur = new Uint8Array(rowBytes);
  let prev = new Uint8Array(rowBytes);
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const at = y * (rowBytes + 1);
    const filter = raw[at];
    for (let i = 0; i < rowBytes; i++) {
      const x = raw[at + 1 + i]!;
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let value = x;
      if (filter === 1) value = x + a;
      else if (filter === 2) value = x + b;
      else if (filter === 3) value = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[i] = value;
    }
    for (let px = 0; px < width; px++) {
      const o = (y * width + px) * 4;
      pixels[o] = cur[px * bpp]!;
      pixels[o + 1] = cur[px * bpp + 1]!;
      pixels[o + 2] = cur[px * bpp + 2]!;
      pixels[o + 3] = bpp === 4 ? cur[px * bpp + 3]! : 255;
    }
    prev = Uint8Array.from(cur);
  }
  return { width, height, pixels };
}
