"""PII masking for anything leaving the system.

The brief requires that no personal data reaches an external service without
masking. In practice there is one place this bites: if a hosted LLM or ASR is
ever used to summarise or transcribe, the note text goes over the wire.

Design choice: mask to stable placeholders rather than deleting. A summariser
needs to know that a person was referred to in order to write a coherent
sentence; it does not need the name. Stable placeholders also let the original
be restored on the way back.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Indian mobile numbers. Written in the wild as 9876543210, 98765 43210,
# +91 98765-43210 or 091-9876543210, so separators have to be optional
# everywhere rather than assumed absent.
PHONE = re.compile(
    r"(?:\+?9?1[\s-]?)?"          # optional +91 / 91 / 091 prefix
    r"\b[6-9]\d{4}[\s-]?\d{5}\b"  # 10 digits, optional break after the 5th
)
# Aadhaar is 12 digits, often grouped 4-4-4. Never needed by this system, so
# finding one at all is worth flagging, not just masking.
AADHAAR = re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b")
EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b")
# Dates of birth in common Indian formats.
DOB = re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2}\b")


@dataclass
class MaskResult:
    text: str
    # placeholder -> original, so a response can be rehydrated.
    mapping: dict[str, str] = field(default_factory=dict)
    flagged: list[str] = field(default_factory=list)


def mask(text: str, known_names: list[str] | None = None) -> MaskResult:
    """Replace direct identifiers with stable placeholders.

    `known_names` comes from the senior and family records for this note. Free
    text name detection is unreliable, so passing the names we already know is
    both more accurate and cheaper than running NER.
    """
    mapping: dict[str, str] = {}
    flagged: list[str] = []
    counters = {"NAME": 0, "PHONE": 0, "EMAIL": 0, "AADHAAR": 0, "DOB": 0}

    def placeholder(kind: str, original: str) -> str:
        for ph, orig in mapping.items():
            if orig == original:
                return ph                      # same value, same placeholder
        counters[kind] += 1
        ph = "[{}_{}]".format(kind, counters[kind])
        mapping[ph] = original
        return ph

    out = text

    # Names first: a name may contain digits in rare transliterations, and
    # masking it early avoids double-masking.
    for name in sorted(known_names or [], key=len, reverse=True):
        name = name.strip()
        if len(name) < 3:
            continue
        pat = re.compile(r"\b" + re.escape(name) + r"\b", re.IGNORECASE)
        if pat.search(out):
            out = pat.sub(lambda m: placeholder("NAME", m.group(0)), out)

    for kind, pat in (("AADHAAR", AADHAAR), ("PHONE", PHONE),
                      ("EMAIL", EMAIL), ("DOB", DOB)):
        if pat.search(out):
            if kind == "AADHAAR":
                # This system never needs an Aadhaar number. If one shows up in
                # a call note, that is a data-entry problem worth surfacing.
                flagged.append("aadhaar_present")
            out = pat.sub(lambda m, k=kind: placeholder(k, m.group(0)), out)

    return MaskResult(text=out, mapping=mapping, flagged=flagged)


def unmask(text: str, mapping: dict[str, str]) -> str:
    """Restore originals in a response that came back from an external call."""
    for ph, original in mapping.items():
        text = text.replace(ph, original)
    return text


def assert_masked(text: str) -> str:
    """Fail closed before an outbound external call.

    Catches the case where masking was forgotten entirely rather than trusting
    the caller to have run it.
    """
    leaks = []
    for kind, pat in (("phone", PHONE), ("email", EMAIL),
                      ("aadhaar", AADHAAR), ("dob", DOB)):
        if pat.search(text):
            leaks.append(kind)
    if leaks:
        raise ValueError(
            "refusing outbound call: unmasked " + ", ".join(leaks))
    return text
