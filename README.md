# TwinFlame_NASA_SPACE_CHALLENGE_2026
Harmonization of MODIS and VIIRS Hot Spots

## Dashboard

The Overview dashboard is a React + Vite frontend backed by a read-only FastAPI
API. It summarizes unified detections, harmonized activity clusters,
correspondences, and processing runs from the configured DuckDB database.

1. Install the Python dependencies with `pip install -r requirements.txt`.
2. Set `DUCKDB_PATH` to the harmonized DuckDB database in `.env`.
3. Start the API from the repository root with
   `uvicorn app.backend.main:app --reload`.
4. With Node.js and npm installed, in `app/frontend` run `npm install` once
   and `npm run dev`.
5. Open the Vite URL shown in the terminal (by default
   `http://127.0.0.1:5173`).

The Overview supports date range, satellite/platform, geographic region,
day/night, and fire radiative power filters. A missing database or an
incomplete pipeline schema is reported in the dashboard rather than replaced
with sample values.

The Live Monitoring page polls the read-only `/api/monitoring` endpoint every
60 seconds and supports rolling or custom acquisition-time windows, platform,
sensor, region, day/night, FRP, and available native-confidence/status filters.
It reads detections from `UNIFIED_DETECTIONS`; `SOURCE_FILES` and
`INGESTION_RUNS` provide the latest retrieval timestamp when they expose an
explicit retrieval-time column. Acquisition time is the satellite observation
time, while retrieval time is when TwinFlame collected the source data. If a
database does not include confidence, status, or retrieval metadata, those
fields are identified as unavailable rather than inferred.

The Geospatial Exploration page joins `UNIFIED_DETECTIONS` to
`harm_activity_clusters` and `harm_cluster_members` to show detections,
activity-cluster extents, member observations, and a 0.5-degree density grid.
Cluster extent and area are calculated from member coordinates as a bounding
envelope when the database has no stored cluster geometry. Saved areas and map
annotations are stored in browser local storage and remain available in that
browser for later research sessions.

The Alerts Center currently presents a clearly labeled illustrative sample,
not live alerts. Acknowledge and resolve actions are saved in that browser's
local storage; they are not written to the read-only DuckDB database or sent
through email/SMS. Sample map locations and historical counts are not real fire
notifications. MODIS/VIIRS correspondence alone is not an alert condition, and
satellite-observation alerts are not emergency warnings or predictions of
danger to people.
