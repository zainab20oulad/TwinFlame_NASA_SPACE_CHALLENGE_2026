"""Read-only API endpoints for the TwinFlame dashboard."""

from __future__ import annotations

import json
import logging
import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import duckdb
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from config.settings import get_settings

logger = logging.getLogger(__name__)

Platform = Literal["all", "terra", "aqua", "noaa20", "noaa21"]
Region = Literal[
    "global", "africa", "asia", "europe", "north-america", "oceania", "south-america"
]
DayNight = Literal["all", "day", "night"]
Period = Literal["today", "24h", "7d", "30d", "all", "custom"]
MonitoringWindow = Literal["1h", "6h", "12h", "24h", "48h", "custom"]
Sensor = Literal["all", "modis", "viirs"]
DetectionStatus = Literal["all", "new", "processed", "harmonized", "unmatched"]
MembershipQuality = Literal["all", "strong", "possible", "rejected"]

REGION_BOUNDS = {
    "africa": (-20.0, -40.0, 55.0, 38.0),
    "asia": (25.0, -12.0, 180.0, 82.0),
    "europe": (-25.0, 34.0, 45.0, 72.0),
    "north-america": (-170.0, 5.0, -50.0, 84.0),
    "oceania": (110.0, -50.0, 180.0, 0.0),
    "south-america": (-85.0, -57.0, -30.0, 14.0),
}
REQUIRED_TABLES = {
    "unified_detections",
    "harm_activity_clusters",
    "harm_cluster_members",
    "harm_correspondence_edges",
    "harm_correspondence_summary",
    "harm_run_metadata",
}
ACQUISITION_TIMESTAMP = """
    acq_date + COALESCE(
        TRY_CAST(
            TRY_STRPTIME(
                LPAD(REGEXP_REPLACE(COALESCE(acq_time, ''), '[^0-9]', '', 'g'), 4, '0'),
                '%H%M'
            ) AS TIME
        ),
        TIME '00:00:00'
    )
"""

app = FastAPI(title="TwinFlame Dashboard API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(get_settings().cors_allowed_origins),
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _platform_condition(platform: str, column: str) -> str:
    if platform == "all":
        return ""
    compact = f"REGEXP_REPLACE(UPPER(COALESCE({column}, '')), '[^A-Z0-9]', '', 'g')"
    if platform == "terra":
        return f"({compact} LIKE '%TERRA%')"
    if platform == "aqua":
        return f"({compact} LIKE '%AQUA%')"
    return f"({compact} LIKE '%{platform.upper()}%')"


def _filtered_detections(
    *,
    period: Period,
    platform: Platform,
    region: Region,
    daynight: DayNight,
    frp_min: float | None,
    frp_max: float | None,
    start_date: date | None,
    end_date: date | None,
    now: datetime,
) -> tuple[str, list[object]]:
    conditions: list[str] = []
    parameters: list[object] = []

    if period == "today":
        conditions.append("acq_date = ?")
        parameters.append(now.date())
    elif period == "24h":
        conditions.append(f"{ACQUISITION_TIMESTAMP} BETWEEN ? AND ?")
        parameters.extend((now - timedelta(hours=24), now))
    elif period in ("7d", "30d"):
        days = 6 if period == "7d" else 29
        conditions.append("acq_date >= ?")
        parameters.append(now.date() - timedelta(days=days))
    elif period == "custom":
        if start_date is None or end_date is None:
            raise HTTPException(
                status_code=422,
                detail="Custom date ranges require both start_date and end_date.",
            )
        if start_date > end_date:
            raise HTTPException(
                status_code=422,
                detail="start_date must be on or before end_date.",
            )
        conditions.extend(("acq_date >= ?", "acq_date <= ?"))
        parameters.extend((start_date, end_date))

    if period != "all" and period != "custom" and period != "24h":
        conditions.append("acq_date <= ?")
        parameters.append(now.date())

    platform_clauses = [
        _platform_condition(platform, "platform"),
        _platform_condition(platform, "source"),
    ]
    platform_clauses = [clause for clause in platform_clauses if clause]
    if platform_clauses:
        conditions.append("(" + " OR ".join(platform_clauses) + ")")

    if region != "global":
        west, south, east, north = REGION_BOUNDS[region]
        conditions.append("longitude BETWEEN ? AND ? AND latitude BETWEEN ? AND ?")
        parameters.extend((west, east, south, north))

    if daynight == "day":
        conditions.append("UPPER(COALESCE(daynight, '')) IN ('D', 'DAY')")
    elif daynight == "night":
        conditions.append("UPPER(COALESCE(daynight, '')) IN ('N', 'NIGHT')")

    if frp_min is not None:
        conditions.append("frp_mw >= ?")
        parameters.append(frp_min)
    if frp_max is not None:
        conditions.append("frp_mw <= ?")
        parameters.append(frp_max)

    where_clause = " AND ".join(conditions) if conditions else "TRUE"
    query = f"""
        SELECT detection_id, platform, source, latitude, longitude, acq_date,
               acq_time, frp_mw, daynight,
               {ACQUISITION_TIMESTAMP} AS acquisition_timestamp
        FROM UNIFIED_DETECTIONS
        WHERE {where_clause}
    """
    return query, parameters


def _latest_successful_run_cte() -> str:
    return """
        latest_successful_run AS (
            SELECT run_id
            FROM harm_run_metadata
            WHERE LOWER(COALESCE(status, '')) IN ('success', 'succeeded', 'complete', 'completed')
            ORDER BY COALESCE(finished_at_utc, started_at_utc) DESC
            LIMIT 1
        )
    """


def _summary_date_conditions(
    period: Period,
    now: datetime,
    start_date: date | None,
    end_date: date | None,
) -> tuple[list[str], list[object]]:
    conditions: list[str] = []
    parameters: list[object] = []
    if period == "today":
        conditions.append("date_utc = ?")
        parameters.append(now.date())
    elif period == "24h":
        conditions.extend(("date_utc >= ?", "date_utc <= ?"))
        parameters.extend(((now - timedelta(hours=24)).date(), now.date()))
    elif period == "7d":
        conditions.extend(("date_utc >= ?", "date_utc <= ?"))
        parameters.extend((now.date() - timedelta(days=6), now.date()))
    elif period == "30d":
        conditions.extend(("date_utc >= ?", "date_utc <= ?"))
        parameters.extend((now.date() - timedelta(days=29), now.date()))
    elif period == "custom" and start_date is not None and end_date is not None:
        conditions.extend(("date_utc >= ?", "date_utc <= ?"))
        parameters.extend((start_date, end_date))
    return conditions, parameters


def _require_tables(connection: duckdb.DuckDBPyConnection) -> None:
    available = {row[0].lower() for row in connection.execute("SHOW TABLES").fetchall()}
    missing = sorted(REQUIRED_TABLES - available)
    if missing:
        raise HTTPException(
            status_code=503,
            detail=(
                "The dashboard database is missing required tables: "
                + ", ".join(missing)
                + ". Complete the standardization and harmonization pipeline first."
            ),
        )


def _dashboard_payload(
    connection: duckdb.DuckDBPyConnection,
    *,
    filtered_sql: str,
    filter_parameters: list[object],
    period: Period,
    platform: Platform,
    region: Region,
    daynight: DayNight,
    frp_min: float | None,
    frp_max: float | None,
    start_date: date | None,
    end_date: date | None,
    now: datetime,
) -> dict[str, object]:
    latest_run = _latest_successful_run_cte()
    filtered_cte = f"filtered_detections AS ({filtered_sql})"
    ctes = f"WITH {filtered_cte}, {latest_run}"

    totals = connection.execute(
        f"""
        {ctes}
        SELECT COUNT(DISTINCT detection_id), MAX(acquisition_timestamp)
        FROM filtered_detections
        """,
        filter_parameters,
    ).fetchone()
    total_detections, latest_acquisition = totals

    daily_rows = connection.execute(
        f"""
        {ctes}
        SELECT acq_date, COUNT(DISTINCT detection_id)
        FROM filtered_detections
        GROUP BY acq_date
        ORDER BY acq_date
        """,
        filter_parameters,
    ).fetchall()
    platform_rows = connection.execute(
        f"""
        {ctes}
        SELECT COALESCE(NULLIF(TRIM(platform), ''), 'Unknown'),
               COUNT(DISTINCT detection_id)
        FROM filtered_detections
        GROUP BY 1
        ORDER BY 2 DESC
        """,
        filter_parameters,
    ).fetchall()

    cluster_count = connection.execute(
        f"""
        {ctes}
        SELECT COUNT(DISTINCT c.activity_cluster_id)
        FROM harm_activity_clusters c
        JOIN latest_successful_run lr ON c.run_id = lr.run_id
        JOIN harm_cluster_members m
          ON m.activity_cluster_id = c.activity_cluster_id
         AND m.run_id = c.run_id
        JOIN filtered_detections d ON d.detection_id = m.detection_id
        """,
        filter_parameters,
    ).fetchone()[0]

    needs_edge_filtering = (
        period == "24h"
        or region != "global"
        or daynight != "all"
        or frp_min is not None
        or frp_max is not None
    )
    if needs_edge_filtering:
        edge_counts = connection.execute(
            f"""
            {ctes}
            SELECT UPPER(TRIM(COALESCE(e.decision_class, 'UNKNOWN'))), COUNT(*)
            FROM harm_correspondence_edges e
            JOIN latest_successful_run lr ON e.run_id = lr.run_id
            WHERE EXISTS (
                SELECT 1
                FROM filtered_detections d
                WHERE d.detection_id = e.detection_id_a
                   OR d.detection_id = e.detection_id_b
            )
            GROUP BY 1
            """,
            filter_parameters,
        ).fetchall()
        correspondence_source = "filtered_edges"
    else:
        summary_conditions, summary_parameters = _summary_date_conditions(
            period, now, start_date, end_date
        )
        pair_condition = _platform_condition(platform, "platform_pair")
        if pair_condition:
            summary_conditions.append(pair_condition)
        summary_where = (
            " AND ".join(summary_conditions) if summary_conditions else "TRUE"
        )
        edge_counts = connection.execute(
            f"""
            WITH {latest_run}
            SELECT 'STRONG', COALESCE(SUM(s.strong_count), 0)
            FROM harm_correspondence_summary s
            JOIN latest_successful_run lr ON s.run_id = lr.run_id
            WHERE {summary_where}
            UNION ALL
            SELECT 'POSSIBLE', COALESCE(SUM(s.possible_count), 0)
            FROM harm_correspondence_summary s
            JOIN latest_successful_run lr ON s.run_id = lr.run_id
            WHERE {summary_where}
            UNION ALL
            SELECT 'REJECTED', COALESCE(SUM(s.rejected_count), 0)
            FROM harm_correspondence_summary s
            JOIN latest_successful_run lr ON s.run_id = lr.run_id
            WHERE {summary_where}
            """,
            summary_parameters * 3,
        ).fetchall()
        correspondence_source = "daily_summary"

    correspondence_counts = {
        str(row[0]).upper(): int(row[1] or 0) for row in edge_counts
    }
    strong_count = correspondence_counts.get("STRONG", 0)
    possible_count = correspondence_counts.get("POSSIBLE", 0)
    rejected_count = correspondence_counts.get("REJECTED", 0)

    unmatched_count = connection.execute(
        f"""
        {ctes}
        SELECT COUNT(DISTINCT d.detection_id)
        FROM filtered_detections d
        WHERE NOT EXISTS (
            SELECT 1
            FROM harm_correspondence_edges e
            JOIN latest_successful_run lr ON e.run_id = lr.run_id
            WHERE UPPER(TRIM(COALESCE(e.decision_class, ''))) IN ('STRONG', 'POSSIBLE')
              AND (e.detection_id_a = d.detection_id OR e.detection_id_b = d.detection_id)
        )
        """,
        filter_parameters,
    ).fetchone()[0]

    map_rows = connection.execute(
        f"""
        {ctes}
        SELECT detection_id, latitude, longitude, platform, acq_date, frp_mw
        FROM filtered_detections
        WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
        ORDER BY acquisition_timestamp DESC
        LIMIT 1201
        """,
        filter_parameters,
    ).fetchall()
    map_points = [
        {
            "id": row[0],
            "latitude": float(row[1]),
            "longitude": float(row[2]),
            "platform": row[3] or "Unknown",
            "date": row[4].isoformat(),
            "frp_mw": float(row[5]) if row[5] is not None else None,
        }
        for row in map_rows[:1200]
    ]
    map_truncated = len(map_rows) > 1200

    run_rows = connection.execute(
        """
        SELECT r.run_id, r.status, r.started_at_utc, r.duration_seconds,
               r.input_count, r.activity_cluster_count, r.correspondence_edge_count
        FROM harm_run_metadata r
        ORDER BY COALESCE(r.finished_at_utc, r.started_at_utc) DESC
        LIMIT 5
        """
    ).fetchall()

    return {
        "kpis": {
            "total_detections": int(total_detections or 0),
            "activity_clusters": int(cluster_count or 0),
            "strong_correspondences": strong_count,
            "possible_correspondences": possible_count,
            "unmatched_or_rejected": int(unmatched_count or 0),
            "latest_acquisition": latest_acquisition.isoformat() + "Z"
            if latest_acquisition is not None
            else None,
        },
        "daily_trend": [
            {"date": row[0].isoformat(), "detections": int(row[1])}
            for row in daily_rows
        ],
        "platform_counts": [
            {"platform": row[0], "detections": int(row[1])} for row in platform_rows
        ],
        "correspondence_distribution": {
            "strong": strong_count,
            "possible": possible_count,
            "rejected": rejected_count,
            "source": correspondence_source,
        },
        "map": {"points": map_points, "truncated": map_truncated},
        "recent_runs": [
            {
                "run_id": row[0],
                "status": row[1],
                "started_at": row[2].isoformat() + "Z" if row[2] is not None else None,
                "duration_seconds": float(row[3]) if row[3] is not None else None,
                "input_count": int(row[4]) if row[4] is not None else None,
                "activity_cluster_count": int(row[5]) if row[5] is not None else None,
                "correspondence_edge_count": int(row[6])
                if row[6] is not None
                else None,
            }
            for row in run_rows
        ],
        "generated_at": now.isoformat(),
    }


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/overview")
def overview(
    period: Period = "7d",
    platform: Platform = "all",
    region: Region = "global",
    daynight: DayNight = "all",
    frp_min: float | None = Query(default=None, ge=0),
    frp_max: float | None = Query(default=None, ge=0),
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict[str, object]:
    if frp_min is not None and frp_max is not None and frp_min > frp_max:
        raise HTTPException(
            status_code=422, detail="frp_min must be less than or equal to frp_max."
        )
    if period == "custom" and (
        start_date is None or end_date is None or start_date > end_date
    ):
        raise HTTPException(
            status_code=422,
            detail="Custom date ranges require a valid start_date on or before end_date.",
        )

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    settings = get_settings()
    database_path: Path = settings.duckdb_path
    if not database_path.exists():
        raise HTTPException(
            status_code=503,
            detail="The dashboard database was not found. Configure DUCKDB_PATH and run the data pipeline.",
        )

    try:
        with duckdb.connect(str(database_path), read_only=True) as connection:
            _require_tables(connection)
            filtered_sql, filter_parameters = _filtered_detections(
                period=period,
                platform=platform,
                region=region,
                daynight=daynight,
                frp_min=frp_min,
                frp_max=frp_max,
                start_date=start_date,
                end_date=end_date,
                now=now,
            )
            return _dashboard_payload(
                connection,
                filtered_sql=filtered_sql,
                filter_parameters=filter_parameters,
                period=period,
                platform=platform,
                region=region,
                daynight=daynight,
                frp_min=frp_min,
                frp_max=frp_max,
                start_date=start_date,
                end_date=end_date,
                now=now,
            )
    except duckdb.Error:
        logger.exception("Failed to query the TwinFlame dashboard database.")
        raise HTTPException(
            status_code=503,
            detail="The dashboard could not read the configured database. Check its schema and pipeline output.",
        ) from None


def _quoted_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _table_columns(
    connection: duckdb.DuckDBPyConnection, table_name: str
) -> dict[str, str]:
    rows = connection.execute(
        f"DESCRIBE SELECT * FROM {_quoted_identifier(table_name)}"
    ).fetchall()
    return {str(row[0]).lower(): str(row[0]) for row in rows}


def _find_column(columns: dict[str, str], *candidates: str) -> str | None:
    for candidate in candidates:
        if candidate.lower() in columns:
            return columns[candidate.lower()]
    return None


def _latest_source_retrieval(
    connection: duckdb.DuckDBPyConnection, tables: dict[str, str]
) -> tuple[datetime | None, str | None]:
    retrieval_columns = (
        "retrieved_at_utc",
        "retrieved_at",
        "retrieval_timestamp_utc",
        "retrieval_timestamp",
        "api_retrieved_at",
        "downloaded_at_utc",
        "downloaded_at",
        "fetched_at_utc",
        "fetched_at",
    )
    for logical_name in ("source_files", "ingestion_runs"):
        table_name = tables.get(logical_name)
        if table_name is None:
            continue
        columns = _table_columns(connection, table_name)
        timestamp_column = _find_column(columns, *retrieval_columns)
        if timestamp_column is None:
            continue
        row = connection.execute(
            f"SELECT MAX(TRY_CAST({_quoted_identifier(timestamp_column)} AS TIMESTAMP)) "
            f"FROM {_quoted_identifier(table_name)}"
        ).fetchone()
        if row and row[0] is not None:
            label = "SOURCE_FILES" if logical_name == "source_files" else "INGESTION_RUNS"
            return row[0], label
    return None, None


def _utc_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


def _utc_naive(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


@app.get("/api/monitoring")
def monitoring(
    window: MonitoringWindow = "24h",
    platform: Platform = "all",
    sensor: Sensor = "all",
    region: Region = "global",
    daynight: DayNight = "all",
    frp_min: float | None = Query(default=None, ge=0),
    confidence: str | None = None,
    status: DetectionStatus = "all",
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> dict[str, object]:
    start_at = _utc_naive(start_at)
    end_at = _utc_naive(end_at)
    if window == "custom" and (start_at is None or end_at is None):
        raise HTTPException(
            status_code=422,
            detail="Custom monitoring windows require both start_at and end_at.",
        )
    if window == "custom" and start_at is not None and end_at is not None:
        if start_at > end_at:
            raise HTTPException(
                status_code=422,
                detail="start_at must be on or before end_at.",
            )
    if frp_min is not None and frp_min < 0:
        raise HTTPException(status_code=422, detail="frp_min must be non-negative.")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    settings = get_settings()
    database_path: Path = settings.duckdb_path
    if not database_path.exists():
        raise HTTPException(
            status_code=503,
            detail="The dashboard database was not found. Configure DUCKDB_PATH and run the data pipeline.",
        )

    try:
        with duckdb.connect(str(database_path), read_only=True) as connection:
            tables = {
                str(row[0]).lower(): str(row[0])
                for row in connection.execute("SHOW TABLES").fetchall()
            }
            detection_table = tables.get("unified_detections")
            if detection_table is None:
                raise HTTPException(
                    status_code=503,
                    detail="The monitoring database is missing UNIFIED_DETECTIONS.",
                )

            columns = _table_columns(connection, detection_table)
            id_column = _find_column(columns, "detection_id", "id")
            date_column = _find_column(columns, "acq_date", "acquisition_date")
            if id_column is None or date_column is None:
                raise HTTPException(
                    status_code=503,
                    detail="UNIFIED_DETECTIONS must include detection_id and acq_date.",
                )

            def dcol(column: str | None, fallback: str = "NULL") -> str:
                return f"d.{_quoted_identifier(column)}" if column else fallback

            time_column = _find_column(columns, "acq_time", "acquisition_time")
            platform_column = _find_column(columns, "platform", "satellite")
            source_column = _find_column(columns, "source", "source_name")
            sensor_column = _find_column(columns, "instrument", "sensor")
            confidence_column = _find_column(
                columns, "native_confidence", "confidence", "confidence_level"
            )
            frp_column = _find_column(columns, "frp_mw", "frp")
            latitude_column = _find_column(columns, "latitude", "lat")
            longitude_column = _find_column(columns, "longitude", "lon", "lng")
            daynight_column = _find_column(columns, "daynight", "day_night")
            status_column = _find_column(
                columns, "detection_status", "processing_status", "status"
            )

            date_expr = f"TRY_CAST({dcol(date_column)} AS DATE)"
            time_digits = (
                f"LPAD(REGEXP_REPLACE(COALESCE(CAST({dcol(time_column)} AS VARCHAR), ''), "
                "'[^0-9]', '', 'g'), 4, '0')"
                if time_column
                else "'0000'"
            )
            acquisition_expr = (
                f"({date_expr} + COALESCE("
                f"TRY_CAST(TRY_STRPTIME({time_digits}, '%H%M') AS TIME), "
                "TIME '00:00:00'))"
            )
            platform_expr = (
                f"COALESCE(NULLIF(TRIM(CAST({dcol(platform_column)} AS VARCHAR)), ''), 'Unknown')"
            )
            source_expr = dcol(source_column, "''")
            if sensor_column:
                sensor_expr = (
                    f"COALESCE(NULLIF(UPPER(TRIM(CAST({dcol(sensor_column)} AS VARCHAR))), ''), "
                    "CASE WHEN UPPER(CAST("
                    f"{source_expr} AS VARCHAR)) LIKE '%MODIS%' THEN 'MODIS' "
                    "WHEN UPPER(CAST("
                    f"{source_expr} AS VARCHAR)) LIKE '%VIIRS%' OR UPPER(CAST("
                    f"{source_expr} AS VARCHAR)) LIKE '%NOAA%' THEN 'VIIRS' "
                    "ELSE 'Unknown' END)"
                )
            else:
                sensor_expr = (
                    "CASE WHEN UPPER(CAST("
                    f"{source_expr} AS VARCHAR)) LIKE '%MODIS%' THEN 'MODIS' "
                    "WHEN UPPER(CAST("
                    f"{source_expr} AS VARCHAR)) LIKE '%VIIRS%' OR UPPER(CAST("
                    f"{source_expr} AS VARCHAR)) LIKE '%NOAA%' "
                    "OR UPPER(CAST("
                    f"{platform_expr} AS VARCHAR)) LIKE '%NOAA%' THEN 'VIIRS' "
                    "ELSE 'Unknown' END"
                )
            confidence_expr = (
                f"CAST({dcol(confidence_column)} AS VARCHAR)"
                if confidence_column
                else "NULL::VARCHAR"
            )
            frp_expr = f"TRY_CAST({dcol(frp_column)} AS DOUBLE)"
            daynight_expr = (
                f"UPPER(TRIM(CAST({dcol(daynight_column)} AS VARCHAR)))"
                if daynight_column
                else "''"
            )

            status_options: list[str] = []
            if status_column:
                status_expr = (
                    f"LOWER(TRIM(CAST({dcol(status_column)} AS VARCHAR)))"
                )
                status_rows = connection.execute(
                    f"SELECT DISTINCT {status_expr} FROM {_quoted_identifier(detection_table)} d "
                    f"WHERE {status_expr} IS NOT NULL AND {status_expr} <> ''"
                ).fetchall()
                status_options = sorted({str(row[0]) for row in status_rows})
            else:
                members_table = tables.get("harm_cluster_members")
                if members_table:
                    member_columns = _table_columns(connection, members_table)
                    member_detection_id = _find_column(member_columns, "detection_id")
                    if member_detection_id:
                        status_expr = (
                            "CASE WHEN EXISTS (SELECT 1 FROM "
                            f"{_quoted_identifier(members_table)} hm WHERE "
                            f"hm.{_quoted_identifier(member_detection_id)} = {dcol(id_column)}) "
                            "THEN 'harmonized' ELSE 'unmatched' END"
                        )
                        status_options = ["harmonized", "unmatched"]
                    else:
                        status_expr = "NULL::VARCHAR"
                else:
                    status_expr = "NULL::VARCHAR"

            status_filter_available = bool(status_options)
            if status != "all":
                if not status_filter_available:
                    raise HTTPException(
                        status_code=422,
                        detail="Detection status filtering is unavailable in this database schema.",
                    )
                if status not in status_options:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Detection status '{status}' is not present in the current database.",
                    )
            if confidence and not confidence_column:
                raise HTTPException(
                    status_code=422,
                    detail="Native confidence filtering is unavailable in this database schema.",
                )

            conditions = [f"{acquisition_expr} <= ?"]
            if window == "custom":
                conditions.append(f"{acquisition_expr} BETWEEN ? AND ?")
                parameters: list[object] = [now, start_at, end_at]
            else:
                hours = int(window[:-1])
                conditions.append(f"{acquisition_expr} >= ?")
                parameters = [now, now - timedelta(hours=hours)]

            if platform != "all":
                platform_values = [platform_column, source_column]
                matching_columns = [
                    f"UPPER(CAST({dcol(column)} AS VARCHAR))"
                    for column in platform_values
                    if column is not None
                ]
                if not matching_columns:
                    raise HTTPException(
                        status_code=422,
                        detail="Platform filtering is unavailable in this database schema.",
                    )
                pattern = {
                    "terra": "%TERRA%",
                    "aqua": "%AQUA%",
                    "noaa20": "%NOAA20%",
                    "noaa21": "%NOAA21%",
                }[platform]
                conditions.append(
                    "(" + " OR ".join(f"{value} LIKE ?" for value in matching_columns) + ")"
                )
                parameters.extend([pattern] * len(matching_columns))
            if sensor != "all":
                conditions.append(f"UPPER(CAST({sensor_expr} AS VARCHAR)) = ?")
                parameters.append(sensor.upper())
            if region != "global":
                west, south, east, north = REGION_BOUNDS[region]
                if latitude_column is None or longitude_column is None:
                    raise HTTPException(
                        status_code=503,
                        detail="UNIFIED_DETECTIONS must include latitude and longitude for region filtering.",
                    )
                conditions.append(
                    f"{dcol(longitude_column)} BETWEEN ? AND ? AND "
                    f"{dcol(latitude_column)} BETWEEN ? AND ?"
                )
                parameters.extend((west, east, south, north))
            if daynight != "all":
                if daynight_column is None:
                    raise HTTPException(
                        status_code=422,
                        detail="Day/night filtering is unavailable in this database schema.",
                    )
                daynight_values = "'D', 'DAY'" if daynight == "day" else "'N', 'NIGHT'"
                conditions.append(f"{daynight_expr} IN ({daynight_values})")
            if frp_min is not None:
                if not frp_column:
                    raise HTTPException(
                        status_code=422,
                        detail="FRP filtering is unavailable in this database schema.",
                    )
                conditions.append(f"{frp_expr} >= ?")
                parameters.append(frp_min)
            if confidence:
                conditions.append(f"LOWER(TRIM({confidence_expr})) = LOWER(?)")
                parameters.append(confidence.strip())
            if status != "all":
                conditions.append(f"{status_expr} = ?")
                parameters.append(status)

            where_clause = " AND ".join(conditions)
            base_cte = f"""
                WITH filtered AS (
                    SELECT
                        CAST({dcol(id_column)} AS VARCHAR) AS id,
                        {platform_expr} AS platform,
                        {sensor_expr} AS sensor,
                        {date_expr} AS acquisition_date,
                        {acquisition_expr} AS acquisition_timestamp,
                        {dcol(time_column, "''")} AS acquisition_time,
                        {frp_expr} AS frp_mw,
                        {confidence_expr} AS native_confidence,
                        {daynight_expr} AS daynight,
                        {status_expr} AS status,
                        TRY_CAST({dcol(latitude_column)} AS DOUBLE) AS latitude,
                        TRY_CAST({dcol(longitude_column)} AS DOUBLE) AS longitude
                    FROM {_quoted_identifier(detection_table)} d
                    WHERE {where_clause}
                )
            """
            total_count, latest_acquisition = connection.execute(
                f"{base_cte} SELECT COUNT(*), MAX(acquisition_timestamp) FROM filtered",
                parameters,
            ).fetchone()
            trend_rows = connection.execute(
                f"""
                {base_cte}
                SELECT DATE_TRUNC('hour', acquisition_timestamp), COUNT(*)
                FROM filtered
                GROUP BY 1
                ORDER BY 1
                """,
                parameters,
            ).fetchall()
            frp_rows = connection.execute(
                f"""
                {base_cte}
                SELECT platform,
                    COUNT(*) FILTER (WHERE frp_mw < 10) AS under_10,
                    COUNT(*) FILTER (WHERE frp_mw >= 10 AND frp_mw < 50) AS from_10_to_50,
                    COUNT(*) FILTER (WHERE frp_mw >= 50 AND frp_mw < 100) AS from_50_to_100,
                    COUNT(*) FILTER (WHERE frp_mw >= 100) AS over_100
                FROM filtered
                WHERE frp_mw IS NOT NULL
                GROUP BY platform
                ORDER BY COUNT(*) DESC
                """,
                parameters,
            ).fetchall()
            detection_rows = connection.execute(
                f"""
                {base_cte}
                SELECT id, platform, sensor, acquisition_date, acquisition_time,
                       acquisition_timestamp, latitude, longitude, frp_mw,
                       native_confidence, daynight, status
                FROM filtered
                ORDER BY acquisition_timestamp DESC
                LIMIT 1200
                """,
                parameters,
            ).fetchall()
            latest_retrieval, retrieval_source = _latest_source_retrieval(connection, tables)

            def serialize_detection(row: tuple[object, ...]) -> dict[str, object]:
                return {
                    "id": row[0],
                    "platform": row[1],
                    "sensor": row[2],
                    "acquisition_date": row[3].isoformat() if row[3] else None,
                    "acquisition_time": str(row[4]) if row[4] is not None else None,
                    "acquisition_timestamp": _utc_iso(row[5]),
                    "latitude": float(row[6]) if row[6] is not None else None,
                    "longitude": float(row[7]) if row[7] is not None else None,
                    "frp_mw": float(row[8]) if row[8] is not None else None,
                    "native_confidence": row[9],
                    "daynight": row[10],
                    "status": row[11],
                }

            detections = [serialize_detection(row) for row in detection_rows]
            map_detections = [
                detection
                for detection in detections
                if detection["latitude"] is not None
                and detection["longitude"] is not None
                and -90 <= detection["latitude"] <= 90
                and -180 <= detection["longitude"] <= 180
            ]
            return {
                "generated_at": _utc_iso(now),
                "latest_retrieval_at": _utc_iso(latest_retrieval),
                "retrieval_source": retrieval_source,
                "latest_acquisition_at": _utc_iso(latest_acquisition),
                "total_detections": int(total_count or 0),
                "trend": [
                    {"time": _utc_iso(row[0]), "count": int(row[1])}
                    for row in trend_rows
                ],
                "frp_distribution": [
                    {
                        "platform": row[0],
                        "under_10": int(row[1]),
                        "from_10_to_50": int(row[2]),
                        "from_50_to_100": int(row[3]),
                        "over_100": int(row[4]),
                    }
                    for row in frp_rows
                ],
                "detections": detections[:50],
                "map_points": map_detections,
                "truncated": int(total_count or 0) > len(detections),
                "capabilities": {
                    "confidence_filter": confidence_column is not None,
                    "status_filter": status_filter_available,
                    "status_options": status_options,
                    "retrieval_timestamp": latest_retrieval is not None,
                },
            }
    except duckdb.Error:
        logger.exception("Failed to query the TwinFlame monitoring database.")
        raise HTTPException(
            status_code=503,
            detail="The monitoring page could not read the configured database. Check the detection table schema and pipeline output.",
        ) from None


def _parse_aoi(value: str | None) -> dict[str, object] | None:
    if not value:
        return None
    try:
        shape = json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="AOI must be valid JSON.") from exc
    if not isinstance(shape, dict):
        raise HTTPException(status_code=422, detail="AOI must be a geometry object.")

    shape_type = shape.get("type")
    if shape_type == "rectangle":
        try:
            south, west, north, east = (
                float(shape[key]) for key in ("south", "west", "north", "east")
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=422,
                detail="Rectangle AOIs require numeric south, west, north, and east bounds.",
            ) from exc
        if not (-90 <= south < north <= 90 and -180 <= west < east <= 180):
            raise HTTPException(status_code=422, detail="Rectangle AOI bounds are invalid.")
        return {"type": "rectangle", "south": south, "west": west, "north": north, "east": east}

    if shape_type == "circle":
        try:
            center = shape["center"]
            latitude, longitude = float(center[0]), float(center[1])
            radius_km = float(shape["radius_km"])
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=422,
                detail="Circle AOIs require a [latitude, longitude] center and radius_km.",
            ) from exc
        if (
            not -90 <= latitude <= 90
            or not -180 <= longitude <= 180
            or not 0 < radius_km <= 20_000
        ):
            raise HTTPException(status_code=422, detail="Circle AOI geometry is invalid.")
        return {
            "type": "circle",
            "center": [latitude, longitude],
            "radius_km": radius_km,
        }

    if shape_type == "polygon":
        points = shape.get("points")
        if not isinstance(points, list) or len(points) < 3:
            raise HTTPException(
                status_code=422, detail="Polygon AOIs require at least three points."
            )
        try:
            coordinates = [[float(point[0]), float(point[1])] for point in points]
        except (IndexError, TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=422, detail="Polygon AOI points must be numeric coordinates."
            ) from exc
        if any(
            not -90 <= latitude <= 90 or not -180 <= longitude <= 180
            for latitude, longitude in coordinates
        ):
            raise HTTPException(status_code=422, detail="Polygon AOI coordinates are invalid.")
        return {"type": "polygon", "points": coordinates}

    raise HTTPException(
        status_code=422, detail="AOI type must be rectangle, circle, or polygon."
    )


def _aoi_bounds(aoi: dict[str, object]) -> tuple[float, float, float, float]:
    if aoi["type"] == "rectangle":
        return (
            float(aoi["west"]),
            float(aoi["south"]),
            float(aoi["east"]),
            float(aoi["north"]),
        )
    if aoi["type"] == "circle":
        latitude, longitude = aoi["center"]  # type: ignore[misc]
        radius_km = float(aoi["radius_km"])
        lat_delta = radius_km / 110.574
        lon_delta = radius_km / max(0.01, 111.320 * math.cos(math.radians(latitude)))
        return (
            max(-180.0, longitude - lon_delta),
            max(-90.0, latitude - lat_delta),
            min(180.0, longitude + lon_delta),
            min(90.0, latitude + lat_delta),
        )
    points = aoi["points"]
    latitudes = [point[0] for point in points]  # type: ignore[index]
    longitudes = [point[1] for point in points]  # type: ignore[index]
    return min(longitudes), min(latitudes), max(longitudes), max(latitudes)


def _point_in_aoi(latitude: float, longitude: float, aoi: dict[str, object] | None) -> bool:
    if aoi is None:
        return True
    if aoi["type"] == "rectangle":
        return (
            float(aoi["south"]) <= latitude <= float(aoi["north"])
            and float(aoi["west"]) <= longitude <= float(aoi["east"])
        )
    if aoi["type"] == "circle":
        center = aoi["center"]
        return _great_circle_km(
            latitude, longitude, float(center[0]), float(center[1])  # type: ignore[index]
        ) <= float(aoi["radius_km"])

    points = aoi["points"]
    inside = False
    previous = points[-1]  # type: ignore[index]
    for current in points:  # type: ignore[assignment]
        current_lat, current_lon = current
        previous_lat, previous_lon = previous
        crosses = (current_lat > latitude) != (previous_lat > latitude)
        if crosses:
            crossing_lon = (previous_lon - current_lon) * (
                latitude - current_lat
            ) / (previous_lat - current_lat) + current_lon
            if longitude < crossing_lon:
                inside = not inside
        previous = current
    return inside


def _great_circle_km(
    latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float
) -> float:
    earth_radius_km = 6371.0088
    latitude_delta = math.radians(latitude_b - latitude_a)
    longitude_delta = math.radians(longitude_b - longitude_a)
    haversine = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(math.radians(latitude_a))
        * math.cos(math.radians(latitude_b))
        * math.sin(longitude_delta / 2) ** 2
    )
    return earth_radius_km * 2 * math.asin(min(1.0, math.sqrt(haversine)))


def _convex_hull(points: list[tuple[float, float]]) -> list[list[float]]:
    coordinates = sorted({(longitude, latitude) for latitude, longitude in points})
    if len(coordinates) <= 2:
        return [[latitude, longitude] for longitude, latitude in coordinates]

    def cross(
        origin: tuple[float, float],
        first: tuple[float, float],
        second: tuple[float, float],
    ) -> float:
        return (first[0] - origin[0]) * (second[1] - origin[1]) - (
            first[1] - origin[1]
        ) * (second[0] - origin[0])

    lower: list[tuple[float, float]] = []
    for point in coordinates:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    upper: list[tuple[float, float]] = []
    for point in reversed(coordinates):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    hull = lower[:-1] + upper[:-1]
    return [[latitude, longitude] for longitude, latitude in hull]


def _hull_area_km2(points: list[list[float]]) -> float:
    if len(points) < 3:
        return 0.0
    mean_latitude = sum(point[0] for point in points) / len(points)
    scale_x = 111.32 * max(0.0, math.cos(math.radians(mean_latitude)))
    scale_y = 110.574
    planar = [
        (longitude * scale_x, latitude * scale_y)
        for latitude, longitude in points
    ]
    area = sum(
        planar[index][0] * planar[(index + 1) % len(planar)][1]
        - planar[(index + 1) % len(planar)][0] * planar[index][1]
        for index in range(len(planar))
    )
    return abs(area) / 2


@app.get("/api/geospatial")
def geospatial(
    start_date: date | None = None,
    end_date: date | None = None,
    platform: Platform = "all",
    sensor: Sensor = "all",
    region: Region = "global",
    daynight: DayNight = "all",
    frp_min: float | None = Query(default=None, ge=0),
    min_cluster_size: int = Query(default=1, ge=1),
    min_extent_km: float = Query(default=0, ge=0),
    max_extent_km: float | None = Query(default=None, ge=0),
    membership_quality: MembershipQuality = "all",
    country: str | None = None,
    west: float | None = None,
    south: float | None = None,
    east: float | None = None,
    north: float | None = None,
    aoi: str | None = None,
) -> dict[str, object]:
    if (start_date is None) != (end_date is None):
        raise HTTPException(
            status_code=422,
            detail="Custom date ranges require both start_date and end_date.",
        )
    if start_date is not None and end_date is not None and start_date > end_date:
        raise HTTPException(
            status_code=422, detail="start_date must be on or before end_date."
        )
    bbox_values = (west, south, east, north)
    if any(value is not None for value in bbox_values):
        if any(value is None for value in bbox_values):
            raise HTTPException(
                status_code=422,
                detail="Bounding-box filters require west, south, east, and north.",
            )
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise HTTPException(status_code=422, detail="Bounding-box bounds are invalid.")
    if max_extent_km is not None and min_extent_km > max_extent_km:
        raise HTTPException(
            status_code=422,
            detail="min_extent_km must be less than or equal to max_extent_km.",
        )
    parsed_aoi = _parse_aoi(aoi)

    settings = get_settings()
    database_path: Path = settings.duckdb_path
    if not database_path.exists():
        raise HTTPException(
            status_code=503,
            detail="The dashboard database was not found. Configure DUCKDB_PATH and run the data pipeline.",
        )

    try:
        with duckdb.connect(str(database_path), read_only=True) as connection:
            tables = {
                str(row[0]).lower(): str(row[0])
                for row in connection.execute("SHOW TABLES").fetchall()
            }
            detection_table = tables.get("unified_detections")
            cluster_table = tables.get("harm_activity_clusters")
            member_table = tables.get("harm_cluster_members")
            if not detection_table or not cluster_table or not member_table:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "Geospatial exploration requires UNIFIED_DETECTIONS, "
                        "harm_activity_clusters, and harm_cluster_members."
                    ),
                )

            detection_columns = _table_columns(connection, detection_table)
            cluster_columns = _table_columns(connection, cluster_table)
            member_columns = _table_columns(connection, member_table)
            detection_id = _find_column(detection_columns, "detection_id", "id")
            acquisition_date = _find_column(
                detection_columns, "acq_date", "acquisition_date"
            )
            latitude_column = _find_column(detection_columns, "latitude", "lat")
            longitude_column = _find_column(detection_columns, "longitude", "lon", "lng")
            cluster_id = _find_column(
                cluster_columns, "activity_cluster_id", "cluster_id"
            )
            member_cluster_id = _find_column(
                member_columns, "activity_cluster_id", "cluster_id"
            )
            member_detection_id = _find_column(
                member_columns, "detection_id", "member_detection_id"
            )
            if not all(
                (
                    detection_id,
                    acquisition_date,
                    latitude_column,
                    longitude_column,
                    cluster_id,
                    member_cluster_id,
                    member_detection_id,
                )
            ):
                raise HTTPException(
                    status_code=503,
                    detail="The geospatial database tables are missing required ID, date, or coordinate columns.",
                )

            def dcol(column: str | None, fallback: str = "NULL") -> str:
                return f"d.{_quoted_identifier(column)}" if column else fallback

            time_column = _find_column(detection_columns, "acq_time", "acquisition_time")
            platform_column = _find_column(detection_columns, "platform", "satellite")
            source_column = _find_column(detection_columns, "source", "source_name")
            sensor_column = _find_column(detection_columns, "instrument", "sensor")
            frp_column = _find_column(detection_columns, "frp_mw", "frp")
            daynight_column = _find_column(detection_columns, "daynight", "day_night")
            country_column = _find_column(detection_columns, "country", "country_name")
            quality_column = _find_column(
                member_columns, "membership_quality", "quality"
            )

            date_expr = f"TRY_CAST({dcol(acquisition_date)} AS DATE)"
            time_digits = (
                f"LPAD(REGEXP_REPLACE(COALESCE(CAST({dcol(time_column)} AS VARCHAR), ''), "
                "'[^0-9]', '', 'g'), 4, '0')"
                if time_column
                else "'0000'"
            )
            acquisition_expr = (
                f"({date_expr} + COALESCE("
                f"TRY_CAST(TRY_STRPTIME({time_digits}, '%H%M') AS TIME), "
                "TIME '00:00:00'))"
            )
            platform_expr = (
                f"COALESCE(NULLIF(TRIM(CAST({dcol(platform_column)} AS VARCHAR)), ''), 'Unknown')"
            )
            source_expr = dcol(source_column, "''")
            if sensor_column:
                sensor_expr = (
                    f"COALESCE(NULLIF(UPPER(TRIM(CAST({dcol(sensor_column)} AS VARCHAR))), ''), "
                    "CASE WHEN UPPER(CAST("
                    f"{source_expr} AS VARCHAR)) LIKE '%MODIS%' THEN 'MODIS' "
                    "WHEN UPPER(CAST("
                    f"{source_expr} AS VARCHAR)) LIKE '%VIIRS%' OR UPPER(CAST("
                    f"{source_expr} AS VARCHAR)) LIKE '%NOAA%' THEN 'VIIRS' "
                    "ELSE 'Unknown' END)"
                )
            else:
                sensor_expr = (
                    "CASE WHEN UPPER(CAST("
                    f"{source_expr} AS VARCHAR)) LIKE '%MODIS%' THEN 'MODIS' "
                    "WHEN UPPER(CAST("
                    f"{source_expr} AS VARCHAR)) LIKE '%VIIRS%' OR UPPER(CAST("
                    f"{source_expr} AS VARCHAR)) LIKE '%NOAA%' THEN 'VIIRS' "
                    "ELSE 'Unknown' END"
                )
            frp_expr = f"TRY_CAST({dcol(frp_column)} AS DOUBLE)"
            daynight_expr = (
                f"UPPER(TRIM(CAST({dcol(daynight_column)} AS VARCHAR)))"
                if daynight_column
                else "''"
            )

            conditions = ["TRUE"]
            parameters: list[object] = []
            if start_date is not None and end_date is not None:
                conditions.extend(
                    (f"{date_expr} >= ?", f"{date_expr} <= ?")
                )
                parameters.extend((start_date, end_date))
            if platform != "all":
                matching_columns = [
                    f"UPPER(CAST({dcol(column)} AS VARCHAR))"
                    for column in (platform_column, source_column)
                    if column is not None
                ]
                if not matching_columns:
                    raise HTTPException(
                        status_code=422,
                        detail="Platform filtering is unavailable in this database schema.",
                    )
                pattern = {
                    "terra": "%TERRA%",
                    "aqua": "%AQUA%",
                    "noaa20": "%NOAA20%",
                    "noaa21": "%NOAA21%",
                }[platform]
                conditions.append(
                    "(" + " OR ".join(f"{value} LIKE ?" for value in matching_columns) + ")"
                )
                parameters.extend([pattern] * len(matching_columns))
            if sensor != "all":
                conditions.append(f"UPPER(CAST({sensor_expr} AS VARCHAR)) = ?")
                parameters.append(sensor.upper())
            if region != "global":
                region_west, region_south, region_east, region_north = REGION_BOUNDS[region]
                conditions.append(
                    f"{dcol(longitude_column)} BETWEEN ? AND ? AND "
                    f"{dcol(latitude_column)} BETWEEN ? AND ?"
                )
                parameters.extend(
                    (region_west, region_east, region_south, region_north)
                )
            if daynight != "all":
                if daynight_column is None:
                    raise HTTPException(
                        status_code=422,
                        detail="Day/night filtering is unavailable in this database schema.",
                    )
                daynight_values = "'D', 'DAY'" if daynight == "day" else "'N', 'NIGHT'"
                conditions.append(f"{daynight_expr} IN ({daynight_values})")
            if frp_min is not None:
                if frp_column is None:
                    raise HTTPException(
                        status_code=422,
                        detail="FRP filtering is unavailable in this database schema.",
                    )
                conditions.append(f"{frp_expr} >= ?")
                parameters.append(frp_min)
            if country:
                if country_column is None:
                    raise HTTPException(
                        status_code=422,
                        detail="Country filtering is unavailable in this database schema.",
                    )
                conditions.append(
                    f"LOWER(TRIM(CAST({dcol(country_column)} AS VARCHAR))) = LOWER(?)"
                )
                parameters.append(country.strip())
            query_bounds = (
                (west, south, east, north)
                if west is not None
                else _aoi_bounds(parsed_aoi)
                if parsed_aoi is not None
                else None
            )
            if query_bounds is not None:
                if west is not None and parsed_aoi is not None:
                    area_west, area_south, area_east, area_north = _aoi_bounds(parsed_aoi)
                    query_bounds = (
                        max(west, area_west),
                        max(south, area_south),
                        min(east, area_east),
                        min(north, area_north),
                    )
                bounds_west, bounds_south, bounds_east, bounds_north = query_bounds
                conditions.append(
                    f"{dcol(longitude_column)} BETWEEN ? AND ? AND "
                    f"{dcol(latitude_column)} BETWEEN ? AND ?"
                )
                parameters.extend(
                    (bounds_west, bounds_east, bounds_south, bounds_north)
                )
            where_clause = " AND ".join(conditions)
            filtered_cte = f"""
                WITH filtered AS (
                    SELECT
                        CAST({dcol(detection_id)} AS VARCHAR) AS id,
                        {platform_expr} AS platform,
                        {sensor_expr} AS sensor,
                        {acquisition_expr} AS acquisition_timestamp,
                        TRY_CAST({dcol(latitude_column)} AS DOUBLE) AS latitude,
                        TRY_CAST({dcol(longitude_column)} AS DOUBLE) AS longitude,
                        {frp_expr} AS frp_mw,
                        {daynight_expr} AS daynight,
                        {f'LOWER(TRIM(CAST({dcol(country_column)} AS VARCHAR)))' if country_column else 'NULL::VARCHAR'} AS country
                    FROM {_quoted_identifier(detection_table)} d
                    WHERE {where_clause}
                )
            """
            raw_detection_count = connection.execute(
                f"{filtered_cte} SELECT COUNT(*) FROM filtered", parameters
            ).fetchone()[0]
            detection_rows = connection.execute(
                f"""
                {filtered_cte}
                SELECT id, platform, sensor, acquisition_timestamp, latitude,
                       longitude, frp_mw, daynight, country
                FROM filtered
                ORDER BY acquisition_timestamp DESC
                LIMIT 20001
                """,
                parameters,
            ).fetchall()

            def in_bounds(row: tuple[object, ...]) -> bool:
                latitude, longitude = row[4], row[5]
                return (
                    latitude is not None
                    and longitude is not None
                    and _point_in_aoi(float(latitude), float(longitude), parsed_aoi)
                )

            selected_detection_rows = [
                row
                for row in detection_rows
                if in_bounds(row)
                and -90 <= float(row[4]) <= 90
                and -180 <= float(row[5]) <= 180
            ]
            detections = [
                {
                    "id": row[0],
                    "platform": row[1],
                    "sensor": row[2],
                    "acquisition_timestamp": _utc_iso(row[3]),
                    "latitude": float(row[4]),
                    "longitude": float(row[5]),
                    "frp_mw": float(row[6]) if row[6] is not None else None,
                    "daynight": row[7],
                    "country": row[8],
                }
                for row in selected_detection_rows[:5000]
            ]

            member_run_id = _find_column(member_columns, "run_id")
            cluster_run_id = _find_column(cluster_columns, "run_id")
            cluster_join = (
                f" AND c.{_quoted_identifier(cluster_run_id)} = "
                f"m.{_quoted_identifier(member_run_id)}"
                if cluster_run_id and member_run_id
                else ""
            )
            quality_filter = ""
            member_parameters = list(parameters)
            if membership_quality != "all":
                if quality_column is None:
                    raise HTTPException(
                        status_code=422,
                        detail="Membership-quality filtering is unavailable in this database schema.",
                    )
                quality_filter = (
                    f" AND LOWER(TRIM(CAST(m.{_quoted_identifier(quality_column)} AS VARCHAR))) = ?"
                )
                member_parameters.append(membership_quality)
            member_rows = connection.execute(
                f"""
                {filtered_cte}
                SELECT
                    CAST(c.{_quoted_identifier(cluster_id)} AS VARCHAR),
                    {f'CAST(c.{_quoted_identifier(cluster_run_id)} AS VARCHAR)' if cluster_run_id else "''"},
                    d.id, d.platform, d.acquisition_timestamp, d.latitude, d.longitude
                FROM {_quoted_identifier(cluster_table)} c
                JOIN {_quoted_identifier(member_table)} m
                  ON m.{_quoted_identifier(member_cluster_id)} = c.{_quoted_identifier(cluster_id)}
                  {cluster_join}
                JOIN filtered d ON d.id = CAST(m.{_quoted_identifier(member_detection_id)} AS VARCHAR)
                WHERE TRUE {quality_filter}
                LIMIT 100001
                """,
                member_parameters,
            ).fetchall()

            cluster_groups: dict[tuple[str, str], list[tuple[object, ...]]] = {}
            for row in member_rows:
                if (
                    row[5] is None
                    or row[6] is None
                    or not _point_in_aoi(float(row[5]), float(row[6]), parsed_aoi)
                    or not (-90 <= float(row[5]) <= 90 and -180 <= float(row[6]) <= 180)
                ):
                    continue
                cluster_groups.setdefault((str(row[0]), str(row[1])), []).append(row)

            clusters = []
            for (cluster_key, run_key), members in cluster_groups.items():
                member_count = len({str(member[2]) for member in members})
                if member_count < min_cluster_size:
                    continue
                latitudes = [float(member[5]) for member in members]
                longitudes = [float(member[6]) for member in members]
                south_bound, north_bound = min(latitudes), max(latitudes)
                west_bound, east_bound = min(longitudes), max(longitudes)
                center_latitude = sum(latitudes) / len(latitudes)
                center_longitude = sum(longitudes) / len(longitudes)
                extent_km = _great_circle_km(
                    south_bound, west_bound, north_bound, east_bound
                )
                boundary = _convex_hull(
                    list(zip(latitudes, longitudes, strict=True))
                )
                if len(boundary) < 3:
                    boundary = [
                        [south_bound, west_bound],
                        [south_bound, east_bound],
                        [north_bound, east_bound],
                        [north_bound, west_bound],
                    ]
                area_km2 = _hull_area_km2(boundary)
                if extent_km < min_extent_km or (
                    max_extent_km is not None and extent_km > max_extent_km
                ):
                    continue
                cluster_platforms = sorted({str(member[3]) for member in members})
                times = [member[4] for member in members if member[4] is not None]
                clusters.append(
                    {
                        "id": cluster_key,
                        "run_id": run_key,
                        "member_count": member_count,
                        "centroid": [center_latitude, center_longitude],
                        "platforms": cluster_platforms,
                        "start_at": _utc_iso(min(times)) if times else None,
                        "end_at": _utc_iso(max(times)) if times else None,
                        "extent_km": round(extent_km, 2),
                        "area_km2": round(area_km2, 2),
                        "bounds": [
                            [south_bound, west_bound],
                            [north_bound, east_bound],
                        ],
                        "boundary": boundary,
                    }
                )
            clusters.sort(key=lambda cluster: cluster["member_count"], reverse=True)

            size_bins = [
                ("1-5", 1, 5),
                ("6-20", 6, 20),
                ("21-50", 21, 50),
                ("51+", 51, None),
            ]
            size_distribution = [
                {
                    "bucket": label,
                    "count": sum(
                        1
                        for cluster in clusters
                        if cluster["member_count"] >= lower
                        and (upper is None or cluster["member_count"] <= upper)
                    ),
                }
                for label, lower, upper in size_bins
            ]
            density_bins: dict[tuple[int, int], int] = {}
            cell_degrees = 0.5
            for detection in detections:
                cell = (
                    math.floor(detection["latitude"] / cell_degrees),
                    math.floor(detection["longitude"] / cell_degrees),
                )
                density_bins[cell] = density_bins.get(cell, 0) + 1
            density_cells = [
                {
                    "south": latitude_bin * cell_degrees,
                    "west": longitude_bin * cell_degrees,
                    "north": (latitude_bin + 1) * cell_degrees,
                    "east": (longitude_bin + 1) * cell_degrees,
                    "count": count,
                }
                for (latitude_bin, longitude_bin), count in density_bins.items()
            ]
            return {
                "generated_at": _utc_iso(datetime.now(timezone.utc)),
                "total_detections": len(selected_detection_rows)
                if parsed_aoi is not None
                else int(raw_detection_count or 0),
                "detections": detections,
                "clusters": clusters,
                "density_cells": density_cells,
                "size_distribution": size_distribution,
                "capabilities": {
                    "country_filter": country_column is not None,
                    "membership_quality_filter": quality_column is not None,
                },
                "truncated": int(raw_detection_count or 0) > 20000
                or len(member_rows) > 100000
                or len(selected_detection_rows) > 5000,
            }
    except duckdb.Error:
        logger.exception("Failed to query the TwinFlame geospatial database.")
        raise HTTPException(
            status_code=503,
            detail="Geospatial exploration could not read the configured database. Check the harmonization tables and schema.",
        ) from None


@app.get("/api/geospatial/clusters/{cluster_id}/members")
def geospatial_cluster_members(
    cluster_id: str,
    run_id: str | None = None,
    limit: int = Query(default=200, ge=1, le=500),
) -> dict[str, object]:
    settings = get_settings()
    database_path: Path = settings.duckdb_path
    if not database_path.exists():
        raise HTTPException(
            status_code=503,
            detail="The dashboard database was not found. Configure DUCKDB_PATH and run the data pipeline.",
        )
    try:
        with duckdb.connect(str(database_path), read_only=True) as connection:
            tables = {
                str(row[0]).lower(): str(row[0])
                for row in connection.execute("SHOW TABLES").fetchall()
            }
            detection_table = tables.get("unified_detections")
            cluster_table = tables.get("harm_activity_clusters")
            member_table = tables.get("harm_cluster_members")
            if not detection_table or not cluster_table or not member_table:
                raise HTTPException(
                    status_code=503,
                    detail="Cluster inspection requires the geospatial harmonization tables.",
                )
            member_columns = _table_columns(connection, member_table)
            detection_columns = _table_columns(connection, detection_table)
            member_cluster_id = _find_column(
                member_columns, "activity_cluster_id", "cluster_id"
            )
            member_detection_id = _find_column(
                member_columns, "detection_id", "member_detection_id"
            )
            member_run_id = _find_column(member_columns, "run_id")
            if not member_cluster_id or not member_detection_id:
                raise HTTPException(
                    status_code=503,
                    detail="harm_cluster_members is missing cluster or detection identifiers.",
                )
            detection_id = _find_column(detection_columns, "detection_id", "id")
            if not detection_id:
                raise HTTPException(
                    status_code=503,
                    detail="UNIFIED_DETECTIONS is missing a detection identifier.",
                )
            platform_column = _find_column(detection_columns, "platform", "satellite")
            date_column = _find_column(detection_columns, "acq_date", "acquisition_date")
            if not date_column:
                raise HTTPException(
                    status_code=503,
                    detail="UNIFIED_DETECTIONS is missing an acquisition date.",
                )
            time_column = _find_column(detection_columns, "acq_time", "acquisition_time")
            frp_column = _find_column(detection_columns, "frp_mw", "frp")
            confidence_column = _find_column(
                detection_columns, "native_confidence", "confidence", "confidence_level"
            )
            daynight_column = _find_column(detection_columns, "daynight", "day_night")
            latitude_column = _find_column(detection_columns, "latitude", "lat")
            longitude_column = _find_column(detection_columns, "longitude", "lon", "lng")
            member_where = (
                f"m.{_quoted_identifier(member_cluster_id)} = ?"
            )
            parameters: list[object] = [cluster_id]
            if run_id is not None and member_run_id:
                member_where += f" AND m.{_quoted_identifier(member_run_id)} = ?"
                parameters.append(run_id)
            total = connection.execute(
                f"SELECT COUNT(*) FROM {_quoted_identifier(member_table)} m WHERE {member_where}",
                parameters,
            ).fetchone()[0]
            rows = connection.execute(
                f"""
                SELECT
                    CAST(d.{_quoted_identifier(detection_id)} AS VARCHAR),
                    {f'CAST(d.{_quoted_identifier(platform_column)} AS VARCHAR)' if platform_column else "'Unknown'"},
                    {f'CAST(d.{_quoted_identifier(date_column)} AS VARCHAR)' if date_column else "NULL"},
                    {f'CAST(d.{_quoted_identifier(time_column)} AS VARCHAR)' if time_column else "NULL"},
                    {f'TRY_CAST(d.{_quoted_identifier(frp_column)} AS DOUBLE)' if frp_column else "NULL"},
                    {f'CAST(d.{_quoted_identifier(confidence_column)} AS VARCHAR)' if confidence_column else "NULL"},
                    {f'UPPER(CAST(d.{_quoted_identifier(daynight_column)} AS VARCHAR))' if daynight_column else "NULL"},
                    {f'TRY_CAST(d.{_quoted_identifier(latitude_column)} AS DOUBLE)' if latitude_column else "NULL"},
                    {f'TRY_CAST(d.{_quoted_identifier(longitude_column)} AS DOUBLE)' if longitude_column else "NULL"}
                FROM {_quoted_identifier(member_table)} m
                JOIN {_quoted_identifier(detection_table)} d
                  ON CAST(d.{_quoted_identifier(detection_id)} AS VARCHAR) =
                     CAST(m.{_quoted_identifier(member_detection_id)} AS VARCHAR)
                WHERE {member_where}
                ORDER BY d.{_quoted_identifier(date_column)} DESC
                LIMIT ?
                """,
                parameters + [limit],
            ).fetchall()
            return {
                "cluster_id": cluster_id,
                "run_id": run_id,
                "total_members": int(total or 0),
                "truncated": int(total or 0) > limit,
                "members": [
                    {
                        "id": row[0],
                        "platform": row[1] or "Unknown",
                        "acquisition_date": row[2],
                        "acquisition_time": row[3],
                        "frp_mw": float(row[4]) if row[4] is not None else None,
                        "native_confidence": row[5],
                        "daynight": row[6],
                        "latitude": float(row[7]) if row[7] is not None else None,
                        "longitude": float(row[8]) if row[8] is not None else None,
                    }
                    for row in rows
                ],
            }
    except duckdb.Error:
        logger.exception("Failed to query cluster members.")
        raise HTTPException(
            status_code=503,
            detail="The selected cluster members could not be read from the database.",
        ) from None
