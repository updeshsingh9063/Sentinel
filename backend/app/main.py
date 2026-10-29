"""Samarth Sentinel API.

One FastAPI app in front of Supabase. Python throughout so the API, the NLP
layer and the models share one language, as the PRD specifies.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.routers import alerts, checkin, family, health, ingest, ops, risk

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version=settings.model_version,
    description=(
        "Flags seniors who need attention today, with a reason and a next "
        "step. Does not diagnose."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (health.router, ingest.router, risk.router, alerts.router,
          family.router, ops.router, checkin.router):
    app.include_router(r)
