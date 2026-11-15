import pytest

from config.api_config import FirmsApiConfig, SensorSource


def make_config(base_url):
    source = SensorSource(
        key="NOAA20",
        firms_source="VIIRS_NOAA20_NRT",
        instrument="VIIRS",
        resolution_m=375,
        raw_subdir="NOAA20",
        required_columns=(),
    )

    return FirmsApiConfig(
        base_url=base_url,
        area_endpoint="area/csv",
        map_key="FAKE_TEST_KEY",
        sources={"NOAA20": source},
    )


@pytest.mark.parametrize(
    "base_url",
    [
        "http://example.com/api",
        "ftp://example.com/api",
        "https:///missing-host",
        "https://user:password@example.com/api",
        "https://example.com/api?token=secret",
        "https://example.com/api#fragment",
    ],
)
def test_invalid_base_urls_are_rejected(base_url):
    cfg = make_config(base_url)
    with pytest.raises(ValueError):
        cfg.area_url("NOAA20")


def test_https_url_is_accepted():
    cfg = make_config("https://example.com/api")
    url = cfg.area_url("NOAA20")
    assert url.startswith("https://example.com/api/")
