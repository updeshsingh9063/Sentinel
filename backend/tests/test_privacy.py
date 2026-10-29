"""The two gates the brief treats as hard constraints."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from app.privacy.masking import assert_masked, mask, unmask
from app.privacy.safety import Channel, UnsafeMessage, assert_safe, check


# ----------------------------------------------------------- never diagnose --

@pytest.mark.parametrize("text", [
    "Looks like early dementia, please consult.",
    "She has diabetes and needs a dose change.",
    "These are symptoms of pneumonia.",
    "Aapko sugar ki bimari hai.",
])
def test_family_channel_rejects_diagnosis(text):
    assert not check(text, Channel.FAMILY).ok
    with pytest.raises(UnsafeMessage):
        assert_safe(text, Channel.FAMILY)


@pytest.mark.parametrize("text", [
    "Mummy seemed more tired than usual this week. A nurse will call today.",
    "We could not reach her on two calls. Someone is visiting this evening.",
])
def test_family_channel_allows_plain_observation(text):
    assert check(text, Channel.FAMILY).ok


def test_condition_names_banned_even_for_coordinators():
    # A coordinator may read trends, but the system still must not conclude.
    assert not check("Probable stroke risk.", Channel.COORDINATOR).ok


def test_coordinator_may_see_clinical_framing_without_condition_names():
    text = "Systolic BP above personal baseline for 6 days; 3 doses missed."
    assert check(text, Channel.COORDINATOR).ok


def test_word_boundaries_do_not_cause_false_positives():
    # "uti" inside "routine", "infection" inside "disinfection"
    assert check("Routine check done, disinfection complete.",
                 Channel.FAMILY).ok


def test_all_violations_reported_not_just_first():
    r = check("He has diabetes and dementia.", Channel.FAMILY)
    assert {"diabetes", "dementia", "he has"} <= set(r.violations)


# ------------------------------------------------------------- PII masking ---

@pytest.mark.parametrize("note", [
    "Called her on 9876543210, no answer.",
    "Called her on 98765 43210, no answer.",
    "Called her on +91 98765-43210, no answer.",
    "Beta number 091-9876543210 diya tha.",
])
def test_masks_phone_in_every_common_format(note):
    r = mask(note)
    assert "9876543210" not in r.text.replace(" ", "").replace("-", "")
    assert unmask(r.text, r.mapping) == note


def test_does_not_mask_non_phone_digit_runs():
    # BP readings and glucose values must survive untouched.
    r = mask("BP 142/88, glucose 193, weight 61.5")
    assert r.text == "BP 142/88, glucose 193, weight 61.5"


def test_masks_known_names_with_stable_placeholders():
    r = mask("Sunita said Sunita was fine", known_names=["Sunita"])
    assert "Sunita" not in r.text
    # Same value must reuse one placeholder, not allocate two.
    assert len(r.mapping) == 1


def test_flags_aadhaar_because_it_should_never_appear():
    r = mask("ID 1234 5678 9012 on file")
    assert "aadhaar_present" in r.flagged
    assert "1234 5678 9012" not in r.text


def test_assert_masked_fails_closed_on_unmasked_text():
    with pytest.raises(ValueError):
        assert_masked("reach me at 9876543210")
    assert assert_masked("reach me at [PHONE_1]")
