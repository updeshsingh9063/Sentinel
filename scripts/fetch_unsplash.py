"""Fill the frontend image slots from Unsplash.

WHY THIS NEEDS A KEY
Unsplash blocks unauthenticated server-side access -- its search page is
client-rendered and its internal JSON endpoint rejects non-browser clients. So
photography could not be bundled with the scaffold without inventing photo IDs
that would 404. Instead every image is a named slot (frontend/lib/images.ts)
that renders a designed placeholder until a real file arrives.

GET A KEY (about two minutes, free)
  1. unsplash.com/developers -> Register as a developer
  2. New Application -> accept the terms -> copy the Access Key
  3. python scripts/fetch_unsplash.py --key <access-key>

Demo tier allows 50 requests/hour, which is ample: there are seven slots.

LICENCE
The Unsplash Licence permits commercial use and does not require attribution.
We record the photographer anyway, into datasets/MANIFEST.json, because the
brief asks for every asset to be cited.

Run:
    python scripts/fetch_unsplash.py --key KEY            # all empty slots
    python scripts/fetch_unsplash.py --key KEY --force    # refetch everything
    python scripts/fetch_unsplash.py --list               # show slots, no key
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMG_DIR = ROOT / "frontend" / "public" / "img"
SLOTS_TS = ROOT / "frontend" / "lib" / "images.ts"
MANIFEST = ROOT / "datasets" / "MANIFEST.json"

API = "https://api.unsplash.com/search/photos"
UA = {"User-Agent": "samarth-sentinel-image-fetcher/1.0"}


def log(msg: str) -> None:
    print(msg, flush=True)


def read_slots() -> dict[str, dict[str, str]]:
    """Parse the slot registry so the search terms live in exactly one place.

    Keeping intents in the TypeScript file means the frontend and this script
    cannot drift; a regex is enough and avoids a node dependency here.
    """
    src = SLOTS_TS.read_text(encoding="utf-8")
    block = re.search(r"export const SLOTS[^=]*=\s*\{(.*?)\n\};", src, re.S)
    if not block:
        raise SystemExit("could not find SLOTS in " + str(SLOTS_TS))

    slots: dict[str, dict[str, str]] = {}
    for entry in re.finditer(
        r'slot:\s*"([^"]+)",\s*\n\s*(?:/\*\*.*?\*/\s*\n\s*)?'
        r'intent:\s*\n?\s*"([^"]+)",\s*\n\s*(?:/\*\*.*?\*/\s*\n\s*)?'
        r'alt:\s*"([^"]+)",\s*\n\s*aspect:\s*"([^"]+)"',
        block.group(1),
        re.S,
    ):
        slot, intent, alt, aspect = entry.groups()
        slots[slot] = {"intent": intent, "alt": alt, "aspect": aspect}
    return slots


ORIENTATION = {
    "square": "squarish",
    "portrait": "portrait",
    "landscape": "landscape",
    "wide": "landscape",
}


def search(term: str, orientation: str, key: str) -> dict | None:
    url = "{}?{}".format(
        API,
        urllib.parse.urlencode(
            {"query": term, "per_page": 1, "orientation": orientation,
             "content_filter": "high"}
        ),
    )
    req = urllib.request.Request(url, headers={**UA, "Authorization": "Client-ID " + key})
    with urllib.request.urlopen(req, timeout=45) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    results = data.get("results") or []
    return results[0] if results else None


def download(url: str, dest: Path) -> int:
    req = urllib.request.Request(url, headers=UA)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    with urllib.request.urlopen(req, timeout=120) as resp, tmp.open("wb") as out:
        while chunk := resp.read(1 << 16):
            out.write(chunk)
    # A JPEG starts FFD8FF. Guards against an error page being saved as .jpg.
    with tmp.open("rb") as fh:
        if fh.read(3) != b"\xff\xd8\xff":
            tmp.unlink(missing_ok=True)
            raise RuntimeError("downloaded file is not a JPEG")
    tmp.replace(dest)
    return dest.stat().st_size


def record(entries: list[dict]) -> None:
    """Append photo credits to the dataset manifest, merging with what is there."""
    if not MANIFEST.exists():
        log("  (no MANIFEST.json; skipping credit record)")
        return
    doc = json.loads(MANIFEST.read_text(encoding="utf-8"))
    merged = {e["name"]: e for e in doc.get("datasets", [])}
    for e in entries:
        merged[e["name"]] = e
    doc["datasets"] = sorted(merged.values(), key=lambda e: e["name"])
    MANIFEST.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    log("  credits recorded in datasets/MANIFEST.json")


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--key", help="Unsplash Access Key")
    ap.add_argument("--force", action="store_true", help="refetch slots that already have a file")
    ap.add_argument("--list", action="store_true", help="show the slots and exit")
    args = ap.parse_args()

    slots = read_slots()

    if args.list:
        log("{} image slots:\n".format(len(slots)))
        for name, meta in slots.items():
            have = (IMG_DIR / (name + ".jpg")).exists()
            log("  [{}] {:<16} {:<10} {}".format(
                "x" if have else " ", name, meta["aspect"], meta["intent"]))
        log("\nFill them with --key, or drop files into frontend/public/img/<slot>.jpg")
        return 0

    if not args.key:
        ap.error("--key is required (get one free at unsplash.com/developers), "
                 "or use --list")

    credits: list[dict] = []
    for name, meta in slots.items():
        dest = IMG_DIR / (name + ".jpg")
        if dest.exists() and not args.force:
            log("  skip    {} (already present)".format(name))
            continue

        orientation = ORIENTATION.get(meta["aspect"], "landscape")
        try:
            photo = search(meta["intent"], orientation, args.key)
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                raise SystemExit("Unsplash rejected the key (401). Check --key.")
            if exc.code == 403:
                raise SystemExit("Rate limit or permission denied (403). "
                                 "Demo tier allows 50 requests/hour.")
            log("  error   {} HTTP {}".format(name, exc.code))
            continue
        except Exception as exc:
            log("  error   {} {}".format(name, exc))
            continue

        if not photo:
            log("  none    {} (no result for: {})".format(name, meta["intent"]))
            continue

        src = (photo.get("urls") or {}).get("regular")
        if not src:
            log("  none    {} (no image url)".format(name))
            continue

        try:
            size = download(src, dest)
        except Exception as exc:
            log("  error   {} {}".format(name, exc))
            continue

        who = ((photo.get("user") or {}).get("name")) or "unknown"
        link = ((photo.get("links") or {}).get("html")) or ""
        log("  got     {:<16} {:>8,} bytes  by {}".format(name, size, who))

        credits.append({
            "name": "Image: {}".format(name),
            "description": "{} (Unsplash photo {})".format(meta["intent"], photo.get("id")),
            "url": link,
            "path": "frontend/public/img/{}.jpg".format(name),
            "license": "Unsplash Licence (commercial use permitted, attribution not required)",
            "citation": "Photograph by {} on Unsplash, accessed {}.".format(
                who, date.today().isoformat()),
        })

    if credits:
        record(credits)
    log("\ndone")
    return 0


if __name__ == "__main__":
    sys.exit(main())
