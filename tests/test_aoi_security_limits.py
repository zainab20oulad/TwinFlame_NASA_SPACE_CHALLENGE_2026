
import json

import pytest
from fastapi import HTTPException

from app.backend.main import _parse_aoi


MAX_AOI_JSON_LENGTH = 50_000
MAX_POLYGON_POINTS = 500


@pytest.mark.xfail(
    strict=True,
    reason="AOI size limit is not implemented yet",
)
def test_rejects_aoi_exceeding_maximum_size():
    aoi = json.dumps({
        "type": "rectangle",
        "south": -10,
        "west": -20,
        "north": 10,
        "east": 20,
    })

    oversized_aoi = aoi.ljust(MAX_AOI_JSON_LENGTH + 1)

    with pytest.raises(HTTPException) as exc:
        _parse_aoi(oversized_aoi)

    assert exc.value.status_code == 422


def test_accepts_aoi_at_maximum_size():
    aoi = json.dumps({
        "type": "rectangle",
        "south": -10,
        "west": -20,
        "north": 10,
        "east": 20,
    })

    valid_aoi = aoi.ljust(MAX_AOI_JSON_LENGTH)

    result = _parse_aoi(valid_aoi)

    assert result["type"] == "rectangle"


@pytest.mark.xfail(
    strict=True,
    reason="Polygon point limit is not implemented yet",
)
def test_rejects_polygon_exceeding_maximum_points():
    points = [
        [34.0, -5.0]
        for _ in range(MAX_POLYGON_POINTS + 1)
    ]

    aoi = json.dumps({
        "type": "polygon",
        "points": points,
    })

    with pytest.raises(HTTPException) as exc:
        _parse_aoi(aoi)

    assert exc.value.status_code == 422


def test_accepts_polygon_at_maximum_points():
    points = [
        [34.0, -5.0]
        for _ in range(MAX_POLYGON_POINTS)
    ]

    aoi = json.dumps({
        "type": "polygon",
        "points": points,
    })

    result = _parse_aoi(aoi)

    assert result["type"] == "polygon"
    assert len(result["points"]) == MAX_POLYGON_POINTS
