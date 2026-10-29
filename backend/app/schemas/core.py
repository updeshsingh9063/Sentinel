"""Request and response shapes shared by the routers."""

from __future__ import annotations

from datetime import date
from enum import Enum

from pydantic import BaseModel, Field


class CueType(str, Enum):
    PAIN = "pain"
    FALL = "fall"
    CONFUSION = "confusion"
    LOW_APPETITE = "low_appetite"
    LONELINESS = "loneliness"
    DIZZINESS = "dizziness"
    POOR_SLEEP = "poor_sleep"
    BREATHLESSNESS = "breathlessness"


class VitalsIn(BaseModel):
    senior_id: str
    measured_on: date
    systolic_bp: float | None = None
    diastolic_bp: float | None = None
    pulse_bpm: float | None = None
    spo2_pct: float | None = None
    weight_kg: float | None = None
    glucose_mgdl: float | None = None
    temperature_c: float | None = None


class MedLogIn(BaseModel):
    senior_id: str
    due_on: date
    drug_name: str
    dose: str | None = None
    # None means unknown rather than missed. Unknown is itself a signal, so the
    # distinction has to survive into the feature layer.
    taken: bool | None = None


class CallNoteIn(BaseModel):
    senior_id: str
    called_on: date
    reached: bool = True
    note_text: str | None = None
    note_lang: str = "hinglish"


class CheckinIn(BaseModel):
    """One IVR response. Keypad only, so every field is a small integer."""

    senior_id: str
    checked_on: date
    answered: bool
    feeling_code: int | None = Field(None, ge=1, le=3)
    pain_code: int | None = Field(None, ge=1, le=3)
    meds_taken: bool | None = None


class Reason(BaseModel):
    """One line of the explanation shown next to an alert."""

    code: str
    # Plain language, non-diagnostic. Goes through the safety gate before send.
    text: str
    contribution: float


class WorklistItem(BaseModel):
    senior_id: str
    display_name: str
    age: int
    score: float
    rank: int
    reasons: list[Reason]
    next_step: str
    days_since_last_contact: int | None = None


class RiskBreakdown(BaseModel):
    """Per-layer scores, so the ablation is visible in the API, not just logs."""

    senior_id: str
    scored_on: date
    score: float
    rules_score: float | None = None
    baseline_score: float | None = None
    ml_score: float | None = None
    nlp_score: float | None = None
    model_version: str
    reasons: list[Reason] = []
