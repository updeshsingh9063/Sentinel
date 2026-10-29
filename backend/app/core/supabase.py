"""Supabase client factories.

Two clients, deliberately separate:

  * anon  -- carries the caller JWT, so RLS applies. Use for anything a signed-in
             user triggers.
  * admin -- service role, bypasses RLS. Use only for the nightly scoring job
             and migrations. Never bind it to a user-facing route.
"""

from functools import lru_cache

from supabase import Client, create_client

from app.core.config import get_settings


def client_for_user(access_token: str) -> Client:
    s = get_settings()
    c = create_client(s.supabase_url, s.supabase_anon_key)
    c.postgrest.auth(access_token)
    return c


@lru_cache
def admin_client() -> Client:
    s = get_settings()
    if not s.supabase_service_role_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not set")
    return create_client(s.supabase_url, s.supabase_service_role_key)
