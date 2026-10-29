"""Senior channel: simulated IVR.

The brief forbids a senior-facing app, so this models a phone call. The
frontend route /checkin is a simulator for the demo, not a product surface --
real deployment would put a telephony provider in front of these handlers.

Accessibility is 15 percent of the judged score, which is why this is a P0
surface and not a stretch goal.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/checkin", tags=["senior"])


@router.get("/script/{senior_id}")
def get_script(senior_id: str, lang: str = "hi"):
    """The questions to read aloud, in the senior preferred language.

    Keypad answers only: 1, 2 or 3. No speech recognition required for the
    core loop, so it degrades to a basic handset.
    """
    raise NotImplementedError("render the IVR script from a template")


@router.post("/response/{senior_id}")
def post_response(senior_id: str, step: str, keypress: int):
    raise NotImplementedError("append to checkins, advance the script")


@router.post("/voice-note/{senior_id}")
def post_voice_note(senior_id: str):
    """Optional free-form recording, transcribed by self-hosted Whisper.

    Audio lands in a private Storage bucket. Requires voice_recording consent.
    """
    raise NotImplementedError("store audio, enqueue ASR then cue extraction")
