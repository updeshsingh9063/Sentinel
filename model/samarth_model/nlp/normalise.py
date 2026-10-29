"""Hinglish script normalisation.

The corpus in datasets/processed shows the same word spelled several ways in
Latin script -- nahi, nahin, nhi all appear. A cue extractor that matches one
spelling misses real notes, so text is folded to a canonical form first.

Variant frequencies come from datasets/processed/hinglish_token_frequencies.csv,
which is observed data rather than guesswork.
"""

from __future__ import annotations

import csv
import re
from functools import lru_cache
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
FREQ_CSV = REPO / "datasets" / "processed" / "hinglish_token_frequencies.csv"

_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[^\w\sऀ-ॿ]+")
_REPEAT = re.compile(r"(.)\1{2,}")

# Hand-pinned variants. These are the ones that actually matter for the cue
# lexicon, and they are pinned rather than learned because getting "nahi" wrong
# flips a negation and turns a reassuring note into an alert.
PINNED: dict[str, str] = {
    "nahin": "nahi", "nhi": "nahi", "nai": "nahi", "nahī": "nahi",
    "nehi": "nahi", "naa": "na",
    "hain": "hai", "h": "hai", "hy": "hai",
    "rha": "raha", "rhi": "rahi", "rhe": "rahe",
    "kha": "khana", "khaa": "khana",
    "bhuk": "bhookh", "bhook": "bhookh", "bhukh": "bhookh",
    "chkkar": "chakkar", "chakker": "chakkar",
    "nind": "neend", "neendh": "neend",
    "drd": "dard", "dardh": "dard",
    "saans": "saans", "sans": "saans", "saas": "saans",
    "gaya": "gaya", "gya": "gaya", "gyi": "gayi",
    "thik": "theek", "thk": "theek", "thek": "theek",
}


def _key(token: str) -> str:
    """Spelling-insensitive key: drop doubled letters and trailing long vowels.

    Only used to CLUSTER observed variants, never to rewrite text directly --
    it is far too lossy for that ("dard" and "dard" collapse fine, but so would
    words that mean different things).
    """
    t = _REPEAT.sub(r"\1", token)
    t = re.sub(r"[aeiou]+$", "", t)
    t = re.sub(r"([aeiou])\1+", r"\1", t)
    return t


@lru_cache(maxsize=1)
def load_variants(path: str | None = None) -> dict[str, str]:
    """Build a variant to canonical map from the token frequency table.

    Tokens that share a spelling-insensitive key are treated as variants of one
    another, and the most frequently OBSERVED spelling wins. Frequency is the
    tie-break because the common spelling is the one a coordinator will type.

    Returns PINNED alone if the frequency table is missing, so the extractor
    still works on a fresh clone before scripts/fetch_datasets.py has run.
    """
    mapping = dict(PINNED)
    p = Path(path) if path else FREQ_CSV
    if not p.exists():
        return mapping

    clusters: dict[str, list[tuple[str, int]]] = {}
    with p.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            tok = (row.get("token") or "").strip().lower()
            if not tok or len(tok) < 3 or not tok.isalpha():
                continue
            try:
                count = int(row.get("count") or 0)
            except ValueError:
                continue
            clusters.setdefault(_key(tok), []).append((tok, count))

    for variants in clusters.values():
        if len(variants) < 2:
            continue
        variants.sort(key=lambda kv: -kv[1])
        canonical = variants[0][0]
        for tok, _ in variants[1:]:
            # Never let a learned cluster override a pinned negation mapping.
            mapping.setdefault(tok, canonical)
    return mapping


def fold(text: str) -> str:
    """Lowercase, collapse whitespace, canonicalise known spelling variants."""
    if not text:
        return ""
    t = text.lower()
    t = _PUNCT.sub(" ", t)
    t = _REPEAT.sub(r"\1\1", t)
    variants = load_variants()
    tokens = [variants.get(tok, tok) for tok in _WS.split(t) if tok]
    return " ".join(tokens)


def tokenise(text: str) -> list[str]:
    """Folded tokens, which is what the cue matcher and negation window use."""
    folded = fold(text)
    return [t for t in _WS.split(folded) if t]
