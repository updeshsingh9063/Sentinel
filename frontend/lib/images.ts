import fs from "node:fs";
import path from "node:path";

/**
 * Image slots.
 *
 * Four photographs carry the site. Each declares what it must show and its
 * own alt text, so alt is never an afterthought at the call site.
 *
 * Drop a file at frontend/public/img/<slot>.jpg and it appears. Until then the
 * section renders a designed stand-in and the layout does not shift.
 * Generation prompts for every asset are in docs/PROMPTS.md.
 *
 * These are only used from server components — `hasImage` touches the
 * filesystem, so never import this file from a "use client" module.
 */

export type Slot = "hero" | "impact" | "closing" | "signin" | "checkin";

export interface ImageSlot {
  slot: Slot;
  intent: string;
  alt: string;
  /** Where the crop holds when the frame is a different shape to the file. */
  objectPosition: string;
}

export const SLOTS: Record<Slot, ImageSlot> = {
  hero: {
    slot: "hero",
    intent:
      "An older Indian man seated in a bright, plant-filled living room with a cup of tea, a care worker resting a hand on his shoulder — warm daylight, lived-in home, no clinical setting",
    alt: "An older man sitting with a cup of tea in his living room while a care worker rests a hand on his shoulder",
    objectPosition: "56% 42%",
  },
  impact: {
    slot: "impact",
    intent:
      "An older couple seen from behind, sitting together outdoors at golden hour by water, warm low sun",
    alt: "An older couple sitting together outdoors at sunset, seen from behind",
    objectPosition: "60% 50%",
  },
  signin: {
    slot: "signin",
    intent:
      "An older Indian man in a kurta with a cup of tea, a younger family member leaning in beside him — a home, not a clinic; upright enough to fill half a screen",
    alt: "An older man with a cup of tea at home, a younger family member leaning in beside him",
    objectPosition: "50% 38%",
  },
  checkin: {
    slot: "checkin",
    intent:
      "An empty, sunlit sitting room — armchair, window, plants — with a wide bare wall through the middle. Deliberately has NOBODY in it: this sits behind the check-in card, and a face behind large type is a face competing with it",
    alt: "",
    // Pulled left of centre. At 50% a narrow screen crops to the bare middle
    // of the wall and the room disappears entirely — the window and the
    // armchair, which are the only reason to use this picture, sit off to one
    // side. This keeps them in frame while the card still lands on plain wall.
    objectPosition: "32% 58%",
  },
  closing: {
    slot: "closing",
    intent:
      "A care worker holding an older person's hand and meeting their eyes, seated in a sunlit home, unhurried and unsentimental",
    alt: "A care worker holding an older person's hand and looking at them while they talk",
    objectPosition: "45% 45%",
  },
};

export function slotSrc(slot: Slot): string {
  return `/img/${slot}.jpg`;
}

/**
 * Existence checks against /public. Server only.
 *
 * The result is cached in production, where the file set cannot change while
 * the server runs, and deliberately NOT cached in development — otherwise
 * dropping a new asset in requires restarting the dev server, and "put the
 * file there and it appears" stops being true at the moment someone tries it.
 */
const cache = new Map<string, boolean>();
const shouldCache = process.env.NODE_ENV === "production";

function exists(key: string, ...segments: string[]): boolean {
  if (shouldCache) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
  }
  let ok = false;
  try {
    ok = fs.existsSync(path.join(process.cwd(), "public", ...segments));
  } catch {
    ok = false;
  }
  if (shouldCache) cache.set(key, ok);
  return ok;
}

export function hasImage(slot: Slot): boolean {
  return exists(`img:${slot}`, "img", `${slot}.jpg`);
}

/**
 * Same check for /public/video/<name>.mp4. A section that has both a video and
 * a still prefers the video and keeps the still as its poster frame, so the
 * first paint is a real picture rather than a black rectangle.
 */
export function hasVideo(name: string): boolean {
  return exists(`video:${name}`, "video", `${name}.mp4`);
}
