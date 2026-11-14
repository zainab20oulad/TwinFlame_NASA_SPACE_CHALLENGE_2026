import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  Circle,
  Crosshair,
  MapPin,
  Minus,
  Pencil,
  Plus,
  RectangleHorizontal,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Circle as LeafletCircle,
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  Popup,
  Rectangle,
  TileLayer,
  useMapEvents,
} from "react-leaflet";

type Position = [number, number];
type AreaGeometry =
  | { type: "rectangle"; south: number; west: number; north: number; east: number }
  | { type: "circle"; center: Position; radius_km: number }
  | { type: "polygon"; points: Position[] };
type AnnotationGeometry =
  | { type: "point"; position: Position }
  | { type: "line" | "polygon"; points: Position[] };
type SavedArea = { id: string; name: string; geometry: AreaGeometry };
type SavedAnnotation = {
  id: string;
  name: string;
  description: string;
  geometry: AnnotationGeometry;
};
type Detection = {
  id: string;
  platform: string;
  sensor: string;
  acquisition_timestamp: string | null;
  latitude: number;
  longitude: number;
  frp_mw: number | null;
  daynight: string | null;
  country: string | null;
};
type Cluster = {
  id: string;
  run_id: string;
  member_count: number;
  centroid: Position;
  platforms: string[];
  start_at: string | null;
  end_at: string | null;
  extent_km: number;
  area_km2: number;
  bounds: [Position, Position];
  boundary: Position[];
};
type ClusterMember = {
  id: string;
  platform: string;
  acquisition_date: string | null;
  acquisition_time: string | null;
  frp_mw: number | null;
  native_confidence: string | null;
  daynight: string | null;
  latitude: number | null;
  longitude: number | null;
};
type GeospatialData = {
  generated_at: string;
  total_detections: number;
  detections: Detection[];
  clusters: Cluster[];
  density_cells: {
    south: number;
    west: number;
    north: number;
    east: number;
    count: number;
  }[];
  size_distribution: { bucket: string; count: number }[];
  capabilities: {
    country_filter: boolean;
    membership_quality_filter: boolean;
  };
  truncated: boolean;
};
type Tool =
  | "select"
  | "area-rectangle"
  | "area-circle"
  | "area-polygon"
  | "annotation-point"
  | "annotation-line"
  | "annotation-polygon";

const AREA_STORAGE_KEY = "twinflame.geospatial.areas.v1";
const ANNOTATION_STORAGE_KEY = "twinflame.geospatial.annotations.v1";
const chartColors = ["#e9b77e", "#f58200", "#f04b22", "#8d321d"];
const platformColors: Record<string, string> = {
  terra: "#f58200",
  aqua: "#f04b22",
  "noaa-20": "#8d321d",
  "noaa-21": "#e9b77e",
  unknown: "#a0a596",
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
const statuses = ["all", "strong", "possible", "rejected"];

function readSaved<T>(key: string) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { value: [] as T[], error: "" };
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error("Stored research data is not a list.");
    return { value: value as T[], error: "" };
  } catch {
    return { value: [] as T[], error: "Saved map items could not be read from this browser." };
  }
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `map-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function utcDateValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

function initialRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return { startDate: utcDateValue(start), endDate: utcDateValue(end) };
}

function timestamp(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function distanceKm(from: Position, to: Position) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(to[0] - from[0]);
  const dLon = radians(to[1] - from[1]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from[0])) *
      Math.cos(radians(to[0])) *
      Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function boundsOf(geometry: AreaGeometry): [Position, Position] {
  if (geometry.type === "rectangle") {
    return [
      [geometry.south, geometry.west],
      [geometry.north, geometry.east],
    ];
  }
  if (geometry.type === "circle") {
    const latDelta = geometry.radius_km / 110.574;
    const lonDelta =
      geometry.radius_km /
      Math.max(0.01, 111.32 * Math.cos((geometry.center[0] * Math.PI) / 180));
    return [
      [Math.max(-90, geometry.center[0] - latDelta), Math.max(-180, geometry.center[1] - lonDelta)],
      [Math.min(90, geometry.center[0] + latDelta), Math.min(180, geometry.center[1] + lonDelta)],
    ];
  }
  const latitudes = geometry.points.map((point) => point[0]);
  const longitudes = geometry.points.map((point) => point[1]);
  return [
    [Math.min(...latitudes), Math.min(...longitudes)],
    [Math.max(...latitudes), Math.max(...longitudes)],
  ];
}

function areaColor(index: number) {
  return chartColors[index % chartColors.length];
}

function platformColor(platform: string) {
  return platformColors[platform.toLowerCase()] ?? platformColors.unknown;
}

function MapClickListener({ onClick }: { onClick: (point: Position) => void }) {
  useMapEvents({
    click(event) {
      onClick([event.latlng.lat, event.latlng.lng]);
    },
  });
  return null;
}

function DrawPreview({ tool, points }: { tool: Tool; points: Position[] }) {
  if (tool === "area-rectangle" && points.length === 2) {
    const south = Math.min(points[0][0], points[1][0]);
    const north = Math.max(points[0][0], points[1][0]);
    const west = Math.min(points[0][1], points[1][1]);
    const east = Math.max(points[0][1], points[1][1]);
    return <Rectangle bounds={[[south, west], [north, east]]} pathOptions={{ color: "#f58200", dashArray: "5 5" }} />;
  }
  if (tool === "area-circle" && points.length === 2) {
    return (
      <LeafletCircle
        center={points[0]}
        radius={distanceKm(points[0], points[1]) * 1000}
        pathOptions={{ color: "#f58200", dashArray: "5 5" }}
      />
    );
  }
  if (tool === "area-polygon" && points.length >= 2) {
    return <Polygon positions={points} pathOptions={{ color: "#f58200", dashArray: "5 5" }} />;
  }
  if (tool === "annotation-line" && points.length >= 2) {
    return <Polyline positions={points} pathOptions={{ color: "#e9b77e", dashArray: "5 5" }} />;
  }
  if (tool === "annotation-polygon" && points.length >= 2) {
    return <Polygon positions={points} pathOptions={{ color: "#e9b77e", dashArray: "5 5" }} />;
  }
  if (points.length === 1) {
    return <CircleMarker center={points[0]} radius={5} pathOptions={{ color: "#f58200" }} />;
  }
  return null;
}

function SavedAreaLayer({
  area,
  selected,
  color,
  onSelect,
}: {
  area: SavedArea;
  selected: boolean;
  color: string;
  onSelect: () => void;
}) {
  const pathOptions = {
    color: selected ? "#f58200" : color,
    fillColor: color,
    fillOpacity: selected ? 0.1 : 0.045,
    weight: selected ? 2 : 1.5,
    dashArray: selected ? undefined : "5 4",
  };
  return (
    <>
      {area.geometry.type === "rectangle" && (
        <Rectangle
          bounds={boundsOf(area.geometry)}
          pathOptions={pathOptions}
          eventHandlers={{ click: onSelect }}
        >
          <Popup>{area.name}</Popup>
        </Rectangle>
      )}
      {area.geometry.type === "circle" && (
        <LeafletCircle
          center={area.geometry.center}
          radius={area.geometry.radius_km * 1000}
          pathOptions={pathOptions}
          eventHandlers={{ click: onSelect }}
        >
          <Popup>{area.name}</Popup>
        </LeafletCircle>
      )}
      {area.geometry.type === "polygon" && (
        <Polygon
          positions={area.geometry.points}
          pathOptions={pathOptions}
          eventHandlers={{ click: onSelect }}
        >
          <Popup>{area.name}</Popup>
        </Polygon>
      )}
    </>
  );
}

function SavedAnnotationLayer({
  annotation,
  selected,
  onSelect,
}: {
  annotation: SavedAnnotation;
  selected: boolean;
  onSelect: () => void;
}) {
  const color = selected ? "#f58200" : "#e9b77e";
  const popup = (
    <Popup>
      <strong>{annotation.name}</strong>
      {annotation.description && <><br />{annotation.description}</>}
    </Popup>
  );
  if (annotation.geometry.type === "point") {
    return (
      <CircleMarker
        center={annotation.geometry.position}
        radius={selected ? 8 : 6}
        pathOptions={{ color, fillColor: color, fillOpacity: 0.9 }}
        eventHandlers={{ click: onSelect }}
      >
        {popup}
      </CircleMarker>
    );
  }
  if (annotation.geometry.type === "line") {
    return (
      <Polyline
        positions={annotation.geometry.points}
        pathOptions={{ color, weight: selected ? 4 : 3 }}
        eventHandlers={{ click: onSelect }}
      >
        {popup}
      </Polyline>
    );
  }
  return (
    <Polygon
      positions={annotation.geometry.points}
      pathOptions={{ color, fillColor: color, fillOpacity: 0.12 }}
      eventHandlers={{ click: onSelect }}
    >
      {popup}
    </Polygon>
  );
}

function GeospatialMap({
  data,
  mode,
  areas,
  selectedAreaId,
  annotations,
  selectedAnnotationId,
  selectedClusterId,
  tool,
  drawingPoints,
  onAreaSelect,
  onAnnotationSelect,
  onClusterSelect,
  onDetectionSelect,
  onMapClick,
}: {
  data: GeospatialData | null;
  mode: string;
  areas: SavedArea[];
  selectedAreaId: string;
  annotations: SavedAnnotation[];
  selectedAnnotationId: string;
  selectedClusterId: string;
  tool: Tool;
  drawingPoints: Position[];
  onAreaSelect: (id: string) => void;
  onAnnotationSelect: (id: string) => void;
  onClusterSelect: (cluster: Cluster) => void;
  onDetectionSelect: (detection: Detection) => void;
  onMapClick: (point: Position) => void;
}) {
  const maxDensity = Math.max(1, ...(data?.density_cells.map((cell) => cell.count) ?? [1]));
  return (
    <MapContainer
      center={[17, 8]}
      zoom={2}
      minZoom={2}
      maxZoom={13}
      scrollWheelZoom
      worldCopyJump
      className="geo-map"
      style={{ cursor: tool === "select" ? "grab" : "crosshair" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
      />
      {mode === "detections" &&
        data?.detections.map((detection) => (
          <CircleMarker
            key={detection.id}
            center={[detection.latitude, detection.longitude]}
            radius={5}
            pathOptions={{
              color: "#171b15",
              weight: 1.2,
              fillColor: platformColor(detection.platform),
              fillOpacity: 0.84,
            }}
            eventHandlers={{ click: () => onDetectionSelect(detection) }}
          >
            <Popup>
              <strong>{detection.platform} · {detection.sensor}</strong>
              <br />
              {timestamp(detection.acquisition_timestamp)}
              <br />
              FRP: {detection.frp_mw == null ? "—" : `${detection.frp_mw.toFixed(1)} MW`}
            </Popup>
          </CircleMarker>
        ))}
      {mode === "clusters" &&
        data?.clusters.map((cluster) => (
          <Polygon
            key={`${cluster.run_id}:${cluster.id}`}
            positions={cluster.boundary}
            pathOptions={{
              color: selectedClusterId === cluster.id ? "#f58200" : "#f04b22",
              fillColor: selectedClusterId === cluster.id ? "#f58200" : "#f04b22",
              fillOpacity: selectedClusterId === cluster.id ? 0.22 : 0.11,
              weight: selectedClusterId === cluster.id ? 3 : 1.5,
            }}
            eventHandlers={{ click: () => onClusterSelect(cluster) }}
          >
            <Popup>
              <strong>Cluster {cluster.id}</strong>
              <br />
              {cluster.member_count} member detections
              <br />
              {cluster.extent_km.toFixed(1)} km extent
            </Popup>
          </Polygon>
        ))}
      {mode === "clusters" &&
        data?.clusters.map((cluster) => (
          <CircleMarker
            key={`center:${cluster.run_id}:${cluster.id}`}
            center={cluster.centroid}
            radius={Math.min(13, 5 + Math.log2(cluster.member_count + 1))}
            pathOptions={{
              color: "#f6d2a4",
              weight: 1.5,
              fillColor: "#f58200",
              fillOpacity: 0.9,
            }}
            eventHandlers={{ click: () => onClusterSelect(cluster) }}
          />
        ))}
      {mode === "density" &&
        data?.density_cells.map((cell) => (
          <Rectangle
            key={`${cell.south}:${cell.west}`}
            bounds={[[cell.south, cell.west], [cell.north, cell.east]]}
            pathOptions={{
              color: "#f58200",
              weight: 0.3,
              fillColor: cell.count / maxDensity > 0.65 ? "#f04b22" : "#f58200",
              fillOpacity: 0.12 + (cell.count / maxDensity) * 0.56,
            }}
          >
            <Popup>{cell.count.toLocaleString()} detections in this density cell</Popup>
          </Rectangle>
        ))}
      {areas.map((area, index) => (
        <SavedAreaLayer
          area={area}
          selected={area.id === selectedAreaId}
          color={areaColor(index)}
          onSelect={() => onAreaSelect(area.id)}
          key={area.id}
        />
      ))}
      {annotations.map((annotation) => (
        <SavedAnnotationLayer
          annotation={annotation}
          selected={annotation.id === selectedAnnotationId}
          onSelect={() => onAnnotationSelect(annotation.id)}
          key={annotation.id}
        />
      ))}
      <DrawPreview tool={tool} points={drawingPoints} />
      {tool !== "select" && <MapClickListener onClick={onMapClick} />}
    </MapContainer>
  );
}

function GeospatialPage() {
  const defaultRange = initialRange();
  const [filters, setFilters] = useState({
    ...defaultRange,
    platform: "all",
    sensor: "all",
    region: "global",
    country: "",
    daynight: "all",
    west: "",
    south: "",
    east: "",
    north: "",
    minClusterSize: "1",
    minExtent: "",
    maxExtent: "",
    membershipQuality: "all",
  });
  const [mode, setMode] = useState("detections");
  const [data, setData] = useState<GeospatialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
  const [clusterMembers, setClusterMembers] = useState<ClusterMember[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [membersTruncated, setMembersTruncated] = useState(false);
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const [selectedAnnotationId, setSelectedAnnotationId] = useState("");
  const [savedAreaState] = useState(() => readSaved<SavedArea>(AREA_STORAGE_KEY));
  const [savedAnnotationState] = useState(() => readSaved<SavedAnnotation>(ANNOTATION_STORAGE_KEY));
  const [areas, setAreas] = useState(savedAreaState.value);
  const [annotations, setAnnotations] = useState(savedAnnotationState.value);
  const [storageError, setStorageError] = useState(
    savedAreaState.error || savedAnnotationState.error,
  );
  const [tool, setTool] = useState<Tool>("select");
  const [drawingPoints, setDrawingPoints] = useState<Position[]>([]);
  const [pendingArea, setPendingArea] = useState<AreaGeometry | null>(null);
  const [pendingAreaName, setPendingAreaName] = useState("");
  const [editingAreaId, setEditingAreaId] = useState("");
  const [pendingAnnotation, setPendingAnnotation] = useState<SavedAnnotation | null>(null);
  const [editingAnnotationId, setEditingAnnotationId] = useState("");

  const updateFilter = useCallback((key: keyof typeof filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const selectedArea = areas.find((area) => area.id === selectedAreaId) ?? null;
  const selectedAnnotation =
    annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null;

  useEffect(() => {
    try {
      window.localStorage.setItem(AREA_STORAGE_KEY, JSON.stringify(areas));
      window.localStorage.setItem(ANNOTATION_STORAGE_KEY, JSON.stringify(annotations));
    } catch {
      setStorageError("Browser storage is unavailable; map research items may not persist.");
    }
  }, [areas, annotations]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        start_date: filters.startDate,
        end_date: filters.endDate,
        platform: filters.platform,
        sensor: filters.sensor,
        region: filters.region,
        daynight: filters.daynight,
        min_cluster_size: filters.minClusterSize || "1",
        membership_quality: filters.membershipQuality,
      });
      if (filters.country.trim()) params.set("country", filters.country.trim());
      if (filters.minExtent.trim()) params.set("min_extent_km", filters.minExtent.trim());
      if (filters.maxExtent.trim()) params.set("max_extent_km", filters.maxExtent.trim());
      if ([filters.west, filters.south, filters.east, filters.north].every(Boolean)) {
        params.set("west", filters.west);
        params.set("south", filters.south);
        params.set("east", filters.east);
        params.set("north", filters.north);
      }
      if (selectedArea) params.set("aoi", JSON.stringify(selectedArea.geometry));
      const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
      try {
        const response = await fetch(`${base}/api/geospatial?${params}`, {
          signal: controller.signal,
        });
        let body: GeospatialData & { detail?: string };
        try {
          body = await response.json();
        } catch {
          throw new Error(
            `Geospatial API returned HTTP ${response.status} with an invalid JSON response.`,
          );
        }
        if (!response.ok) {
          throw new Error(body.detail ?? "Geospatial data could not be loaded.");
        }
        setData(body as GeospatialData);
        setSelectedCluster(null);
        setSelectedDetection(null);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Geospatial data could not be loaded.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 320);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [filters, refreshKey, selectedArea]);

  useEffect(() => {
    if (!selectedCluster) {
      setClusterMembers([]);
      setMemberCount(0);
      setMembersTruncated(false);
      return;
    }
    const controller = new AbortController();
    const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
    const params = new URLSearchParams({ run_id: selectedCluster.run_id });
    fetch(
      `${base}/api/geospatial/clusters/${encodeURIComponent(selectedCluster.id)}/members?${params}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        let body: {
          detail?: string;
          members: ClusterMember[];
          total_members: number;
          truncated: boolean;
        };
        try {
          body = await response.json();
        } catch {
          throw new Error(
            `Cluster members API returned HTTP ${response.status} with an invalid JSON response.`,
          );
        }
        if (!response.ok) {
          throw new Error(body.detail ?? "Cluster members could not be loaded.");
        }
        return body;
      })
      .then((body) => {
        setClusterMembers(body.members);
        setMemberCount(body.total_members);
        setMembersTruncated(body.truncated);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Cluster members could not be loaded.",
          );
        }
      });
    return () => controller.abort();
  }, [selectedCluster]);

  const beginTool = (nextTool: Tool, areaId = "", annotationId = "") => {
    setTool(nextTool);
    setDrawingPoints([]);
    setEditingAreaId(areaId);
    setEditingAnnotationId(annotationId);
    setPendingArea(null);
    setPendingAnnotation(null);
  };

  const completeArea = (geometry: AreaGeometry) => {
    if (editingAreaId) {
      setAreas((current) =>
        current.map((area) =>
          area.id === editingAreaId ? { ...area, geometry } : area,
        ),
      );
      setSelectedAreaId(editingAreaId);
      setEditingAreaId("");
    } else {
      setPendingArea(geometry);
      setPendingAreaName("");
    }
    setTool("select");
    setDrawingPoints([]);
  };

  const completeAnnotation = (geometry: AnnotationGeometry) => {
    if (editingAnnotationId) {
      setAnnotations((current) =>
        current.map((annotation) =>
          annotation.id === editingAnnotationId
            ? { ...annotation, geometry }
            : annotation,
        ),
      );
      setSelectedAnnotationId(editingAnnotationId);
      setEditingAnnotationId("");
    } else {
      setPendingAnnotation({
        id: createId(),
        name: "",
        description: "",
        geometry,
      });
    }
    setTool("select");
    setDrawingPoints([]);
  };

  const handleMapClick = (point: Position) => {
    if (tool === "area-rectangle") {
      if (drawingPoints.length === 0) {
        setDrawingPoints([point]);
        return;
      }
      const first = drawingPoints[0];
      completeArea({
        type: "rectangle",
        south: Math.min(first[0], point[0]),
        west: Math.min(first[1], point[1]),
        north: Math.max(first[0], point[0]),
        east: Math.max(first[1], point[1]),
      });
      return;
    }
    if (tool === "area-circle") {
      if (drawingPoints.length === 0) {
        setDrawingPoints([point]);
        return;
      }
      completeArea({
        type: "circle",
        center: drawingPoints[0],
        radius_km: Math.max(0.1, distanceKm(drawingPoints[0], point)),
      });
      return;
    }
    if (tool === "area-polygon") {
      setDrawingPoints((points) => [...points, point]);
      return;
    }
    if (tool === "annotation-point") {
      completeAnnotation({ type: "point", position: point });
      return;
    }
    if (tool === "annotation-line" || tool === "annotation-polygon") {
      setDrawingPoints((points) => [...points, point]);
    }
  };

  const finishDrawing = () => {
    if (tool === "area-polygon" && drawingPoints.length >= 3) {
      completeArea({ type: "polygon", points: drawingPoints });
    } else if (tool === "annotation-line" && drawingPoints.length >= 2) {
      completeAnnotation({ type: "line", points: drawingPoints });
    } else if (tool === "annotation-polygon" && drawingPoints.length >= 3) {
      completeAnnotation({ type: "polygon", points: drawingPoints });
    }
  };

  const saveArea = () => {
    if (!pendingArea || !pendingAreaName.trim()) return;
    const area = { id: createId(), name: pendingAreaName.trim(), geometry: pendingArea };
    setAreas((current) => [...current, area]);
    setSelectedAreaId(area.id);
    setPendingArea(null);
    setPendingAreaName("");
  };

  const saveAnnotation = () => {
    if (!pendingAnnotation?.name.trim()) return;
    setAnnotations((current) => [
      ...current,
      { ...pendingAnnotation, name: pendingAnnotation.name.trim() },
    ]);
    setSelectedAnnotationId(pendingAnnotation.id);
    setPendingAnnotation(null);
  };

  const selectCluster = (cluster: Cluster) => {
    setSelectedCluster(cluster);
    setSelectedDetection(null);
  };

  const setAnnotationField = (key: "name" | "description", value: string) => {
    if (pendingAnnotation) {
      setPendingAnnotation((current) => current && { ...current, [key]: value });
      return;
    }
    if (selectedAnnotationId) {
      setAnnotations((current) =>
        current.map((annotation) =>
          annotation.id === selectedAnnotationId
            ? { ...annotation, [key]: value }
            : annotation,
        ),
      );
    }
  };

  const canFinish =
    (tool === "area-polygon" && drawingPoints.length >= 3) ||
    (tool === "annotation-line" && drawingPoints.length >= 2) ||
    (tool === "annotation-polygon" && drawingPoints.length >= 3);
  const selectedClusterKey = selectedCluster?.id ?? "";

  return (
    <>
      <section className="page-heading geospatial-heading">
        <div>
          <div className="eyebrow"><span /> RESEARCH WORKSPACE</div>
          <h1>Geospatial exploration</h1>
          <p className="page-subtitle">
            Explore hotspot locations, harmonized cluster extents, and researcher-defined areas.
          </p>
        </div>
        <button
          className={`refresh-button ${loading ? "is-loading" : ""}`}
          type="button"
          onClick={() => setRefreshKey((key) => key + 1)}
          disabled={loading}
        >
          <RefreshCw size={15} />
          <span>Refresh map</span>
        </button>
      </section>

      <section className="geo-filter-panel" aria-label="Geospatial filters">
        <label className="geo-filter">
          <span className="filter-label">FROM · UTC DATE</span>
          <input
            type="date"
            value={filters.startDate}
            onChange={(event) => updateFilter("startDate", event.target.value)}
          />
        </label>
        <label className="geo-filter">
          <span className="filter-label">TO · UTC DATE</span>
          <input
            type="date"
            value={filters.endDate}
            onChange={(event) => updateFilter("endDate", event.target.value)}
          />
        </label>
        <label className="geo-filter">
          <span className="filter-label">PLATFORM</span>
          <select value={filters.platform} onChange={(event) => updateFilter("platform", event.target.value)}>
            <option value="all">All platforms</option>
            <option value="terra">Terra</option>
            <option value="aqua">Aqua</option>
            <option value="noaa20">NOAA-20</option>
            <option value="noaa21">NOAA-21</option>
          </select>
        </label>
        <label className="geo-filter">
          <span className="filter-label">SENSOR</span>
          <select value={filters.sensor} onChange={(event) => updateFilter("sensor", event.target.value)}>
            <option value="all">All sensors</option>
            <option value="modis">MODIS</option>
            <option value="viirs">VIIRS</option>
          </select>
        </label>
        <label className="geo-filter">
          <span className="filter-label">REGION</span>
          <select value={filters.region} onChange={(event) => updateFilter("region", event.target.value)}>
            {regions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <label className="geo-filter">
          <span className="filter-label">COUNTRY</span>
          <input
            type="text"
            placeholder={data?.capabilities.country_filter ? "Country name" : "Not in schema"}
            value={filters.country}
            disabled={data != null && !data.capabilities.country_filter}
            onChange={(event) => updateFilter("country", event.target.value)}
          />
        </label>
        <label className="geo-filter">
          <span className="filter-label">DAY / NIGHT</span>
          <select value={filters.daynight} onChange={(event) => updateFilter("daynight", event.target.value)}>
            <option value="all">All observations</option>
            <option value="day">Day</option>
            <option value="night">Night</option>
          </select>
        </label>
        <label className="geo-filter">
          <span className="filter-label">MIN CLUSTER MEMBERS</span>
          <input
            type="number"
            min="1"
            value={filters.minClusterSize}
            onChange={(event) => updateFilter("minClusterSize", event.target.value)}
          />
        </label>
        <label className="geo-filter">
          <span className="filter-label">MIN EXTENT · KM</span>
          <input
            type="number"
            min="0"
            placeholder="Any"
            value={filters.minExtent}
            onChange={(event) => updateFilter("minExtent", event.target.value)}
          />
        </label>
        <label className="geo-filter">
          <span className="filter-label">MAX EXTENT · KM</span>
          <input
            type="number"
            min="0"
            placeholder="Any"
            value={filters.maxExtent}
            onChange={(event) => updateFilter("maxExtent", event.target.value)}
          />
        </label>
        <label className="geo-filter">
          <span className="filter-label">MEMBERSHIP QUALITY</span>
          <select
            value={filters.membershipQuality}
            disabled={data != null && !data.capabilities.membership_quality_filter}
            onChange={(event) => updateFilter("membershipQuality", event.target.value)}
          >
            {statuses.map((status) => (
              <option value={status} key={status}>
                {status === "all" ? "All qualities" : status[0].toUpperCase() + status.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="geo-bbox-panel" aria-label="Bounding-box filter">
        <div className="geo-bbox-title"><Crosshair size={14} /> BOUNDING BOX</div>
        {[
          ["west", "West longitude"],
          ["south", "South latitude"],
          ["east", "East longitude"],
          ["north", "North latitude"],
        ].map(([key, label]) => (
          <label key={key}>
            <span className="filter-label">{label.toUpperCase()}</span>
            <input
              type="number"
              step="0.1"
              aria-label={label}
              placeholder="—"
              value={filters[key as keyof typeof filters]}
              onChange={(event) => updateFilter(key as keyof typeof filters, event.target.value)}
            />
          </label>
        ))}
        <button
          className="geo-clear-bounds"
          type="button"
          onClick={() => {
            updateFilter("west", "");
            updateFilter("south", "");
            updateFilter("east", "");
            updateFilter("north", "");
          }}
        >
          Clear bounds
        </button>
      </section>

      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={18} />
          <div><strong>Geospatial data unavailable</strong><span>{error}</span></div>
          <button type="button" onClick={() => setRefreshKey((key) => key + 1)}>Try again</button>
        </div>
      )}
      {(storageError || (data && !data.capabilities.country_filter) || (data && !data.capabilities.membership_quality_filter)) && (
        <div className="geo-info-note">
          {storageError && <span>{storageError}</span>}
          {data && !data.capabilities.country_filter && <span>Country filtering is unavailable in this database schema.</span>}
          {data && !data.capabilities.membership_quality_filter && <span>Membership-quality filtering is unavailable in this database schema.</span>}
        </div>
      )}

      <section className="geo-mode-row" aria-label="Visualization mode">
        <div>
          <strong>VISUALIZATION MODE</strong>
          <span>{data ? `${data.total_detections.toLocaleString()} detections · ${data.clusters.length.toLocaleString()} clusters` : "Loading spatial layers…"}</span>
        </div>
        <div className="geo-mode-buttons">
          {[
            ["detections", "Individual detections"],
            ["clusters", "Activity clusters"],
            ["density", "Density map"],
          ].map(([value, label]) => (
            <button
              className={mode === value ? "selected" : ""}
              type="button"
              onClick={() => setMode(value)}
              key={value}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="geo-workspace">
        <article className="panel geo-map-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Global detection geography</div>
              <div className="panel-subtitle">Pan and zoom · click a detection or cluster to inspect</div>
            </div>
            <span className={`geo-map-state ${loading ? "loading" : ""}`}>
              <span /> {loading ? "UPDATING" : "MAP READY"}
            </span>
          </div>
          <div className="geo-toolbars">
            <div className="geo-toolbar-group">
              <strong>DRAW AREA</strong>
              <button type="button" onClick={() => beginTool("area-rectangle", selectedAreaId)}>
                <RectangleHorizontal size={13} /> Rectangle
              </button>
              <button type="button" onClick={() => beginTool("area-circle", selectedAreaId)}>
                <Circle size={13} /> Circle
              </button>
              <button type="button" onClick={() => beginTool("area-polygon", selectedAreaId)}>
                <Plus size={13} /> Polygon
              </button>
            </div>
            <div className="geo-toolbar-group">
              <strong>ANNOTATE</strong>
              <button type="button" onClick={() => beginTool("annotation-point")}>
                <MapPin size={13} /> Point / note
              </button>
              <button type="button" onClick={() => beginTool("annotation-line")}>
                <Minus size={13} /> Line
              </button>
              <button type="button" onClick={() => beginTool("annotation-polygon")}>
                <Plus size={13} /> Polygon
              </button>
            </div>
          </div>
          {tool !== "select" && (
            <div className="geo-draw-instructions">
              <span>
                {tool.includes("rectangle") || tool.includes("circle")
                  ? `Click the map ${drawingPoints.length ? "again to complete the shape" : "to set the first point"}.`
                  : tool.includes("point")
                    ? "Click the map to place a point note."
                    : `Click map vertices (${drawingPoints.length} added), then finish the drawing.`}
              </span>
              <div>
                {canFinish && <button type="button" onClick={finishDrawing}><Check size={13} /> Finish</button>}
                <button type="button" onClick={() => beginTool("select")}><X size={13} /> Cancel</button>
              </div>
            </div>
          )}
          {pendingArea && (
            <div className="geo-save-draft">
              <input
                type="text"
                placeholder="Name this research area"
                aria-label="Research area name"
                value={pendingAreaName}
                onChange={(event) => setPendingAreaName(event.target.value)}
              />
              <button type="button" onClick={saveArea} disabled={!pendingAreaName.trim()}>
                <Save size={13} /> Save area
              </button>
              <button type="button" aria-label="Discard area" onClick={() => setPendingArea(null)}><X size={14} /></button>
            </div>
          )}
          <div className="geo-map-frame">
            {data ? (
              <GeospatialMap
                data={data}
                mode={mode}
                areas={areas}
                selectedAreaId={selectedAreaId}
                annotations={annotations}
                selectedAnnotationId={selectedAnnotationId}
                selectedClusterId={selectedClusterKey}
                tool={tool}
                drawingPoints={drawingPoints}
                onAreaSelect={setSelectedAreaId}
                onAnnotationSelect={setSelectedAnnotationId}
                onClusterSelect={selectCluster}
                onDetectionSelect={(detection) => {
                  setSelectedDetection(detection);
                  setSelectedCluster(null);
                }}
                onMapClick={handleMapClick}
              />
            ) : (
              <div className="panel-skeleton geo-map-skeleton" />
            )}
          </div>
          {data?.truncated && (
            <div className="geo-truncated-note">
              Map layers are capped for responsiveness; narrow the date range or filters to inspect fewer records.
            </div>
          )}
          {selectedDetection && (
            <div className="geo-detection-detail">
              <strong>{selectedDetection.platform} · {selectedDetection.sensor}</strong>
              <span>
                {timestamp(selectedDetection.acquisition_timestamp)} · {selectedDetection.latitude.toFixed(3)}, {selectedDetection.longitude.toFixed(3)}
                {selectedDetection.frp_mw != null && ` · ${selectedDetection.frp_mw.toFixed(1)} MW`}
              </span>
              <button type="button" onClick={() => setSelectedDetection(null)} aria-label="Close detection details"><X size={14} /></button>
            </div>
          )}
        </article>

        <aside className="geo-side-stack">
          <article className="panel geo-research-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Research areas</div>
                <div className="panel-subtitle">Saved AOIs filter detections and clusters</div>
              </div>
              <span className="panel-icon"><Crosshair size={15} /></span>
            </div>
            <label className="geo-panel-field">
              <span className="filter-label">ACTIVE AREA OF INTEREST</span>
              <select value={selectedAreaId} onChange={(event) => setSelectedAreaId(event.target.value)}>
                <option value="">No area selected</option>
                {areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}
              </select>
            </label>
            {selectedArea ? (
              <div className="geo-selected-area">
                <input
                  type="text"
                  aria-label="Rename selected area"
                  value={selectedArea.name}
                  onChange={(event) =>
                    setAreas((current) =>
                      current.map((area) =>
                        area.id === selectedAreaId ? { ...area, name: event.target.value } : area,
                      ),
                    )
                  }
                />
                <span>{selectedArea.geometry.type} · filters current results</span>
                <div>
                  <button
                    type="button"
                    onClick={() => beginTool(
                      selectedArea.geometry.type === "rectangle"
                        ? "area-rectangle"
                        : selectedArea.geometry.type === "circle"
                          ? "area-circle"
                          : "area-polygon",
                      selectedArea.id,
                    )}
                  >
                    <Pencil size={12} /> Redraw shape
                  </button>
                  <button
                    className="geo-danger-button"
                    type="button"
                    onClick={() => {
                      setAreas((current) => current.filter((area) => area.id !== selectedAreaId));
                      setSelectedAreaId("");
                    }}
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </div>
            ) : (
              <div className="geo-hint">Draw a rectangle, circle, or polygon on the map, then save it with a name.</div>
            )}
          </article>

          <article className="panel geo-cluster-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Cluster inspection</div>
                <div className="panel-subtitle">Select a boundary or cluster in the map</div>
              </div>
              <span className="geo-cluster-count">{data?.clusters.length ?? "—"}</span>
            </div>
            {selectedCluster ? (
              <>
                <div className="geo-cluster-summary">
                  <strong>Cluster {selectedCluster.id}</strong>
                  <span>{selectedCluster.member_count.toLocaleString()} member detections · run {selectedCluster.run_id || "—"}</span>
                  <span>Centroid {selectedCluster.centroid[0].toFixed(3)}, {selectedCluster.centroid[1].toFixed(3)}</span>
                  <span>{selectedCluster.platforms.join(", ") || "No platforms"} · {selectedCluster.extent_km.toFixed(1)} km extent</span>
                  <span>Area estimate ≈ {selectedCluster.area_km2.toLocaleString()} km²</span>
                  <span>{timestamp(selectedCluster.start_at)} – {timestamp(selectedCluster.end_at)}</span>
                  <small>Outline is the convex hull of member detections; extent is the bounding-envelope diagonal.</small>
                </div>
                <div className="geo-members-header">
                  <strong>MEMBERS</strong><span>{memberCount || selectedCluster.member_count}</span>
                </div>
                <div className="geo-members-list">
                  {clusterMembers.map((member) => (
                    <div className="geo-member-row" key={member.id}>
                      <strong>{member.platform}</strong>
                      <span>{member.acquisition_date ?? "—"} {member.acquisition_time ?? ""}</span>
                      <span>{member.frp_mw == null ? "—" : `${member.frp_mw.toFixed(1)} MW`}</span>
                    </div>
                  ))}
                  {membersTruncated && <small>Showing the latest {clusterMembers.length} members.</small>}
                  {!clusterMembers.length && <span className="geo-hint">Loading cluster members…</span>}
                </div>
                <button className="geo-text-button" type="button" onClick={() => setSelectedCluster(null)}>
                  Clear cluster selection
                </button>
              </>
            ) : selectedDetection ? (
              <div className="geo-hint">Detection selected. Select a cluster boundary to inspect its members.</div>
            ) : (
              <div className="geo-cluster-list">
                {data?.clusters.slice(0, 8).map((cluster) => (
                  <button
                    type="button"
                    className="geo-cluster-list-row"
                    key={`${cluster.run_id}:${cluster.id}`}
                    onClick={() => selectCluster(cluster)}
                  >
                    <span><strong>{cluster.id}</strong><small>{cluster.platforms.join(" · ")}</small></span>
                    <span><strong>{cluster.member_count}</strong><small>members</small></span>
                  </button>
                ))}
                {data && data.clusters.length === 0 && <div className="geo-hint">No clusters match the selected filters.</div>}
              </div>
            )}
          </article>

          <article className="panel geo-annotation-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Map annotations</div>
                <div className="panel-subtitle">Notes and spatial marks saved in this browser</div>
              </div>
              <span className="panel-icon"><MapPin size={15} /></span>
            </div>
            {pendingAnnotation || selectedAnnotation ? (
              <div className="geo-annotation-editor">
                <input
                  type="text"
                  placeholder="Annotation title"
                  aria-label="Annotation title"
                  value={pendingAnnotation?.name ?? selectedAnnotation?.name ?? ""}
                  onChange={(event) => setAnnotationField("name", event.target.value)}
                />
                <textarea
                  placeholder="Description or research note"
                  aria-label="Annotation description"
                  value={pendingAnnotation?.description ?? selectedAnnotation?.description ?? ""}
                  onChange={(event) => setAnnotationField("description", event.target.value)}
                />
                {pendingAnnotation ? (
                  <button type="button" onClick={saveAnnotation} disabled={!pendingAnnotation.name.trim()}>
                    <Save size={12} /> Save annotation
                  </button>
                ) : selectedAnnotation ? (
                  <div className="geo-annotation-actions">
                    <button
                      type="button"
                      onClick={() => beginTool(
                        selectedAnnotation.geometry.type === "point"
                          ? "annotation-point"
                          : selectedAnnotation.geometry.type === "line"
                            ? "annotation-line"
                            : "annotation-polygon",
                        "",
                        selectedAnnotation.id,
                      )}
                    >
                      <Pencil size={12} /> Edit geometry
                    </button>
                    <button
                      className="geo-danger-button"
                      type="button"
                      onClick={() => {
                        setAnnotations((current) => current.filter((item) => item.id !== selectedAnnotationId));
                        setSelectedAnnotationId("");
                      }}
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                ) : null}
                <button className="geo-text-button" type="button" onClick={() => {
                  setPendingAnnotation(null);
                  setSelectedAnnotationId("");
                }}>
                  Close editor
                </button>
              </div>
            ) : (
              <div className="geo-annotation-list">
                {annotations.map((annotation) => (
                  <button type="button" key={annotation.id} onClick={() => setSelectedAnnotationId(annotation.id)}>
                    <span className={`annotation-type ${annotation.geometry.type}`} />
                    <span><strong>{annotation.name || "Untitled annotation"}</strong><small>{annotation.geometry.type}</small></span>
                    <Pencil size={12} />
                  </button>
                ))}
                {!annotations.length && <div className="geo-hint">Use the map tools to add a marker, line, or polygon note.</div>}
              </div>
            )}
          </article>
        </aside>
      </section>

      <section className="panel geo-size-panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Cluster size distribution</div>
            <div className="panel-subtitle">Harmonized activity clusters by member count</div>
          </div>
          <span className="chart-unit">NUMBER OF CLUSTERS</span>
        </div>
        <div className="geo-size-chart">
          {data?.size_distribution.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.size_distribution} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="#34392f" strokeDasharray="3 5" />
                <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fill: "#c0c2b7", fontSize: 10 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: "#a0a596", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    border: "1px solid #3b4035",
                    borderRadius: 10,
                    backgroundColor: "#20241d",
                    color: "#f3efe7",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" name="Clusters" radius={[5, 5, 0, 0]}>
                  {data.size_distribution.map((item, index) => (
                    <Cell key={item.bucket} fill={chartColors[index % chartColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="geo-hint">No cluster size data for this selection.</div>
          )}
        </div>
      </section>
      <footer className="page-footer geo-footer">
        <span><span className="footer-indicator" /> {data?.total_detections.toLocaleString() ?? "—"} detections in selection</span>
        <span>{data ? `Spatial layers generated ${timestamp(data.generated_at)}` : "Waiting for spatial data"}</span>
      </footer>
    </>
  );
}

export default GeospatialPage;
