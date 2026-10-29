"""FR-3: risk scoring.

Read-only here. Scores are produced by the nightly job in services/scoring.py
and stored per senior-day, so the worklist is a cheap ordered read and the
ablation stays reproducible from the table.
"""

from datetime import date

from fastapi import APIRouter, Depends

from app.deps import CallerClient, get_caller
from app.schemas.core import RiskBreakdown

router = APIRouter(prefix="/risk", tags=["risk"])


@router.get("/{senior_id}", response_model=RiskBreakdown)
def get_risk(senior_id: str, on: date | None = None,
             caller: CallerClient = Depends(get_caller)):
    raise NotImplementedError("select from risk_scores with per-layer columns")


@router.get("/{senior_id}/baseline")
def get_baseline(senior_id: str, caller: CallerClient = Depends(get_caller)):
    """Layer B band for the sparkline: the senior own median and MAD.

    The brief is explicit that deviation from a personal baseline matters more
    than population averages, so the UI draws the band, not a fixed threshold.
    """
    raise NotImplementedError("compute rolling median/MAD over the window")
