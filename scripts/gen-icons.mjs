import sharp from "sharp";
import { writeFile } from "node:fs/promises";

// STRIDE mark: three diagonal "stride" bars (cascading down-right), recolored
// to the Court palette — cobalt #2451ff on near-white #f6f7fb. Mirrors the old
// lime-on-black motif. Content stays inside the maskable safe zone.
const BG = "#f6f7fb";
const FG = "#2451ff";

const svg = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="${BG}"/>
  <g stroke="${FG}" stroke-width="46" stroke-linecap="round">
    <line x1="145" y1="202" x2="215" y2="118"/>
    <line x1="207" y1="308" x2="303" y2="192"/>
    <line x1="287" y1="413" x2="383" y2="297"/>
  </g>
</svg>`;

const buf = (size) => Buffer.from(svg(size));

const targets = [
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["public/icon-512-maskable.png", 512],
  ["src/app/icon.png", 512],
  ["src/app/apple-icon.png", 512],
];

for (const [path, size] of targets) {
  const png = await sharp(buf(size), { density: 384 }).resize(size, size).png().toBuffer();
  await writeFile(path, png);
  console.log("wrote", path, size);
}
