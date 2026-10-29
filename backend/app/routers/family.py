"""Family-facing read.

Two guards, both outside this module: RLS requires a family_links row plus a
granted family_summary consent, and the text itself has passed the
never-diagnose gate in privacy/safety.py before it was ever stored.

There is deliberately no endpoint here that returns vitals, notes, cues or
risk scores. A family member has no RLS policy on those tables.
"""

from fastapi import APIRouter, Depends

from app.deps import CallerClient, get_caller

router = APIRouter(prefix="/family", tags=["family"])


@router.get("/summary/{senior_id}")
def get_summary(senior_id: str, caller: CallerClient = Depends(get_caller)):
    raise NotImplementedError("select latest family_summaries row")


@router.put("/consent/{senior_id}")
def set_consent(senior_id: str, scope: str, granted: bool,
                caller: CallerClient = Depends(get_caller)):
    """The one write a family member has. Scope is per channel."""
    raise NotImplementedError("update consents, append to audit_log")
