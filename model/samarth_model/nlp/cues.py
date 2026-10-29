"""FR-2: cue extraction from call notes and check-ins."""

from __future__ import annotations

from dataclasses import dataclass

from samarth_model.nlp.lexicon import LEXICON
from samarth_model.nlp.negation import NEG_TOKENS, is_hedged, is_negated
from samarth_model.nlp.normalise import fold, tokenise


@dataclass(frozen=True)
class Cue:
    cue: str
    negated: bool
    confidence: float
    span_text: str


# Surface forms are folded once at import so every note does not pay for it.
# Longest first: "khana nahi" must win over "khana" so the negation is part of
# the matched span rather than left dangling beside it.
#
# INTRINSIC NEGATION. Several Hindi cue phrases carry "nahi" as part of the
# cue itself: "neend nahi aayi" means sleep did NOT come, which asserts poor
# sleep, and "khana nahi kha rahi" asserts low appetite. Running the negation
# detector over these inverts the two most common decline cues into
# reassurance. Such forms are flagged here and never negation-flipped.
_PATTERNS: list[tuple[str, list[str], str, bool]] = sorted(
    (
        (cue, tokenise(form), form, any(t in NEG_TOKENS for t in tokenise(form)))
        for cue, forms in LEXICON.items()
        for form in forms
    ),
    key=lambda p: -len(p[1]),
)


def extract(text: str) -> list[Cue]:
    """Normalise, match the lexicon, then resolve negation.

    Order matters: negation is resolved after matching so the marker position
    relative to the matched span is known.

    A negated cue is RETURNED, with negated=True, not dropped. Downstream the
    score ignores it, but the coordinator still sees "she said no pain today",
    which is evidence and is the difference between a system that listened and
    one that filtered.
    """
    if not text or not text.strip():
        return []

    tokens = tokenise(text)
    if not tokens:
        return []

    found: dict[str, Cue] = {}
    claimed: set[int] = set()

    for cue, pattern, surface, intrinsic_neg in _PATTERNS:
        if not pattern:
            continue
        n = len(pattern)
        for i in range(len(tokens) - n + 1):
            if tokens[i:i + n] != pattern:
                continue
            # One token belongs to one cue. Without this, "khana nahi kha
            # rahi" matches both the long form and the bare "khana".
            if any(j in claimed for j in range(i, i + n)):
                continue

            if intrinsic_neg:
                # The negation IS the cue. "neend nahi aayi" asserts poor sleep.
                negated = False
            else:
                span = set(range(i, i + n))
                negated = any(
                    is_negated(tokens, j, window=4, skip=span)
                    for j in span
                )
            hedged = is_hedged(tokens, i)

            # Confidence is about how sure we are the cue was MENTIONED, not
            # how severe it is. A longer surface form is less likely to be a
            # coincidence; a hedge makes the mention itself softer.
            confidence = min(0.97, 0.72 + 0.08 * n)
            if hedged:
                confidence -= 0.14

            claimed.update(range(i, i + n))

            prev = found.get(cue)
            # An asserted mention outranks a negated one: "no pain this
            # morning but dard now" is a pain cue.
            if prev is None or (prev.negated and not negated) or (
                prev.negated == negated and confidence > prev.confidence
            ):
                found[cue] = Cue(
                    cue=cue,
                    negated=negated,
                    confidence=round(confidence, 3),
                    span_text=surface,
                )
            break

    return sorted(found.values(), key=lambda c: (c.negated, -c.confidence))


def extract_positive(text: str) -> list[str]:
    """Just the cue names that were actually asserted. Used for features."""
    return [c.cue for c in extract(text) if not c.negated]
