
"""Secure HTTP client for NASA FIRMS area CSV requests."""

from __future__ import annotations

import csv
import io
import logging
import time
from datetime import date

import requests

from config.api_config import FirmsApiConfig

logger = logging.getLogger(__name__)


class FirmsApiError(RuntimeError):
    """Safe error raised when a NASA FIRMS request fails."""


class FirmsApiClient:
    def __init__(
        self,
        config: FirmsApiConfig,
        session: requests.Session | None = None,
    ) -> None:
        self.config = config
        self.session = (
            session if session is not None else requests.Session()
        )

    def fetch_area(
        self,
        key: str,
        bbox: str = "world",
        day_range: int = 1,
        on_date: date | str | None = None,
    ) -> list[dict[str, str]]:
        """Fetch FIRMS CSV and validate required columns."""

        source = self.config.sources.get(key)

        if source is None:
            raise FirmsApiError("Unknown NASA FIRMS data source")

        url = self.config.area_url(
            key=key,
            bbox=bbox,
            day_range=day_range,
            on_date=on_date,
        )

        for attempt in range(self.config.max_retries + 1):
            try:
                response = self.session.get(
                    url,
                    timeout=self.config.timeout,
                )
                response.raise_for_status()

                try:
                    return self._parse_csv(
                        response.text,
                        required_columns=source.required_columns,
                    )
                except (ValueError, csv.Error):
                    raise FirmsApiError(
                        "NASA FIRMS returned an invalid CSV response"
                    ) from None

            except requests.RequestException:
                if attempt < self.config.max_retries:
                    logger.warning(
                        "NASA FIRMS request failed "
                        "(attempt %d/%d); retrying",
                        attempt + 1,
                        self.config.max_retries + 1,
                    )
                    time.sleep(self.config.retry_delay)

        # Do not expose the original exception: it may contain
        # the complete URL, including the secret MAP_KEY.
        raise FirmsApiError(
            "NASA FIRMS request failed after "
            f"{self.config.max_retries + 1} attempts"
        ) from None

    @staticmethod
    def _parse_csv(
        content: str,
        required_columns: tuple[str, ...] = (),
    ) -> list[dict[str, str]]:
        """Parse CSV and validate its structure and required columns."""

        if not content.strip():
            raise ValueError("Empty CSV response")

        reader = csv.DictReader(io.StringIO(content))

        if not reader.fieldnames or any(
            not name.strip() for name in reader.fieldnames
        ):
            raise ValueError("CSV header is missing or invalid")

        if len(reader.fieldnames) != len(set(reader.fieldnames)):
            raise ValueError("CSV contains duplicate column names")

        missing_columns = set(required_columns) - set(
            reader.fieldnames
        )

        if missing_columns:
            raise ValueError("CSV is missing required columns")

        rows: list[dict[str, str]] = []

        for row in reader:
            if None in row or any(
                value is None for value in row.values()
            ):
                raise ValueError("CSV contains malformed rows")

            rows.append(row)

        return rows
