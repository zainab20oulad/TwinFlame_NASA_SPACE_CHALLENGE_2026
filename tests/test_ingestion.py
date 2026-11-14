
import requests
import pytest

from config.api_config import FirmsApiConfig, SensorSource
from ingestion.firms_client import FirmsApiClient, FirmsApiError


TEST_SECRET = "TEST_SECRET_KEY_12345"


def make_config(max_retries=2, retry_delay=0):
    source = SensorSource(
        key="NOAA20",
        firms_source="VIIRS_NOAA20_NRT",
        instrument="VIIRS",
        resolution_m=375,
        raw_subdir="noaa20",
        required_columns=("latitude", "longitude"),
    )

    return FirmsApiConfig(
        base_url="https://example.com",
        area_endpoint="area/csv",
        map_key=TEST_SECRET,
        timeout=1,
        max_retries=max_retries,
        retry_delay=retry_delay,
        sources={"NOAA20": source},
    )


class FakeResponse:
    def __init__(self, text="", error=None):
        self.text = text
        self.error = error

    def raise_for_status(self):
        if self.error:
            raise self.error


class FakeSession:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    def get(self, url, timeout):
        self.calls += 1
        outcome = self.outcomes.pop(0)

        if isinstance(outcome, Exception):
            raise outcome

        return outcome


def test_fetch_area_parses_valid_csv():
    session = FakeSession([
        FakeResponse("latitude,longitude\n34.0,-5.0\n")
    ])
    client = FirmsApiClient(make_config(), session=session)

    rows = client.fetch_area("NOAA20")

    assert rows == [{"latitude": "34.0", "longitude": "-5.0"}]
    assert session.calls == 1


def test_parse_csv_rejects_empty_content():
    with pytest.raises(ValueError, match="Empty CSV"):
        FirmsApiClient._parse_csv("   ")


def test_parse_csv_rejects_missing_header():
    with pytest.raises(ValueError, match="header"):
        FirmsApiClient._parse_csv(",\n")


def test_parse_csv_rejects_malformed_row():
    with pytest.raises(ValueError, match="malformed"):
        FirmsApiClient._parse_csv("latitude,longitude\n34.0\n")


def test_fetch_area_retries_request_error(monkeypatch):
    monkeypatch.setattr(
        "ingestion.firms_client.time.sleep", lambda _: None
    )

    session = FakeSession([
        requests.ConnectionError("temporary failure"),
        FakeResponse("latitude,longitude\n34.0,-5.0\n"),
    ])
    client = FirmsApiClient(make_config(), session=session)

    rows = client.fetch_area("NOAA20")

    assert len(rows) == 1
    assert session.calls == 2


def test_fetch_area_does_not_expose_api_key(monkeypatch):
    monkeypatch.setattr(
        "ingestion.firms_client.time.sleep", lambda _: None
    )

    session = FakeSession([
        requests.ConnectionError(
            f"Connection failed: https://example.com/{TEST_SECRET}"
        )
    ])
    client = FirmsApiClient(
        make_config(max_retries=0), session=session
    )

    with pytest.raises(FirmsApiError) as exc_info:
        client.fetch_area("NOAA20")

    assert TEST_SECRET not in str(exc_info.value)


def test_fetch_area_does_not_retry_invalid_csv():
    session = FakeSession([FakeResponse("   ")])
    client = FirmsApiClient(make_config(), session=session)

    with pytest.raises(FirmsApiError, match="invalid CSV"):
        client.fetch_area("NOAA20")

    assert session.calls == 1


def test_parse_csv_rejects_missing_required_columns():
    with pytest.raises(ValueError, match="required columns"):
        FirmsApiClient._parse_csv(
            "latitude,longitude\n34.0,-5.0\n",
            required_columns=(
                "latitude",
                "longitude",
                "brightness",
            ),
        )
