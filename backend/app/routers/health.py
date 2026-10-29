from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter(tags=["meta"])


@router.get("/healthz")
def healthz() -> dict:
    s = get_settings()
    return {"ok": True, "environment": s.environment, "model": s.model_version}
