import { GENRE_PALETTE, FALLBACK_COLORS } from "./config.js";
import { locationKey, isIncomplete } from "./utils.js";

let data = [];
let playlists = [];
let playlistArtists = {};
let genreColors = { ...GENRE_PALETTE };
let listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

export function getData() {
  return data;
}

export function getGenreColor(genre) {
  return genreColors[genre] || "#4ECDC4";
}

export function getGenreColors() {
  return genreColors;
}

export function getPlaylists() {
  return playlists;
}

function normalizePlaylists(playlistList) {
  return (playlistList || [])
    .map((p) => (typeof p === "string" ? { name: p } : p))
    .filter((p) => p?.name);
}

function isFollowedPlaylist(playlist) {
  return (
    playlist?.access === "followed" ||
    playlist?.blockReason === "followed"
  );
}

export function setPlaylists(playlistList) {
  const next = normalizePlaylists(playlistList).filter((p) => !isFollowedPlaylist(p));
  if (!next.length) return false;
  const byName = new Map(
    playlists.filter((p) => !isFollowedPlaylist(p)).map((p) => [p.name, { ...p }])
  );
  for (const p of next) {
    const prev = byName.get(p.name);
    byName.set(p.name, {
      ...(prev || {}),
      ...p,
      trackCount: p.trackCount ?? prev?.trackCount ?? null,
      artistCount: p.artistCount ?? prev?.artistCount ?? 0,
      artistTotal: p.artistTotal ?? prev?.artistTotal ?? 0,
      tracksBlocked: p.tracksBlocked ?? prev?.tracksBlocked ?? false,
      blockReason: p.blockReason ?? prev?.blockReason ?? null,
      access: p.access ?? prev?.access ?? null,
    });
  }
  playlists = [...byName.values()].filter((p) => !isFollowedPlaylist(p));
  notify();
  return true;
}

function applyPlaylistTags() {
  for (const d of data) {
    if (!d.spotifyId) continue;
    const tags = new Set(d.playlists || []);
    for (const [name, ids] of Object.entries(playlistArtists)) {
      const idSet = ids instanceof Set ? ids : new Set(ids || []);
      if (idSet.has(d.spotifyId)) tags.add(name);
    }
    d.playlists = [...tags];
  }
}

function setPlaylistArtistIndex(map) {
  playlistArtists = {};
  for (const [name, ids] of Object.entries(map || {})) {
    playlistArtists[name] = new Set(ids || []);
  }
  applyPlaylistTags();
}

export function mergeData(arr, playlistList = [], playlistArtistMap = null) {
  const incoming = (arr || []).filter(
    (d) => d && typeof d.lat === "number" && typeof d.lng === "number" && d.name
  );
  const byKey = new Map();
  for (const d of data) {
    const key = d.spotifyId || d.name.toLowerCase();
    byKey.set(key, { ...d, playlists: [...(d.playlists || [])] });
  }
  incoming.forEach((d, i) => {
    const key = d.spotifyId || d.name.toLowerCase();
    const prev = byKey.get(key);
    const playlists = new Set([...(prev?.playlists || []), ...(d.playlists || [])]);
    byKey.set(key, {
      ...(prev || {}),
      ...d,
      genre: d.genre || prev?.genre || "Other",
      plays: Math.max(+d.plays || 0, +prev?.plays || 0) || 1,
      city: d.city || prev?.city || "—",
      country: d.country || prev?.country || "—",
      playlists: [...playlists],
      spotifyId: d.spotifyId || prev?.spotifyId || null,
      likedTrack: d.likedTrack || d.liked_track || prev?.likedTrack || null,
      albums: [...new Set([...(prev?.albums || []), ...(d.albums || [])])],
      labels: [...new Set([...(prev?.labels || []), ...(d.labels || [])])],
      releaseYears: [...new Set([...(prev?.releaseYears || []), ...(d.releaseYears || [])])].sort((a, b) => a - b),
      csvGenres: [...new Set([...(prev?.csvGenres || []), ...(d.csvGenres || [])])],
      addedBy: [...new Set([...(prev?.addedBy || []), ...(d.addedBy || [])])],
      trackNames: [...new Set([...(prev?.trackNames || []), ...(d.trackNames || [])])].slice(0, 40),
      keys: [...new Set([...(prev?.keys || []), ...(d.keys || [])])],
      modes: [...new Set([...(prev?.modes || []), ...(d.modes || [])])],
      timeSignatures: [...new Set([...(prev?.timeSignatures || []), ...(d.timeSignatures || [])])],
      explicit: !!(prev?.explicit || d.explicit),
      saved: !!(prev?.saved || d.saved || d.likedTrack || prev?.likedTrack),
      durationMs: d.durationMs ?? prev?.durationMs ?? null,
      trackPopularity: d.trackPopularity ?? prev?.trackPopularity ?? null,
      audio: { ...(prev?.audio || {}), ...(d.audio || {}) },
      addedAtMin: [prev?.addedAtMin, d.addedAtMin].filter(Boolean).sort()[0] || null,
      addedAtMax: [prev?.addedAtMax, d.addedAtMax].filter(Boolean).sort().slice(-1)[0] || null,
      id: prev?.id || d.id || `a-${i}-${d.name.replace(/\W/g, "").slice(0, 24)}`,
    });
  });
  data = [...byKey.values()];
  if (playlistList?.length) setPlaylists(playlistList);
  if (playlistArtistMap) {
    const merged = { ...Object.fromEntries(
      Object.entries(playlistArtists).map(([k, v]) => [k, [...(v instanceof Set ? v : v || [])]])
    ) };
    for (const [name, ids] of Object.entries(playlistArtistMap)) {
      merged[name] = [...new Set([...(merged[name] || []), ...(ids || [])])];
    }
    setPlaylistArtistIndex(merged);
  } else {
    applyPlaylistTags();
  }
  let fi = 0;
  for (const d of data) {
    if (!genreColors[d.genre]) {
      genreColors[d.genre] = FALLBACK_COLORS[fi++ % FALLBACK_COLORS.length];
    }
  }
  notify();
  return data.length;
}

export function loadData(arr, playlistList = [], playlistArtistMap = null) {
  const clean = (arr || []).filter(
    (d) => d && typeof d.lat === "number" && typeof d.lng === "number" && d.name
  );
  clean.forEach((d, i) => {
    d.genre = d.genre || "Other";
    d.plays = +d.plays || 1;
    d.city = d.city || "—";
    d.country = d.country || "—";
    d.playlists = d.playlists || [];
    d.spotifyId = d.spotifyId || d.spotify_id || null;
    d.likedTrack = d.likedTrack || d.liked_track || null;
    d.albums = d.albums || [];
    d.labels = d.labels || [];
    d.releaseYears = d.releaseYears || [];
    d.csvGenres = d.csvGenres || [];
    d.addedBy = d.addedBy || [];
    d.trackNames = d.trackNames || [];
    d.keys = d.keys || [];
    d.modes = d.modes || [];
    d.timeSignatures = d.timeSignatures || [];
    d.audio = d.audio || {};
    d.explicit = !!d.explicit;
    d.saved = !!(d.saved || d.likedTrack || (d.playlists || []).includes("Liked Songs"));
    d.id = d.id || `a-${i}-${d.name.replace(/\W/g, "").slice(0, 24)}`;
  });
  data = clean;
  const nextPlaylists = normalizePlaylists(playlistList).filter(
    (p) => !isFollowedPlaylist(p)
  );
  if (nextPlaylists.length) {
    const byName = new Map(
      playlists.filter((p) => !isFollowedPlaylist(p)).map((p) => [p.name, { ...p }])
    );
    for (const p of nextPlaylists) {
      const prev = byName.get(p.name);
      byName.set(p.name, {
        ...(prev || {}),
        ...p,
        trackCount: p.trackCount ?? prev?.trackCount ?? null,
        artistCount: p.artistCount ?? prev?.artistCount ?? 0,
        artistTotal: p.artistTotal ?? prev?.artistTotal ?? 0,
        tracksBlocked: p.tracksBlocked ?? prev?.tracksBlocked ?? false,
        blockReason: p.blockReason ?? prev?.blockReason ?? null,
        access: p.access ?? prev?.access ?? null,
      });
    }
    playlists = [...byName.values()].filter((p) => !isFollowedPlaylist(p));
  } else {
    playlists = playlists.filter((p) => !isFollowedPlaylist(p));
  }
  if (playlistArtistMap) setPlaylistArtistIndex(playlistArtistMap);
  else applyPlaylistTags();
  let fi = 0;
  for (const d of data) {
    if (!genreColors[d.genre]) {
      genreColors[d.genre] = FALLBACK_COLORS[fi++ % FALLBACK_COLORS.length];
    }
  }
  notify();
  return data.length;
}

export function clearData() {
  data = [];
  playlists = [];
  playlistArtists = {};
  notify();
}

export function derivePlaylists() {
  const shelfNames = new Set(
    playlists.filter((p) => p?.name && !isFollowedPlaylist(p)).map((p) => p.name)
  );
  const artistCounts = new Map();
  for (const d of data) {
    for (const p of d.playlists || []) {
      if (!shelfNames.has(p) && p !== "Liked Songs") continue;
      artistCounts.set(p, (artistCounts.get(p) || 0) + 1);
    }
  }

  const byName = new Map();
  for (const playlist of playlists) {
    if (!playlist?.name || isFollowedPlaylist(playlist)) continue;
    byName.set(playlist.name, { ...playlist });
  }
  for (const [name, count] of artistCounts) {
    const existing = byName.get(name) || { name };
    existing.artistCount = Math.max(existing.artistCount || 0, count);
    byName.set(name, existing);
  }

  for (const [name, ids] of Object.entries(playlistArtists)) {
    if (!shelfNames.has(name) && name !== "Liked Songs") continue;
    const existing = byName.get(name) || { name };
    const idSet = ids instanceof Set ? ids : new Set(ids || []);
    existing.artistTotal = Math.max(existing.artistTotal || 0, idSet.size);
    const onMap = data.filter((d) => d.spotifyId && idSet.has(d.spotifyId)).length;
    existing.artistCount = Math.max(existing.artistCount || 0, onMap);
    byName.set(name, existing);
  }

  return [...byName.values()]
    .map((playlist) => ({
      name: playlist.name,
      id: playlist.id || null,
      url: playlist.url || null,
      trackCount: playlist.trackCount ?? null,
      artistCount: playlist.artistCount || 0,
      artistTotal: playlist.artistTotal || 0,
      tracksBlocked: !!playlist.tracksBlocked,
      blockReason: playlist.blockReason || null,
      access: playlist.access || null,
    }))
    .filter((p) => !isFollowedPlaylist(p))
    .sort((a, b) => {
      if (a.name === "Liked Songs") return -1;
      if (b.name === "Liked Songs") return 1;
      return a.name.localeCompare(b.name);
    });
}

export function deriveOptions() {
  const countries = new Set();
  const cities = new Set();
  const artists = new Set();
  const genres = new Set();
  const csvGenres = new Set();
  const albums = new Set();
  const labels = new Set();
  const trackNames = new Set();
  const addedBy = new Set();
  const modes = new Set();
  const keys = new Set();
  const timeSignatures = new Set();
  let playsMin = Infinity;
  let playsMax = -Infinity;
  let trackPopMin = Infinity;
  let trackPopMax = -Infinity;
  let releaseYearMin = Infinity;
  let releaseYearMax = -Infinity;
  let durationMin = Infinity;
  let durationMax = -Infinity;
  let addedYearMin = Infinity;
  let addedYearMax = -Infinity;
  const audioBounds = {};

  const playlistNames = derivePlaylists().map((p) => p.name);
  const playlistSet = new Set(playlistNames.length ? playlistNames : []);

  for (const d of data) {
    if (d.country && d.country !== "—") countries.add(d.country);
    if (d.city && d.city !== "—") cities.add(d.city);
    artists.add(d.name);
    genres.add(d.genre);
    for (const p of d.playlists || []) playlistSet.add(p);
    for (const g of d.csvGenres || []) csvGenres.add(g);
    for (const a of d.albums || []) albums.add(a);
    for (const l of d.labels || []) labels.add(l);
    for (const t of d.trackNames || []) trackNames.add(t);
    for (const u of d.addedBy || []) addedBy.add(u);
    for (const m of d.modes || []) modes.add(String(m));
    for (const k of d.keys || []) keys.add(String(k));
    for (const ts of d.timeSignatures || []) timeSignatures.add(String(ts));
    playsMin = Math.min(playsMin, d.plays);
    playsMax = Math.max(playsMax, d.plays);
    if (d.trackPopularity != null) {
      trackPopMin = Math.min(trackPopMin, d.trackPopularity);
      trackPopMax = Math.max(trackPopMax, d.trackPopularity);
    }
    for (const y of d.releaseYears || []) {
      releaseYearMin = Math.min(releaseYearMin, y);
      releaseYearMax = Math.max(releaseYearMax, y);
    }
    if (d.durationMs != null) {
      durationMin = Math.min(durationMin, d.durationMs);
      durationMax = Math.max(durationMax, d.durationMs);
    }
    for (const stamp of [d.addedAtMin, d.addedAtMax]) {
      if (stamp && String(stamp).slice(0, 4).match(/^\d{4}$/)) {
        const y = +String(stamp).slice(0, 4);
        addedYearMin = Math.min(addedYearMin, y);
        addedYearMax = Math.max(addedYearMax, y);
      }
    }
    const audio = d.audio || {};
    for (const [k, v] of Object.entries(audio)) {
      if (v == null || Number.isNaN(+v)) continue;
      if (!audioBounds[k]) audioBounds[k] = { min: Infinity, max: -Infinity };
      audioBounds[k].min = Math.min(audioBounds[k].min, +v);
      audioBounds[k].max = Math.max(audioBounds[k].max, +v);
    }
  }

  const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);

  return {
    countries: [...countries].sort(),
    cities: [...cities].sort(),
    artists: [...artists].sort(),
    genres: [...genres].sort(),
    csvGenres: [...csvGenres].sort(),
    playlists: [...playlistSet].sort(),
    albums: [...albums].sort(),
    labels: [...labels].sort(),
    trackNames: [...trackNames].sort(),
    addedBy: [...addedBy].sort(),
    modes: [...modes].sort(),
    keys: [...keys].sort((a, b) => +a - +b),
    timeSignatures: [...timeSignatures].sort((a, b) => +a - +b),
    playsMin: finite(playsMin, 0),
    playsMax: finite(playsMax, 100),
    trackPopMin: finite(trackPopMin, 0),
    trackPopMax: finite(trackPopMax, 100),
    releaseYearMin: finite(releaseYearMin, 1950),
    releaseYearMax: finite(releaseYearMax, new Date().getFullYear()),
    durationMin: finite(durationMin, 0),
    durationMax: finite(durationMax, 600000),
    addedYearMin: finite(addedYearMin, 2008),
    addedYearMax: finite(addedYearMax, new Date().getFullYear()),
    audioBounds,
    hasCsvMeta:
      albums.size > 0 ||
      labels.size > 0 ||
      csvGenres.size > 0 ||
      Number.isFinite(trackPopMin) ||
      Object.keys(audioBounds).length > 0,
  };
}

export function countByLocation(items) {
  const m = new Map();
  for (const d of items) {
    const k = locationKey(d);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

export { isIncomplete, locationKey };
