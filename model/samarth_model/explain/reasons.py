"""Turning contributions into the two lines a coordinator reads.

Every alert needs a why and a next step. Both are template-generated, with an
LLM used only to soften tone if at all, because a template cannot invent a
diagnosis. The output still passes the never-diagnose gate before send.

The gate below is the last line of defence, not the first: nothing upstream is
allowed to produce a condition name either. It exists because this is the point
where text leaves the model and reaches a human, and a silent regression
anywhere upstream would otherwise ship.
"""

from __future__ import annotations

import re

#: Terms that must never appear in a reason or a next step. Not exhaustive --
#: it cannot be -- but it catches the plausible slips, and `assert_safe` is
#: called on every generated string in the pipeline and in the tests.
#:
#: SPLIT INTO STEMS AND WHOLE WORDS ON PURPOSE. A naive substring check fires
#: on "routine" because it contains "uti", and on "indicates" because it
#: contains "cat". Short clinical abbreviations have to match whole words or
#: the gate blocks safe text while still feeling thorough.
BANNED_STEMS = [
    "diagnos", "dementia", "alzheimer", "parkinson", "hypertens",
    "diabet", "pneumon", "arrhythm", "sepsis", "angina", "cancer",
]

BANNED_WORDS = [
    "stroke", "cardiac", "copd", "uti", "infection", "infections",
    "disease", "diseases", "syndrome", "depression", "psychosis",
]

BANNED_PHRASES = [
    "heart failure", "anxiety disorder", "suffering from", "condition is",
    "likely has", "caused by", "symptom of", "sign of",
]

#: Kept for callers that imported the old flat list.
BANNED = BANNED_STEMS + BANNED_WORDS + BANNED_PHRASES

_WORDS = re.compile(r"[a-z]+")


class UnsafeText(ValueError):
    """Raised when generated text would name or imply a condition."""


def assert_safe(text: str) -> str:
    """Reject text that names a condition. Returns the text if it is clean."""
    low = text.lower()
    words = _WORDS.findall(low)

    for phrase in BANNED_PHRASES:
        if phrase in low:
            raise UnsafeText(f"generated text contains banned phrase {phrase!r}: {text!r}")

    wordset = set(words)
    for term in BANNED_WORDS:
        if term in wordset:
            raise UnsafeText(f"generated text contains banned term {term!r}: {text!r}")

    for stem in BANNED_STEMS:
        if any(w.startswith(stem) for w in words):
            raise UnsafeText(f"generated text contains banned stem {stem!r}: {text!r}")

    return text


def reasons_from_contributions(contributions, top_n: int = 3) -> list[dict]:
    """Rank the hits and keep the few that carry the score.

    Three by default. A coordinator reading a list of ten reasons is reading
    none of them, and the brief asks for the TOP reasons, not all of them.

    `contributions` may be RuleHit objects or plain dicts with code, text and
    contribution.
    """
    rows = []
    for c in contributions or []:
        if hasattr(c, "code"):
            rows.append({"code": c.code, "text": c.text,
                         "contribution": round(float(c.contribution), 4)})
        elif isinstance(c, dict) and "code" in c:
            rows.append({"code": c["code"], "text": c["text"],
                         "contribution": round(float(c.get("contribution", 0.0)), 4)})

    rows.sort(key=lambda r: -r["contribution"])
    for r in rows[:top_n]:
        assert_safe(r["text"])
    return rows[:top_n]


#: Dominant reason -> the action a human can actually take today. Each ends at
#: a person: nothing here adjusts a medication or contacts a senior on its own.
_ACTIONS: dict[str, str] = {
    "bp_very_high": "Call today and ask how they are feeling. If the reading repeats, arrange a nurse visit and ask their doctor to review.",
    "bp_high": "Call today, check the reading was taken sitting and rested, and confirm the evening dose.",
    "bp_low": "Call today and ask whether they have felt faint on standing. Offer a nurse visit if it has happened more than once.",
    "spo2_low": "Call today and ask about breathing. If it is worse than usual, arrange a nurse visit.",
    "pulse_outside": "Call today and re-check the reading while they are resting.",
    "temp_high": "Call today, ask how long they have felt unwell, and arrange a nurse visit if it has been more than a day.",
    "dose_missed": "Call this morning and go through the evening routine with them. Ask what is getting in the way.",
    "dose_patchy": "Call and confirm the evening dose. Ask whether the reminder is working.",
    "no_contact": "Try the alternate number, then the family contact. If neither answers by midday, schedule a home visit.",
    "contact_thin": "Try again today at a different time of day, then the family contact.",
    "feels_worse": "Call today and ask what has changed since last week.",
    "pain_reported": "Call today and ask where the pain is and how long it has lasted.",
    "cue_fall": "Call today. Ask whether they were hurt, check the room where it happened, and arrange a nurse visit.",
    "cue_breathlessness": "Call today and ask about breathing at rest and on stairs. Arrange a nurse visit if it is new.",
    "cue_dizziness": "Call today. Ask whether it happens on standing up, and offer a nurse visit.",
    "cue_confusion": "Call today and speak to the family contact as well. Ask whether this is new.",
    "cue_low_appetite": "Call today and ask what they have eaten and who is cooking.",
    "cue_pain": "Call today and ask where the pain is and whether it is new.",
    "cue_poor_sleep": "Call today and ask what is keeping them awake.",
    "cue_loneliness": "Call today for a longer conversation and ask whether they would like a visit.",
    "silence": "Try the alternate number, then the family contact.",
}

_DEFAULT_ACTION = "No action needed today. Pattern is within their usual range."


def next_step_for(reason_codes: list[str]) -> str:
    """Map the dominant reason to a concrete action a human can take today."""
    for code in reason_codes or []:
        if code in _ACTIONS:
            return assert_safe(_ACTIONS[code])
    return _DEFAULT_ACTION


def summarise(reasons: list[dict]) -> tuple[list[dict], str]:
    """The pair an alert row stores: ranked reasons and one next step."""
    top = reasons_from_contributions(reasons)
    return top, next_step_for([r["code"] for r in top])
