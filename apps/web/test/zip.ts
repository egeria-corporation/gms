// SPDX-License-Identifier: AGPL-3.0-only
// A minimal zip writer for tests (stored, no compression): enough to stand in for a grants
// system's zip of PDFs. The import screen reads it with the real reader (@gms/importers/zip).
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

export function makeZip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  const u16 = (a: number[], v: number) => a.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (a: number[], v: number) => a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  let count = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = enc.encode(path);
    const data = enc.encode(text);
    const crc = crc32(data);
    const offset = local.length;
    u32(local, 0x04034b50);
    for (const v of [20, 0x0800, 0, 0, 0x21]) u16(local, v);
    u32(local, crc);
    u32(local, data.length);
    u32(local, data.length);
    u16(local, name.length);
    u16(local, 0);
    local.push(...name, ...data);
    u32(central, 0x02014b50);
    for (const v of [20, 20, 0x0800, 0, 0, 0x21]) u16(central, v);
    u32(central, crc);
    u32(central, data.length);
    u32(central, data.length);
    for (const v of [name.length, 0, 0, 0, 0]) u16(central, v);
    u32(central, 0);
    u32(central, offset);
    central.push(...name);
    count++;
  }
  const end: number[] = [];
  u32(end, 0x06054b50);
  for (const v of [0, 0, count, count]) u16(end, v);
  u32(end, central.length);
  u32(end, local.length);
  u16(end, 0);
  return new Uint8Array([...local, ...central, ...end]);
}
