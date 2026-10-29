"""FR-1: signal ingestion.

Accepts the three signal families the brief requires -- vitals, medication
logs, call notes -- plus IVR check-ins. Writes go through the caller JWT so
RLS decides whether this coordinator may touch this senior.
"""

from fastapi import APIRouter, Depends, status

from app.deps import CallerClient, get_caller
from app.schemas.core import CallNoteIn, CheckinIn, MedLogIn, VitalsIn

router = APIRouter(prefix="/ingest", tags=["ingest"])


@router.post("/vitals", status_code=status.HTTP_201_CREATED)
def post_vitals(payload: VitalsIn, caller: CallerClient = Depends(get_caller)):
    raise NotImplementedError("upsert into vitals; tolerate partial readings")


@router.post("/medications", status_code=status.HTTP_201_CREATED)
def post_medication(payload: MedLogIn, caller: CallerClient = Depends(get_caller)):
    raise NotImplementedError("insert into medication_logs; keep taken=None distinct")


@router.post("/call-notes", status_code=status.HTTP_201_CREATED)
def post_call_note(payload: CallNoteIn, caller: CallerClient = Depends(get_caller)):
    raise NotImplementedError(
        "insert into call_notes, then enqueue cue extraction (FR-2)")


@router.post("/checkin", status_code=status.HTTP_201_CREATED)
def post_checkin(payload: CheckinIn, caller: CallerClient = Depends(get_caller)):
    raise NotImplementedError("upsert into checkins; answered=False is a signal")
