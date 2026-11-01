// node scripts/make-icons.mjs
// Every app icon from one picture: design/icon/fatty-icon-source.jpg (1024 px, rounded corners,
// white outside them, orange background, the figure running off the bottom edge). Re-run after
// replacing the source.
//
// - Web: rounded icons with see-through corners (192, 512), a maskable one for Android home-screen
//   installs, the browser tab icon (app/icon.png) and the iOS one (app/apple-icon.png).
// - Android: the launcher foreground, full-bleed on the orange, the art filling exactly what
//   launchers show, so their mask trims the jeans, never the mohawk or thumbs. The launch splash
//   shows it too.

import { mkdir, rm } from 'node:fs/promises';
import sharp from 'sharp';

const SOURCE = 'design/icon/fatty-icon-source.jpg';
const SIZE = 1024;
/**
 * The source's corners, measured: white reaches 68 px in along each diagonal, so a corner radius of
 * 240 px (inset 2 px) clears it. The straight edges are orange right to the edge.
 */
const RADIUS = 240;

/**
 * Orange to fill a square around the art when it's shrunk to `scale`: the art's own border colours
 * carried straight outward (corners from just inside their curve), then softened. It matches the
 * art's background exactly, so there's no seam where the art ends.
 */
async function backdrop(size, scale, offsetX, offsetY) {
  const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(size * size * 3);
  const inner = size * scale;
  const k = SIZE / inner;
  const m = 12; // stay clear of the edge
  const r = RADIUS + 10; // and of the white corners
  const lo = m + r;
  const hi = SIZE - 1 - m - r;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let u = Math.min(SIZE - 1 - m, Math.max(m, (x - offsetX) * k));
      let v = Math.min(SIZE - 1 - m, Math.max(m, (y - offsetY) * k));
      const cx = u < lo ? lo : u > hi ? hi : null;
      const cy = v < lo ? lo : v > hi ? hi : null;
      if (cx != null && cy != null) {
        const d = Math.hypot(u - cx, v - cy);
        if (d > r) {
          u = cx + ((u - cx) * r) / d;
          v = cy + ((v - cy) * r) / d;
        }
      }
      const i = (Math.round(v) * info.width + Math.round(u)) * 3;
      const o = (y * size + x) * 3;
      out[o] = data[i];
      out[o + 1] = data[i + 1];
      out[o + 2] = data[i + 2];
    }
  }
  return sharp(out, { raw: { width: size, height: size, channels: 3 } }).blur(Math.max(1, size * 0.012));
}

/** The source with its white corners made see-through. */
async function rounded() {
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><rect x="2" y="2" width="${SIZE - 4}" height="${SIZE - 4}" rx="${RADIUS}" fill="#fff"/></svg>`,
  );
  return sharp(SOURCE).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

/**
 * A square full of orange with the art at `scale` of the side, centred or sitting on the bottom
 * edge (the figure runs off the bottom, so that's where he belongs), its edges blended into the
 * backdrop so there's no seam. For masks that crop (Android launchers, maskable icons, iOS).
 */
async function fullBleed(art, size, scale, anchor = 'centre') {
  const inner = Math.round(size * scale);
  const feather = Math.max(2, Math.round(inner * 0.012));
  const soft = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}">
      <defs><filter id="f"><feGaussianBlur stdDeviation="${feather / 2}"/></filter></defs>
      <rect x="${feather}" y="${feather}" width="${inner - 2 * feather}" height="${inner - 2 * feather}" rx="${Math.round((RADIUS * inner) / SIZE)}" fill="#fff" filter="url(#f)"/>
    </svg>`,
  );
  const piece = await sharp(art).resize(inner, inner).composite([{ input: soft, blend: 'dest-in' }]).png().toBuffer();
  const left = Math.round((size - inner) / 2);
  const top = anchor === 'bottom' ? size - inner : left;
  return (await backdrop(size, inner / size, left, top)).composite([{ input: piece, left, top }]).png().toBuffer();
}

async function main() {
  const art = await rounded();
  const out = (buf, file, size) => sharp(buf).resize(size, size).png({ compressionLevel: 9 }).toFile(file);

  // Web app and browser tab.
  await out(art, 'public/icon-512.png', 512);
  await out(art, 'public/icon-192.png', 192);
  await out(art, 'app/icon.png', 64);
  // Maskable: what matters (mohawk, thumbs) must sit inside the middle 80% circle. The thumbs are
  // 47% of the art's width from its centre, so the art goes in at 84%, on the bottom edge.
  await out(await fullBleed(art, SIZE, 0.84, 'bottom'), 'public/icon-maskable-512.png', 512);
  // iOS rounds the corners itself and wants no transparency: the art fills it, corners filled in.
  await out(await fullBleed(art, SIZE, 1), 'app/apple-icon.png', 180);

  // Android adaptive icon foreground: a 108 dp canvas, of which launchers show the middle 72 dp
  // through their mask. The art fills those 72 dp (two thirds), so a round mask keeps the mohawk
  // and thumbs and trims only the jeans. 432 px is 108 dp at xxxhdpi.
  await mkdir('android/app/src/main/res/drawable-nodpi', { recursive: true });
  await out(await fullBleed(art, SIZE, 2 / 3), 'android/app/src/main/res/drawable-nodpi/ic_launcher_foreground.png', 432);

  await rm('public/icon.svg', { force: true });
  await rm('app/icon.svg', { force: true });
  console.log('Icons written.');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
