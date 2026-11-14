"""Central application settings for TwinFlame.

Reads .env (via python-dotenv) and exposes a single immutable ``Settings`` object.
Secrets stay in the environment; non-secret source definitions live in sources.yaml
(see api_config.py).

Usage:
    from config.settings import get_settings
    settings = get_settings()
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]

# Real environment variables win over .env (override=False).
load_dotenv(PROJECT_ROOT / ".env", override=False)

VALID_ENVS = {"development", "test", "staging", "production"}
VALID_OUTPUT_FORMATS = {"parquet", "csv"}


# ------------------------------------------------------------------
# Environment helpers
# ------------------------------------------------------------------
def _get_str(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _get_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from exc


def _get_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean (true/false), got {raw!r}")


def _get_list(name: str, default: str = "") -> tuple[str, ...]:
    raw = os.getenv(name, default)
    return tuple(item.strip() for item in raw.split(",") if item.strip())


def _get_path(name: str, default: str) -> Path:
    """Resolve a path from the environment; relative paths are anchored at the project root."""
    path = Path(_get_str(name, default)).expanduser()
    return path if path.is_absolute() else (PROJECT_ROOT / path).resolve()


# ------------------------------------------------------------------
# Settings
# ------------------------------------------------------------------
@dataclass(frozen=True)
class Settings:
    # Application
    app_name: str
    app_env: str
    log_level: str

    # Backend API (FastAPI)
    api_host: str
    api_port: int
    cors_allowed_origins: tuple[str, ...]

    # Data locations
    raw_data_dir: Path
    validated_dir: Path
    cleaned_dir: Path
    standardized_dir: Path
    harmonization_dir: Path
    log_dir: Path

    # DuckDB
    duckdb_path: Path
    duckdb_read_only: bool
    duckdb_temp_dir: Path
    duckdb_threads: int

    # NASA FIRMS (repr=False keeps the key out of logs and tracebacks)
    firms_map_key: str = field(repr=False)

    # Request behaviour
    api_timeout: int
    api_max_retries: int
    api_retry_delay: int

    # Processing
    batch_size: int
    output_format: str

    # Validation
    validate_coordinates: bool
    validate_required_columns: bool

    # -- convenience ---------------------------------------------------
    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def firms_key_configured(self) -> bool:
        return bool(self.firms_map_key) and self.firms_map_key != "your_firms_map_key_here"

    def require_firms_key(self) -> str:
        """Return the MAP_KEY or fail early. Call this from ingestion entry points only."""
        if not self.firms_key_configured:
            raise RuntimeError(
                "FIRMS_MAP_KEY is not set. Request a free key at "
                "https://firms.modaps.eosdis.nasa.gov/api/map_key/ and add it to .env"
            )
        return self.firms_map_key

    def ensure_directories(self) -> None:
        """Create the writable directories the pipeline needs."""
        for path in (
            self.raw_data_dir,
            self.validated_dir,
            self.cleaned_dir,
            self.standardized_dir,
            self.harmonization_dir,
            self.log_dir,
            self.duckdb_temp_dir,
            self.duckdb_path.parent,
        ):
            path.mkdir(parents=True, exist_ok=True)


def _validate(settings: Settings) -> None:
    if settings.app_env not in VALID_ENVS:
        raise ValueError(f"APP_ENV must be one of {sorted(VALID_ENVS)}, got {settings.app_env!r}")
    if settings.output_format not in VALID_OUTPUT_FORMATS:
        raise ValueError(
            f"OUTPUT_FORMAT must be one of {sorted(VALID_OUTPUT_FORMATS)}, got {settings.output_format!r}"
        )
    if not 1 <= settings.api_port <= 65535:
        raise ValueError("API_PORT must be between 1 and 65535")
    if settings.batch_size <= 0:
        raise ValueError("BATCH_SIZE must be greater than 0")
    if settings.duckdb_threads <= 0:
        raise ValueError("DUCKDB_THREADS must be greater than 0")
    if settings.api_max_retries < 0 or settings.api_retry_delay < 0 or settings.api_timeout <= 0:
        raise ValueError("API_TIMEOUT must be > 0 and API_MAX_RETRIES / API_RETRY_DELAY must be >= 0")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings(
        app_name=_get_str("APP_NAME", "TwinFlame"),
        app_env=_get_str("APP_ENV", "development").lower(),
        log_level=_get_str("LOG_LEVEL", "INFO").upper(),
        api_host=_get_str("API_HOST", "127.0.0.1"),
        api_port=_get_int("API_PORT", 8000),
        cors_allowed_origins=_get_list(
            "CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ),
        raw_data_dir=_get_path("RAW_DATA_DIR", "data/raw"),
        validated_dir=_get_path("VALIDATED_DIR", "data/processed/validated"),
        cleaned_dir=_get_path("CLEANED_DIR", "data/processed/cleaned"),
        standardized_dir=_get_path("STANDARDIZED_DIR", "data/processed/standardized"),
        harmonization_dir=_get_path("HARMONIZATION_DIR", "data/harmonization"),
        log_dir=_get_path("LOG_DIR", "logs"),
        duckdb_path=_get_path("DUCKDB_PATH", "database/twinflame.duckdb"),
        duckdb_read_only=_get_bool("DUCKDB_READ_ONLY", True),
        duckdb_temp_dir=_get_path("DUCKDB_TEMP_DIR", "database/tmp_spill"),
        duckdb_threads=_get_int("DUCKDB_THREADS", 4),
        firms_map_key=_get_str("FIRMS_MAP_KEY"),
        api_timeout=_get_int("API_TIMEOUT", 30),
        api_max_retries=_get_int("API_MAX_RETRIES", 3),
        api_retry_delay=_get_int("API_RETRY_DELAY", 5),
        batch_size=_get_int("BATCH_SIZE", 100_000),
        output_format=_get_str("OUTPUT_FORMAT", "parquet").lower(),
        validate_coordinates=_get_bool("VALIDATE_COORDINATES", True),
        validate_required_columns=_get_bool("VALIDATE_REQUIRED_COLUMNS", True),
    )
    _validate(settings)
    return settings