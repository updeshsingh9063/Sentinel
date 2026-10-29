/**
 * Turn a raw photograph into a slot image for frontend/public/img.
 *
 * Three things every source has needed so far, and the reason each exists:
 *
 *   1. TRIM. Generated stock carries a sparkle watermark in the bottom-right
 *      corner. It is small, but it is the single clearest "this is AI stock"
 *      tell on the page, so it comes off before anything else. Cropping is
 *      used rather than painting over it: a patched corner is a smudge, and a
 *      smudge is worse than a slightly shorter frame.
 *
 *   2. GRADE. The palette is forest and cream. Source photographs arrive with
 *      saturated blues and oranges that fight it. A light desaturation plus a
 *      warm soft-light wash settles them into the page without the result
 *      reading as a filter.
 *
 *   3. RESAMPLE. Sources are ~1264px wide, which is soft when a hero is
 *      full-bleed on a large display. A modest lanczos upscale with a touch of
 *      sharpening holds up better than letting the browser scale it.
 *
 * Usage:
 *   node scripts/prep-image.mjs --in "<source>" --out public/img/hero.jpg \
 *     [--trim-bottom 92] [--trim-left 0] [--width 1800] \
 *     [--grade warm|forest|none] [--quality 82]
 *
 * Run from frontend/ (npm run img:prep -- …). It lives here rather than beside
 * the assets because ESM resolves `sharp` from the script's own directory.
 */

import path from "node:path";

import sharp from "sharp";

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith("--") ? next : "true";
  }
  return out;
}

const a = args(process.argv.slice(2));
if (!a.in || !a.out) {
  console.error("need --in <source> and --out <dest>");
  process.exit(1);
}

const trimBottom = Number(a["trim-bottom"] ?? 0);
const trimLeft = Number(a["trim-left"] ?? 0);
const trimRight = Number(a["trim-right"] ?? 0);
const trimTop = Number(a["trim-top"] ?? 0);
const width = Number(a.width ?? 1800);
const quality = Number(a.quality ?? 82);
const grade = a.grade ?? "warm";

/**
 * A solid colour the size of the frame, composited in soft-light. Soft-light
 * leaves blacks and whites roughly where they are and pulls the midtones
 * toward the wash, which is what separates a grade from a tint.
 */
function wash(w, h, rgb, alpha) {
  return {
    input: {
      create: {
        width: w,
        height: h,
        channels: 4,
        background: { ...rgb, alpha },
      },
    },
    blend: "soft-light",
  };
}

const src = sharp(a.in);
const meta = await src.metadata();

const left = trimLeft;
const top = trimTop;
const w = meta.width - trimLeft - trimRight;
const h = meta.height - trimTop - trimBottom;
if (w <= 0 || h <= 0) {
  console.error(`trim leaves nothing: ${meta.width}x${meta.height} -> ${w}x${h}`);
  process.exit(1);
}

let pipe = sharp(a.in).extract({ left, top, width: w, height: h });

if (grade === "warm") {
  // Blue scrubs and orange shirts both sit a long way from forest and cream.
  // Pulling saturation back a little and washing the midtones warm brings
  // them close enough to the page that nothing jumps.
  pipe = pipe
    .modulate({ saturation: 0.9, brightness: 1.015 })
    .composite([wash(w, h, { r: 232, g: 186, b: 122 }, 0.3)])
    // Flattening to a buffer between stages keeps the composite from being
    // resized along with the base image, which would feather the wash.
    .jpeg({ quality: 100 });
  pipe = sharp(await pipe.toBuffer());
} else if (grade === "forest") {
  // For a photograph that has to sit UNDER text. Collapsing it to one hue
  // removes the local colour contrast that makes type hard to read, so the
  // image can stay at a strength where it still reads as a photograph.
  pipe = pipe.greyscale().tint({ r: 34, g: 74, b: 62 });
}

const outPath = path.resolve(a.out);
const info = await pipe
  .resize({ width, kernel: "lanczos3", withoutEnlargement: false })
  .sharpen({ sigma: 0.6 })
  .jpeg({ quality, progressive: true, mozjpeg: true, chromaSubsampling: "4:4:4" })
  .toFile(outPath);

console.log(
  `${path.basename(a.in)} ${meta.width}x${meta.height}` +
    ` -> ${path.relative(process.cwd(), outPath)} ${info.width}x${info.height}` +
    ` ${(info.size / 1024).toFixed(0)}KB (grade: ${grade})`,
);
