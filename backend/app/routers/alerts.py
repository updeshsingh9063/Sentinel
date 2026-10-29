"""FR-4 and FR-5: the coordinator worklist and the alert budget.

The ranking, not the classification, is the product. A coordinator can act on
about ten seniors a day, so the endpoint returns a capped ordered list and
every item carries a reason and a next step.
"""

from datetime import date

from fastapi import APIRouter, Depends

from app.deps import CallerClient, get_caller
from app.schemas.core import WorklistItem

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("/worklist", response_model=list[WorklistItem])
def worklist(on: date | None = None, limit: int | None = None,
             caller: CallerClient = Depends(get_caller)):
    """Today for the signed-in coordinator, highest risk first.

    `limit` defaults to settings.alerts_per_coordinator_per_day. Returning more
    than the cap would defeat the point of having one.
    """
    raise NotImplementedError("join alerts to seniors, order by rank_in_day")


@router.post("/{alert_id}/acknowledge")
def acknowledge(alert_id: int, caller: CallerClient = Depends(get_caller)):
    raise NotImplementedError("set status=acknowledged, stamp the audit log")


@router.post("/{alert_id}/outcome")
def record_outcome(alert_id: int, result: str, note: str | None = None,
                   caller: CallerClient = Depends(get_caller)):
    """Coordinator verdict. This is what makes precision measurable at all."""
    raise NotImplementedError("upsert alert_feedback")
