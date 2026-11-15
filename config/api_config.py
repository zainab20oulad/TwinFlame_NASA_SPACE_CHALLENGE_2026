
"""NASA FIRMS API configuration for TwinFlame.

Combines secrets/runtime options from settings.py with the static source
definitions in sources.yaml. Configuration only: no HTTP calls happen here
(that belongs to ingestion/firms_client.py).

Usage:
    from config.api_config import get_firms_config

    cfg = get_firms_config()
    url = cfg.area_url("NOAA20", "-10,27,-1,36", day_range=1)
    logger.info("GET %s", cfg.redact(url))
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date as date_type
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import yaml

from .settings import Settings, get_settings


SOURCES_FILE = Path(__file__).with_name("sources.yaml")

_BBOX_RE = re.compile(
    r"^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$"
)


# ----------------------------------------------------------
# Input validation
# ----------------------------------------------------------

def validate_bbox(bbox: str) -> None:
    """Validate geographic bounding box coordinates."""

    if bbox == "world":
        return

    if not isinstance(bbox, str) or not _BBOX_RE.fullmatch(bbox):
        raise ValueError(
            "bbox must be 'world' or "
            "'west,south,east,north' in decimal degrees"
        )

    west, south, east, north = map(float, bbox.split(","))

    if not (-180 <= west <= 180 and -180 <= east <= 180):
        raise ValueError(
            "Longitude must be between -180 and 180"
        )

    if not (-90 <= south <= 90 and -90 <= north <= 90):
        raise ValueError(
            "Latitude must be between -90 and 90"
        )

    if west >= east:
        raise ValueError(
            "West must be less than East"
        )

    if south >= north:
        raise ValueError(
            "South must be less than North"
        )


def validate_date(on_date: date_type | str | None) -> str | None:
    """Validate date and return YYYY-MM-DD format."""

    if on_date is None:
        return None

    if isinstance(on_date, date_type):
        return on_date.isoformat()

    if not isinstance(on_date, str):
        raise ValueError(
            "Date must be YYYY-MM-DD"
        )

    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", on_date):
        raise ValueError(
            "Invalid date format. Expected YYYY-MM-DD"
        )

    try:
        parsed_date = date_type.fromisoformat(on_date)
    except ValueError as exc:
        raise ValueError(
            "Invalid calendar date"
        ) from exc

    return parsed_date.isoformat()


# ----------------------------------------------------------
# Data source definitions
# ----------------------------------------------------------

@dataclass(frozen=True)
class SensorSource:
    key: str
    firms_source: str
    instrument: str
    resolution_m: int
    raw_subdir: str
    required_columns: tuple[str, ...]
    enabled: bool = True


@dataclass(frozen=True)
class FirmsApiConfig:
    base_url: str
    area_endpoint: str
    map_key: str = field(repr=False)
    timeout: int = 30
    max_retries: int = 3
    retry_delay: int = 5
    max_day_range: int = 5
    transactions_per_window: int = 5000
    window_seconds: int = 600
    sources: dict[str, SensorSource] = field(default_factory=dict)
    raw_api_dir: Path = Path("data/raw/api")

    # ------------------------------------------------------
    # Sources
    # ------------------------------------------------------

    def enabled_sources(self) -> list[SensorSource]:
        return [
            source
            for source in self.sources.values()
            if source.enabled
        ]

    def get_source(self, key: str) -> SensorSource:
        try:
            return self.sources[key]
        except KeyError as exc:
            raise KeyError(
                f"Unknown source {key!r}. "
                f"Available: {sorted(self.sources)}"
            ) from exc

    def raw_dir(self, key: str) -> Path:
        """Return the raw data directory for a sensor."""

        return (
            self.raw_api_dir
            / self.get_source(key).raw_subdir
        )

    # ------------------------------------------------------
    # URLs
    # ------------------------------------------------------

    def area_url(
        self,
        key: str,
        bbox: str = "world",
        day_range: int = 1,
        on_date: date_type | str | None = None,
    ) -> str:
        """Build a validated NASA FIRMS area URL.

        The MAP_KEY is part of the URL path.
        Never log this URL without redaction.
        """

        parsed_url = urlsplit(self.base_url)

        if (
            parsed_url.scheme.lower() != "https"
            or not parsed_url.hostname
            or parsed_url.username is not None
            or parsed_url.password is not None
            or parsed_url.query
            or parsed_url.fragment
        ):
            raise ValueError(
                "FIRMS base_url must be a valid HTTPS URL "
                "without credentials, query, or fragment"
            )

        if not self.map_key:
            raise RuntimeError(
                "FIRMS_MAP_KEY is not set (see .env.example)"
            )

        if (
            isinstance(day_range, bool)
            or not isinstance(day_range, int)
            or not 1 <= day_range <= self.max_day_range
        ):
            raise ValueError(
                f"day_range must be between 1 and "
                f"{self.max_day_range}"
            )

        # FIX 1: Validate bounding box coordinates
        validate_bbox(bbox)

        # FIX 2: Validate date
        validated_date = validate_date(on_date)

        source = self.get_source(key).firms_source

        parts = [
            self.base_url.rstrip("/"),
            self.area_endpoint.strip("/"),
            self.map_key,
            source,
            bbox,
            str(day_range),
        ]

        if validated_date is not None:
            parts.append(validated_date)

        return "/".join(parts)

    def redact(self, text: str) -> str:
        """Hide MAP_KEY in URLs, logs and error messages."""

        return (
            text.replace(self.map_key, "***")
            if self.map_key
            else text
        )


# ----------------------------------------------------------
# YAML configuration
# ----------------------------------------------------------

def _load_yaml(path: Path = SOURCES_FILE) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}

    if "firms" not in data:
        raise ValueError(
            f"{path.name}: missing top-level 'firms' section"
        )

    return data


def load_sources_yaml() -> dict[str, Any]:
    """Return the full parsed sources.yaml."""

    return _load_yaml()


def _build_sources(
    raw: dict[str, Any]
) -> dict[str, SensorSource]:

    sources: dict[str, SensorSource] = {}

    for key, spec in raw.items():
        sources[key] = SensorSource(
            key=key,
            firms_source=spec["firms_source"],
            instrument=spec["instrument"],
            resolution_m=int(spec["resolution_m"]),
            raw_subdir=spec.get("raw_subdir", key),
            required_columns=tuple(
                spec.get("required_columns", [])
            ),
            enabled=bool(
                spec.get("enabled", True)
            ),
        )

    return sources


# ----------------------------------------------------------
# Build configuration
# ----------------------------------------------------------

def build_firms_config(
    settings: Settings | None = None
) -> FirmsApiConfig:

    settings = settings or get_settings()

    firms = _load_yaml()["firms"]
    limits = firms.get("limits", {})

    return FirmsApiConfig(
        base_url=firms["base_url"],
        area_endpoint=firms.get(
            "area_endpoint", "area/csv"
        ),
        map_key=settings.firms_map_key,
        timeout=settings.api_timeout,
        max_retries=settings.api_max_retries,
        retry_delay=settings.api_retry_delay,
        max_day_range=int(
            limits.get("max_day_range", 5)
        ),
        transactions_per_window=int(
            limits.get("transactions_per_window", 5000)
        ),
        window_seconds=int(
            limits.get("window_seconds", 600)
        ),
        sources=_build_sources(
            firms.get("sources", {})
        ),
        raw_api_dir=settings.raw_data_dir / "api",
    )


@lru_cache(maxsize=1)
def get_firms_config() -> FirmsApiConfig:
    return build_firms_config()
