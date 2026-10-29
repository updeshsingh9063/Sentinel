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
                         "text_hi": text_hi_for(c.code, getattr(c, "values", None)),
                         "contribution": round(float(c.contribution), 4)})
        elif isinstance(c, dict) and "code" in c:
            rows.append({"code": c["code"], "text": c["text"],
                         "text_hi": c.get("text_hi")
                         or text_hi_for(c["code"], c.get("values")),
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




# ---------------------------------------------------------------- Hindi -----
#
# WHY THE HINDI LIVES HERE AND NOT IN THE FRONTEND. These sentences are stored
# with the score and travel into the alert, so a coordinator reads exactly what
# the model wrote and what the metrics were computed on. Translating at render
# time would mean the Hindi string had never been through the never-diagnose
# gate below — the one place every generated sentence must pass.
#
# `{n}` is filled from RuleHit.values, not parsed back out of the English, so
# the two languages state the same number by construction.

_TEXT_HI: dict[str, str] = {
    "bp_very_high": "\u0938\u093f\u0938\u094d\u091f\u094b\u0932\u093f\u0915 {n}, \u0909\u0928\u0915\u0940 \u0938\u093e\u092e\u093e\u0928\u094d\u092f \u0938\u0940\u092e\u093e \u0938\u0947 \u0915\u093e\u095e\u0940 \u090a\u092a\u0930",
    "bp_high": "\u0938\u093f\u0938\u094d\u091f\u094b\u0932\u093f\u0915 {n}, \u0909\u0928\u0915\u0940 \u0938\u093e\u092e\u093e\u0928\u094d\u092f \u0938\u0940\u092e\u093e \u0938\u0947 \u090a\u092a\u0930",
    "bp_low": "\u0938\u093f\u0938\u094d\u091f\u094b\u0932\u093f\u0915 {n}, \u0909\u0928\u0915\u0940 \u0938\u093e\u092e\u093e\u0928\u094d\u092f \u0938\u0940\u092e\u093e \u0938\u0947 \u0928\u0940\u091a\u0947",
    "spo2_low": "\u0911\u0915\u094d\u0938\u0940\u091c\u0928 {n}%, \u0906\u092e \u0938\u0947 \u0915\u092e",
    "pulse_outside": "\u0928\u093e\u0921\u093c\u0940 {n}, \u0938\u093e\u092e\u093e\u0928\u094d\u092f \u0938\u0940\u092e\u093e \u0938\u0947 \u092c\u093e\u0939\u0930",
    "temp_high": "\u0924\u093e\u092a\u092e\u093e\u0928 {n} \u0921\u093f\u0917\u094d\u0930\u0940",
    "dose_missed": "\u092a\u093f\u091b\u0932\u0947 \u0939\u095e\u094d\u0924\u0947 {n}% \u0938\u0947 \u0915\u092e \u0916\u0941\u0930\u093e\u0915\u0947\u0902 \u0926\u0930\u094d\u091c",
    "dose_patchy": "\u0907\u0938 \u0939\u095e\u094d\u0924\u0947 \u0916\u0941\u0930\u093e\u0915\u0947\u0902 \u0905\u0928\u093f\u092f\u092e\u093f\u0924 \u0930\u0942\u092a \u0938\u0947 \u0926\u0930\u094d\u091c",
    "no_contact": "{n} \u0926\u093f\u0928 \u0938\u0947 \u0915\u094b\u0908 \u0915\u0949\u0932 \u0928\u0939\u0940\u0902 \u0909\u0920\u0940",
    "contact_thin": "{n} \u0926\u093f\u0928 \u0938\u0947 \u0915\u094b\u0908 \u0915\u0949\u0932 \u0928\u0939\u0940\u0902 \u0909\u0920\u0940",
    "feels_worse": "\u0930\u094b\u095b \u0915\u0940 \u091c\u093e\u0901\u091a \u092e\u0947\u0902 \u0916\u0930\u093e\u092c \u092e\u0939\u0938\u0942\u0938 \u0915\u0930\u0928\u093e \u092c\u0924\u093e\u092f\u093e",
    "pain_reported": "\u0930\u094b\u095b \u0915\u0940 \u091c\u093e\u0901\u091a \u092e\u0947\u0902 \u095b\u094d\u092f\u093e\u0926\u093e \u0926\u0930\u094d\u0926 \u092c\u0924\u093e\u092f\u093e",
    "cue_pain": "\u0939\u093e\u0932 \u0915\u0940 \u0915\u0949\u0932 \u092e\u0947\u0902 \u0926\u0930\u094d\u0926 \u0915\u093e \u095b\u093f\u0915\u094d\u0930",
    "cue_fall": "\u0939\u093e\u0932 \u0915\u0940 \u0915\u0949\u0932 \u092e\u0947\u0902 \u0917\u093f\u0930\u0928\u0947 \u0915\u093e \u095b\u093f\u0915\u094d\u0930",
    "cue_confusion": "\u0939\u093e\u0932 \u0915\u0940 \u0915\u0949\u0932 \u092e\u0947\u0902 \u092f\u093e\u0926\u0926\u093e\u0936\u094d\u0924 \u092f\u093e \u092d\u094d\u0930\u092e \u0915\u093e \u095b\u093f\u0915\u094d\u0930",
    "cue_low_appetite": "\u0939\u093e\u0932 \u0915\u0940 \u0915\u0949\u0932 \u092e\u0947\u0902 \u092d\u0942\u0916 \u0915\u093e \u095b\u093f\u0915\u094d\u0930",
    "cue_loneliness": "\u0939\u093e\u0932 \u0915\u0940 \u0915\u0949\u0932 \u092e\u0947\u0902 \u0905\u0915\u0947\u0932\u0947\u092a\u0928 \u0915\u093e \u095b\u093f\u0915\u094d\u0930",
    "cue_dizziness": "\u0939\u093e\u0932 \u0915\u0940 \u0915\u0949\u0932 \u092e\u0947\u0902 \u091a\u0915\u094d\u0915\u0930 \u0915\u093e \u095b\u093f\u0915\u094d\u0930",
    "cue_poor_sleep": "\u0939\u093e\u0932 \u0915\u0940 \u0915\u0949\u0932 \u092e\u0947\u0902 \u0928\u0940\u0902\u0926 \u0920\u0940\u0915 \u0928 \u0939\u094b\u0928\u0947 \u0915\u093e \u095b\u093f\u0915\u094d\u0930",
    "cue_breathlessness": "\u0939\u093e\u0932 \u0915\u0940 \u0915\u0949\u0932 \u092e\u0947\u0902 \u0938\u093e\u0901\u0938 \u095e\u0942\u0932\u0928\u0947 \u0915\u093e \u095b\u093f\u0915\u094d\u0930",
    "baseline_shift": "\u0930\u0940\u0921\u093f\u0902\u0917 \u0909\u0928\u0915\u0940 \u0905\u092a\u0928\u0940 \u0939\u093e\u0932\u093f\u092f\u093e \u0938\u0940\u092e\u093e \u0938\u0947 \u0939\u091f \u0930\u0939\u0940 \u0939\u0948\u0902",
}

_ACTIONS_HI: dict[str, str] = {
    "bp_very_high": "\u0906\u091c \u0915\u0949\u0932 \u0915\u0930\u0915\u0947 \u0939\u093e\u0932 \u092a\u0942\u091b\u0947\u0902\u0964 \u0905\u0917\u0930 \u0930\u0940\u0921\u093f\u0902\u0917 \u092b\u093f\u0930 \u0910\u0938\u0940 \u0906\u090f \u0924\u094b \u0928\u0930\u094d\u0938 \u0915\u0940 \u0935\u093f\u095b\u093f\u091f \u0915\u0930\u093e\u090f\u0901 \u0914\u0930 \u0921\u0949\u0915\u094d\u091f\u0930 \u0938\u0947 \u0938\u092e\u0940\u0915\u094d\u0937\u093e \u0915\u0930\u093e\u090f\u0901\u0964",
    "bp_high": "\u0906\u091c \u0915\u0949\u0932 \u0915\u0930\u0947\u0902, \u092a\u0942\u091b\u0947\u0902 \u0915\u093f \u0930\u0940\u0921\u093f\u0902\u0917 \u092c\u0948\u0920\u0915\u0930 \u0914\u0930 \u0906\u0930\u093e\u092e \u0915\u0947 \u092c\u093e\u0926 \u0932\u0940 \u0917\u0908 \u0925\u0940, \u0914\u0930 \u0936\u093e\u092e \u0915\u0940 \u0916\u0941\u0930\u093e\u0915 \u0915\u0940 \u092a\u0941\u0937\u094d\u091f\u093f \u0915\u0930\u0947\u0902\u0964",
    "bp_low": "\u0906\u091c \u0915\u0949\u0932 \u0915\u0930\u0915\u0947 \u092a\u0942\u091b\u0947\u0902 \u0915\u093f \u0916\u0921\u093c\u0947 \u0939\u094b\u0928\u0947 \u092a\u0930 \u091a\u0915\u094d\u0915\u0930 \u0906\u092f\u093e \u0915\u094d\u092f\u093e\u0964",
    "spo2_low": "\u0906\u091c \u0915\u0949\u0932 \u0915\u0930\u0915\u0947 \u0938\u093e\u0901\u0938 \u0915\u0947 \u092c\u093e\u0930\u0947 \u092e\u0947\u0902 \u092a\u0942\u091b\u0947\u0902\u0964",
    "pulse_outside": "\u0906\u091c \u0915\u0949\u0932 \u0915\u0930\u0947\u0902 \u0914\u0930 \u0906\u0930\u093e\u092e \u0915\u0940 \u0939\u093e\u0932\u0924 \u092e\u0947\u0902 \u0926\u094b\u092c\u093e\u0930\u093e \u0930\u0940\u0921\u093f\u0902\u0917 \u0932\u0947\u0902\u0964",
    "temp_high": "\u0906\u091c \u0915\u0949\u0932 \u0915\u0930\u0947\u0902 \u0914\u0930 \u092a\u0942\u091b\u0947\u0902 \u0915\u093f \u0915\u092c \u0938\u0947 \u0924\u092c\u0940\u092f\u0924 \u0920\u0940\u0915 \u0928\u0939\u0940\u0902 \u0939\u0948\u0964",
    "dose_missed": "\u0906\u091c \u0938\u0941\u092c\u0939 \u0915\u0949\u0932 \u0915\u0930\u0915\u0947 \u0936\u093e\u092e \u0915\u0940 \u0926\u093f\u0928\u091a\u0930\u094d\u092f\u093e \u0938\u093e\u0925 \u092e\u0947\u0902 \u0926\u0947\u0916\u0947\u0902\u0964 \u092a\u0942\u091b\u0947\u0902 \u0915\u093f \u0926\u093f\u0915\u094d\u0915\u0924 \u0915\u094d\u092f\u093e \u0906 \u0930\u0939\u0940 \u0939\u0948\u0964",
    "dose_patchy": "\u0915\u0949\u0932 \u0915\u0930\u0915\u0947 \u0936\u093e\u092e \u0915\u0940 \u0916\u0941\u0930\u093e\u0915 \u0915\u0940 \u092a\u0941\u0937\u094d\u091f\u093f \u0915\u0930\u0947\u0902\u0964",
    "no_contact": "\u0926\u0942\u0938\u0930\u0947 \u0928\u0902\u092c\u0930 \u092a\u0930, \u092b\u093f\u0930 \u092a\u0930\u093f\u0935\u093e\u0930 \u0915\u0947 \u0938\u0902\u092a\u0930\u094d\u0915 \u092a\u0930 \u0915\u094b\u0936\u093f\u0936 \u0915\u0930\u0947\u0902\u0964 \u0926\u094b\u092a\u0939\u0930 \u0924\u0915 \u091c\u0935\u093e\u092c \u0928 \u092e\u093f\u0932\u0947 \u0924\u094b \u0918\u0930 \u0915\u0940 \u0935\u093f\u095b\u093f\u091f \u0930\u0916\u0947\u0902\u0964",
    "contact_thin": "\u0906\u091c \u0926\u093f\u0928 \u0915\u0947 \u0915\u093f\u0938\u0940 \u0914\u0930 \u0938\u092e\u092f \u092a\u0930 \u0926\u094b\u092c\u093e\u0930\u093e \u0915\u094b\u0936\u093f\u0936 \u0915\u0930\u0947\u0902\u0964",
    "feels_worse": "\u0906\u091c \u0915\u0949\u0932 \u0915\u0930\u0915\u0947 \u092a\u0942\u091b\u0947\u0902 \u0915\u093f \u092a\u093f\u091b\u0932\u0947 \u0939\u095e\u094d\u0924\u0947 \u0938\u0947 \u0915\u094d\u092f\u093e \u092c\u0926\u0932\u093e \u0939\u0948\u0964",
    "pain_reported": "\u0906\u091c \u0915\u0949\u0932 \u0915\u0930\u0915\u0947 \u092a\u0942\u091b\u0947\u0902 \u0915\u093f \u0926\u0930\u094d\u0926 \u0915\u0939\u093e\u0901 \u0939\u0948 \u0914\u0930 \u0915\u092c \u0938\u0947 \u0939\u0948\u0964",
    "cue_fall": "\u0906\u091c \u0915\u0949\u0932 \u0915\u0930\u0947\u0902\u0964 \u092a\u0942\u091b\u0947\u0902 \u0915\u093f \u091a\u094b\u091f \u0924\u094b \u0928\u0939\u0940\u0902 \u0932\u0917\u0940, \u0914\u0930 \u0928\u0930\u094d\u0938 \u0915\u0940 \u0935\u093f\u095b\u093f\u091f \u0930\u0916\u0947\u0902\u0964",
    "cue_breathlessness": "\u0906\u091c \u0915\u0949\u0932 \u0915\u0930\u0915\u0947 \u0906\u0930\u093e\u092e \u092e\u0947\u0902 \u0914\u0930 \u0938\u0940\u0922\u093c\u0940 \u091a\u0922\u093c\u0924\u0947 \u0938\u092e\u092f \u0938\u093e\u0901\u0938 \u0915\u0947 \u092c\u093e\u0930\u0947 \u092e\u0947\u0902 \u092a\u0942\u091b\u0947\u0902\u0964",
    "cue_dizziness": "\u0906\u091c \u0915\u0949\u0932 \u0915\u0930\u0947\u0902\u0964 \u092a\u0942\u091b\u0947\u0902 \u0915\u093f \u0916\u0921\u093c\u0947 \u0939\u094b\u0928\u0947 \u092a\u0930 \u0939\u094b\u0924\u093e \u0939\u0948 \u0915\u094d\u092f\u093e\u0964",
    "cue_confusion": "\u0906\u091c \u0915\u0949\u0932 \u0915\u0930\u0947\u0902 \u0914\u0930 \u092a\u0930\u093f\u0935\u093e\u0930 \u0938\u0947 \u092d\u0940 \u092c\u093e\u0924 \u0915\u0930\u0947\u0902\u0964 \u092a\u0942\u091b\u0947\u0902 \u0915\u093f \u092f\u0939 \u0928\u092f\u093e \u0939\u0948 \u0915\u094d\u092f\u093e\u0964",
    "cue_low_appetite": "\u0906\u091c \u0915\u0949\u0932 \u0915\u0930\u0915\u0947 \u092a\u0942\u091b\u0947\u0902 \u0915\u093f \u0915\u094d\u092f\u093e \u0916\u093e\u092f\u093e \u0914\u0930 \u0916\u093e\u0928\u093e \u0915\u094c\u0928 \u092c\u0928\u093e \u0930\u0939\u093e \u0939\u0948\u0964",
    "cue_pain": "\u0906\u091c \u0915\u0949\u0932 \u0915\u0930\u0915\u0947 \u092a\u0942\u091b\u0947\u0902 \u0915\u093f \u0926\u0930\u094d\u0926 \u0915\u0939\u093e\u0901 \u0939\u0948 \u0914\u0930 \u0928\u092f\u093e \u0939\u0948 \u0915\u094d\u092f\u093e\u0964",
    "cue_poor_sleep": "\u0906\u091c \u0915\u0949\u0932 \u0915\u0930\u0915\u0947 \u092a\u0942\u091b\u0947\u0902 \u0915\u093f \u0928\u0940\u0902\u0926 \u092e\u0947\u0902 \u0915\u094d\u092f\u093e \u092c\u093e\u0927\u093e \u0906 \u0930\u0939\u0940 \u0939\u0948\u0964",
    "cue_loneliness": "\u0906\u091c \u0932\u0902\u092c\u0940 \u092c\u093e\u0924 \u0915\u0930\u0947\u0902 \u0914\u0930 \u092a\u0942\u091b\u0947\u0902 \u0915\u093f \u0915\u094b\u0908 \u092e\u093f\u0932\u0928\u0947 \u0906\u090f \u0924\u094b \u0905\u091a\u094d\u091b\u093e \u0932\u0917\u0947\u0917\u093e \u0915\u094d\u092f\u093e\u0964",
    "silence": "\u0926\u0942\u0938\u0930\u0947 \u0928\u0902\u092c\u0930 \u092a\u0930, \u092b\u093f\u0930 \u092a\u0930\u093f\u0935\u093e\u0930 \u0915\u0947 \u0938\u0902\u092a\u0930\u094d\u0915 \u092a\u0930 \u0915\u094b\u0936\u093f\u0936 \u0915\u0930\u0947\u0902\u0964",
}

_DEFAULT_ACTION_HI = "\u0906\u091c \u0915\u093f\u0938\u0940 \u0915\u093e\u0930\u094d\u0930\u0935\u093e\u0908 \u0915\u0940 \u095b\u0930\u0942\u0930\u0924 \u0928\u0939\u0940\u0902\u0964 \u0938\u092c \u0909\u0928\u0915\u0940 \u0938\u093e\u092e\u093e\u0928\u094d\u092f \u0938\u0940\u092e\u093e \u092e\u0947\u0902 \u0939\u0948\u0964"


def text_hi_for(code: str, values: dict | None) -> str:
    """The Hindi sentence for a reason code, or "" when there is none."""
    template = _TEXT_HI.get(code)
    if not template:
        return ""
    try:
        return assert_safe(template.format(**(values or {})))
    except (KeyError, IndexError):
        # A template wanting a value the hit did not carry. Returning nothing
        # is right: the interface falls back to English, which is worse than
        # Hindi and far better than a sentence with a hole in it.
        return ""


def next_step_hi_for(reason_codes: list[str]) -> str:
    for code in reason_codes or []:
        if code in _ACTIONS_HI:
            return assert_safe(_ACTIONS_HI[code])
    return _DEFAULT_ACTION_HI


def summarise(reasons: list[dict]) -> tuple[list[dict], str, str]:
    """What an alert row stores: ranked reasons, and a next step in each language.

    Each reason carries `text` and `text_hi`. Both were produced here and both
    passed the gate, so neither can be a translation nobody checked.
    """
    top = reasons_from_contributions(reasons)
    codes = [r["code"] for r in top]
    return top, next_step_for(codes), next_step_hi_for(codes)
