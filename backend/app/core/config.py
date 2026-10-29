"""Settings, read from the environment. See .env.example at the repo root."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Samarth Sentinel API"
    environment: str = "development"

    # Supabase. The service-role key bypasses RLS, so it stays server-side and
    # is used only by the scoring job, never on a request path driven by a user.
    supabase_url: str = "http://localhost:54321"
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""

    # Alert budget. The brief weighs precision as heavily as recall, so the cap
    # is configuration rather than a magic number in the ranker.
    alerts_per_coordinator_per_day: int = 10
    alert_cooldown_days: int = 3
    escalate_after_consecutive_days: int = 3

    # Layer B baseline window.
    baseline_window_days: int = 21
    baseline_min_observations: int = 7

    model_version: str = "v0.1.0-dev"


@lru_cache
def get_settings() -> Settings:
    return Settings()
