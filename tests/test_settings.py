
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
