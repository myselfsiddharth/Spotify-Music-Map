/** Field availability and UI metadata based on Exportify CSV + map data. */
export const GENRE_PALETTE = {
  "Hip-Hop": "#FF7A6B",
  "R&B/Soul": "#F5B942",
  Pop: "#FFD166",
  Indie: "#9B7BFF",
  Rock: "#E85D9E",
  Electronic: "#4ECDC4",
  Afrobeats: "#5DD39E",
  Latin: "#FF9F45",
  Jazz: "#7FB2FF",
  Reggae: "#8BD450",
};

export const FALLBACK_COLORS = [
  "#FF7A6B", "#F5B942", "#FFD166", "#9B7BFF", "#E85D9E",
  "#4ECDC4", "#5DD39E", "#FF9F45", "#7FB2FF", "#8BD450", "#C77DFF", "#63E6BE",
];

export const MAP_STYLES = ["minimal", "normal", "satellite"];

export const AUDIO_FEATURE_FILTERS = [
  { key: "danceability", label: "Danceability", min: 0, max: 1, step: 0.05 },
  { key: "energy", label: "Energy", min: 0, max: 1, step: 0.05 },
  { key: "valence", label: "Valence (mood)", min: 0, max: 1, step: 0.05 },
  { key: "acousticness", label: "Acousticness", min: 0, max: 1, step: 0.05 },
  { key: "instrumentalness", label: "Instrumentalness", min: 0, max: 1, step: 0.05 },
  { key: "speechiness", label: "Speechiness", min: 0, max: 1, step: 0.05 },
  { key: "liveness", label: "Liveness", min: 0, max: 1, step: 0.05 },
  { key: "tempo", label: "Tempo (BPM)", min: 40, max: 220, step: 1 },
  { key: "loudness", label: "Loudness (dB)", min: -60, max: 0, step: 1 },
];

export const SORT_OPTIONS = [
  { id: "plays-desc", label: "Popularity (library)", group: "Popularity", field: "plays", dir: -1, available: true },
  { id: "track-pop-desc", label: "Track popularity", group: "Popularity", field: "trackPopularity", dir: -1, available: true },
  { id: "name-asc", label: "Artist A → Z", group: "Name", field: "name", dir: 1, available: true },
  { id: "name-desc", label: "Artist Z → A", group: "Name", field: "name", dir: -1, available: true },
  { id: "release-new", label: "Release year (newest)", group: "Dates", field: "releaseYearMax", dir: -1, available: true },
  { id: "release-old", label: "Release year (oldest)", group: "Dates", field: "releaseYearMin", dir: 1, available: true },
  { id: "added-new", label: "Date added (newest)", group: "Dates", field: "addedAtMax", dir: -1, available: true },
  { id: "added-old", label: "Date added (oldest)", group: "Dates", field: "addedAtMin", dir: 1, available: true },
  { id: "duration-desc", label: "Avg duration (longest)", group: "Track", field: "durationMs", dir: -1, available: true },
  { id: "dist-center", label: "Distance from map center", group: "Distance", field: "_distCenter", dir: 1, available: true },
  { id: "dist-user", label: "Distance from your location", group: "Distance", field: "_distUser", dir: 1, available: true, needsLocation: true },
  { id: "recent", label: "Recently played", group: "Unavailable", available: false, reason: "Spotify last-played not in Exportify CSV" },
  { id: "oldest", label: "Oldest played", group: "Unavailable", available: false, reason: "Spotify last-played not in Exportify CSV" },
  { id: "title-asc", label: "Song title A → Z", group: "Unavailable", available: false, reason: "Map is artist-origin based; use Track Name search via CSV import metadata" },
  { id: "album", label: "Album name", group: "Unavailable", available: false, reason: "Use Album filter in More filters" },
];

export const FILTER_META = {
  country: { label: "Country", type: "multi", available: true },
  city: { label: "City", type: "multi", available: true },
  region: { label: "State / region", type: "multi", available: false, reason: "Region not in Exportify CSV or geocoder" },
  artist: { label: "Artist", type: "multi", available: true },
  genre: { label: "Genre (map bucket)", type: "multi", available: true },
  csvGenre: { label: "Genre (CSV)", type: "multi", available: true },
  playlist: { label: "Playlist", type: "multi", available: true },
  album: { label: "Album", type: "multi", available: true },
  label: { label: "Record label", type: "multi", available: true },
  trackName: { label: "Track name", type: "multi", available: true },
  addedBy: { label: "Added by", type: "multi", available: true },
  mode: { label: "Mode (major/minor)", type: "multi", available: true },
  key: { label: "Key", type: "multi", available: true },
  timeSignature: { label: "Time signature", type: "multi", available: true },
  popularity: { label: "Library popularity", type: "range", available: true, field: "plays" },
  trackPopularity: { label: "Track popularity", type: "range", available: true },
  releaseYear: { label: "Release year", type: "range", available: true },
  duration: { label: "Avg duration (ms)", type: "range", available: true },
  dateAdded: { label: "Date added (year)", type: "range", available: true },
  explicit: { label: "Explicit content", type: "select", available: true },
  saved: { label: "Saved / liked songs", type: "toggle", available: true },
  audioFeatures: { label: "Audio features", type: "range", available: true },
  radiusCenter: { label: "Radius from map center", type: "radius", available: true },
  radiusUser: { label: "Radius from your location", type: "radius", available: true, needsLocation: true },
  visibleOnly: { label: "Visible map area only", type: "toggle", available: true },
  hideIncomplete: { label: "Hide incomplete locations", type: "toggle", available: true },
  showClusters: { label: "Clustered markers", type: "display", available: true },
  showMarkers: { label: "Individual markers", type: "display", available: true },
  showHeatmap: { label: "Heatmap", type: "display", available: true },
  multiLocation: { label: "Only multi-artist locations", type: "toggle", available: true },
  lastPlayed: { label: "Last played", available: false, reason: "Not in Exportify CSV" },
};

export const GLOBE_ZOOM_MAX = 1.35;
export const MAP_ZOOM_MIN = 2.1;
export const CACHE_KEY = "sonic_cart_data";

export function defaultFilters() {
  return {
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
}

export function defaultMapState() {
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1440;
  return {
    lng: -20,
    lat: 24,
    zoom: viewportWidth < 640 ? 1.05 : viewportWidth < 1024 ? 1.45 : 2.2,
    bearing: 0,
    spin: false,
    arcs: false,
    mapStyle: "satellite",
    markerMode: "genre",
  };
}
