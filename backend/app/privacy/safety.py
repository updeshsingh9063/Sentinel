"""The never-diagnose gate.

The brief forbids naming a condition to a senior or a family member. That is a
hard constraint, not a tone preference, so it is enforced as a function every
outbound message passes through -- and as a test that runs in CI.

Scope note: coordinator-facing text is exempt. A coordinator may legitimately
read "BP trending up over 6 days"; what they must not receive is a machine
diagnosis either. So the banned list splits in two: condition names are banned
everywhere, while diagnostic framing ("you have", "symptoms of") is banned on
the family and senior channels.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum


class Channel(str, Enum):
    SENIOR = "senior"
    FAMILY = "family"
    COORDINATOR = "coordinator"


# Condition names. Never permitted on any channel, because the system is not
# licensed to conclude any of them.
CONDITION_TERMS = [
    "alzheimer", "dementia", "parkinson", "stroke", "heart attack",
    "myocardial", "cardiac arrest", "heart failure", "arrhythmia",
    "diabetes", "diabetic", "hypertension", "hypertensive", "hypotension",
    "pneumonia", "copd", "asthma", "tuberculosis", "cancer", "tumour",
    "tumor", "sepsis", "infection", "uti", "kidney failure", "renal failure",
    "anaemia", "anemia", "depression", "anxiety disorder", "delirium",
    "osteoporosis", "arthritis", "fracture", "covid",
]

# Diagnostic or prescriptive framing. Banned on senior and family channels.
DIAGNOSTIC_FRAMES = [
    "you have", "he has", "she has", "they have",
    "diagnosed", "diagnosis", "symptoms of", "symptomatic of",
    "suffering from", "indicates that", "caused by", "due to a",
    "you should take", "increase the dose", "stop taking", "prescribe",
    "test results show", "confirms", "is suffering",
]

# Hindi and Hinglish equivalents. The senior channel speaks Hindi, so an
# English-only gate would miss the most likely leak.
DIAGNOSTIC_FRAMES_HI = [
    "aapko hai", "aapko ye hai", "bimari hai", "rog hai",
    "diagnosis hai", "ilaj", "dawa badal", "dawa band",
]


def _compile(terms: list[str]) -> re.Pattern[str]:
    # Word-boundary match so "uti" does not fire inside "routine" and
    # "infection" does not fire inside "disinfection".
    return re.compile(r"\b(" + "|".join(re.escape(t) for t in terms) + r")\b",
                      re.IGNORECASE)


_CONDITIONS = _compile(CONDITION_TERMS)
_FRAMES = _compile(DIAGNOSTIC_FRAMES + DIAGNOSTIC_FRAMES_HI)


@dataclass(frozen=True)
class SafetyResult:
    ok: bool
    violations: list[str]

    def __bool__(self) -> bool:
        return self.ok


def check(text: str, channel: Channel) -> SafetyResult:
    """Return every banned term found, not just the first.

    Reporting all of them at once means a failing CI run tells you everything
    to fix rather than one thing per iteration.
    """
    found = [m.group(0).lower() for m in _CONDITIONS.finditer(text)]

    if channel in (Channel.SENIOR, Channel.FAMILY):
        found += [m.group(0).lower() for m in _FRAMES.finditer(text)]

    # Preserve first-seen order while removing duplicates.
    seen: dict[str, None] = {}
    for f in found:
        seen.setdefault(f, None)
    return SafetyResult(ok=not seen, violations=list(seen))


class UnsafeMessage(RuntimeError):
    """Raised instead of delivering a message that names a condition."""


def assert_safe(text: str, channel: Channel) -> str:
    """Gate for the send path. Fails closed: no message rather than a bad one."""
    result = check(text, channel)
    if not result.ok:
        raise UnsafeMessage(
            "refusing to send on the {} channel; banned terms: {}".format(
                channel.value, ", ".join(result.violations)))
    return text
