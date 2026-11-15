/**
 * Generate the app icons (forest-green tile with tally strokes) as PNGs, with no image dependencies.
 * Usage: pnpm exec tsx scripts/make-icons.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const BG = [0x24, 0x56, 0x3f];
const BARS = [0xff, 0xfd, 0xf8]; // off-white strokes
const SLASH = [0x9f, 0xd8, 0xb1]; // mint slash

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** Coverage (0..1) of a thick rounded line segment at a pixel centre, with ~1px anti-aliasing. */
function segmentCoverage(px: number, py: number, x0: number, y0: number, x1: number, y1: number, width: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)));
  const d = Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
  return Math.max(0, Math.min(1, width / 2 - d + 0.5));
}

function png(size: number, opts: { rounded: boolean; glyphScale: number }): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = opts.rounded ? size * 0.22 : 0;
  const g = opts.glyphScale;
  const c = size / 2;
  const at = (u: number) => c + (u - 0.5) * size * g;
  const w = 0.075 * size * g;
  // Four tally strokes and the diagonal slash that closes the "five".
  const bars = [0.26, 0.4, 0.54, 0.68].map((u) => [at(u), at(0.24), at(u), at(0.76)] as const);
  const slash = [at(0.17), at(0.66), at(0.8), at(0.34)] as const;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let alpha = 1;
      if (r > 0) {
        const dx = Math.max(r - (x + 0.5), x + 0.5 - (size - r), 0);
        const dy = Math.max(r - (y + 0.5), y + 0.5 - (size - r), 0);
        alpha = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(dx, dy)));
      }
      const px = x + 0.5;
      const py = y + 0.5;
      const barCov = Math.max(...bars.map(([x0, y0, x1, y1]) => segmentCoverage(px, py, x0, y0, x1, y1, w)));
      const slashCov = segmentCoverage(px, py, slash[0], slash[1], slash[2], slash[3], w);
      let col = BG.map((v) => v);
      col = col.map((v, i) => v * (1 - barCov) + BARS[i]! * barCov);
      col = col.map((v, i) => v * (1 - slashCov) + SLASH[i]! * slashCov);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round(col[0]!);
      raw[o + 1] = Math.round(col[1]!);
      raw[o + 2] = Math.round(col[2]!);
      raw[o + 3] = Math.round(alpha * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, { rounded: true, glyphScale: 1 }));
writeFileSync("public/icons/icon-512.png", png(512, { rounded: true, glyphScale: 1 }));
// Maskable: full-bleed tile, glyph inside the 80% safe zone.
writeFileSync("public/icons/maskable-512.png", png(512, { rounded: false, glyphScale: 0.8 }));
writeFileSync("src/app/apple-icon.png", png(180, { rounded: false, glyphScale: 0.9 }));
writeFileSync("src/app/icon.png", png(64, { rounded: true, glyphScale: 1 }));
console.log("Icons written.");
