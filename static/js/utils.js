export function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function hexA(hex, a) {
  const n = hex.replace("#", "");
  const r = parseInt(n.substring(0, 2), 16);
  const g = parseInt(n.substring(2, 4), 16);
  const b = parseInt(n.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function locationKey(d) {
  return `${d.lat.toFixed(3)}|${d.lng.toFixed(3)}`;
}

export function isIncomplete(d) {
  return d.lat == null || d.lng == null || d.city === "—" || d.country === "—";
}

export function parseUrlState(search) {
  const p = new URLSearchParams(search);
  const out = {};
  if (p.has("style")) out.mapStyle = p.get("style");
  if (p.has("q")) out.search = p.get("q");
  if (p.has("sort")) out.sort = p.get("sort");
  if (p.has("sel")) out.selectedId = p.get("sel");
  const filters = p.get("f");
  if (filters) {
    try {
      out.filters = JSON.parse(filters);
    } catch {
      try {
        out.filters = JSON.parse(decodeURIComponent(filters));
      } catch {
        /* ignore malformed or legacy filter state */
      }
    }
  }
  return out;
}

export function buildUrlState({ map, search, sort, selectedId, filters }) {
  const p = new URLSearchParams();
  if (map.mapStyle !== "satellite") p.set("style", map.mapStyle);
  if (search) p.set("q", search);
  if (sort && sort !== "plays-desc") p.set("sort", sort);
  if (selectedId) p.set("sel", selectedId);
  const f = serializeFilters(filters);
  if (f && Object.keys(f).length) p.set("f", JSON.stringify(f));
  const qs = p.toString();
  return qs ? `?${qs}` : window.location.pathname;
}

function serializeFilters(filters) {
  if (!filters) return null;
  const o = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v instanceof Set) {
      if (v.size) o[k] = [...v];
    } else if (v != null && v !== false && v !== "") {
      if ((k === "showClusters" || k === "showMarkers") && v === true) continue;
      if (k === "explicit" && v === "any") continue;
      o[k] = v;
    }
  }
  return o;
}

export function deserializeFilters(raw) {
  const base = {
    countries: new Set(),
    cities: new Set(),
    artists: new Set(),
    genres: new Set(),
    csvGenres: new Set(),
    playlists: new Set(),
    albums: new Set(),
    labels: new Set(),
    trackNames: new Set(),
    addedBy: new Set(),
    modes: new Set(),
    keys: new Set(),
    timeSignatures: new Set(),
    playsMin: null,
    playsMax: null,
    trackPopMin: null,
    trackPopMax: null,
    releaseYearMin: null,
    releaseYearMax: null,
    durationMin: null,
    durationMax: null,
    addedYearMin: null,
    addedYearMax: null,
    explicit: "any",
    savedOnly: false,
    danceabilityMin: null,
    energyMin: null,
    valenceMin: null,
    acousticnessMin: null,
    instrumentalnessMin: null,
    speechinessMin: null,
    livenessMin: null,
    tempoMin: null,
    loudnessMin: null,
    radiusCenterKm: null,
    radiusUserKm: null,
    visibleOnly: false,
    hideIncomplete: false,
    showClusters: true,
    showMarkers: true,
    showHeatmap: false,
    multiLocation: false,
  };
  if (!raw) return base;
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) base[k] = new Set(v);
    else if (k in base) base[k] = v;
  }
  return base;
}
