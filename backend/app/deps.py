"""Request dependencies.

Every health-data route resolves the caller to a Supabase client carrying that
caller JWT. RLS then decides what is visible. The API never filters by role in
Python -- doing so would put the privacy guarantee in application code, where
the brief would be right not to trust it.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status
from supabase import Client

from app.core.supabase import client_for_user


@dataclass
class CallerClient:
    client: Client
    access_token: str


def get_caller(authorization: str | None = Header(default=None)) -> CallerClient:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    return CallerClient(client=client_for_user(token), access_token=token)
