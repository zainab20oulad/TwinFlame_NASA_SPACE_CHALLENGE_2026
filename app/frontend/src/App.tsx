import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Flame,
  Globe2,
  Layers3,
  Link2,
  MapPin,
  Moon,
  RefreshCw,
  Satellite,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import MonitoringPage from "./MonitoringPage";
import GeospatialPage from "./GeospatialPage";
import AlertsCenter from "./AlertsCenter";

type Filters = {
  period: string;
  platform: string;
  region: string;
  daynight: string;
  frpMin: string;
  frpMax: string;
  startDate: string;
  endDate: string;
};

type OverviewData = {
  kpis: {
    total_detections: number;
    activity_clusters: number;
    strong_correspondences: number;
    possible_correspondences: number;
    unmatched_or_rejected: number;
    latest_acquisition: string | null;
  };
  daily_trend: { date: string; detections: number }[];
  platform_counts: { platform: string; detections: number }[];
  correspondence_distribution: {
    strong: number;
    possible: number;
    rejected: number;
    source: string;
  };
  map: {
    points: {
      id: string;
      latitude: number;
      longitude: number;
      platform: string;
      date: string;
      frp_mw: number | null;
    }[];
    truncated: boolean;
  };
  recent_runs: {
    run_id: string;
    status: string;
    started_at: string | null;
    duration_seconds: number | null;
    input_count: number | null;
    activity_cluster_count: number | null;
    correspondence_edge_count: number | null;
  }[];
};

const brand = {
  orange: "#f58200",
  red: "#d92d1f",
  copper: "#8d321d",
  green: "#26271e",
};
const platformColors: Record<string, string> = {
  Terra: "#f58200",
  Aqua: "#f04b22",
  "NOAA-20": "#8d321d",
  "NOAA-21": "#e9b77e",
  Unknown: "#90988f",
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
const periodOptions = [
  ["today", "Today"],
  ["24h", "24 hours"],
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["all", "All time"],
  ["custom", "Custom"],
];

function dateInputValue(value: Date) {
  const localDate = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function initialFilters(): Filters {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);
  return {
    period: "7d",
    platform: "all",
    region: "global",
    daynight: "all",
    frpMin: "",
    frpMax: "",
    startDate: dateInputValue(weekAgo),
    endDate: dateInputValue(today),
  };
}

function platformLabel(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.includes("TERRA")) return "Terra";
  if (normalized.includes("AQUA")) return "Aqua";
  if (normalized.includes("NOAA20")) return "NOAA-20";
  if (normalized.includes("NOAA21")) return "NOAA-21";
  return "Unknown";
}

function number(value: number | null | undefined) {
  return value == null ? "—" : new Intl.NumberFormat("en-US").format(value);
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function dateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function timestampLabel(value: string | null) {
  if (!value) return "No acquisition yet";
  return `${new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} · ${new Date(value).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  })}`;
}

function apiUrl(filters: Filters) {
  const params = new URLSearchParams({
    period: filters.period,
    platform: filters.platform,
    region: filters.region,
    daynight: filters.daynight,
  });
  if (filters.frpMin.trim()) params.set("frp_min", filters.frpMin.trim());
  if (filters.frpMax.trim()) params.set("frp_max", filters.frpMax.trim());
  if (filters.period === "custom") {
    params.set("start_date", filters.startDate);
    params.set("end_date", filters.endDate);
  }
  const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/api/overview?${params}`;
}

function SelectFilter({
  label,
  value,
  options,
  onChange,
  icon,
}: {
  label: string;
  value: string;
  options: string[][];
  onChange: (value: string) => void;
  icon: ReactNode;
}) {
  return (
    <label className="select-filter">
      <span className="filter-label">{label}</span>
      <span className="select-control">
        <span className="select-icon">{icon}</span>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map(([optionValue, optionLabel]) => (
            <option value={optionValue} key={optionValue}>
              {optionLabel}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="select-chevron" />
      </span>
    </label>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  accent,
  valueClass = "",
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  accent: string;
  valueClass?: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span className="metric-icon" style={{ color: accent, backgroundColor: `${accent}12` }}>
          {icon}
        </span>
        <span className="metric-label">{label}</span>
        <CircleHelp className="metric-help" size={14} aria-label={detail} />
      </div>
      <div className={`metric-value ${valueClass}`}>{value}</div>
      <div className="metric-detail">{detail}</div>
    </article>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="chart-empty">
      <span className="empty-mark">
        <Activity size={17} />
      </span>
      <span>{label}</span>
    </div>
  );
}

function OverviewMap({ data }: { data: OverviewData }) {
  return (
    <div className="map-frame">
      <MapContainer
        center={[17, 8]}
        zoom={2}
        minZoom={2}
        maxZoom={9}
        scrollWheelZoom
        worldCopyJump
        className="fire-map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
        />
        {data.map.points.map((point) => (
          <CircleMarker
            key={point.id}
            center={[point.latitude, point.longitude]}
            radius={5}
            pathOptions={{
              color: "#d92d1f",
              weight: 1.5,
              fillColor: "#f58200",
              fillOpacity: 0.8,
            }}
          >
            <Popup>
              <strong>{platformLabel(point.platform)}</strong>
              <br />
              {point.date}
              {point.frp_mw != null && <span> · {point.frp_mw.toFixed(1)} MW</span>}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      {data.map.points.length === 0 && (
        <div className="map-empty">
          <MapPin size={18} />
          <span>No detections match these filters</span>
        </div>
      )}
      <div className="map-legend">
        <span className="legend-dot" />
        <span>Fire detections</span>
        <span className="legend-divider" />
        <span>{number(data.map.points.length)} shown</span>
      </div>
      {data.map.truncated && (
        <span className="map-cap">Showing the latest 1,200 detections</span>
      )}
    </div>
  );
}

function App() {
  const [activePage, setActivePage] = useState<
    "overview" | "monitoring" | "geospatial" | "alerts"
  >("overview");
  const [filters, setFilters] = useState(initialFilters);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const updateFilter = useCallback((key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      setData(null);
      try {
        const response = await fetch(apiUrl(filters), { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.detail ?? "The dashboard data could not be loaded.");
        }
        setData(body as OverviewData);
        setLastUpdated(new Date());
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "The dashboard data could not be loaded.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [filters, refreshKey]);

  const normalizedPlatforms = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of data?.platform_counts ?? []) {
      const label = platformLabel(item.platform);
      totals.set(label, (totals.get(label) ?? 0) + item.detections);
    }
    return ["Terra", "Aqua", "NOAA-20", "NOAA-21", "Unknown"]
      .map((platform) => ({ platform, detections: totals.get(platform) ?? 0 }))
      .filter((item) => item.detections > 0);
  }, [data?.platform_counts]);

  const distribution = useMemo(
    () => [
      { name: "Strong", value: data?.correspondence_distribution.strong ?? 0, color: "#80a66f" },
      {
        name: "Possible",
        value: data?.correspondence_distribution.possible ?? 0,
        color: brand.orange,
      },
      {
        name: "Rejected",
        value: data?.correspondence_distribution.rejected ?? 0,
        color: "#8d321d",
      },
    ],
    [data?.correspondence_distribution],
  );

  const periodLabel =
    periodOptions.find(([value]) => value === filters.period)?.[1]?.toLowerCase() ?? "7 days";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-logo">
            <img src="/logo.png" alt="TwinFlame orbiting Earth logo" />
          </div>
          <div>
            <div className="brand-name">Twin<span>Flame</span></div>
            <div className="brand-caption">FIRE INTELLIGENCE</div>
          </div>
        </div>

        <div className="side-section-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Dashboard navigation">
          <button
            className={`nav-item ${activePage === "overview" ? "active" : ""}`}
            type="button"
            onClick={() => setActivePage("overview")}
            aria-current={activePage === "overview" ? "page" : undefined}
          >
            <Layers3 size={17} />
            <span>Overview</span>
            {activePage === "overview" && <span className="nav-active-mark" />}
          </button>
          <button className="nav-item" type="button" disabled title="Coming soon">
            <Link2 size={17} />
            <span>Correspondences</span>
            <span className="nav-soon">SOON</span>
          </button>
          <button
            className={`nav-item ${activePage === "geospatial" ? "active" : ""}`}
            type="button"
            onClick={() => setActivePage("geospatial")}
            aria-current={activePage === "geospatial" ? "page" : undefined}
          >
            <Globe2 size={17} />
            <span>Geospatial explore</span>
            {activePage === "geospatial" && <span className="nav-active-mark" />}
          </button>
          <button
            className={`nav-item ${activePage === "monitoring" ? "active" : ""}`}
            type="button"
            onClick={() => setActivePage("monitoring")}
            aria-current={activePage === "monitoring" ? "page" : undefined}
          >
            <Satellite size={17} />
            <span>Live monitoring</span>
            {activePage === "monitoring" && <span className="nav-active-mark" />}
          </button>
          <button
            className={`nav-item ${activePage === "alerts" ? "active" : ""}`}
            type="button"
            onClick={() => setActivePage("alerts")}
            aria-current={activePage === "alerts" ? "page" : undefined}
          >
            <Bell size={17} />
            <span>Alerts center</span>
            {activePage === "alerts" && <span className="nav-active-mark" />}
          </button>
        </nav>

        <div className="sidebar-spacer" />
        <div className="pipeline-status">
          <div className="pipeline-status-top">
            <span
              className={`status-pulse ${error ? "offline" : loading ? "syncing" : ""}`}
            />
            <span>Database</span>
            <span className={`status-live ${error ? "offline" : ""}`}>
              {error ? "ERROR" : loading ? "SYNCING" : data ? "CONNECTED" : "—"}
            </span>
          </div>
          <p>Read-only connection to harmonized observations.</p>
        </div>
        <div className="sidebar-footer">
          <span className="footer-orbit">T</span>
          <div>
            <span className="footer-name">TwinFlame</span>
            <span className="footer-version">NASA SPACE CHALLENGE · 2026</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>
              {activePage === "overview"
                ? "Overview"
                : activePage === "monitoring"
                  ? "Live monitoring"
                  : activePage === "geospatial"
                    ? "Geospatial exploration"
                    : "Alerts center"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="utc-note"><Globe2 size={14} /> ALL TIMES UTC</span>
            <span className="topbar-divider" />
            <span className="topbar-date">
              <CalendarDays size={15} />
              {new Date().toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </header>

        <div className="page-wrap">
          {activePage === "monitoring" ? (
            <MonitoringPage />
          ) : activePage === "alerts" ? (
            <AlertsCenter />
          ) : activePage === "geospatial" ? (
            <GeospatialPage />
          ) : (
            <>
          <section className="page-heading">
            <div>
              <div className="eyebrow"><span /> GLOBAL FIRE MONITOR</div>
              <h1>Overview</h1>
              <p className="page-subtitle">
                A unified view of active fire detections and cross-sensor activity.
              </p>
            </div>
            <button
              className={`refresh-button ${loading ? "is-loading" : ""}`}
              type="button"
              onClick={() => setRefreshKey((key) => key + 1)}
              disabled={loading}
            >
              <RefreshCw size={15} />
              <span>Refresh data</span>
            </button>
          </section>

          <section className="filter-panel" aria-label="Overview filters">
            <div className="filter-heading">
              <span className="filter-heading-icon"><SlidersHorizontal size={15} /></span>
              <span>Filters</span>
            </div>
            <div className="filter-separator" />
            <label className="period-filter">
              <span className="filter-label">DATE RANGE</span>
              <span className="period-control">
                {periodOptions.map(([value, label]) => (
                  <button
                    className={filters.period === value ? "period-button selected" : "period-button"}
                    key={value}
                    type="button"
                    onClick={() => updateFilter("period", value)}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </label>
            <div className="filter-separator" />
            <SelectFilter
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
              icon={<Satellite size={14} />}
            />
            <SelectFilter
              label="REGION"
              value={filters.region}
              options={regions}
              onChange={(value) => updateFilter("region", value)}
              icon={<Globe2 size={14} />}
            />
            <SelectFilter
              label="DAY / NIGHT"
              value={filters.daynight}
              options={[
                ["all", "All observations"],
                ["day", "Day"],
                ["night", "Night"],
              ]}
              onChange={(value) => updateFilter("daynight", value)}
              icon={filters.daynight === "night" ? <Moon size={14} /> : <Sun size={14} />}
            />
            <div className="filter-separator frp-divider" />
            <div className="frp-filter">
              <span className="filter-label">FRP · MW</span>
              <div className="frp-inputs">
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Min"
                  aria-label="Minimum fire radiative power in megawatts"
                  value={filters.frpMin}
                  onChange={(event) => updateFilter("frpMin", event.target.value)}
                />
                <span>—</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Max"
                  aria-label="Maximum fire radiative power in megawatts"
                  value={filters.frpMax}
                  onChange={(event) => updateFilter("frpMax", event.target.value)}
                />
              </div>
            </div>
            {filters.period === "custom" && (
              <>
                <div className="filter-separator custom-divider" />
                <label className="date-input">
                  <span className="filter-label">FROM</span>
                  <input
                    type="date"
                    value={filters.startDate}
                    onChange={(event) => updateFilter("startDate", event.target.value)}
                  />
                </label>
                <label className="date-input">
                  <span className="filter-label">TO</span>
                  <input
                    type="date"
                    value={filters.endDate}
                    onChange={(event) => updateFilter("endDate", event.target.value)}
                  />
                </label>
              </>
            )}
          </section>

          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} />
              <div>
                <strong>Dashboard data unavailable</strong>
                <span>{error}</span>
              </div>
              <button type="button" onClick={() => setRefreshKey((key) => key + 1)}>
                Try again <ArrowUpRight size={14} />
              </button>
            </div>
          )}

          <section className="metrics-grid" aria-label="Overview summary">
            <MetricCard
              label="Total detections"
              value={data ? compactNumber(data.kpis.total_detections) : "—"}
              detail={`Across selected ${periodLabel}`}
              icon={<Flame size={17} />}
              accent={brand.red}
            />
            <MetricCard
              label="Activity clusters"
              value={data ? compactNumber(data.kpis.activity_clusters) : "—"}
              detail="Harmonized fire events"
              icon={<Layers3 size={17} />}
              accent={brand.copper}
            />
            <MetricCard
              label="Strong matches"
              value={data ? compactNumber(data.kpis.strong_correspondences) : "—"}
              detail="High-confidence correspondences"
              icon={<Link2 size={17} />}
              accent={brand.green}
            />
            <MetricCard
              label="Possible matches"
              value={data ? compactNumber(data.kpis.possible_correspondences) : "—"}
              detail="Candidate correspondences"
              icon={<CircleHelp size={17} />}
              accent="#d18935"
            />
            <MetricCard
              label="Unmatched / rejected"
              value={data ? compactNumber(data.kpis.unmatched_or_rejected) : "—"}
              detail="Observations without a strong or possible match"
              icon={<MapPin size={17} />}
              accent="#788276"
            />
            <MetricCard
              label="Latest acquisition"
              value={data ? timestampLabel(data.kpis.latest_acquisition) : "—"}
              detail="Most recent filtered observation"
              icon={<Clock3 size={17} />}
              accent="#98724c"
              valueClass="metric-time"
            />
          </section>

          <section className="visual-grid">
            <article className="panel map-panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Global fire activity</div>
                  <div className="panel-subtitle">Geographic distribution of filtered detections</div>
                </div>
                <span className="panel-tag"><span className="tag-dot" /> LIVE MAP</span>
              </div>
              {data ? (
                <OverviewMap data={data} />
              ) : (
                <div className="panel-skeleton map-skeleton" />
              )}
              <div className="map-footer">
                <span><span className="footer-indicator" /> Satellite observations</span>
                <span>Drag to pan <span className="footer-dot">·</span> Scroll to zoom</span>
              </div>
            </article>

            <article className="panel correspondence-panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Correspondence quality</div>
                  <div className="panel-subtitle">Cross-sensor match decisions</div>
                </div>
                <span className="panel-icon"><Link2 size={16} /></span>
              </div>
              {data ? (
                <>
                  <div className="donut-wrap">
                    {distribution.some((item) => item.value > 0) ? (
                      <>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={distribution}
                              dataKey="value"
                              nameKey="name"
                              innerRadius="69%"
                              outerRadius="92%"
                              paddingAngle={distribution.filter((item) => item.value > 0).length > 1 ? 4 : 0}
                              stroke="none"
                              startAngle={90}
                              endAngle={-270}
                            >
                              {distribution.map((item) => (
                                <Cell key={item.name} fill={item.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(value) => number(Number(value))}
                              contentStyle={{
                                border: "1px solid #3b4035",
                                borderRadius: 10,
                                backgroundColor: "#20241d",
                                color: "#f3efe7",
                                boxShadow: "0 8px 26px #00000055",
                                fontSize: 12,
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="donut-center">
                          <strong>
                            {compactNumber(
                              data.correspondence_distribution.strong +
                                data.correspondence_distribution.possible +
                                data.correspondence_distribution.rejected,
                            )}
                          </strong>
                          <span>total matches</span>
                        </div>
                      </>
                    ) : (
                      <EmptyChart label="No correspondences in this range" />
                    )}
                  </div>
                  <div className="distribution-legend">
                    {distribution.map((item) => (
                      <div className="distribution-row" key={item.name}>
                        <span className="distribution-name">
                          <span className="distribution-dot" style={{ background: item.color }} />
                          {item.name}
                        </span>
                        <strong>{number(item.value)}</strong>
                        <span className="distribution-percent">
                          {data.correspondence_distribution.strong +
                            data.correspondence_distribution.possible +
                            data.correspondence_distribution.rejected
                            ? `${Math.round(
                                (item.value /
                                  (data.correspondence_distribution.strong +
                                    data.correspondence_distribution.possible +
                                    data.correspondence_distribution.rejected)) *
                                  100,
                              )}%`
                            : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="panel-skeleton chart-skeleton" />
              )}
            </article>

            <article className="panel trend-panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Detection activity</div>
                  <div className="panel-subtitle">Daily observations across selected platforms</div>
                </div>
                <span className="chart-unit">DETECTIONS / DAY</span>
              </div>
              <div className="trend-chart">
                {data && data.daily_trend.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.daily_trend} margin={{ top: 10, right: 12, bottom: 0, left: -14 }}>
                      <defs>
                        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f58200" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="#f58200" stopOpacity={0.015} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="#34392f" strokeDasharray="3 5" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={dateLabel}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={26}
                        tick={{ fill: "#a0a596", fontSize: 11 }}
                        dy={10}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={48}
                        tickFormatter={(value: number) => compactNumber(value)}
                        tick={{ fill: "#a0a596", fontSize: 11 }}
                      />
                      <Tooltip
                        labelFormatter={(label) => new Date(`${label}T00:00:00`).toLocaleDateString("en-US", {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        })}
                        formatter={(value) => [number(Number(value)), "Detections"]}
                        contentStyle={{
                          border: "1px solid #3b4035",
                          borderRadius: 10,
                          backgroundColor: "#20241d",
                          color: "#f3efe7",
                          boxShadow: "0 8px 26px #00000055",
                          fontSize: 12,
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="detections"
                        stroke="#f04b22"
                        strokeWidth={2.5}
                        fill="url(#trendFill)"
                        activeDot={{ r: 5, stroke: "#f3efe7", strokeWidth: 2 }}
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : data ? (
                  <EmptyChart label="No daily detections in this range" />
                ) : (
                  <div className="panel-skeleton" />
                )}
              </div>
            </article>

            <article className="panel platform-panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Detections by platform</div>
                  <div className="panel-subtitle">Sensor contribution in this range</div>
                </div>
                <span className="panel-icon"><Satellite size={16} /></span>
              </div>
              <div className="platform-chart">
                {data && normalizedPlatforms.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={normalizedPlatforms}
                      layout="vertical"
                      margin={{ top: 8, right: 26, bottom: 2, left: 0 }}
                      barCategoryGap={16}
                    >
                      <CartesianGrid horizontal={false} stroke="#34392f" />
                      <XAxis
                        type="number"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#a0a596", fontSize: 10 }}
                        tickFormatter={(value: number) => compactNumber(value)}
                      />
                      <YAxis
                        type="category"
                        dataKey="platform"
                        axisLine={false}
                        tickLine={false}
                        width={62}
                        tick={{ fill: "#d4d0c4", fontSize: 11, fontWeight: 600 }}
                      />
                      <Tooltip
                        formatter={(value) => [number(Number(value)), "Detections"]}
                        contentStyle={{
                          borderRadius: 10,
                          border: "1px solid #3b4035",
                          backgroundColor: "#20241d",
                          color: "#f3efe7",
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="detections" radius={[0, 5, 5, 0]} maxBarSize={19}>
                        {normalizedPlatforms.map((item) => (
                          <Cell key={item.platform} fill={platformColors[item.platform]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : data ? (
                  <EmptyChart label="No platform detections in this range" />
                ) : (
                  <div className="panel-skeleton" />
                )}
              </div>
              <div className="platform-footnote">
                <span><span className="tiny-dot" /> Terra &amp; Aqua · MODIS</span>
                <span><span className="tiny-dot viirs-dot" /> NOAA-20 &amp; 21 · VIIRS</span>
              </div>
            </article>

            <article className="panel pipeline-panel">
              <div className="panel-header pipeline-header">
                <div>
                  <div className="panel-title">Recent pipeline activity</div>
                  <div className="panel-subtitle">Latest harmonization executions</div>
                </div>
                <span className="activity-count">
                  <Activity size={14} />
                  {data ? `${data.recent_runs.length} RUNS` : "—"}
                </span>
              </div>
              {data && data.recent_runs.length ? (
                <div className="run-list">
                  {data.recent_runs.map((run) => {
                    const success = ["success", "succeeded", "complete", "completed"].includes(
                      run.status.toLowerCase(),
                    );
                    return (
                      <div className="run-row" key={run.run_id}>
                        <span className={`run-status ${success ? "success" : "other"}`}>
                          {success ? <Check size={13} /> : <AlertCircle size={13} />}
                        </span>
                        <div className="run-main">
                          <strong>Harmonization run</strong>
                          <span className="run-id">{run.run_id}</span>
                        </div>
                        <span className={`run-badge ${success ? "success-badge" : "other-badge"}`}>
                          {run.status}
                        </span>
                        <div className="run-stat">
                          <strong>{number(run.input_count)}</strong>
                          <span>INPUTS</span>
                        </div>
                        <div className="run-stat">
                          <strong>{number(run.activity_cluster_count)}</strong>
                          <span>CLUSTERS</span>
                        </div>
                        <div className="run-time">
                          <span>{run.started_at ? timestampLabel(run.started_at) : "—"}</span>
                          <span>
                            {run.duration_seconds != null
                              ? `${Math.max(1, Math.round(run.duration_seconds / 60))} min`
                              : "duration —"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : data ? (
                <div className="runs-empty">
                  <Clock3 size={17} />
                  <span>No pipeline runs match the current filters.</span>
                </div>
              ) : (
                <div className="panel-skeleton run-skeleton" />
              )}
            </article>
          </section>

          <footer className="page-footer">
            <span>
              <span className={`footer-indicator ${error ? "offline" : ""}`} />
              {error ? "Data source unavailable" : "Connected to harmonized observations"}
            </span>
            <span>
              {loading
                ? "Updating…"
                : error
                  ? "Update failed"
                  : lastUpdated
                    ? `Updated ${lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`
                    : "Waiting for data"}
              <span className="footer-dot"> · </span>
              <button type="button" onClick={() => setRefreshKey((key) => key + 1)}>
                Refresh
              </button>
            </span>
          </footer>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
