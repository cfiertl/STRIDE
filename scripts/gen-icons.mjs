import sharp from "sharp";
import { writeFile } from "node:fs/promises";

// STRIDE mark: three diagonal "stride" bars cascading down-right, in the Court
// palette — white on cobalt.
//
// The palette is the way round it is on purpose. A near-white tile with a small
// mark reads as washed out on a home screen, sitting next to saturated app
// icons, and the icon is the one place the brand colour has to carry itself
// with no type or UI around it to do the work.
const BG = "#2451ff";
const FG = "#ffffff";

// Stroke width in the 512 box. The old 46 (9% of the canvas) held up at 512 and
// turned to mush everywhere small: a 9% diagonal lands on barely two pixels at
// favicon size, and antialiasing does the rest.
const STROKE = 62;

// How much of the canvas the mark fills, per variant. This is the whole reason
// there are two files rather than one.
//
// A *standard* icon is only corner-rounded, so it can run large and should —
// at MASKABLE scale it looks lost in dead space. A *maskable* icon is cropped
// and then zoomed to fill the launcher's mask, so its content has to sit well
// inside that or the round caps get shaved. Shipping one file for both, which
// this did byte for byte, means picking which of those two ways to be wrong.
//
// MASKABLE is sized to the *tighter* of the two published safe zones. The
// maskable spec promises a circle of 80% diameter, which would allow 1.07, but
// Android's adaptive-icon viewport is 72dp of a 108dp canvas — 66.7%, radius
// 170.7 — and real launchers do apply that full 1.5x zoom. The mark's outer
// radius unscaled is 191 (the bottom-right cap), so 170.7/191 = 0.893 is the
// ceiling. Sizing down costs nothing: the launcher scales it straight back up.
const STANDARD = 1.16;
const MASKABLE = 0.88;

const svg = (size, scale) => `<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="${BG}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)"
     stroke="${FG}" stroke-width="${STROKE}" stroke-linecap="round">
    <line x1="145" y1="202" x2="215" y2="118"/>
    <line x1="207" y1="308" x2="303" y2="192"/>
    <line x1="287" y1="413" x2="383" y2="297"/>
  </g>
</svg>`;

const targets = [
  ["public/icon-192.png", 192, STANDARD],
  ["public/icon-384.png", 384, STANDARD],
  ["public/icon-512.png", 512, STANDARD],
  ["public/icon-512-maskable.png", 512, MASKABLE],
  ["src/app/icon.png", 512, STANDARD],
  // Apple tops out at 180 and downscales anything larger itself. Handing it the
  // exact size keeps the resampling here, where it's supersampled from vector.
  ["src/app/apple-icon.png", 180, STANDARD],
];

for (const [path, size, scale] of targets) {
  const png = await sharp(Buffer.from(svg(size, scale)), { density: 384 })
    .resize(size, size)
    .png()
    .toBuffer();
  await writeFile(path, png);
  console.log("wrote", path, `${size}px`, `scale ${scale}`);
}
