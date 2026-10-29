"""The never-diagnose gate and the bilingual reason layer.

These are the tests that matter most in the whole repo. The gate is the single
thing standing between a generated sentence and a family member reading a
condition name, and the brief scores "no diagnostic claims" separately. A
regression here is not a cosmetic bug.

Every case below is a real failure mode, not a synthetic one: the substring
cases are why the banned list is split into stems and whole words at all.
"""

from __future__ import annotations

import pytest

from samarth_model.explain.reasons import (
    UnsafeText,
    assert_safe,
    next_step_for,
    next_step_hi_for,
    reasons_from_contributions,
    summarise,
    text_hi_for,
)
from samarth_model.scoring.rules import evaluate


# ---- the gate -------------------------------------------------------------

@pytest.mark.parametrize(
    "text",
    [
        "Possible diagnosis of something",
        "Signs of dementia",
        "This is a urinary infection",
        "Likely has a chest problem",
        "Symptom of something worse",
        "Suffering from low mood",
        "Shows early Parkinson tremor",
        "Blood sugar suggests diabetes",
    ],
)
def test_gate_rejects_condition_language(text):
    with pytest.raises(UnsafeText):
        assert_safe(text)


@pytest.mark.parametrize(
    "text",
    [
        # The whole reason the list is split: each of these CONTAINS a banned
        # term as a substring and is perfectly safe.
        "Call today and go through the evening routine",   # routine -> uti
        "The reading indicates nothing unusual",           # indicates -> cat
        "Ask what is getting in the way",
        "No answered call in 5 days",
        "Systolic reading of 167, above the usual range",
        "Appetite mentioned in a recent call note",
    ],
)
def test_gate_allows_safe_text(text):
    assert assert_safe(text) == text


def test_gate_is_case_insensitive():
    with pytest.raises(UnsafeText):
        assert_safe("DIAGNOSIS pending")


def test_every_english_next_step_passes_its_own_gate():
    """The actions are hand-written, so nothing checks them but this."""
    codes = [
        "bp_very_high", "bp_high", "bp_low", "spo2_low", "pulse_outside",
        "temp_high", "dose_missed", "dose_patchy", "no_contact",
        "contact_thin", "feels_worse", "pain_reported", "cue_fall",
        "cue_breathlessness", "cue_dizziness", "cue_confusion",
        "cue_low_appetite", "cue_pain", "cue_poor_sleep", "cue_loneliness",
        "silence",
    ]
    for code in codes:
        assert_safe(next_step_for([code]))
        assert_safe(next_step_hi_for([code]))


def test_unknown_code_falls_back_rather_than_raising():
    assert next_step_for(["no_such_code"])
    assert next_step_hi_for(["no_such_code"])


# ---- ranking --------------------------------------------------------------

def test_reasons_are_ranked_and_capped_at_three():
    contributions = [
        {"code": "a", "text": "small", "contribution": 0.1},
        {"code": "b", "text": "largest", "contribution": 0.9},
        {"code": "c", "text": "middle", "contribution": 0.5},
        {"code": "d", "text": "tiny", "contribution": 0.01},
    ]
    out = reasons_from_contributions(contributions)
    assert [r["code"] for r in out] == ["b", "c", "a"]


def test_ranking_rejects_unsafe_text_rather_than_dropping_it():
    """A banned sentence must stop the pipeline, not be quietly filtered.

    Silently removing it would leave an alert whose reasons do not explain its
    score, which is worse than failing loudly during a build.
    """
    with pytest.raises(UnsafeText):
        reasons_from_contributions(
            [{"code": "x", "text": "Clear diagnosis of something", "contribution": 0.9}]
        )


# ---- the bilingual layer --------------------------------------------------

def test_hindi_reason_carries_the_same_number_as_english():
    """The two languages are generated from the same values, not translated.

    This is the property that matters: if Hindi were produced by parsing the
    English sentence, this is the test that would catch it drifting.
    """
    hits = evaluate({"systolic_bp": 167})
    top, _, _ = summarise(hits)
    row = next(r for r in top if r["code"] == "bp_high")
    assert "167" in row["text"]
    assert "167" in row["text_hi"]


def test_hindi_is_actually_devanagari():
    hi = text_hi_for("dose_missed", {"n": 50})
    assert hi
    assert any("ऀ" <= ch <= "ॿ" for ch in hi), hi


def test_missing_hindi_template_falls_back_to_empty_not_broken_text():
    """A rule added without a Hindi sentence must not render a hole.

    The interface falls back to English on an empty string. A half-formatted
    template — "{n} दिन से" with no n — would ship a visible defect.
    """
    assert text_hi_for("a_code_with_no_template", {"n": 1}) == ""


def test_hindi_template_missing_a_value_returns_empty():
    assert text_hi_for("no_contact", {}) == ""


def test_summarise_returns_both_languages():
    top, step_en, step_hi = summarise(evaluate({"adherence_7": 0.4}))
    assert top and step_en and step_hi
    assert step_en != step_hi


# ---- the rules themselves -------------------------------------------------

def test_rule_hits_carry_their_values():
    (hit,) = [h for h in evaluate({"systolic_bp": 185}) if h.code == "bp_very_high"]
    assert hit.values == {"n": 185}


def test_no_rule_fires_on_an_empty_record():
    assert evaluate({}) == []


def test_missing_value_is_not_treated_as_zero():
    """A senior with no BP reading must not look like a senior with BP 0.

    None and 0 arriving at the same branch is the classic way a missing
    measurement becomes an emergency.
    """
    assert [h.code for h in evaluate({"systolic_bp": None})] == []


def test_hits_come_back_strongest_first():
    hits = evaluate({"systolic_bp": 185, "adherence_7": 0.7})
    assert [h.contribution for h in hits] == sorted(
        (h.contribution for h in hits), reverse=True
    )
