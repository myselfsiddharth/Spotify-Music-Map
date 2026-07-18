import { FALLBACK_COLORS, GENRE_PALETTE } from "./config.js";
import { locationKey } from "./utils.js";

// Map renderer: https://github.com/maplibre/maplibre-gl-js (BSD-3-Clause)
// Vector basemaps: https://github.com/hyperknot/openfreemap (MIT, OSM attribution required)
// Globe + satellite hybrid follows MapLibre's globe-atmosphere example:
// https://github.com/maplibre/maplibre-gl-js/blob/main/test/examples/display-a-globe-with-an-atmosphere.html
const HOME = { name: "Home", city: "Phoenix", lat: 33.45, lng: -112.07 };
const VECTOR_STYLE_URLS = {
  minimal: "https://tiles.openfreemap.org/styles/positron",
  normal: "https://tiles.openfreemap.org/styles/liberty",
};
const ESRI_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_LABELS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const EOX_GLOBE =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg";
const SATELLITE_GLOBE_ZOOM_MAX = 4.2;
const RASTER_FADE = 0;

function satelliteGlobeStyle() {
  return {
    version: 8,
    name: "Satellite",
    sources: {
      "eox-globe": {
        type: "raster",
        tiles: [EOX_GLOBE],
        tileSize: 256,
        maxzoom: 10,
        attribution: "© EOX IT Services GmbH",
      },
      "esri-imagery": {
        type: "raster",
        tiles: [ESRI_IMAGERY],
        tileSize: 256,
        minzoom: 6,
        maxzoom: 19,
        attribution:
          "© Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      },
      "esri-labels": {
        type: "raster",
        tiles: [ESRI_LABELS],
        tileSize: 256,
        minzoom: 9,
        maxzoom: 19,
      },
    },
    layers: [
      {
        id: "eox-globe",
        type: "raster",
        source: "eox-globe",
        maxzoom: 11,
        paint: {
          "raster-fade-duration": RASTER_FADE,
          "raster-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0, 1,
            7, 1,
            8.5, 0,
          ],
        },
      },
      {
        id: "esri-imagery",
        type: "raster",
        source: "esri-imagery",
        minzoom: 6,
        paint: {
          "raster-fade-duration": RASTER_FADE,
          "raster-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6, 0,
            7.2, 1,
          ],
          // Keep imagery lit — previous brightness-max ~0.04 blacked out close zooms
          "raster-brightness-min": 0,
          "raster-brightness-max": 1,
          "raster-contrast": 0,
          "raster-saturation": 0,
        },
      },
      {
        id: "esri-labels",
        type: "raster",
        source: "esri-labels",
        minzoom: 9,
        paint: {
          "raster-fade-duration": RASTER_FADE,
          "raster-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9, 0,
            10.5, 0.9,
            12, 1,
          ],
        },
      },
    ],
    sky: {
      "sky-color": "#0a1628",
      "sky-horizon-blend": 0.08,
      "horizon-color": "#5aa8d8",
      "horizon-fog-blend": 0.05,
      "fog-color": "#0a1628",
      "fog-ground-blend": 0,
      "atmosphere-blend": [
        "interpolate",
        ["linear"],
        ["zoom"],
        0, 0.45,
        2.5, 0.35,
        3.8, 0.08,
        4.2, 0,
      ],
    },
    light: {
      anchor: "viewport",
      color: "#ffffff",
      intensity: 0.95,
      position: [1.5, 90, 70],
    },
  };
}

const SOURCE = {
  artists: "music-artists",
  clusters: "music-artist-clusters",
  selection: "music-selection",
  user: "music-user-location",
  arcs: "music-home-arcs",
};

const LAYER = {
  arcs: "music-home-arcs-line",
  arcGlow: "music-home-arcs-glow",
  heatmap: "music-artist-heatmap",
  rawGlow: "music-artist-markers-glow",
  rawMarkers: "music-artist-markers",
  clusterGlow: "music-cluster-glow",
  clusterMarkers: "music-cluster-markers",
  clusterRing: "music-cluster-ring",
  clusterCount: "music-cluster-count",
  clusterPoints: "music-cluster-points",
  clusterPointsGlow: "music-cluster-points-glow",
  stackCount: "music-stack-count",
  clusterStackCount: "music-cluster-stack-count",
  selectionGlow: "music-selection-glow",
  selectionRing: "music-selection-ring",
  userGlow: "music-user-glow",
  userRing: "music-user-ring",
  userDot: "music-user-dot",
};

const EMPTY_FEATURES = { type: "FeatureCollection", features: [] };
const MIN_ZOOM = 0;
const MAX_ZOOM = 16;
const CAMERA_DURATION = 700;
const SPIN_DEGREES_PER_MS = 0.0018;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLng(lng) {
  return ((((Number(lng) || 0) + 180) % 360) + 360) % 360 - 180;
}

function validCoordinate(item) {
  return Number.isFinite(Number(item?.lat)) && Number.isFinite(Number(item?.lng));
}

function mixHex(from, to, amount) {
  const t = clamp(amount, 0, 1);
  const read = (hex, offset) => Number.parseInt(hex.slice(offset, offset + 2), 16);
  const channel = (a, b) => Math.round(a + (b - a) * t).toString(16).padStart(2, "0");
  return `#${channel(read(from, 1), read(to, 1))}${channel(read(from, 3), read(to, 3))}${channel(read(from, 5), read(to, 5))}`;
}

function colorFor(item, markerMode = "genre") {
  if (markerMode === "popularity") {
    const popularity = Math.log10(Math.max(1, Number(item?.plays) || 1)) / 4;
    return mixHex("#4ecdc4", "#f5b942", popularity);
  }
  if (GENRE_PALETTE[item?.genre]) return GENRE_PALETTE[item.genre];
  const key = String(item?.genre || item?.name || "");
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

function featureCollection(features) {
  return { type: "FeatureCollection", features };
}

function pointFeature(item, key, markerMode, kind = "artist", extras = {}) {
  return {
    type: "Feature",
    properties: {
      key,
      kind,
      name: String(item.name || "Unknown artist"),
      city: String(item.city || ""),
      country: String(item.country || ""),
      genre: String(item.genre || "Other"),
      plays: Math.max(1, Number(item.plays) || 1),
      color: colorFor(item, markerMode),
      stackCount: 1,
      keys: String(key || ""),
      ...extras,
    },
    geometry: { type: "Point", coordinates: [Number(item.lng), Number(item.lat)] },
  };
}

function toCartesian(lng, lat) {
  const lambda = (lng * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(lambda), cosPhi * Math.sin(lambda), Math.sin(phi)];
}

function greatCircleCoordinates(start, end, steps = 32) {
  const a = toCartesian(start.lng, start.lat);
  const b = toCartesian(end.lng, end.lat);
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);
  const coordinates = [];
  let previousLng = Number(start.lng);

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    let x;
    let y;
    let z;
    if (sinOmega < 1e-6) {
      x = a[0] + (b[0] - a[0]) * t;
      y = a[1] + (b[1] - a[1]) * t;
      z = a[2] + (b[2] - a[2]) * t;
    } else {
      const fromWeight = Math.sin((1 - t) * omega) / sinOmega;
      const toWeight = Math.sin(t * omega) / sinOmega;
      x = a[0] * fromWeight + b[0] * toWeight;
      y = a[1] * fromWeight + b[1] * toWeight;
      z = a[2] * fromWeight + b[2] * toWeight;
    }

    let lng = (Math.atan2(y, x) * 180) / Math.PI;
    const lat = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
    while (lng - previousLng > 180) lng -= 360;
    while (lng - previousLng < -180) lng += 360;
    coordinates.push([lng, lat]);
    previousLng = lng;
  }
  return coordinates;
}

function minimalLongitudeBounds(longitudes) {
  if (longitudes.length < 2) {
    const lng = normalizeLng(longitudes[0] || 0);
    return [lng, lng];
  }

  const sorted = longitudes
    .map((lng) => ((Number(lng) % 360) + 360) % 360)
    .sort((a, b) => a - b);
  let largestGap = -1;
  let gapIndex = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const next = index === sorted.length - 1 ? sorted[0] + 360 : sorted[index + 1];
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      gapIndex = index;
    }
  }

  let west = sorted[(gapIndex + 1) % sorted.length];
  let east = sorted[gapIndex];
  if (east < west) east += 360;
  const center = (west + east) / 2;
  if (center > 180) {
    west -= 360;
    east -= 360;
  }
  return [west, east];
}

export function createMapController(container, land, callbacks = {}) {
  if (!window.maplibregl?.Map) throw new Error("MapLibre GL JS failed to load");

  // The OpenFreeMap basemap replaces the old local land polygons. The argument stays
  // in the public API so callers do not need a migration.
  void land;

  const maplibregl = window.maplibregl;
  const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let reducedMotion = !!motionQuery?.matches;
  let view = {
    lng: -20,
    lat: 24,
    zoom: window.innerWidth < 640 ? 1.05 : window.innerWidth < 1024 ? 1.45 : 2.2,
    bearing: 0,
    spin: false,
    arcs: false,
    mapStyle: "satellite",
    markerMode: "genre",
  };
  let items = [];
  let filters = {};
  let selected = null;
  let hoverHighlight = null;
  let userLocation = null;
  let map = null;
  let started = false;
  let styleReady = false;
  let pointerActive = false;
  let wheelPauseUntil = 0;
  let resizeListening = false;
  let motionListening = false;
  let layoutObserver = null;
  let spinFrame = 0;
  let spinStepActive = false;
  let lastSpinTime = 0;
  let lastSpinEmit = 0;
  let cameraEmitTimer = 0;
  let lastCameraEmit = 0;
  let hoveredKey = null;
  let itemByKey = new Map();
  let keyByItem = new Map();
  let activeProjection = null;
  let presentationFrame = 0;
  let hoverFrame = 0;
  let pendingHoverEvent = null;

  function mapStyleSpec(style = view.mapStyle) {
    if (style === "satellite") return satelliteGlobeStyle();
    return VECTOR_STYLE_URLS[style] || VECTOR_STYLE_URLS.minimal;
  }

  function syncMapPresentation() {
    if (!map) return;
    const zoom = map.getZoom();

    if (view.mapStyle === "satellite") {
      const wantGlobe = zoom < SATELLITE_GLOBE_ZOOM_MAX;
      const nextProjection = wantGlobe ? "globe" : "mercator";
      if (activeProjection !== nextProjection) {
        map.setProjection?.({ type: nextProjection });
        activeProjection = nextProjection;
      }
      if (wantGlobe && map.setLight) {
        map.setLight({
          anchor: "viewport",
          color: "#ffffff",
          intensity: 0.95,
          position: [1.5, 90, 70],
        });
      }
      document.body.classList.toggle("map-zoom-flat", !wantGlobe);
      return;
    }

    document.body.classList.remove("map-zoom-flat");
    if (activeProjection !== "globe") {
      map.setProjection?.({ type: "globe" });
      activeProjection = "globe";
    }
  }

  function schedulePresentationSync() {
    if (presentationFrame) return;
    presentationFrame = window.requestAnimationFrame(() => {
      presentationFrame = 0;
      syncMapPresentation();
    });
  }

  function animationDuration(duration = CAMERA_DURATION) {
    return reducedMotion ? 0 : duration;
  }

  function focusOffset() {
    const resultsOpen = document.getElementById("resultsPanel")?.classList.contains("open");
    if (!resultsOpen) return [0, 0];
    if (window.innerWidth <= 639) return [0, -Math.min(120, window.innerHeight * 0.14)];
    return [Math.min(220, window.innerWidth * 0.2), 0];
  }

  function fitPadding() {
    if (window.innerWidth <= 639) {
      const panelOpen = document.getElementById("resultsPanel")?.classList.contains("open");
      return { top: 100, right: 60, bottom: panelOpen ? Math.min(460, window.innerHeight * 0.5) : 100, left: 60 };
    }
    const panelOpen = document.getElementById("resultsPanel")?.classList.contains("open");
    return { top: 96, right: 96, bottom: 84, left: panelOpen ? 480 : 96 };
  }

  function layoutPadding() {
    const empty = { top: 0, right: 0, bottom: 0, left: 0 };
    if (window.innerWidth <= 639 || !document.body.classList.contains("results-open")) return empty;
    const panel = document.getElementById("resultsPanel")?.getBoundingClientRect();
    if (!panel?.width) return empty;
    return {
      ...empty,
      left: Math.min(Math.ceil(panel.right + 18), Math.floor(window.innerWidth * 0.55)),
    };
  }

  function syncLayoutPadding() {
    if (!map?.setPadding) return;
    const next = layoutPadding();
    const current = map.getPadding?.() || {};
    if (["top", "right", "bottom", "left"].every((side) => Number(current[side] || 0) === next[side])) return;
    map.setPadding(next);
  }

  function rebuildItemIndex() {
    itemByKey = new Map();
    keyByItem = new Map();
    const used = new Set();
    items.forEach((item, index) => {
      const base = String(item?.id ?? `${item?.name || "artist"}-${index}`);
      let key = base;
      let suffix = 1;
      while (used.has(key)) key = `${base}-${suffix++}`;
      used.add(key);
      itemByKey.set(key, item);
      keyByItem.set(item, key);
    });
  }

  function itemsAtLocation(item) {
    if (!validCoordinate(item)) return item ? [item] : [];
    const key = locationKey(item);
    return items.filter((candidate) => validCoordinate(candidate) && locationKey(candidate) === key);
  }

  function itemFeatures() {
    // One map point per rounded lat/lng so co-located artists stack into a browsable group.
    const groups = new Map();
    for (const item of items) {
      if (!validCoordinate(item)) continue;
      const key = locationKey(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    const features = [];
    for (const group of groups.values()) {
      group.sort((a, b) => (Number(b.plays) || 0) - (Number(a.plays) || 0));
      const lead = group[0];
      const keys = group.map((entry) => keyByItem.get(entry)).filter(Boolean);
      const plays = Math.max(...group.map((entry) => Math.max(1, Number(entry.plays) || 1)));
      features.push(
        pointFeature(lead, keys[0] || keyByItem.get(lead), view.markerMode, "artist", {
          stackCount: group.length,
          keys: keys.join("\n"),
          plays,
          name:
            group.length > 1
              ? `${lead.name} +${group.length - 1}`
              : String(lead.name || "Unknown artist"),
        })
      );
    }
    return features;
  }

  function groupFromFeature(feature) {
    const raw = String(feature?.properties?.keys || feature?.properties?.key || "");
    const keys = raw.split("\n").map((part) => part.trim()).filter(Boolean);
    const group = keys.map((key) => itemByKey.get(key)).filter(Boolean);
    if (group.length) return group;
    const fallback = featureItem(feature);
    return fallback ? [fallback] : [];
  }

  function projectScreen(lng, lat) {
    if (!map || !Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat))) return null;
    try {
      const point = map.project([Number(lng), Number(lat)]);
      const rect = container.getBoundingClientRect();
      return { x: rect.left + point.x, y: rect.top + point.y };
    } catch {
      return null;
    }
  }

  function emitAnchor() {
    if (!selected || !validCoordinate(selected)) {
      callbacks.onAnchorMove?.(null);
      return;
    }
    callbacks.onAnchorMove?.(projectScreen(selected.lng, selected.lat));
  }

  function selectionFeatures() {
    const active = [];
    const seen = new Set();
    for (const [item, kind] of [[selected, "selected"], [hoverHighlight, "hover"]]) {
      if (!validCoordinate(item) || seen.has(item)) continue;
      seen.add(item);
      const key = keyByItem.get(item) || String(item.id || item.name || kind);
      active.push(pointFeature(item, key, view.markerMode, kind));
    }
    return active;
  }

  function arcFeatures() {
    if (!view.arcs) return [];
    return items.filter(validCoordinate).map((item) => ({
      type: "Feature",
      properties: { color: colorFor(item, view.markerMode), plays: Number(item.plays) || 1 },
      geometry: {
        type: "LineString",
        coordinates: greatCircleCoordinates(HOME, item),
      },
    }));
  }

  function setSourceData(sourceId, data) {
    if (!map || !styleReady) return;
    const source = map.getSource(sourceId);
    source?.setData?.(data);
  }

  function updateItemSources() {
    const data = featureCollection(itemFeatures());
    setSourceData(SOURCE.artists, data);
    setSourceData(SOURCE.clusters, data);
    setSourceData(SOURCE.arcs, featureCollection(arcFeatures()));
  }

  function updateSelectionSource() {
    setSourceData(SOURCE.selection, featureCollection(selectionFeatures()));
  }

  function updateUserSource() {
    const data = validCoordinate(userLocation)
      ? featureCollection([{
          type: "Feature",
          properties: { kind: "user" },
          geometry: { type: "Point", coordinates: [Number(userLocation.lng), Number(userLocation.lat)] },
        }])
      : EMPTY_FEATURES;
    setSourceData(SOURCE.user, data);
  }

  function setVisibility(layerId, visible) {
    if (!map?.getLayer(layerId)) return;
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }

  function updateLayerVisibility() {
    if (!map || !styleReady) return;
    const showMarkers = filters.showMarkers !== false;
    const showClusters = filters.showClusters !== false;
    setVisibility(LAYER.arcs, !!view.arcs);
    setVisibility(LAYER.arcGlow, !!view.arcs);
    setVisibility(LAYER.heatmap, !!filters.showHeatmap);
    setVisibility(LAYER.rawGlow, showMarkers && !showClusters);
    setVisibility(LAYER.rawMarkers, showMarkers && !showClusters);
    setVisibility(LAYER.stackCount, showMarkers && !showClusters);
    setVisibility(LAYER.clusterPointsGlow, showMarkers && showClusters);
    setVisibility(LAYER.clusterPoints, showMarkers && showClusters);
    setVisibility(LAYER.clusterStackCount, showMarkers && showClusters);
    setVisibility(LAYER.clusterGlow, showMarkers && showClusters);
    setVisibility(LAYER.clusterMarkers, showMarkers && showClusters);
    setVisibility(LAYER.clusterRing, showMarkers && showClusters);
    setVisibility(LAYER.clusterCount, showMarkers && showClusters);
  }

  function addSource(id, definition) {
    if (!map.getSource(id)) map.addSource(id, definition);
  }

  function addLayer(definition) {
    if (!map.getLayer(definition.id)) map.addLayer(definition);
  }

  function installMusicLayers() {
    if (!map) return;

    addSource(SOURCE.artists, { type: "geojson", data: EMPTY_FEATURES, maxzoom: 14 });
    addSource(SOURCE.clusters, {
      type: "geojson",
      data: EMPTY_FEATURES,
      cluster: true,
      clusterRadius: 54,
      clusterMaxZoom: 8,
      maxzoom: 14,
    });
    addSource(SOURCE.arcs, { type: "geojson", data: EMPTY_FEATURES, maxzoom: 12 });
    addSource(SOURCE.selection, { type: "geojson", data: EMPTY_FEATURES, maxzoom: 14 });
    addSource(SOURCE.user, { type: "geojson", data: EMPTY_FEATURES, maxzoom: 14 });

    // ── Arc glow (wide, soft underlay) ──────────────────────────────
    addLayer({
      id: LAYER.arcGlow,
      type: "line",
      source: SOURCE.arcs,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.12, 5, 0.08, 9, 0.03],
        "line-width": ["interpolate", ["linear"], ["zoom"], 0, 5, 6, 8],
        "line-blur": 4,
      },
    });

    // ── Arc lines (crisp, dashed) ───────────────────────────────────
    addLayer({
      id: LAYER.arcs,
      type: "line",
      source: SOURCE.arcs,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.52, 5, 0.35, 9, 0.12],
        "line-width": ["interpolate", ["linear"], ["zoom"], 0, 1.2, 6, 2],
        "line-dasharray": [2, 2.4],
      },
    });

    // ── Heatmap ─────────────────────────────────────────────────────
    addLayer({
      id: LAYER.heatmap,
      type: "heatmap",
      source: SOURCE.artists,
      maxzoom: 10,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "plays"], 1, 0.12, 50, 0.35, 500, 0.65, 5000, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.55, 8, 1.5],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 14, 5, 28, 8, 40],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.72, 7, 0.45, 9, 0.18, 10, 0],
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(10, 10, 30, 0)",
          0.08, "rgba(20, 60, 120, 0.18)",
          0.2, "rgba(29, 185, 84, 0.35)",
          0.38, "rgba(30, 215, 120, 0.55)",
          0.55, "rgba(78, 205, 196, 0.68)",
          0.72, "rgba(255, 209, 102, 0.8)",
          0.88, "rgba(255, 150, 80, 0.88)",
          1, "rgba(255, 100, 80, 0.95)",
        ],
      },
    });

    // ── Artist marker paint (shared by raw + cluster unclustered) ──
    const artistCirclePaint = {
      "circle-radius": [
        "interpolate", ["exponential", 1.5], ["get", "plays"],
        1, 4.5,
        20, 5.5,
        100, 7,
        500, 9.5,
        2000, 12,
        10000, 15,
      ],
      "circle-color": ["get", "color"],
      "circle-opacity": 0.92,
      "circle-stroke-color": "rgba(255,255,255,0.96)",
      "circle-stroke-width": [
        "interpolate", ["linear"], ["zoom"],
        0, 1.2,
        5, 1.6,
        10, 2.2,
      ],
      "circle-stroke-opacity": 0.95,
      "circle-blur": 0.04,
    };

    // ── Artist marker glow (soft radiance beneath each dot) ────────
    const artistGlowPaint = {
      "circle-radius": [
        "interpolate", ["exponential", 1.5], ["get", "plays"],
        1, 10,
        100, 16,
        1000, 22,
        10000, 30,
      ],
      "circle-color": ["get", "color"],
      "circle-opacity": [
        "interpolate", ["linear"], ["zoom"],
        0, 0.10,
        5, 0.16,
        10, 0.08,
      ],
      "circle-blur": 0.85,
    };

    // Raw (unclustered) markers: glow + dot
    addLayer({ id: LAYER.rawGlow, type: "circle", source: SOURCE.artists, paint: artistGlowPaint });
    addLayer({ id: LAYER.rawMarkers, type: "circle", source: SOURCE.artists, paint: artistCirclePaint });
    addLayer({
      id: LAYER.stackCount,
      type: "symbol",
      source: SOURCE.artists,
      filter: [">", ["get", "stackCount"], 1],
      layout: {
        "text-field": ["to-string", ["get", "stackCount"]],
        "text-size": 11,
        "text-font": ["Noto Sans Bold"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "rgba(0,0,0,0.45)",
        "text-halo-width": 1.2,
      },
    });

    // ── Cluster glow (outer soft halo) ──────────────────────────────
    addLayer({
      id: LAYER.clusterGlow,
      type: "circle",
      source: SOURCE.clusters,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": [
          "step", ["get", "point_count"],
          "#1db954", 10, "#16a766", 30, "#0f8f7f", 80, "#4e7ed9",
        ],
        "circle-radius": ["step", ["get", "point_count"], 28, 10, 34, 30, 40, 80, 48],
        "circle-opacity": 0.12,
        "circle-blur": 0.7,
      },
    });

    // ── Cluster circle (main body) ──────────────────────────────────
    addLayer({
      id: LAYER.clusterMarkers,
      type: "circle",
      source: SOURCE.clusters,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": [
          "step", ["get", "point_count"],
          "#1db954", 10, "#16a766", 30, "#0f8f7f", 80, "#4e7ed9",
        ],
        "circle-radius": [
          "interpolate", ["exponential", 1.2], ["get", "point_count"],
          2, 15,
          10, 19,
          30, 24,
          80, 29,
          200, 34,
        ],
        "circle-opacity": 0.88,
        "circle-stroke-color": "rgba(255,255,255,0)",
        "circle-stroke-width": 0,
      },
    });

    // ── Cluster ring (thin white outline for crispness) ─────────────
    addLayer({
      id: LAYER.clusterRing,
      type: "circle",
      source: SOURCE.clusters,
      filter: ["has", "point_count"],
      paint: {
        "circle-radius": [
          "interpolate", ["exponential", 1.2], ["get", "point_count"],
          2, 15,
          10, 19,
          30, 24,
          80, 29,
          200, 34,
        ],
        "circle-color": "rgba(255,255,255,0)",
        "circle-stroke-color": "rgba(255,255,255,0.85)",
        "circle-stroke-width": 2,
        "circle-stroke-opacity": 0.9,
      },
    });

    // ── Cluster count label ─────────────────────────────────────────
    addLayer({
      id: LAYER.clusterCount,
      type: "symbol",
      source: SOURCE.clusters,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-size": [
          "interpolate", ["linear"], ["get", "point_count"],
          2, 11,
          30, 13,
          100, 14,
        ],
        "text-font": ["Noto Sans Bold"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-letter-spacing": 0.04,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "rgba(0,0,0,0.3)",
        "text-halo-width": 1,
        "text-halo-blur": 0.5,
      },
    });

    // ── Cluster unclustered points: glow + dot ──────────────────────
    addLayer({
      id: LAYER.clusterPointsGlow,
      type: "circle",
      source: SOURCE.clusters,
      filter: ["!", ["has", "point_count"]],
      paint: artistGlowPaint,
    });
    addLayer({
      id: LAYER.clusterPoints,
      type: "circle",
      source: SOURCE.clusters,
      filter: ["!", ["has", "point_count"]],
      paint: artistCirclePaint,
    });
    addLayer({
      id: LAYER.clusterStackCount,
      type: "symbol",
      source: SOURCE.clusters,
      filter: ["all", ["!", ["has", "point_count"]], [">", ["get", "stackCount"], 1]],
      layout: {
        "text-field": ["to-string", ["get", "stackCount"]],
        "text-size": 11,
        "text-font": ["Noto Sans Bold"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "rgba(0,0,0,0.45)",
        "text-halo-width": 1.2,
      },
    });

    // ── Selection highlight layers ──────────────────────────────────
    addLayer({
      id: LAYER.selectionGlow,
      type: "circle",
      source: SOURCE.selection,
      paint: {
        "circle-radius": ["case", ["==", ["get", "kind"], "selected"], 28, 22],
        "circle-color": ["get", "color"],
        "circle-opacity": 0.25,
        "circle-blur": 0.55,
      },
    });
    addLayer({
      id: LAYER.selectionRing,
      type: "circle",
      source: SOURCE.selection,
      paint: {
        "circle-radius": ["case", ["==", ["get", "kind"], "selected"], 15, 12],
        "circle-color": "rgba(255,255,255,0.08)",
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": ["case", ["==", ["get", "kind"], "selected"], 3, 2.2],
        "circle-stroke-opacity": 1,
      },
    });

    // ── User location layers ────────────────────────────────────────
    addLayer({
      id: LAYER.userGlow,
      type: "circle",
      source: SOURCE.user,
      paint: { "circle-radius": 28, "circle-color": "#4285f4", "circle-opacity": 0.14, "circle-blur": 0.6 },
    });
    addLayer({
      id: LAYER.userRing,
      type: "circle",
      source: SOURCE.user,
      paint: {
        "circle-radius": 12,
        "circle-color": "rgba(66,133,244,0.15)",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
    addLayer({
      id: LAYER.userDot,
      type: "circle",
      source: SOURCE.user,
      paint: { "circle-radius": 5.5, "circle-color": "#4285f4", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 },
    });

    styleReady = true;
    updateItemSources();
    updateSelectionSource();
    updateUserSource();
    updateLayerVisibility();
  }

  function visibleBounds() {
    if (!map) return { west: -180, east: 180, south: -85, north: 85 };
    const bounds = map.getBounds();
    let west = bounds.getWest();
    let east = bounds.getEast();
    const south = clamp(bounds.getSouth(), -90, 90);
    const north = clamp(bounds.getNorth(), -90, 90);
    if (east - west >= 350 || west < -180 || east > 180) {
      west = -180;
      east = 180;
    }
    return { west, east, south, north };
  }

  function syncViewFromMap() {
    if (!map) return;
    const center = map.getCenter();
    view = {
      ...view,
      lng: normalizeLng(center.lng),
      lat: clamp(center.lat, -90, 90),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
    };
  }

  function emitCameraState() {
    if (!map || !started) return;
    syncViewFromMap();
    const zoom = view.zoom;
    const globe =
      view.mapStyle === "satellite"
        ? zoom < SATELLITE_GLOBE_ZOOM_MAX
        : clamp((zoom - 1.2) / 2.2, 0, 1) < 0.5;
    const t = view.mapStyle === "satellite"
      ? clamp(zoom / SATELLITE_GLOBE_ZOOM_MAX, 0, 1)
      : clamp((zoom - 1.2) / 2.2, 0, 1);
    const latitudeScale = Math.max(0.05, Math.cos((view.lat * Math.PI) / 180));
    const kmPerPx = (40075.017 * latitudeScale) / (512 * 2 ** zoom);
    callbacks.onViewChange?.({ ...view });
    callbacks.onRender?.({
      bounds: visibleBounds(),
      center: { lat: view.lat, lng: view.lng },
      kmPerPx,
      t,
      globe,
      map: !globe,
    });
    lastCameraEmit = performance.now();
  }

  function scheduleCameraEmit(delay = 140) {
    if (!started || cameraEmitTimer) return;
    const elapsed = performance.now() - lastCameraEmit;
    cameraEmitTimer = window.setTimeout(() => {
      cameraEmitTimer = 0;
      emitCameraState();
    }, Math.max(0, delay - elapsed));
  }

  function applyCamera(next, duration = 0) {
    if (!map) return;
    const camera = {
      center: [Number(next.lng ?? view.lng), clamp(Number(next.lat ?? view.lat), -85, 85)],
      zoom: clamp(Number(next.zoom ?? view.zoom), MIN_ZOOM, MAX_ZOOM),
      bearing: Number(next.bearing ?? view.bearing) || 0,
    };
    if (next.offset) camera.offset = next.offset;
    const ms = animationDuration(duration);
    if (!ms) map.jumpTo(camera);
    else map.easeTo({ ...camera, duration: ms, easing: (t) => 1 - (1 - t) ** 3, essential: false });
  }

  function eventPosition(event) {
    const rect = container.getBoundingClientRect();
    return { x: rect.left + event.point.x, y: rect.top + event.point.y };
  }

  function queryInteractiveFeatures(point) {
    if (!map || !styleReady) return [];
    const layers = [LAYER.clusterMarkers, LAYER.clusterPoints, LAYER.rawMarkers]
      .filter((id) => map.getLayer(id));
    return layers.length ? map.queryRenderedFeatures(point, { layers }) : [];
  }

  function featureItem(feature) {
    return itemByKey.get(String(feature?.properties?.key));
  }

  function processPointerMove(event) {
    if (!event) return;
    const feature = queryInteractiveFeatures(event.point)[0];
    const position = eventPosition(event);
    const isCluster = !!feature?.properties?.cluster;
    const item = isCluster ? null : featureItem(feature);
    const activeKey = isCluster
      ? `cluster-${feature.properties.cluster_id}`
      : item ? keyByItem.get(item) : null;

    container.classList.toggle("pointer", !!feature);
    if (map?.getCanvas()) map.getCanvas().style.cursor = feature ? "pointer" : "grab";
    if (!feature) {
      if (hoveredKey !== null) callbacks.onHover?.(null);
      hoveredKey = null;
      return;
    }

    if (isCluster) {
      hoveredKey = activeKey;
      callbacks.onHover?.({
        type: "cluster",
        data: {
          id: Number(feature.properties.cluster_id),
          count: Number(feature.properties.point_count),
          _x: position.x,
          _y: position.y,
        },
      });
      return;
    }

    if (item) {
      item._x = position.x;
      item._y = position.y;
      hoveredKey = activeKey;
      callbacks.onHover?.({
        type: "item",
        data: item,
        stackCount: Number(feature.properties?.stackCount) || 1,
        group: groupFromFeature(feature),
      });
    }
  }

  function handlePointerMove(event) {
    pendingHoverEvent = event;
    if (hoverFrame) return;
    hoverFrame = window.requestAnimationFrame(() => {
      hoverFrame = 0;
      processPointerMove(pendingHoverEvent);
      pendingHoverEvent = null;
    });
  }

  function clearPointerHover() {
    hoveredKey = null;
    container.classList.remove("pointer");
    if (map?.getCanvas()) map.getCanvas().style.cursor = "grab";
    callbacks.onHover?.(null);
  }

  async function handleClusterClick(feature) {
    const clusterId = Number(feature.properties.cluster_id);
    const count = Number(feature.properties.point_count) || 0;
    const source = map?.getSource(SOURCE.clusters);
    if (!source) return;
    const center = feature.geometry.coordinates;

    try {
      const [leaves, zoom] = await Promise.all([
        source.getClusterLeaves(clusterId, Math.max(1, count), 0),
        source.getClusterExpansionZoom(clusterId),
      ]);
      const clusterItems = leaves.map(featureItem).filter(Boolean);
      callbacks.onClusterClick?.({ id: clusterId, count, items: clusterItems });
      const ms = animationDuration(620);
      if (!ms) map.jumpTo({ center, zoom: Math.min(zoom, MAX_ZOOM) });
      else map.easeTo({ center, zoom: Math.min(zoom, MAX_ZOOM), duration: ms, easing: (t) => 1 - (1 - t) ** 3, essential: false });
    } catch (error) {
      console.warn("Unable to expand artist cluster", error);
    }
  }

  function handleMapClick(event) {
    const features = queryInteractiveFeatures(event.point);
    const cluster = features.find((feature) => feature.properties?.cluster);
    if (cluster) {
      handleClusterClick(cluster);
      return;
    }

    const feature = features.find((candidate) => featureItem(candidate) || groupFromFeature(candidate).length);
    const group = groupFromFeature(feature);
    const item = group[0] || featureItem(feature);
    if (!item) return;
    const position = eventPosition(event);
    item._x = position.x;
    item._y = position.y;
    selected = item;
    updateSelectionSource();
    callbacks.onSelect?.(item, { group, index: 0, screen: position });
  }

  function spinTick(now) {
    spinFrame = 0;
    if (!started || !map || !view.spin || reducedMotion || document.hidden) return;
    if (!lastSpinTime) lastSpinTime = now;
    const elapsed = Math.min(50, Math.max(0, now - lastSpinTime));
    lastSpinTime = now;

    if (!pointerActive && now >= wheelPauseUntil && !map.isMoving() && styleReady) {
      const center = map.getCenter();
      spinStepActive = true;
      map.jumpTo({ center: [center.lng + elapsed * SPIN_DEGREES_PER_MS, center.lat] });
      spinStepActive = false;
      syncViewFromMap();
      if (now - lastSpinEmit > 900) {
        emitCameraState();
        lastSpinEmit = now;
      }
    }
    spinFrame = window.requestAnimationFrame(spinTick);
  }

  function updateSpin() {
    const shouldSpin = started && map && view.spin && !reducedMotion;
    if (shouldSpin && !spinFrame) {
      lastSpinTime = 0;
      spinFrame = window.requestAnimationFrame(spinTick);
    } else if (!shouldSpin && spinFrame) {
      window.cancelAnimationFrame(spinFrame);
      spinFrame = 0;
      lastSpinTime = 0;
    }
  }

  function resize() {
    map?.resize();
    syncLayoutPadding();
    scheduleCameraEmit(0);
  }

  function onMotionPreferenceChange(event) {
    reducedMotion = !!event.matches;
    if (reducedMotion) map?.stop();
    updateSpin();
  }

  function addWindowListeners() {
    if (!resizeListening) {
      window.addEventListener("resize", resize);
      resizeListening = true;
    }
    if (!layoutObserver) {
      layoutObserver = new MutationObserver(syncLayoutPadding);
      layoutObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }
    if (!motionListening && motionQuery) {
      if (motionQuery.addEventListener) motionQuery.addEventListener("change", onMotionPreferenceChange);
      else motionQuery.addListener?.(onMotionPreferenceChange);
      motionListening = true;
    }
  }

  function removeWindowListeners() {
    if (resizeListening) {
      window.removeEventListener("resize", resize);
      resizeListening = false;
    }
    layoutObserver?.disconnect();
    layoutObserver = null;
    if (motionListening && motionQuery) {
      if (motionQuery.removeEventListener) motionQuery.removeEventListener("change", onMotionPreferenceChange);
      else motionQuery.removeListener?.(onMotionPreferenceChange);
      motionListening = false;
    }
  }

  function initializeMap() {
    const isSatellite = view.mapStyle === "satellite";
    map = new maplibregl.Map({
      container,
      style: mapStyleSpec(),
      center: [view.lng, view.lat],
      zoom: clamp(view.zoom, MIN_ZOOM, MAX_ZOOM),
      bearing: view.bearing,
      pitch: 0,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      antialias: false,
      attributionControl: false,
      fadeDuration: isSatellite || reducedMotion ? 0 : 200,
      renderWorldCopies: true,
      refreshExpiredTiles: false,
      padding: layoutPadding(),
    });
    map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");

    map.on("style.load", () => {
      styleReady = false;
      activeProjection = null;
      syncMapPresentation();

      if (view.mapStyle !== "satellite") {
        try {
          if (map.setSky) {
            map.setSky({
              "sky-color": "#0b1026",
              "sky-horizon-blend": 0.5,
              "horizon-color": "#0d2847",
              "horizon-fog-blend": 0.72,
              "fog-color": "#0a1628",
              "fog-ground-blend": 0,
              "atmosphere-blend": [
                "interpolate", ["linear"], ["zoom"],
                0, 1,
                5, 0.6,
                8, 0,
              ],
            });
          }
        } catch (_) {
          // setSky may not be supported in all MapLibre versions
        }

        try {
          if (map.setFog) {
            map.setFog({
              range: [1, 12],
              color: "rgba(16, 24, 48, 0.3)",
              "horizon-blend": 0.08,
            });
          }
        } catch (_) {
          // setFog may not be available
        }
      }

      installMusicLayers();
      resize();
      emitCameraState();
      updateSpin();
    });
    map.on("move", () => {
      syncViewFromMap();
      if (view.mapStyle === "satellite") schedulePresentationSync();
      if (!spinStepActive) scheduleCameraEmit();
      emitAnchor();
    });
    map.on("moveend", () => {
      syncMapPresentation();
      if (!spinStepActive) scheduleCameraEmit(0);
      emitAnchor();
    });
    map.on("zoom", () => {
      if (view.mapStyle === "satellite") schedulePresentationSync();
    });
    map.on("mousemove", handlePointerMove);
    container.addEventListener("mouseleave", clearPointerHover);
    map.on("click", handleMapClick);
    map.on("styleimagemissing", (event) => {
      if (!event?.id || map.hasImage(event.id)) return;
      map.addImage(event.id, {
        width: 2,
        height: 2,
        data: new Uint8Array(2 * 2 * 4),
      });
    });
    map.on("dragstart", () => { pointerActive = true; });
    map.on("dragend", () => { pointerActive = false; lastSpinTime = 0; });
    map.on("rotatestart", () => { pointerActive = true; });
    map.on("rotateend", () => { pointerActive = false; lastSpinTime = 0; });
    map.on("zoomstart", (event) => { if (event.originalEvent) pointerActive = true; });
    map.on("zoomend", () => { pointerActive = false; lastSpinTime = 0; });
    map.on("error", (event) => {
      const message = event?.error?.message;
      if (message && !/abort|cancel/i.test(message)) console.warn("MapLibre render warning:", message);
    });
    container.addEventListener("wheel", () => {
      wheelPauseUntil = performance.now() + 900;
      lastSpinTime = 0;
    }, { passive: true });
  }

  function flyTo(lng, lat, targetZoom) {
    const next = {
      lng: Number(lng),
      lat: clamp(Number(lat), -85, 85),
      zoom: targetZoom ?? Math.max(view.zoom, 5.2),
      bearing: view.bearing,
      offset: focusOffset(),
    };
    view = { ...view, ...next };
    applyCamera(next, CAMERA_DURATION);
  }

  function approximateFitView(points) {
    const longitudes = points.map((item) => Number(item.lng));
    const latitudes = points.map((item) => Number(item.lat));
    const [west, east] = minimalLongitudeBounds(longitudes);
    const south = Math.min(...latitudes);
    const north = Math.max(...latitudes);
    const span = Math.max(east - west, north - south, 1);
    return {
      lng: normalizeLng((west + east) / 2),
      lat: clamp((south + north) / 2, -85, 85),
      zoom: clamp(Math.log2(360 / span) - 0.45, MIN_ZOOM, 8),
    };
  }

  return {
    start() {
      if (started) return;
      started = true;
      addWindowListeners();
      if (!map) initializeMap();
      else {
        map.resize();
        emitCameraState();
      }
      updateSpin();
    },

    stop() {
      started = false;
      updateSpin();
      removeWindowListeners();
      if (cameraEmitTimer) {
        window.clearTimeout(cameraEmitTimer);
        cameraEmitTimer = 0;
      }
      map?.stop();
      clearPointerHover();
    },

    setView(next = {}) {
      const previousStyle = view.mapStyle;
      const previousMode = view.markerMode;
      const cameraChanged = next.lng != null || next.lat != null || next.zoom != null || next.bearing != null;
      view = { ...view, ...next };
      view.zoom = clamp(Number(view.zoom) || 0, MIN_ZOOM, MAX_ZOOM);
      view.lat = clamp(Number(view.lat) || 0, -85, 85);
      view.lng = normalizeLng(view.lng);
      view.bearing = Number(view.bearing) || 0;

      if (map && next.mapStyle && next.mapStyle !== previousStyle) {
        styleReady = false;
        activeProjection = null;
        map.setStyle(mapStyleSpec(next.mapStyle));
      }
      if (map && cameraChanged) applyCamera(view, 0);
      if (next.markerMode && next.markerMode !== previousMode) {
        updateItemSources();
        updateSelectionSource();
      }
      if (next.arcs != null) {
        setSourceData(SOURCE.arcs, featureCollection(arcFeatures()));
        updateLayerVisibility();
      }
      updateSpin();
    },

    getView() {
      if (map) syncViewFromMap();
      return { ...view };
    },

    setItems(next) {
      items = Array.isArray(next) ? next : [];
      rebuildItemIndex();
      updateItemSources();
      updateSelectionSource();
    },

    setFilters(next) {
      filters = next || {};
      updateLayerVisibility();
    },

    setSelected(item) {
      selected = item || null;
      updateSelectionSource();
      emitAnchor();
    },

    setHoverHighlight(item) {
      hoverHighlight = item || null;
      updateSelectionSource();
    },

    getSelected: () => selected,

    projectScreen,

    itemsAtLocation,

    setUserLocation(location) {
      userLocation = validCoordinate(location) ? location : null;
      updateUserSource();
    },

    flyTo,

    fitBounds(itemsToFit) {
      const points = (itemsToFit || []).filter(validCoordinate);
      if (!points.length) return;
      if (points.length === 1) {
        flyTo(points[0].lng, points[0].lat, Math.max(view.zoom, 6));
        return;
      }

      const next = approximateFitView(points);
      view = { ...view, ...next };
      if (!map) return;
      const [west, east] = minimalLongitudeBounds(points.map((item) => Number(item.lng)));
      const latitudes = points.map((item) => Number(item.lat));
      const south = clamp(Math.min(...latitudes), -85, 85);
      const north = clamp(Math.max(...latitudes), -85, 85);
      const bounds = [[west, south], [east, north]];
      const options = { padding: fitPadding(), maxZoom: 8, duration: animationDuration(650), essential: false };
      if (reducedMotion) map.fitBounds(bounds, { ...options, duration: 0 });
      else map.fitBounds(bounds, options);
    },

    zoomIn() {
      if (!map) {
        view.zoom = clamp(view.zoom + 1, MIN_ZOOM, MAX_ZOOM);
        return;
      }
      map.zoomIn({ duration: animationDuration(260), essential: false });
    },

    zoomOut() {
      if (!map) {
        view.zoom = clamp(view.zoom - 1, MIN_ZOOM, MAX_ZOOM);
        return;
      }
      map.zoomOut({ duration: animationDuration(260), essential: false });
    },

    resetBearing() {
      view.bearing = 0;
      if (!map) return;
      const options = { bearing: 0, pitch: 0, duration: animationDuration(350), essential: false };
      if (reducedMotion) map.jumpTo(options);
      else map.easeTo(options);
    },

    recenterUser() {
      if (userLocation) flyTo(userLocation.lng, userLocation.lat, Math.max(view.zoom, 6));
    },

    // Main.js calls this from onViewChange. Emitting here would recurse, so the
    // compatibility hook intentionally remains a no-op.
    notifyViewChange() {},
  };
}
