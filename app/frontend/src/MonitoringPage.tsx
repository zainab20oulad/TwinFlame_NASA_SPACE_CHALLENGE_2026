import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  Clock3,
  Flame,
  MapPin,
  RefreshCw,
  Satellite,
  SlidersHorizontal,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";

type MonitoringFilters = {
  window: string;
  platform: string;
  sensor: string;
  region: string;
  daynight: string;
  frpMin: string;
  confidence: string;
  status: string;
  startAt: string;
  endAt: string;
};

type Detection = {
  id: string;
  platform: string;
  sensor: string;
  acquisition_date: string | null;
  acquisition_time: string | null;
  acquisition_timestamp: string | null;
  latitude: number | null;
  longitude: number | null;
  frp_mw: number | null;
  native_confidence: string | number | null;
  daynight: string | null;
  status: string | null;
};

type MapDetection = Detection & {
  latitude: number;
  longitude: number;
};

type MonitoringData = {
  generated_at: string;
  latest_retrieval_at: string | null;
  retrieval_source: string | null;
  latest_acquisition_at: string | null;
  total_detections: number;
  trend: { time: string; count: number }[];
  frp_distribution: {
    platform: string;
    under_10: number;
    from_10_to_50: number;
    from_50_to_100: number;
    over_100: number;
  }[];
  detections: Detection[];
  map_points: MapDetection[];
  truncated: boolean;
  capabilities: {
    confidence_filter: boolean;
    status_filter: boolean;
    status_options: string[];
    retrieval_timestamp: boolean;
  };
};

const regions = [
  ["global", "Global"],
  ["africa", "Africa"],
  ["asia", "Asia"],
  ["europe", "Europe"],
  ["north-america", "North America"],
  ["oceania", "Oceania"],
  ["south-america", "South America"],
];
const windows = [
  ["1h", "Last hour"],
  ["6h", "Last 6 hours"],
  ["12h", "Last 12 hours"],
  ["24h", "Last 24 hours"],
  ["48h", "Last 48 hours"],
  ["custom", "Custom"],
];
const platformColors: Record<string, string> = {
  terra: "#f58200",
  aqua: "#f04b22",
  "noaa-20": "#8d321d",
  "noaa-21": "#e9b77e",
  unknown: "#a0a596",
};
const frpColors = ["#e9b77e", "#f58200", "#f04b22", "#8d321d"];

function localDateTimeValue(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function initialFilters(): MonitoringFilters {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return {
    window: "24h",
    platform: "all",
    sensor: "all",
    region: "global",
    daynight: "all",
    frpMin: "",
    confidence: "",
    status: "all",
    startAt: localDateTimeValue(start),
    endAt: localDateTimeValue(end),
  };
}

function apiUrl(filters: MonitoringFilters) {
  const params = new URLSearchParams({
    window: filters.window,
    platform: filters.platform,
    sensor: filters.sensor,
    region: filters.region,
    daynight: filters.daynight,
    status: filters.status,
  });
  if (filters.frpMin.trim()) params.set("frp_min", filters.frpMin.trim());
  if (filters.confidence.trim()) params.set("confidence", filters.confidence.trim());
  if (filters.window === "custom") {
    const start = new Date(filters.startAt);
    const end = new Date(filters.endAt);
    if (Number.isFinite(start.getTime())) params.set("start_at", start.toISOString());
    if (Number.isFinite(end.getTime())) params.set("end_at", end.toISOString());
  }
  const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/api/monitoring?${params}`;
}

function formattedTimestamp(value: string | null, withDate = true) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return date.toLocaleString("en-US", {
    ...(withDate ? { month: "short", day: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function timeAgo(value: string | null, now: number) {
  if (!value) return "No retrieval timestamp";
  const minutes = Math.max(0, Math.floor((now - new Date(value).getTime()) / 60_000));
  if (!Number.isFinite(minutes)) return "Unavailable";
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ${minutes % 60} min ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function freshness(value: string | null, now: number) {
  if (!value) return { label: "Unknown", state: "unknown" };
  const age = now - new Date(value).getTime();
  if (!Number.isFinite(age) || age < 0) return { label: "Unknown", state: "unknown" };
  if (age <= 60 * 60_000) return { label: "Fresh", state: "fresh" };
  if (age <= 6 * 60 * 60_000) return { label: "Delayed", state: "delayed" };
  return { label: "Stale", state: "stale" };
}

function platformColor(platform: string) {
  return platformColors[platform.toLowerCase()] ?? platformColors.unknown;
}

function SelectField({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: string[][];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="monitor-filter">
      <span className="filter-label">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option value={optionValue} key={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function FocusMapOnDetection({ detection }: { detection: MapDetection | null }) {
  const map = useMap();
  useEffect(() => {
    if (detection?.latitude == null || detection.longitude == null) return;
    map.flyTo([detection.latitude, detection.longitude], Math.max(map.getZoom(), 5), {
      duration: 0.6,
    });
  }, [detection?.id, detection?.latitude, detection?.longitude, map]);
  return null;
}

function MonitoringMap({
  points,
  selected,
  onSelect,
}: {
  points: MapDetection[];
  selected: MapDetection | null;
  onSelect: (detection: MapDetection) => void;
}) {
  return (
    <div className="monitor-map-frame">
      <MapContainer
        center={[17, 8]}
        zoom={2}
        minZoom={2}
        maxZoom={12}
        scrollWheelZoom
        worldCopyJump
        className="monitor-fire-map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
        />
        {points.map((point) => (
          <CircleMarker
            key={point.id}
            center={[point.latitude, point.longitude]}
            radius={point.frp_mw == null ? 5 : Math.min(10, 4 + Math.sqrt(point.frp_mw) / 2)}
            pathOptions={{
              color: "#171b15",
              weight: 1.5,
              fillColor: platformColor(point.platform),
              fillOpacity: 0.88,
            }}
            eventHandlers={{ click: () => onSelect(point) }}
          >
            <Popup>
              <strong>{point.platform} · {point.sensor}</strong>
              <br />
              Acquisition: {formattedTimestamp(point.acquisition_timestamp)}
              <br />
              FRP: {point.frp_mw == null ? "—" : `${point.frp_mw.toFixed(1)} MW`}
              <br />
              Native confidence: {point.native_confidence ?? "—"}
              <br />
              {point.daynight === "D" ? "Day" : point.daynight === "N" ? "Night" : "Day/night —"}
              {point.status && <><br />Status: {point.status}</>}
            </Popup>
          </CircleMarker>
        ))}
        <FocusMapOnDetection detection={selected} />
      </MapContainer>
      {points.length === 0 && (
        <div className="map-empty">
          <MapPin size={18} />
          <span>No hotspots match these filters</span>
        </div>
      )}
      <div className="monitor-map-legend">
        <span className="legend-dot" />
        <span>Latest hotspots</span>
        <span className="legend-divider" />
        <span>{points.length.toLocaleString()} shown</span>
      </div>
    </div>
  );
}

function FreshnessTimeline({
  acquisition,
  retrieval,
  now,
}: {
  acquisition: string | null;
  retrieval: string | null;
  now: number;
}) {
  const range = 48 * 60 * 60 * 1000;
  const position = (value: string | null) => {
    if (!value) return null;
    const age = now - new Date(value).getTime();
    if (!Number.isFinite(age)) return null;
    return Math.max(0, Math.min(100, 100 - (age / range) * 100));
  };
  const events = [
    { label: "Acquisition", value: acquisition, position: position(acquisition), tone: "acquisition" },
    { label: "API retrieval", value: retrieval, position: position(retrieval), tone: "retrieval" },
  ];

  return (
    <div className="freshness-timeline">
      <div className="timeline-axis">
        <span>48 hours ago</span>
        <span>Now</span>
      </div>
      <div className="timeline-track">
        <span className="timeline-line" />
        {events.map((event) => event.position != null && (
          <span
            className={`timeline-marker ${event.tone}`}
            style={{ left: `${event.position}%` }}
            key={event.tone}
            title={`${event.label}: ${formattedTimestamp(event.value)}`}
          />
        ))}
      </div>
      <div className="timeline-events">
        {events.map((event) => (
          <div className="timeline-event" key={event.tone}>
            <span className={`timeline-key ${event.tone}`} />
            <div>
              <strong>{event.label}</strong>
              <span>{formattedTimestamp(event.value)}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="timeline-note">
        Acquisition is when the satellite observed the hotspot; retrieval is when TwinFlame collected the data.
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <article className="monitor-metric">
      <div className="monitor-metric-top">
        <span className={`monitor-metric-icon ${tone}`}>{icon}</span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function MonitoringPage() {
  const [filters, setFilters] = useState(initialFilters);
  const [data, setData] = useState<MonitoringData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [clock, setClock] = useState(Date.now());

  const updateFilter = useCallback((key: keyof MonitoringFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let interval: number;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(apiUrl(filters), { signal: controller.signal });
        let body: { detail?: string } & Partial<MonitoringData>;
        try {
          body = await response.json();
        } catch {
          throw new Error(
            `Monitoring API returned HTTP ${response.status} with an invalid JSON response.`,
          );
        }
        if (!response.ok) {
          throw new Error(body.detail ?? "Monitoring data could not be loaded.");
        }
        setData(body as MonitoringData);
        setSelectedId(null);
        setLastUpdated(new Date());
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Monitoring data could not be loaded.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    interval = window.setInterval(() => setRefreshKey((key) => key + 1), 60_000);
    return () => {
      window.clearInterval(interval);
      controller.abort();
    };
  }, [filters, refreshKey]);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const selected = useMemo(
    () => data?.map_points.find((point) => point.id === selectedId) ?? null,
    [data?.map_points, selectedId],
  );
  const fresh = freshness(data?.latest_retrieval_at ?? null, clock);
  const statusOptions = data?.capabilities.status_options ?? [];
  const statusFilterAvailable = data?.capabilities.status_filter ?? false;
  const confidenceFilterAvailable = data?.capabilities.confidence_filter ?? false;

  return (
    <>
      <section className="page-heading monitoring-heading">
        <div>
          <div className="eyebrow"><span /> NEAR REAL-TIME MONITORING</div>
          <h1>Live hotspots</h1>
          <p className="page-subtitle">
            Latest satellite observations, collection freshness, and hotspot activity.
          </p>
        </div>
        <button
          className={`refresh-button ${loading ? "is-loading" : ""}`}
          type="button"
          onClick={() => setRefreshKey((key) => key + 1)}
          disabled={loading}
        >
          <RefreshCw size={15} />
          <span>Refresh now</span>
        </button>
      </section>

      <section className="monitor-filter-panel" aria-label="Monitoring filters">
        <div className="monitor-filter-heading">
          <span className="filter-heading-icon"><SlidersHorizontal size={15} /></span>
          <span>Monitor filters</span>
        </div>
        <SelectField
          label="TIME WINDOW"
          value={filters.window}
          options={windows}
          onChange={(value) => updateFilter("window", value)}
        />
        <SelectField
          label="PLATFORM"
          value={filters.platform}
          options={[
            ["all", "All platforms"],
            ["terra", "Terra"],
            ["aqua", "Aqua"],
            ["noaa20", "NOAA-20"],
            ["noaa21", "NOAA-21"],
          ]}
          onChange={(value) => updateFilter("platform", value)}
        />
        <SelectField
          label="SENSOR"
          value={filters.sensor}
          options={[["all", "All sensors"], ["modis", "MODIS"], ["viirs", "VIIRS"]]}
          onChange={(value) => updateFilter("sensor", value)}
        />
        <SelectField
          label="REGION"
          value={filters.region}
          options={regions}
          onChange={(value) => updateFilter("region", value)}
        />
        <SelectField
          label="DAY / NIGHT"
          value={filters.daynight}
          options={[
            ["all", "All observations"],
            ["day", "Day"],
            ["night", "Night"],
          ]}
          onChange={(value) => updateFilter("daynight", value)}
        />
        <label className="monitor-filter monitor-numeric-filter">
          <span className="filter-label">MIN FRP · MW</span>
          <input
            type="number"
            min="0"
            step="1"
            placeholder="Any"
            aria-label="Minimum fire radiative power in megawatts"
            value={filters.frpMin}
            onChange={(event) => updateFilter("frpMin", event.target.value)}
          />
        </label>
        <label className="monitor-filter monitor-confidence-filter">
          <span className="filter-label">NATIVE CONFIDENCE</span>
          <input
            type="text"
            placeholder={confidenceFilterAvailable ? "e.g. H, N, or 85" : "Not in schema"}
            aria-label="Exact native confidence value"
            value={filters.confidence}
            disabled={!confidenceFilterAvailable}
            onChange={(event) => updateFilter("confidence", event.target.value)}
          />
        </label>
        <SelectField
          label="DETECTION STATUS"
          value={filters.status}
          options={[
            ["all", "All statuses"],
            ...["new", "processed", "harmonized", "unmatched"]
              .filter((status) => statusOptions.includes(status))
              .map((status) => [status, status[0].toUpperCase() + status.slice(1)]),
          ]}
          disabled={!statusFilterAvailable}
          onChange={(value) => updateFilter("status", value)}
        />
        {filters.window === "custom" && (
          <>
            <label className="monitor-filter custom-time-filter">
              <span className="filter-label">FROM · LOCAL TIME</span>
              <input
                type="datetime-local"
                value={filters.startAt}
                onChange={(event) => updateFilter("startAt", event.target.value)}
              />
            </label>
            <label className="monitor-filter custom-time-filter">
              <span className="filter-label">TO · LOCAL TIME</span>
              <input
                type="datetime-local"
                value={filters.endAt}
                onChange={(event) => updateFilter("endAt", event.target.value)}
              />
            </label>
          </>
        )}
      </section>

      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={18} />
          <div>
            <strong>Monitoring data unavailable</strong>
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setRefreshKey((key) => key + 1)}>
            Try again
          </button>
        </div>
      )}
      {data && (!confidenceFilterAvailable || !statusFilterAvailable) && (
        <p className="monitor-schema-note">
          {[
            !confidenceFilterAvailable && "Native confidence is not available in this database schema.",
            !statusFilterAvailable && "Detection status is not available in this database schema.",
          ].filter(Boolean).join(" ")}
        </p>
      )}

      <section className="monitor-metrics" aria-label="Live monitoring summary">
        <Metric
          label="DETECTIONS IN WINDOW"
          value={data ? data.total_detections.toLocaleString("en-US") : "—"}
          detail={windows.find(([value]) => value === filters.window)?.[1] ?? "Selected period"}
          icon={<Flame size={16} />}
          tone="orange"
        />
        <Metric
          label="LATEST ACQUISITION"
          value={formattedTimestamp(data?.latest_acquisition_at ?? null)}
          detail="Satellite observation time · UTC"
          icon={<Clock3 size={16} />}
          tone="copper"
        />
        <Metric
          label="LATEST API RETRIEVAL"
          value={formattedTimestamp(data?.latest_retrieval_at ?? null)}
          detail={
            data?.retrieval_source
              ? `From ${data.retrieval_source} · ${timeAgo(data.latest_retrieval_at, clock)}`
              : "No retrieval timestamp recorded"
          }
          icon={<RefreshCw size={16} />}
          tone="mahogany"
        />
        <Metric
          label="DATA FRESHNESS"
          value={fresh.label}
          detail={
            data?.latest_retrieval_at
              ? `${timeAgo(data.latest_retrieval_at, clock)} · API retrieval`
              : "Waiting for a source retrieval timestamp"
          }
          icon={<Satellite size={16} />}
          tone={`freshness-${fresh.state}`}
        />
      </section>

      <section className="monitor-visual-grid">
        <article className="panel monitor-map-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Latest hotspot locations</div>
              <div className="panel-subtitle">Select a marker to inspect the observation</div>
            </div>
            <span className={`monitor-live-badge ${loading ? "syncing" : ""}`}>
              <span /> {loading ? "UPDATING" : "AUTO-REFRESH · 60S"}
            </span>
          </div>
          {data ? (
            <MonitoringMap
              points={data.map_points}
              selected={selected}
              onSelect={(point) => setSelectedId(point.id)}
            />
          ) : (
            <div className="panel-skeleton monitor-map-skeleton" />
          )}
          <div className="monitor-map-footer">
            <span><span className="footer-indicator" /> {data?.map_points.length.toLocaleString() ?? "—"} mapped observations</span>
            <span>
              {data?.truncated ? "Showing latest 1,200" : "Live FIRMS observations"}
              <span className="footer-dot"> · </span>
              Click a hotspot for details
            </span>
          </div>
        </article>

        <div className="monitor-side-stack">
          <article className="panel monitor-chart-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Detection activity</div>
                <div className="panel-subtitle">Acquisitions by hour · selected window</div>
              </div>
              <span className="chart-unit">HOTSPOTS / HOUR</span>
            </div>
            <div className="monitor-trend-chart">
              {data?.trend.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.trend} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <defs>
                      <linearGradient id="monitorTrendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f58200" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#f58200" stopOpacity={0.015} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#34392f" strokeDasharray="3 5" />
                    <XAxis
                      dataKey="time"
                      tickFormatter={(value: string) =>
                        new Date(value).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "UTC",
                        })
                      }
                      tickLine={false}
                      axisLine={false}
                      minTickGap={28}
                      tick={{ fill: "#a0a596", fontSize: 10 }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={42}
                      tick={{ fill: "#a0a596", fontSize: 10 }}
                    />
                    <Tooltip
                      labelFormatter={(value) => formattedTimestamp(String(value))}
                      formatter={(value) => [Number(value).toLocaleString(), "Detections"]}
                      contentStyle={{
                        border: "1px solid #3b4035",
                        borderRadius: 10,
                        backgroundColor: "#20241d",
                        color: "#f3efe7",
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#f04b22"
                      strokeWidth={2.5}
                      fill="url(#monitorTrendFill)"
                      dot={false}
                      activeDot={{ r: 5, stroke: "#f3efe7", strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="monitor-empty-chart">No detections in this time window</div>
              )}
            </div>
          </article>

          <article className="panel monitor-chart-panel freshness-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Observation freshness timeline</div>
                <div className="panel-subtitle">Observation time versus system retrieval</div>
              </div>
            </div>
            <FreshnessTimeline
              acquisition={data?.latest_acquisition_at ?? null}
              retrieval={data?.latest_retrieval_at ?? null}
              now={clock}
            />
          </article>
        </div>

        <article className="panel monitor-frp-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">FRP distribution by platform</div>
              <div className="panel-subtitle">Detection counts grouped by fire radiative power</div>
            </div>
            <span className="chart-unit">DETECTIONS</span>
          </div>
          <div className="monitor-frp-chart">
            {data?.frp_distribution.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.frp_distribution} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="#34392f" strokeDasharray="3 5" />
                  <XAxis
                    dataKey="platform"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#c0c2b7", fontSize: 10 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#a0a596", fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      border: "1px solid #3b4035",
                      borderRadius: 10,
                      backgroundColor: "#20241d",
                      color: "#f3efe7",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="under_10" name="< 10 MW" stackId="frp" fill={frpColors[0]} />
                  <Bar dataKey="from_10_to_50" name="10–50 MW" stackId="frp" fill={frpColors[1]} />
                  <Bar dataKey="from_50_to_100" name="50–100 MW" stackId="frp" fill={frpColors[2]} />
                  <Bar dataKey="over_100" name="100+ MW" stackId="frp" fill={frpColors[3]} radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="monitor-empty-chart">FRP distribution is unavailable for this window</div>
            )}
          </div>
          <div className="frp-legend">
            {["< 10 MW", "10–50 MW", "50–100 MW", "100+ MW"].map((label, index) => (
              <span key={label}>
                <i style={{ backgroundColor: frpColors[index] }} />
                {label}
              </span>
            ))}
          </div>
        </article>

        <article className="panel monitor-table-panel">
          <div className="panel-header monitor-table-header">
            <div>
              <div className="panel-title">Latest detections</div>
              <div className="panel-subtitle">
                Acquisition timestamps are UTC; select a row to locate it on the map.
              </div>
            </div>
            <span className="monitor-table-count">
              {data ? `${data.detections.length} SHOWN` : "—"}
            </span>
          </div>
          <div className="monitor-table-scroll">
            <table className="monitor-table">
              <thead>
                <tr>
                  <th>ACQUISITION · UTC</th>
                  <th>PLATFORM / SENSOR</th>
                  <th>LOCATION</th>
                  <th>FRP</th>
                  <th>NATIVE CONFIDENCE</th>
                  <th>DAY / NIGHT</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {data?.detections.map((detection) => (
                  <tr
                    className={selectedId === detection.id ? "selected" : ""}
                    key={detection.id}
                    onClick={() => setSelectedId(detection.id)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(detection.id);
                      }
                    }}
                  >
                    <td>
                      <strong>{formattedTimestamp(detection.acquisition_timestamp)}</strong>
                      <span>{detection.acquisition_date ?? "Date unavailable"}</span>
                    </td>
                    <td>
                      <strong>{detection.platform}</strong>
                      <span>{detection.sensor}</span>
                    </td>
                    <td className="monitor-coordinates">
                      {detection.latitude == null || detection.longitude == null
                        ? "—"
                        : `${detection.latitude.toFixed(2)}, ${detection.longitude.toFixed(2)}`}
                    </td>
                    <td>{detection.frp_mw == null ? "—" : `${detection.frp_mw.toFixed(1)} MW`}</td>
                    <td>{detection.native_confidence ?? "—"}</td>
                    <td>{detection.daynight === "D" ? "Day" : detection.daynight === "N" ? "Night" : "—"}</td>
                    <td>
                      <span className={`detection-status ${detection.status ?? "unknown"}`}>
                        {detection.status ?? "Unknown"}
                      </span>
                    </td>
                  </tr>
                ))}
                {data && data.detections.length === 0 && (
                  <tr>
                    <td colSpan={7} className="monitor-table-empty">
                      No detections match the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {!data && <div className="monitor-table-loading">Loading latest detections…</div>}
          </div>
          {data?.truncated && (
            <div className="monitor-table-footer">Showing the latest 50 rows of the filtered window.</div>
          )}
        </article>
      </section>

      <footer className="page-footer monitor-footer">
        <span>
          <span className={`footer-indicator ${fresh.state === "stale" ? "offline" : ""}`} />
          Latest API retrieval {timeAgo(data?.latest_retrieval_at ?? null, clock)}
        </span>
        <span>
          {lastUpdated
            ? `Page queried ${lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`
            : "Waiting for data"}
          <span className="footer-dot"> · </span>
          Refreshes automatically every 60 seconds
        </span>
      </footer>
    </>
  );
}

export default MonitoringPage;
