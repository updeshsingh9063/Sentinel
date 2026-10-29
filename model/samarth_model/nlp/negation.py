"""Negation and hedge handling.

Without this the extractor fires on "no pain today" and precision collapses.
The observed negation markers in the corpus are nahi (933), nahin (269),
nhi (80), plus mat, bilkul, kabhi and koi.

A negated cue is recorded with negated=True rather than dropped: "no pain for
three days then pain" is a trajectory, and discarding the negatives loses it.
"""

from __future__ import annotations

NEGATION_MARKERS = ["nahi", "nahin", "nhi", "na", "mat", "bilkul nahi",
                    "no", "not", "never", "denies", "without"]

HEDGE_MARKERS = ["thoda", "shayad", "maybe", "slightly", "a bit", "kabhi kabhi"]

# Single tokens, after normalise.fold has already folded nahin/nhi -> nahi.
NEG_TOKENS = {"nahi", "na", "mat", "no", "not", "never", "denies", "without",
              "koi", "bilkul"}
_NEG_TOKENS = NEG_TOKENS
_HEDGE_TOKENS = {"thoda", "shayad", "maybe", "slightly", "bit", "kabhi"}

# Words that end a clause. Negation does not reach past them, so
# "dard nahi, par neend kam" does not negate the sleep cue.
_BOUNDARIES = {"par", "lekin", "but", "aur", "and", "phir", "however"}


def is_negated(tokens: list[str], cue_index: int, window: int = 4,
               skip: set[int] | None = None) -> bool:
    """Look backwards and forwards a few tokens for a negation marker.

    Both directions, because Hindi puts the negation AFTER the thing being
    negated ("dard nahi hai") while English puts it before ("no pain"). A
    backwards-only window, which is the usual English default, silently fails
    on most of this corpus.

    The scan stops at a clause boundary so one negated cue does not negate
    everything after it in the sentence.
    """
    if cue_index < 0 or cue_index >= len(tokens):
        return False
    skip = skip or set()

    for direction in (-1, 1):
        for step in range(1, window + 1):
            i = cue_index + direction * step
            if i < 0 or i >= len(tokens):
                break
            # A marker inside the matched span belongs to the cue phrase, not
            # to a negation of it.
            if i in skip:
                continue
            tok = tokens[i]
            if tok in _BOUNDARIES:
                break
            if tok in _NEG_TOKENS:
                return True
    return False


def is_hedged(tokens: list[str], cue_index: int, window: int = 3) -> bool:
    """A hedge lowers confidence rather than flipping the cue.

    "thoda dard" is still pain, reported more weakly. Treating it as a
    negation would throw away a real early signal, which is exactly what this
    product exists to catch.
    """
    if cue_index < 0 or cue_index >= len(tokens):
        return False
    lo = max(0, cue_index - window)
    return any(tok in _HEDGE_TOKENS for tok in tokens[lo:cue_index])
