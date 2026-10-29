"""Fill the frontend image slots from Openverse.

WHY OPENVERSE AND NOT UNSPLASH
Unsplash blocks unauthenticated server-side access -- its search page is
client-rendered and its internal JSON endpoint rejects non-browser clients, so
photography could not be fetched without an API key. Openverse (run by
WordPress) has a keyless API and returns licence metadata with every result,
which also serves the brief requirement to cite every asset.

We filter hard to StockSnap CC0 originals: genuine stock-quality photography,
public domain dedication, no attribution required. Credits are recorded in
datasets/MANIFEST.json anyway.

Run:
    python scripts/fetch_images.py              # fill empty slots
    python scripts/fetch_images.py --force      # refetch everything
    python scripts/fetch_images.py --list       # show slots and status
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMG_DIR = ROOT / "frontend" / "public" / "img"
MANIFEST = ROOT / "datasets" / "MANIFEST.json"

API = "https://api.openverse.org/v1/images/"
UA = {"User-Agent": "samarth-sentinel-image-fetcher/1.0"}

# Each slot lists queries in preference order. Several because Openverse
# coverage is uneven -- "elderly man portrait" returns nothing while
# "senior man" returns plenty.
SLOT_QUERIES: dict[str, list[str]] = {
    "hero": ["senior woman", "senior couple", "grandmother"],
    "coordinator": ["caregiver nurse", "nurse", "doctor patient"],
    "senior-portrait": ["senior man", "elderly man", "senior woman portrait"],
    "family-call": ["browsing smartphone", "woman phone", "video call"],
    # "home interior morning" returned a young couple in bed -- wrong subject
    # entirely. Openverse matches loosely, so slot queries must name the
    # person, not the room.
    # "old elderly" returned hands on a Bible -- a fine photograph, but an
    # explicitly Christian one. This product serves a mixed-faith Indian
    # population, so religious imagery would read as affiliation.
    "home-interior": ["senior couple", "senior people", "senior friends"],
    # "grandmother child" returned a heavily Christmas-themed kitchen scene;
    # wrong register for an Indian senior-care product.
    "hands": ["senior hands", "senior healthcare", "holding hands"],
    "ops": ["office desk screens", "computer workspace", "data screen"],
}

MIN_WIDTH = 2000


def log(msg: str) -> None:
    print(msg, flush=True)


def get_json(url: str, tries: int = 4) -> dict:
    """Openverse rate-limits anonymous callers, so back off rather than fail."""
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503):
                raise
        except Exception:
            pass
        time.sleep(3 * (attempt + 1))
    return {}


def search(query: str) -> list[dict]:
    url = API + "?" + urllib.parse.urlencode({
        "q": query,
        "license": "cc0",
        "source": "stocksnap",
        "size": "large",
        "page_size": 12,
    })
    return get_json(url).get("results", []) or []


def download(url: str, dest: Path) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as resp, tmp.open("wb") as out:
        while chunk := resp.read(1 << 16):
            out.write(chunk)
    # JPEG starts FFD8FF. Guards against saving an error page as .jpg.
    with tmp.open("rb") as fh:
        head = fh.read(3)
    if head != b"\xff\xd8\xff":
        tmp.unlink(missing_ok=True)
        raise RuntimeError("not a JPEG (got {!r})".format(head))
    tmp.replace(dest)
    return dest.stat().st_size


def record(entries: list[dict]) -> None:
    if not MANIFEST.exists():
        log("  (no MANIFEST.json; skipping credit record)")
        return
    doc = json.loads(MANIFEST.read_text(encoding="utf-8"))
    merged = {e["name"]: e for e in doc.get("datasets", [])}
    for e in entries:
        merged[e["name"]] = e
    doc["datasets"] = sorted(merged.values(), key=lambda e: e["name"])
    MANIFEST.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    log("\n  credits recorded in datasets/MANIFEST.json")


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    if args.list:
        for slot in SLOT_QUERIES:
            have = (IMG_DIR / (slot + ".jpg")).exists()
            log("  [{}] {:<16} {}".format(
                "x" if have else " ", slot, " | ".join(SLOT_QUERIES[slot])))
        return 0

    used_ids: set[str] = set()
    credits: list[dict] = []

    for slot, queries in SLOT_QUERIES.items():
        dest = IMG_DIR / (slot + ".jpg")
        if dest.exists() and not args.force:
            log("  skip    {} (present)".format(slot))
            # remember its id so a later slot does not duplicate it
            continue

        picked = None
        for q in queries:
            for r in search(q):
                if r.get("id") in used_ids:
                    continue              # no two slots share a photograph
                if (r.get("width") or 0) < MIN_WIDTH:
                    continue
                if not r.get("url"):
                    continue
                picked = r
                break
            if picked:
                break
            time.sleep(1.0)

        if not picked:
            log("  none    {} (no usable result)".format(slot))
            continue

        try:
            size = download(picked["url"], dest)
        except Exception as exc:
            log("  error   {} {}".format(slot, exc))
            continue

        used_ids.add(picked["id"])
        log("  got     {:<16} {:>9,} bytes  {}x{}  {}".format(
            slot, size, picked.get("width"), picked.get("height"),
            (picked.get("title") or "")[:28]))

        credits.append({
            "name": "Image: {}".format(slot),
            "description": "{} (Openverse/StockSnap)".format(picked.get("title") or slot),
            "url": picked.get("foreign_landing_url") or picked.get("url"),
            "path": "frontend/public/img/{}.jpg".format(slot),
            "license": "CC0 1.0 (public domain dedication, no attribution required)",
            "citation": "{} by {} via StockSnap/Openverse, accessed {}.".format(
                picked.get("title") or "Untitled",
                picked.get("creator") or "unknown",
                date.today().isoformat()),
        })
        time.sleep(1.0)

    if credits:
        record(credits)
    log("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
