"""Runtime settings, read from the environment (see .env.example)."""

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_DATABASE_URL = "postgresql://qarib:qarib_local_only@localhost:5432/qarib"
DEFAULT_USER_AGENT = "QaribBot/1.0 (+https://example.qa/bot; legal@example.qa)"


@dataclass(frozen=True)
class Settings:
    database_url: str = DEFAULT_DATABASE_URL
    # Plan P4: identify the bot with a contact URL/email. Replace example.qa once the domain exists.
    user_agent: str = DEFAULT_USER_AGENT
    # Plan P4: at most 1 request / 2 s / domain.
    min_interval_s: float = 2.0
    global_interval_s: float = 0.25
    request_timeout_s: float = 20.0
    max_response_bytes: int = 10 * 1024 * 1024
    max_redirects: int = 3
    robots_ttl_s: float = 24 * 3600
    # Plan 3.2: 3 consecutive 403/429/CAPTCHA => auto-disable the source.
    breaker_threshold: int = 3
    # Plan 3.6: a price that moves by more than this vs the 30-day median is held for review.
    outlier_ratio: float = 0.5
    outlier_min_history: int = 3
    # Abort a batch (publish nothing) when too many rows fail validation.
    max_invalid_ratio: float = 0.3
    invalid_ratio_min_rows: int = 10
    # Sanity bounds for a single grocery price, QAR.
    max_price_qar: float = 5000.0
    artefact_dir: Path = Path(".artefacts")
    azure_connection_string: str | None = None
    azure_container: str = "raw-artefacts"

    @classmethod
    def from_env(cls) -> "Settings":
        env = os.environ
        return cls(
            database_url=env.get("DATABASE_URL", DEFAULT_DATABASE_URL),
            user_agent=env.get("INGEST_USER_AGENT", DEFAULT_USER_AGENT),
            artefact_dir=Path(env.get("INGEST_ARTEFACT_DIR", ".artefacts")),
            azure_connection_string=env.get("AZURE_STORAGE_CONNECTION_STRING") or None,
            azure_container=env.get("INGEST_AZURE_CONTAINER", "raw-artefacts"),
        )
