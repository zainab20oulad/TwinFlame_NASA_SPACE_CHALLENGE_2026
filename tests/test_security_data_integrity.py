
import pandas as pd
import pytest

from validation.data_quality_validator import DataQualityValidator


@pytest.fixture
def valid_row():
    return pd.DataFrame({
        "latitude": [35.0],
        "longitude": [-5.0],
        "acq_date": ["2026-11-15"],
        "acq_time": [1030],
        "satellite": ["TERRA"],
        "instrument": ["MODIS"],
        "confidence": [80],
        "version": ["6.1"],
        "scan": [1.0],
        "track": [1.0],
        "frp": [12.5],
        "daynight": ["D"],
        "brightness": [310.0],
        "bright_t31": [290.0],
    })


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("latitude", 90.1),
        ("latitude", -90.1),
        ("longitude", 180.1),
        ("longitude", -180.1),
        ("frp", -0.1),
        ("scan", 0),
        ("track", -1),
    ],
)
def test_invalid_ranges_are_rejected(valid_row, column, value):
    data = valid_row.copy()
    data.loc[0, column] = value

    result = DataQualityValidator().validate(data)

    assert result["metrics"]["rejected_rows"] == 1



@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("latitude", "invalid"),
        ("longitude", "invalid"),
        ("frp", "invalid"),
        ("scan", float("inf")),
        ("track", float("nan")),
    ],
)

def test_invalid_numeric_values_are_rejescted(
    valid_row, column, value
):
    data = valid_row.copy()

    # Allow invalid values in numeric columns under pandas 3.x.
    data[column] = data[column].astype(object)
    data.at[0, column] = value

    result = DataQualityValidator().validate(data)

    assert result["metrics"]["rejected_rows"] == 1


    # Allow invalid strings in numeric columns under pandas 3.x.
    data[column] = data[column].astype(object)
    data.loc[0, column] = value

    result = DataQualityValidator().validate(data)

    assert result["metrics"]["rejected_rows"] == 1



def test_missing_required_column_raises(valid_row):
    data = valid_row.drop(columns=["latitude"])

    with pytest.raises(ValueError, match="missing required columns"):
        DataQualityValidator().validate(data)


def test_valid_row_is_preserved(valid_row):
    result = DataQualityValidator().validate(valid_row)

    assert result["metrics"]["input_rows"] == 1
    assert result["metrics"]["valid_rows"] == 1
    assert result["metrics"]["rejected_rows"] == 0


def test_duplicate_rows_are_detected_or_documented(valid_row):
    data = pd.concat([valid_row, valid_row], ignore_index=True)

    result = DataQualityValidator().validate(data)

    # Current validator does not implement duplicate detection.
    # This test documents that limitation rather than hiding it.
    assert result["metrics"]["input_rows"] == 2
    assert result["metrics"]["valid_rows"] == 2
