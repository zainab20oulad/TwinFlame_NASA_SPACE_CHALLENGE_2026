
import pytest

from config.api_config import FirmsApiConfig, SensorSource


TEST_SECRET = "TEST_SECRET_KEY_12345"


def make_config(map_key=TEST_SECRET):
    source = SensorSource(
        key="NOAA20",
        firms_source="VIIRS_NOAA20_NRT",
        instrument="VIIRS",
        resolution_m=375,
        raw_subdir="noaa20",
        required_columns=(),
    )

    return FirmsApiConfig(
        base_url="https://example.com",
        area_endpoint="area/csv",
        map_key=map_key,
        sources={"NOAA20": source},
    )


def test_area_url_builds_expected_url():
    config = make_config()

    url = config.area_url(
        key="NOAA20",
        bbox="-10,27,-1,36",
        day_range=1,
    )

    assert url.startswith("https://example.com/area/csv/")
    assert TEST_SECRET in url
    assert "VIIRS_NOAA20_NRT" in url


def test_area_url_rejects_missing_api_key():
    config = make_config(map_key="")

    with pytest.raises(RuntimeError):
        config.area_url(key="NOAA20")


@pytest.mark.parametrize("day_range", [0, -1, 6, 100])
def test_area_url_rejects_invalid_day_range(day_range):
    config = make_config()

    with pytest.raises(ValueError, match="day_range"):
        config.area_url(
            key="NOAA20",
            day_range=day_range,
        )


@pytest.mark.parametrize(
    "bbox",
    [
        "invalid",
        "1,2,3",
        "https://example.com",
        "1,2,3,4,5",
    ],
)
def test_area_url_rejects_invalid_bbox(bbox):
    config = make_config()

    with pytest.raises(ValueError, match="bbox"):
        config.area_url(
            key="NOAA20",
            bbox=bbox,
        )


def test_area_url_can_be_redacted_before_logging():
    config = make_config()

    url = config.area_url(key="NOAA20")
    safe_url = config.redact(url)

    assert TEST_SECRET not in safe_url
    assert "***" in safe_url
