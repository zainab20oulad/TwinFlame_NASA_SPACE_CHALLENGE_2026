import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  Clock3,
  Flame,
  MapPin,
  RotateCcw,
  Satellite,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";

type AlertType = "fire" | "unusual" | "availability" | "pipeline";
type AlertStatus = "new" | "acknowledged" | "resolved";
type Severity = "low" | "medium" | "high" | "critical";

type AlertHistoryItem = {
  action: string;
  timestamp: string;
  performedBy: string;
};

type AlertEvent = {
  id: string;
  type: AlertType;
  severity: Severity;
  title: string;
  description: string;
  triggeredAt: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
  relatedRunId: string | null;
  platforms: string[];
  trigger: string;
  evidence: string[];
  status: AlertStatus;
  history: AlertHistoryItem[];
};

type AlertFilters = {
  startDate: string;
  endDate: string;
  type: string;
  severity: string;
  status: string;
  region: string;
  platform: string;
};

const STORAGE_KEY = "twinflame.alerts.events.v1";
const TYPE_LABELS: Record<AlertType, string> = {
  fire: "Elevated fire activity",
  unusual: "Unusual activity",
  availability: "Data availability",
  pipeline: "Pipeline failure",
};
const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
const STATUS_LABELS: Record<AlertStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
};

const DEMO_ALERTS: AlertEvent[] = [
  {
    id: "demo-frp-01",
    type: "unusual",
    severity: "high",
    title: "Elevated FRP detected",
    description:
      "A geographical region has recorded a daily FRP value significantly above its historical baseline.",
    triggeredAt: "2026-11-14T13:42:00Z",
    region: "Example study area · East Africa",
    latitude: 2.5,
    longitude: 34.5,
    relatedRunId: null,
    platforms: ["MODIS", "VIIRS"],
    trigger: "Illustrative FRP anomaly threshold exceeded",
    evidence: [
      "Daily FRP: 2.4× the illustrative regional baseline",
      "Supporting observations: MODIS and VIIRS",
      "Baseline window: preceding 30 days (illustrative)",
    ],
    status: "new",
    history: [
      {
        action: "Alert created",
        timestamp: "2026-11-14T13:42:00Z",
        performedBy: "Illustrative rule",
      },
    ],
  },
  {
    id: "demo-data-01",
    type: "availability",
    severity: "medium",
    title: "Expected observation not received",
    description:
      "An illustrative observation window has passed without a matching source record.",
    triggeredAt: "2026-11-13T09:18:00Z",
    region: "Example study area · South Asia",
    latitude: 22.5,
    longitude: 78.9,
    relatedRunId: null,
    platforms: ["Terra"],
    trigger: "Expected MODIS observation window is missing",
    evidence: [
      "Expected platform: Terra",
      "Observation window: 2026-11-13 06:00–09:00 UTC",
      "Availability check: illustrative sample",
    ],
    status: "acknowledged",
    history: [
      {
        action: "Alert created",
        timestamp: "2026-11-13T09:18:00Z",
        performedBy: "Illustrative rule",
      },
      {
        action: "Acknowledged",
        timestamp: "2026-11-13T10:02:00Z",
        performedBy: "Dashboard user",
      },
    ],
  },
  {
    id: "demo-pipeline-01",
    type: "pipeline",
    severity: "critical",
    title: "Harmonization run failed",
    description:
      "A sample processing run stopped before harmonized outputs were written.",
    triggeredAt: "2026-11-12T22:05:00Z",
    region: "Global",
    latitude: null,
    longitude: null,
    relatedRunId: "demo-run-884",
    platforms: ["Pipeline"],
    trigger: "Processing run status is failed",
    evidence: [
      "Run: demo-run-884",
      "Stage: correspondence validation",
      "Outcome: illustrative failed run",
    ],
    status: "new",
    history: [
      {
        action: "Alert created",
        timestamp: "2026-11-12T22:05:00Z",
        performedBy: "Illustrative rule",
      },
    ],
  },
  {
    id: "demo-fire-01",
    type: "fire",
    severity: "medium",
    title: "Regional detection count elevated",
    description:
      "The illustrative daily detection count is above its configured regional threshold.",
    triggeredAt: "2026-11-10T15:36:00Z",
    region: "Example study area · Southern Europe",
    latitude: 40.2,
    longitude: 17.4,
    relatedRunId: null,
    platforms: ["VIIRS"],
    trigger: "Daily detection count exceeds the illustrative threshold",
    evidence: [
      "Daily detections: 86 (illustrative)",
      "Configured sample threshold: 60",
      "Supporting platform: VIIRS",
    ],
    status: "acknowledged",
    history: [
      {
        action: "Alert created",
        timestamp: "2026-11-10T15:36:00Z",
        performedBy: "Illustrative rule",
      },
      {
        action: "Acknowledged",
        timestamp: "2026-11-10T16:11:00Z",
        performedBy: "Dashboard user",
      },
    ],
  },
  {
    id: "demo-pipeline-02",
    type: "pipeline",
    severity: "high",
    title: "Input validation requires review",
    description:
      "A sample source file did not pass the expected schema checks.",
    triggeredAt: "2026-11-09T06:12:00Z",
    region: "Global",
    latitude: null,
    longitude: null,
    relatedRunId: "demo-run-879",
    platforms: ["Pipeline"],
    trigger: "Input validation reported missing required fields",
    evidence: [
      "Run: demo-run-879",
      "Validation: required-column check",
      "Outcome: illustrative validation failure",
    ],
    status: "resolved",
    history: [
      {
        action: "Alert created",
        timestamp: "2026-11-09T06:12:00Z",
        performedBy: "Illustrative rule",
      },
      {
        action: "Resolved",
        timestamp: "2026-11-09T08:40:00Z",
        performedBy: "Dashboard user",
      },
    ],
  },
  {
    id: "demo-data-02",
    type: "availability",
    severity: "low",
    title: "Source data may be stale",
    description:
      "The sample ingestion timestamp is older than its expected refresh interval.",
    triggeredAt: "2026-11-08T18:20:00Z",
    region: "Example study area · North America",
    latitude: 38.5,
    longitude: -101.5,
    relatedRunId: null,
    platforms: ["NOAA-20"],
    trigger: "Last successful retrieval exceeds the illustrative freshness window",
    evidence: [
      "Related platform: NOAA-20",
      "Expected refresh: every 6 hours",
      "Latest retrieval: 2026-11-08 10:00 UTC (illustrative)",
    ],
    status: "resolved",
    history: [
      {
        action: "Alert created",
        timestamp: "2026-11-08T18:20:00Z",
        performedBy: "Illustrative rule",
      },
      {
        action: "Resolved",
        timestamp: "2026-11-08T21:04:00Z",
        performedBy: "Dashboard user",
      },
    ],
  },
];

const HISTORY_DAYS = [
  "2026-11-08",
  "2026-11-09",
  "2026-11-10",
  "2026-11-11",
  "2026-11-12",
  "2026-11-13",
  "2026-11-14",
];

const regionOptions = [
  "Example study area · East Africa",
  "Example study area · South Asia",
  "Example study area · Southern Europe",
  "Example study area · North America",
  "Global",
];

function isAlertEvent(value: unknown): value is AlertEvent {
  if (typeof value !== "object" || value === null) return false;
  const alert = value as Partial<AlertEvent>;
  return (
    typeof alert.id === "string" &&
    typeof alert.triggeredAt === "string" &&
    typeof alert.title === "string" &&
    ["new", "acknowledged", "resolved"].includes(alert.status ?? "") &&
    Array.isArray(alert.history)
  );
}

function loadAlerts() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { alerts: DEMO_ALERTS, error: "" };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isAlertEvent)) {
      throw new Error("Saved alert data is invalid.");
    }
    return { alerts: parsed, error: "" };
  } catch {
    return {
      alerts: DEMO_ALERTS,
      error: "Saved alert actions could not be read. Showing the illustrative sample.",
    };
  }
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function AlertIcon({ type }: { type: AlertType }) {
  if (type === "fire") return <Flame size={15} />;
  if (type === "availability") return <Satellite size={15} />;
  if (type === "pipeline") return <AlertTriangle size={15} />;
  return <ShieldAlert size={15} />;
}

function AlertsCenter() {
  const initial = useMemo(loadAlerts, []);
  const [alerts, setAlerts] = useState<AlertEvent[]>(initial.alerts);
  const [storageError, setStorageError] = useState(initial.error);
  const [selectedId, setSelectedId] = useState(DEMO_ALERTS[0].id);
  const [filters, setFilters] = useState<AlertFilters>({
    startDate: "2026-11-01",
    endDate: "2026-11-14",
    type: "all",
    severity: "all",
    status: "all",
    region: "all",
    platform: "all",
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
    } catch {
      setStorageError("Alert actions could not be saved in this browser.");
    }
  }, [alerts]);

  const filteredAlerts = useMemo(
    () =>
      alerts
        .filter((alert) => {
          const date = alert.triggeredAt.slice(0, 10);
          return (
            date >= filters.startDate &&
            date <= filters.endDate &&
            (filters.type === "all" || alert.type === filters.type) &&
            (filters.severity === "all" || alert.severity === filters.severity) &&
            (filters.status === "all" || alert.status === filters.status) &&
            (filters.region === "all" || alert.region === filters.region) &&
            (filters.platform === "all" || alert.platforms.includes(filters.platform))
          );
        })
        .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt)),
    [alerts, filters],
  );
  const selectedAlert =
    filteredAlerts.find((alert) => alert.id === selectedId) ?? filteredAlerts[0];
  const activeCount = alerts.filter((alert) => alert.status !== "resolved").length;
  const acknowledgedCount = alerts.filter(
    (alert) => alert.status === "acknowledged",
  ).length;
  const resolvedCount = alerts.filter((alert) => alert.status === "resolved").length;
  const historyData = HISTORY_DAYS.map((day) => ({
    day: new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
    count: DEMO_ALERTS.filter((alert) => alert.triggeredAt.slice(0, 10) === day)
      .length,
  }));
  const reversedDateRange = filters.startDate > filters.endDate;

  const updateFilter = (key: keyof AlertFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const changeStatus = (alertId: string, status: AlertStatus) => {
    const now = new Date().toISOString();
    const action = status === "acknowledged" ? "Acknowledged" : "Resolved";
    setAlerts((current) =>
      current.map((alert) =>
        alert.id === alertId
          ? {
              ...alert,
              status,
              history: [
                ...alert.history,
                { action, timestamp: now, performedBy: "Dashboard user" },
              ],
            }
          : alert,
      ),
    );
  };

  const resetSample = () => {
    setAlerts(DEMO_ALERTS);
    setSelectedId(DEMO_ALERTS[0].id);
  };

  return (
    <>
      <section className="page-heading alerts-heading">
        <div>
          <div className="eyebrow"><span /> OBSERVATION &amp; PIPELINE HEALTH</div>
          <h1>Alerts center</h1>
          <p className="page-subtitle">
            Review meaningful satellite-observation and processing conditions.
          </p>
        </div>
        <div className="alerts-heading-actions">
          <button type="button" className="alerts-reset-button" onClick={resetSample}>
            <RotateCcw size={13} /> Reset sample
          </button>
          <span className="alerts-demo-badge"><Bell size={13} /> ILLUSTRATIVE SAMPLE</span>
        </div>
      </section>

      <div className="alerts-notice" role="note">
        <AlertTriangle size={16} />
        <p>
          <strong>Not an emergency warning.</strong> These illustrative examples
          are not live notifications, fire predictions, or assessments of risk to
          people. MODIS and VIIRS correspondence alone does not trigger an alert.
        </p>
      </div>

      {storageError && (
        <div className="alerts-storage-warning" role="status">{storageError}</div>
      )}

      <section className="alerts-summary" aria-label="Alert summary">
        <article className="alerts-summary-card">
          <span className="alerts-summary-icon"><Bell size={17} /></span>
          <span className="alerts-summary-label">TOTAL ALERTS</span>
          <strong>{alerts.length}</strong>
          <small>In this illustrative sample</small>
        </article>
        <article className="alerts-summary-card">
          <span className="alerts-summary-icon is-high"><AlertTriangle size={17} /></span>
          <span className="alerts-summary-label">ACTIVE</span>
          <strong>{activeCount}</strong>
          <small>New or acknowledged</small>
        </article>
        <article className="alerts-summary-card">
          <span className="alerts-summary-icon is-ack"><Check size={17} /></span>
          <span className="alerts-summary-label">ACKNOWLEDGED</span>
          <strong>{acknowledgedCount}</strong>
          <small>Seen, still open</small>
        </article>
        <article className="alerts-summary-card">
          <span className="alerts-summary-icon is-resolved"><CheckCheck size={17} /></span>
          <span className="alerts-summary-label">RESOLVED</span>
          <strong>{resolvedCount}</strong>
          <small>Closed in this sample</small>
        </article>
      </section>

      <section className="alerts-filter-panel" aria-label="Alert filters">
        <div className="alerts-filter-heading">
          <SlidersHorizontal size={15} />
          <span>Filter alerts</span>
        </div>
        <label className="alerts-filter">
          <span>FROM · UTC</span>
          <input
            type="date"
            value={filters.startDate}
            onChange={(event) => updateFilter("startDate", event.target.value)}
          />
        </label>
        <label className="alerts-filter">
          <span>TO · UTC</span>
          <input
            type="date"
            value={filters.endDate}
            onChange={(event) => updateFilter("endDate", event.target.value)}
          />
        </label>
        <label className="alerts-filter">
          <span>ALERT TYPE</span>
          <select value={filters.type} onChange={(event) => updateFilter("type", event.target.value)}>
            <option value="all">All types</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="alerts-filter">
          <span>SEVERITY</span>
          <select value={filters.severity} onChange={(event) => updateFilter("severity", event.target.value)}>
            <option value="all">All severities</option>
            {SEVERITIES.map((severity) => (
              <option value={severity} key={severity}>
                {severity.charAt(0).toUpperCase() + severity.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="alerts-filter">
          <span>STATUS</span>
          <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
            <option value="all">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="alerts-filter">
          <span>REGION</span>
          <select value={filters.region} onChange={(event) => updateFilter("region", event.target.value)}>
            <option value="all">All regions</option>
            {regionOptions.map((region) => <option value={region} key={region}>{region}</option>)}
          </select>
        </label>
        <label className="alerts-filter">
          <span>SATELLITE / PLATFORM</span>
          <select value={filters.platform} onChange={(event) => updateFilter("platform", event.target.value)}>
            <option value="all">All platforms</option>
            {["MODIS", "VIIRS", "Terra", "Aqua", "NOAA-20", "NOAA-21", "Pipeline"].map((platform) => (
              <option value={platform} key={platform}>{platform}</option>
            ))}
          </select>
        </label>
      </section>
      {reversedDateRange && (
        <p className="alerts-filter-error" role="alert">
          Start date must be on or before the end date.
        </p>
      )}

      <div className="alerts-workspace">
        <section className="alerts-feed-panel" aria-label="Alert feed">
          <div className="alerts-panel-header">
            <div>
              <h2>Alert feed</h2>
              <p>{filteredAlerts.length} matching illustrative alerts</p>
            </div>
            <span className="alerts-feed-count">{filteredAlerts.length}</span>
          </div>
          <div className="alerts-feed-list">
            {filteredAlerts.map((alert) => (
              <article
                className={`alert-feed-item ${selectedAlert?.id === alert.id ? "is-selected" : ""}`}
                key={alert.id}
              >
                <button
                  type="button"
                  className="alert-feed-select"
                  onClick={() => setSelectedId(alert.id)}
                  aria-label={`View ${alert.title}`}
                  aria-pressed={selectedAlert?.id === alert.id}
                >
                  <span className={`alert-type-icon alert-type-${alert.type}`}>
                    <AlertIcon type={alert.type} />
                  </span>
                  <span className="alert-feed-content">
                    <span className="alert-feed-meta">
                      <span className={`alert-severity severity-${alert.severity}`}>
                        {alert.severity}
                      </span>
                      <span>{TYPE_LABELS[alert.type]}</span>
                    </span>
                    <strong>{alert.title}</strong>
                    <span className="alert-feed-location">
                      <MapPin size={12} /> {alert.region}
                    </span>
                    <span className="alert-feed-time">
                      <Clock3 size={12} /> {formatTime(alert.triggeredAt)}
                    </span>
                  </span>
                  <span className={`alert-status status-${alert.status}`}>
                    {STATUS_LABELS[alert.status]}
                  </span>
                </button>
                <div className="alert-feed-actions">
                  {alert.status === "new" && (
                    <button type="button" onClick={() => changeStatus(alert.id, "acknowledged")}>
                      <Check size={13} /> Acknowledge
                    </button>
                  )}
                  {alert.status !== "resolved" && (
                    <button type="button" onClick={() => changeStatus(alert.id, "resolved")}>
                      <CheckCheck size={13} /> Resolve
                    </button>
                  )}
                </div>
              </article>
            ))}
            {filteredAlerts.length === 0 && (
              <div className="alerts-empty">
                <Bell size={20} />
                <strong>No alerts match these filters</strong>
                <span>Try a different date range or filter selection.</span>
              </div>
            )}
          </div>
        </section>

        <section className="alerts-map-panel" aria-label="Illustrative alert map">
          <div className="alerts-panel-header">
            <div>
              <h2>Alert locations</h2>
              <p>Illustrative locations only · not live incident data</p>
            </div>
            <span className="alerts-map-legend"><i /> Sample</span>
          </div>
          <div className="alerts-map-frame">
            <MapContainer
              center={[18, 5]}
              zoom={1.6}
              minZoom={1}
              scrollWheelZoom
              className="alerts-map"
              aria-label="Map of illustrative alert locations"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {filteredAlerts.map((alert) =>
                alert.latitude != null && alert.longitude != null ? (
                  <CircleMarker
                    key={alert.id}
                    center={[alert.latitude, alert.longitude]}
                    radius={selectedAlert?.id === alert.id ? 9 : 7}
                    pathOptions={{
                      color: "#171b15",
                      weight: 2,
                      fillColor:
                        alert.severity === "critical"
                          ? "#e45b4f"
                          : alert.severity === "high"
                            ? "#f58200"
                            : alert.severity === "medium"
                              ? "#d9a64a"
                              : "#80a66f",
                      fillOpacity: 0.94,
                    }}
                    eventHandlers={{ click: () => setSelectedId(alert.id) }}
                  >
                    <Popup>
                      <strong>{alert.title}</strong>
                      <br />
                      {alert.region}
                      <br />
                      Illustrative sample location
                    </Popup>
                  </CircleMarker>
                ) : null,
              )}
            </MapContainer>
            {filteredAlerts.every((alert) => alert.latitude == null || alert.longitude == null) && (
              <div className="alerts-map-empty">No geographically relevant alerts in this view.</div>
            )}
          </div>
        </section>

        {selectedAlert && (
          <section className="alerts-detail-panel" aria-label="Selected alert details">
            <div className="alerts-panel-header">
              <div>
                <span className="alerts-detail-kicker">SELECTED ALERT</span>
                <h2>{selectedAlert.title}</h2>
              </div>
              <span className={`alert-status status-${selectedAlert.status}`}>
                {STATUS_LABELS[selectedAlert.status]}
              </span>
            </div>
            <p className="alerts-detail-description">{selectedAlert.description}</p>
            <div className="alerts-detail-facts">
              <div><span>TYPE</span><strong>{TYPE_LABELS[selectedAlert.type]}</strong></div>
              <div><span>SEVERITY</span><strong className={`detail-severity severity-${selectedAlert.severity}`}>{selectedAlert.severity}</strong></div>
              <div><span>TRIGGERED · UTC</span><strong>{formatTime(selectedAlert.triggeredAt)}</strong></div>
              <div><span>REGION</span><strong>{selectedAlert.region}</strong></div>
              <div><span>SATELLITE / PLATFORM</span><strong>{selectedAlert.platforms.join(", ")}</strong></div>
              {selectedAlert.relatedRunId && (
                <div><span>RELATED RUN</span><strong>{selectedAlert.relatedRunId}</strong></div>
              )}
            </div>
            <div className="alerts-evidence">
              <h3>Triggering condition</h3>
              <p>{selectedAlert.trigger}</p>
              <h3>Supporting observations</h3>
              <ul>
                {selectedAlert.evidence.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div className="alerts-history">
              <h3>Status history</h3>
              {selectedAlert.history.map((item, index) => (
                <div className="alerts-history-item" key={`${item.timestamp}-${index}`}>
                  <span className="alerts-history-dot" />
                  <span><strong>{item.action}</strong><small>{item.performedBy}</small></span>
                  <time>{formatTime(item.timestamp)}</time>
                </div>
              ))}
            </div>
            <div className="alerts-detail-actions">
              {selectedAlert.status === "new" && (
                <button
                  type="button"
                  className="alerts-action-secondary"
                  onClick={() => changeStatus(selectedAlert.id, "acknowledged")}
                >
                  <Check size={14} /> Acknowledge
                </button>
              )}
              {selectedAlert.status !== "resolved" && (
                <button
                  type="button"
                  className="alerts-action-primary"
                  onClick={() => changeStatus(selectedAlert.id, "resolved")}
                >
                  <CheckCheck size={14} /> Resolve alert
                </button>
              )}
              {selectedAlert.status === "resolved" && (
                <span className="alerts-resolved-note"><CheckCheck size={14} /> This alert is resolved</span>
              )}
            </div>
          </section>
        )}

        <section className="alerts-history-chart-panel">
          <div className="alerts-panel-header">
            <div>
              <h2>Historical alert activity</h2>
              <p>Sample events by day · 8–14 November 2026</p>
            </div>
            <span className="alerts-chart-tag">ILLUSTRATIVE</span>
          </div>
          <div className="alerts-history-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={historyData} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#30362c" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: "#a0a596", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: "#a0a596", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "#f5820012" }}
                  contentStyle={{ background: "#20241d", border: "1px solid #3a4035", borderRadius: 8 }}
                  labelStyle={{ color: "#f3efe7" }}
                  itemStyle={{ color: "#f5a044" }}
                  formatter={(value) => [value, "Sample alerts"]}
                />
                <Bar dataKey="count" fill="#f58200" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="alerts-chart-caption">
            Counts reflect this example dataset only; they are not historical operational statistics.
          </p>
        </section>
      </div>
    </>
  );
}

export default AlertsCenter;
