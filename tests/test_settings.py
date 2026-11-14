
from pathlib import Path

import pytest

from config.settings import Settings, _validate


def make_settings(**overrides):
    values = {
        "app_name": "TwinFlame",
        "app_env": "development",
        "log_level": "INFO",
        "api_host": "127.0.0.1",
        "api_port": 8000,
        "cors_allowed_origins": ("http://localhost:5173",),
        "raw_data_dir": Path("data/raw"),
        "validated_dir": Path("data/validated"),
        "cleaned_dir": Path("data/cleaned"),
        "standardized_dir": Path("data/standardized"),
        "harmonization_dir": Path("data/harmonization"),
        "log_dir": Path("logs"),
        "duckdb_path": Path("database/test.duckdb"),
        "duckdb_read_only": True,
        "duckdb_temp_dir": Path("database/tmp"),
        "duckdb_threads": 4,
        "firms_map_key": "",
        "api_timeout": 30,
        "api_max_retries": 3,
        "api_retry_delay": 5,
        "batch_size": 1000,
        "output_format": "parquet",
        "validate_coordinates": True,
        "validate_required_columns": True,
    }
    values.update(overrides)
    return Settings(**values)


@pytest.mark.parametrize("port", [0, -1, 65536])
def test_rejects_invalid_api_port(port):
    with pytest.raises(ValueError, match="API_PORT"):
        _validate(make_settings(api_port=port))


@pytest.mark.parametrize("timeout", [0, -1])
def test_rejects_invalid_api_timeout(timeout):
    with pytest.raises(ValueError, match="API_TIMEOUT"):
        _validate(make_settings(api_timeout=timeout))


def test_rejects_negative_retries():
    with pytest.raises(ValueError, match="API_MAX_RETRIES"):
        _validate(make_settings(api_max_retries=-1))


def test_rejects_zero_batch_size():
    with pytest.raises(ValueError, match="BATCH_SIZE"):
        _validate(make_settings(batch_size=0))


def test_rejects_unsupported_output_format():
    with pytest.raises(ValueError, match="OUTPUT_FORMAT"):
        _validate(make_settings(output_format="xml"))


def test_accepts_valid_settings():
    _validate(make_settings())

def test_rejects_invalid_app_env():
    with pytest.raises(ValueError, match="APP_ENV"):
        _validate(make_settings(app_env="invalid"))


def test_rejects_invalid_log_level():
    with pytest.raises(ValueError, match="LOG_LEVEL"):
        _validate(make_settings(log_level="TRACE"))


def test_rejects_empty_api_host():
    with pytest.raises(ValueError, match="API_HOST"):
        _validate(make_settings(api_host=""))


def test_rejects_empty_cors_origins():
    with pytest.raises(ValueError, match="CORS_ALLOWED_ORIGINS"):
        _validate(make_settings(cors_allowed_origins=()))


def test_rejects_wildcard_cors_in_production():
    with pytest.raises(ValueError, match="Wildcard CORS"):
        _validate(
            make_settings(
                app_env="production",
                cors_allowed_origins=("*",),
            )
        )


@pytest.mark.parametrize(
    "origin",
    [
        "https://example.com/path",
        "https://example.com?query=1",
        "not-a-url",
        "ftp://example.com",
    ],
)
def test_rejects_invalid_cors_origin(origin):
    with pytest.raises(ValueError, match="CORS origin"):
        _validate(make_settings(cors_allowed_origins=(origin,)))


def test_rejects_negative_retry_delay():
    with pytest.raises(ValueError, match="API_RETRY_DELAY"):
        _validate(make_settings(api_retry_delay=-1))


def test_rejects_zero_duckdb_threads():
    with pytest.raises(ValueError, match="DUCKDB_THREADS"):
        _validate(make_settings(duckdb_threads=0))

def test_settings_repr_does_not_expose_firms_map_key():
    secret = "TEST_SECRET_KEY_12345"
    settings = make_settings(firms_map_key=secret)

    assert secret not in repr(settings)

from config.api_config import FirmsApiConfig


def test_firms_api_config_repr_does_not_expose_map_key():
    secret = "TEST_SECRET_KEY_12345"

    config = FirmsApiConfig(
        base_url="https://example.com",
        area_endpoint="area/csv",
        map_key=secret,
    )

    assert secret not in repr(config)

def test_redact_hides_map_key_from_text():
    secret = "TEST_SECRET_KEY_12345"

    config = FirmsApiConfig(
        base_url="https://example.com",
        area_endpoint="area/csv",
        map_key=secret,
    )

    text = f"Request failed for URL containing key: {secret}"
    redacted = config.redact(text)

    assert secret not in redacted
    assert "***" in redacted
