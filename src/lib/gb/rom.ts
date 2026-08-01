/**
 * Generic Game Boy ROM helpers: header fields and the two cartridge checksums.
 *
 * Both algorithms are from Pandocs and were verified against the stock
 * amenizer.gb, which stores 0x8c / 0x8474 — exactly what these produce.
 */

export const HEADER_TITLE = 0x0134;
export const HEADER_TITLE_LEN = 16;
export const HEADER_CHECKSUM = 0x014d;
export const GLOBAL_CHECKSUM = 0x014e;

/** Running `x = x - byte - 1` over 0x0134..0x014C. */
export function headerChecksum(rom: Uint8Array): number {
  let x = 0;
  for (let i = 0x0134; i <= 0x014c; i++) x = (x - rom[i] - 1) & 0xff;
  return x;
}

/** 16-bit sum of every byte except the two global-checksum bytes themselves. */
export function globalChecksum(rom: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < rom.length; i++) {
    if (i === GLOBAL_CHECKSUM || i === GLOBAL_CHECKSUM + 1) continue;
    sum += rom[i];
  }
  return sum & 0xffff;
}

/** Recompute and write both checksums in place. Big-endian for the global one. */
export function fixChecksums(rom: Uint8Array): void {
  rom[HEADER_CHECKSUM] = headerChecksum(rom);
  const g = globalChecksum(rom);
  rom[GLOBAL_CHECKSUM] = (g >> 8) & 0xff;
  rom[GLOBAL_CHECKSUM + 1] = g & 0xff;
}

export function readTitle(rom: Uint8Array): string {
  const bytes = rom.subarray(HEADER_TITLE, HEADER_TITLE + HEADER_TITLE_LEN);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder('ascii').decode(bytes.subarray(0, end));
}

/**
 * MD5, because that is how the notes (and the homebrew scene generally)
 * identify Amenizer builds. SubtleCrypto does not offer MD5, so it is here.
 */
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = new Uint32Array(
  Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32)),
);

export function md5Hex(data: Uint8Array): string {
  const bitLen = data.length * 8;
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  new DataView(padded.buffer).setUint32(padded.length - 8, bitLen >>> 0, true);
  new DataView(padded.buffer).setUint32(padded.length - 4, Math.floor(bitLen / 2 ** 32), true);

  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const view = new DataView(padded.buffer);
  const m = new Uint32Array(16);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(off + i * 4, true);
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      f = (f + a + MD5_K[i] + m[g]) >>> 0;
      a = d; d = c; c = b;
      const s = MD5_S[i];
      b = (b + (((f << s) | (f >>> (32 - s))) >>> 0)) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  new DataView(out.buffer).setUint32(0, a0, true);
  new DataView(out.buffer).setUint32(4, b0, true);
  new DataView(out.buffer).setUint32(8, c0, true);
  new DataView(out.buffer).setUint32(12, d0, true);
  return [...out].map((b) => b.toString(16).padStart(2, '0')).join('');
}
