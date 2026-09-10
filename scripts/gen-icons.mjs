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

// Stroke width in the 512 box. At the old 46 — 9% of the canvas — a diagonal
// lands on barely two pixels at favicon size and antialiasing eats it.
const STROKE = 62;

// Mark geometry, constructed rather than hand-placed.
//
// The original coordinates were laid out by eye and were not regular: the top
// bar measured 109 units against 151 for the other two, the gaps between bar
// centres were 117 and 132, and the cascade drifted from 50.2° to 52.7°. None
// of that reads as an accent at icon size — it reads as a wonky mark, and no
// amount of rescaling fixes it, because scaling preserves the irregularity.
//
// So the three bars are now derived: equal length, leaning up-right at ANGLE,
// stepping down-right by an equal offset. The step leans at the same angle
// mirrored about the horizontal, which is the symmetry the original was
// reaching for and missing.
const ANGLE = 51; // degrees above horizontal
const BAR = 150;  // centreline length; the round caps add STROKE on top
const STEP = 125; // centre-to-centre offset between neighbouring bars

const C = 256; // canvas centre, in the 512 box
const rad = (ANGLE * Math.PI) / 180;
const along = [Math.cos(rad), -Math.sin(rad)]; // bar direction, up-right
const step = [Math.cos(rad), Math.sin(rad)];   // cascade direction, down-right

const bars = [-1, 0, 1].map((i) => {
  const cx = C + i * STEP * step[0];
  const cy = C + i * STEP * step[1];
  return {
    x1: cx - (BAR / 2) * along[0], y1: cy - (BAR / 2) * along[1],
    x2: cx + (BAR / 2) * along[0], y2: cy + (BAR / 2) * along[1],
  };
});

// Outer radius of any painted pixel, measured from the canvas centre. Derived
// rather than eyeballed so that changing ANGLE, BAR or STEP can't silently
// push the mark outside the maskable crop without anyone noticing.
const outerRadius = Math.max(
  ...bars.flatMap((b) => [Math.hypot(b.x1 - C, b.y1 - C), Math.hypot(b.x2 - C, b.y2 - C)])
) + STROKE / 2;

// How much of the canvas the mark fills, per variant — the reason there are two
// files rather than one.
//
// A standard icon is only corner-rounded, so it can run large and should; at
// maskable scale it looks lost in dead space. A maskable icon is cropped by the
// launcher and zoomed to fill the mask, so its content has to sit inside that
// crop or the round caps get shaved. Shipping one file for both, which this did
// byte for byte, means choosing which of the two ways to be wrong.
//
// The maskable bound is the tighter of the two published safe zones. The
// maskable spec promises a circle of 80% diameter, but Android's adaptive-icon
// viewport is 72dp of a 108dp canvas — 66.7% — and real launchers apply that
// full 1.5x zoom. Sizing down costs nothing: the launcher scales it back up.
// Radius of the region a launcher guarantees to show, in the 512 box.
const MASKABLE_VISIBLE_R = (512 * (2 / 3)) / 2;
// Filling that circle to its edge is inside the crop but looks cramped, and
// leaves nothing for the launchers whose mask is tighter than a plain circle.
// 80% of it is the mark sitting in the tile rather than straining against it.
const MASKABLE_FILL = 0.8;

const STANDARD = +(220 / outerRadius).toFixed(3); // 220 of 256 leaves an optical margin
const MASKABLE = +((MASKABLE_VISIBLE_R * MASKABLE_FILL) / outerRadius).toFixed(3);

const n = (v) => v.toFixed(1);
const svg = (size, scale) => `<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="${BG}"/>
  <g transform="translate(${C} ${C}) scale(${scale}) translate(-${C} -${C})"
     stroke="${FG}" stroke-width="${STROKE}" stroke-linecap="round">
${bars.map((b) => `    <line x1="${n(b.x1)}" y1="${n(b.y1)}" x2="${n(b.x2)}" y2="${n(b.y2)}"/>`).join("\n")}
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

console.log(`outer radius ${outerRadius.toFixed(1)} -> standard ${STANDARD}, maskable ${MASKABLE}`);
for (const [path, size, scale] of targets) {
  const png = await sharp(Buffer.from(svg(size, scale)), { density: 384 })
    .resize(size, size)
    .png()
    .toBuffer();
  await writeFile(path, png);
  console.log("wrote", path, `${size}px`, `scale ${scale}`);
}
