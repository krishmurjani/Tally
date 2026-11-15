/**
 * Generate the app icons (forest-green tile with a white "T") as PNGs, with no image dependencies.
 * Usage: pnpm exec tsx scripts/make-icons.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const BG = [0x24, 0x56, 0x3f];
const FG = [0xff, 0xfd, 0xf8];

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

function png(size: number, opts: { rounded: boolean; glyphScale: number }): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = opts.rounded ? size * 0.22 : 0;
  const g = opts.glyphScale;
  const c = size / 2;
  // "T": top bar and stem, in units of the tile, scaled around the centre
  const rects = [
    [0.28, 0.27, 0.72, 0.39],
    [0.435, 0.27, 0.565, 0.75],
  ].map(([x0, y0, x1, y1]) => [c + (x0! - 0.5) * size * g, c + (y0! - 0.5) * size * g, c + (x1! - 0.5) * size * g, c + (y1! - 0.5) * size * g]);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      // coverage of the rounded tile (cheap anti-aliasing at the corners)
      let alpha = 1;
      if (r > 0) {
        const dx = Math.max(r - (x + 0.5), x + 0.5 - (size - r), 0);
        const dy = Math.max(r - (y + 0.5), y + 0.5 - (size - r), 0);
        alpha = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(dx, dy)));
      }
      const inGlyph = rects.some(([x0, y0, x1, y1]) => x + 0.5 >= x0! && x + 0.5 <= x1! && y + 0.5 >= y0! && y + 0.5 <= y1!);
      const col = inGlyph ? FG : BG;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = col[0]!;
      raw[o + 1] = col[1]!;
      raw[o + 2] = col[2]!;
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
