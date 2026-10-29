"""Ops view: aggregates only.

Backed by the ops_daily_metrics view, which is security-definer and has
already aggregated away the individual. Ops holds no table-level policy
anywhere in the schema, so this is the whole of its access.
"""

from fastapi import APIRouter, Depends

from app.deps import CallerClient, get_caller

router = APIRouter(prefix="/ops", tags=["ops"])


@router.get("/metrics")
def daily_metrics(days: int = 30, caller: CallerClient = Depends(get_caller)):
    raise NotImplementedError("select from ops_daily_metrics")
