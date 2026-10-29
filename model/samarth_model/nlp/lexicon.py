"""Health cue lexicon.

Hand-built, because no public Hinglish health-note corpus exists -- the fetched
corpora are movie dialogue and contain no health content at all. See
datasets/TRAINING_DATA.md.

This file must be reviewed by a Hindi speaker before the demo. Terms below are
a starting point, not a validated resource.
"""

from __future__ import annotations

# cue -> surface forms (Hinglish, Hindi romanised, English)
LEXICON: dict[str, list[str]] = {
    "pain":           ["dard", "dukh raha", "pain", "ache", "aching", "takleef",
                       "hurts", "hurting"],
    "fall":           ["gir gaya", "gir gayi", "girne", "gire", "gir", "fall",
                       "fell", "slip", "slipped"],
    "confusion":      ["bhool", "bhool gayi", "bhool gaya", "yaad nahi", "confuse",
                       "confused", "forgot", "forgetting", "bhoolna"],
    "low_appetite":   ["khana nahi", "bhookh nahi", "appetite", "not eating",
                       "eating less", "skipping meals"],
    "loneliness":     ["akela", "akeli", "lonely", "alone", "bore", "baithi rehti"],
    "dizziness":      ["chakkar", "dizzy", "dizziness", "giddy", "sar ghoom"],
    "poor_sleep":     ["neend nahi", "so nahi", "sleep", "sleeping", "insomnia",
                       "neend kam"],
    "breathlessness": ["saans", "saans phool", "breathless", "breathing",
                       "dam ghut", "shortness"],
}
