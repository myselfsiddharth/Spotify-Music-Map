import { haversineKm, isIncomplete } from "./utils.js";
import { countByLocation } from "./data-store.js";
import { defaultFilters } from "./config.js";

export function applyFilters(items, filters, ctx) {
  const { mapCenter, userLocation, bounds, locCounts } = ctx;
  let out = items;

  if (filters.hideIncomplete) {
    out = out.filter((d) => !isIncomplete(d));
  }

  if (filters.countries?.size) {
    out = out.filter((d) => filters.countries.has(d.country));
  }
  if (filters.cities?.size) {
    out = out.filter((d) => filters.cities.has(d.city));
  }
  if (filters.artists?.size) {
    out = out.filter((d) => filters.artists.has(d.name));
  }
  if (filters.genres?.size) {
    out = out.filter((d) => filters.genres.has(d.genre));
  }
  if (filters.csvGenres?.size) {
    out = out.filter((d) => (d.csvGenres || []).some((g) => filters.csvGenres.has(g)));
  }
  if (filters.playlists?.size) {
    out = out.filter((d) => (d.playlists || []).some((p) => filters.playlists.has(p)));
  }
  if (filters.albums?.size) {
    out = out.filter((d) => (d.albums || []).some((a) => filters.albums.has(a)));
  }
  if (filters.labels?.size) {
    out = out.filter((d) => (d.labels || []).some((l) => filters.labels.has(l)));
  }
  if (filters.trackNames?.size) {
    out = out.filter((d) => (d.trackNames || []).some((t) => filters.trackNames.has(t)));
  }
  if (filters.addedBy?.size) {
    out = out.filter((d) => (d.addedBy || []).some((u) => filters.addedBy.has(u)));
  }
  if (filters.modes?.size) {
    out = out.filter((d) => (d.modes || []).some((m) => filters.modes.has(String(m))));
  }
  if (filters.keys?.size) {
    out = out.filter((d) => (d.keys || []).some((k) => filters.keys.has(String(k))));
  }
  if (filters.timeSignatures?.size) {
    out = out.filter((d) =>
      (d.timeSignatures || []).some((t) => filters.timeSignatures.has(String(t)))
    );
  }

  if (filters.playsMin != null) {
    out = out.filter((d) => d.plays >= filters.playsMin);
  }
  if (filters.playsMax != null) {
    out = out.filter((d) => d.plays <= filters.playsMax);
  }
  if (filters.trackPopMin != null) {
    out = out.filter(
      (d) => d.trackPopularity != null && d.trackPopularity >= filters.trackPopMin
    );
  }
  if (filters.trackPopMax != null) {
    out = out.filter(
      (d) => d.trackPopularity != null && d.trackPopularity <= filters.trackPopMax
    );
  }
  if (filters.releaseYearMin != null) {
    out = out.filter((d) =>
      (d.releaseYears || []).some((y) => y >= filters.releaseYearMin)
    );
  }
  if (filters.releaseYearMax != null) {
    out = out.filter((d) =>
      (d.releaseYears || []).some((y) => y <= filters.releaseYearMax)
    );
  }
  if (filters.durationMin != null) {
    out = out.filter((d) => d.durationMs != null && d.durationMs >= filters.durationMin);
  }
  if (filters.durationMax != null) {
    out = out.filter((d) => d.durationMs != null && d.durationMs <= filters.durationMax);
  }
  if (filters.addedYearMin != null) {
    out = out.filter((d) => addedYear(d) != null && addedYear(d) >= filters.addedYearMin);
  }
  if (filters.addedYearMax != null) {
    out = out.filter((d) => addedYear(d) != null && addedYear(d) <= filters.addedYearMax);
  }

  if (filters.explicit === "explicit") {
    out = out.filter((d) => !!d.explicit);
  } else if (filters.explicit === "clean") {
    out = out.filter((d) => !d.explicit);
  }

  if (filters.savedOnly) {
    out = out.filter((d) => d.saved || d.likedTrack || (d.playlists || []).includes("Liked Songs"));
  }

  for (const feature of [
    "danceability",
    "energy",
    "valence",
    "acousticness",
    "instrumentalness",
    "speechiness",
    "liveness",
    "tempo",
    "loudness",
  ]) {
    const minKey = `${feature}Min`;
    if (filters[minKey] != null) {
      out = out.filter((d) => {
        const v = d.audio?.[feature];
        return v != null && v >= filters[minKey];
      });
    }
  }

  if (filters.radiusCenterKm != null && mapCenter) {
    const r = filters.radiusCenterKm;
    out = out.filter(
      (d) => haversineKm(mapCenter.lat, mapCenter.lng, d.lat, d.lng) <= r
    );
  }

  if (filters.radiusUserKm != null && userLocation) {
    const r = filters.radiusUserKm;
    out = out.filter(
      (d) => haversineKm(userLocation.lat, userLocation.lng, d.lat, d.lng) <= r
    );
  }

  if (filters.visibleOnly && bounds) {
    out = out.filter((d) => pointInBounds(d.lng, d.lat, bounds));
  }

  if (filters.multiLocation) {
    const counts = locCounts || countByLocation(items);
    out = out.filter((d) => (counts.get(locationKey(d)) || 0) > 1);
  }

  return out;
}

function addedYear(d) {
  const stamp = d.addedAtMax || d.addedAtMin;
  if (!stamp) return null;
  const y = +String(stamp).slice(0, 4);
  return Number.isFinite(y) ? y : null;
}

function locationKey(d) {
  return `${d.lat.toFixed(3)}|${d.lng.toFixed(3)}`;
}

function pointInBounds(lng, lat, b) {
  return lng >= b.west && lng <= b.east && lat >= b.south && lat <= b.north;
}

export function searchItems(items, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) {
    return { artists: [], locations: [], playlists: [], genres: [] };
  }

  const artists = items
    .filter((d) => {
      const hay = [
        d.name,
        d.city,
        d.country,
        d.genre,
        ...(d.playlists || []),
        ...(d.csvGenres || []),
        ...(d.albums || []),
        ...(d.trackNames || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    })
    .slice(0, 12);

  const locMap = new Map();
  for (const d of items) {
    const city = d.city || "—";
    const country = d.country || "—";
    const label = `${city}, ${country}`.toLowerCase();
    if (!label.includes(q) && !city.toLowerCase().includes(q) && !country.toLowerCase().includes(q)) {
      continue;
    }
    const key = `${city}|${country}`;
    const prev = locMap.get(key);
    if (prev) {
      prev.count += 1;
    } else {
      locMap.set(key, {
        city,
        country,
        count: 1,
        lat: d.lat,
        lng: d.lng,
        item: d,
      });
    }
  }
  const locations = [...locMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const playlistSet = new Set();
  const genreSet = new Set();
  for (const d of items) {
    for (const p of d.playlists || []) {
      if (p.toLowerCase().includes(q)) playlistSet.add(p);
    }
    if (d.genre && d.genre.toLowerCase().includes(q)) genreSet.add(d.genre);
    for (const g of d.csvGenres || []) {
      if (g.toLowerCase().includes(q)) genreSet.add(g);
    }
  }

  return {
    artists,
    locations,
    playlists: [...playlistSet].sort().slice(0, 8),
    genres: [...genreSet].sort().slice(0, 8),
  };
}

export function sortItems(items, sortId, ctx) {
  const { mapCenter, userLocation } = ctx;
  const arr = [...items];

  for (const d of arr) {
    d._distCenter = mapCenter
      ? haversineKm(mapCenter.lat, mapCenter.lng, d.lat, d.lng)
      : 0;
    d._distUser =
      userLocation != null
        ? haversineKm(userLocation.lat, userLocation.lng, d.lat, d.lng)
        : Infinity;
    const years = d.releaseYears || [];
    d.releaseYearMax = years.length ? Math.max(...years) : -Infinity;
    d.releaseYearMin = years.length ? Math.min(...years) : Infinity;
  }

  switch (sortId) {
    case "name-asc":
      arr.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "name-desc":
      arr.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case "dist-center":
      arr.sort((a, b) => a._distCenter - b._distCenter);
      break;
    case "dist-user":
      arr.sort((a, b) => a._distUser - b._distUser);
      break;
    case "track-pop-desc":
      arr.sort((a, b) => (b.trackPopularity || 0) - (a.trackPopularity || 0));
      break;
    case "release-new":
      arr.sort((a, b) => b.releaseYearMax - a.releaseYearMax);
      break;
    case "release-old":
      arr.sort((a, b) => a.releaseYearMin - b.releaseYearMin);
      break;
    case "added-new":
      arr.sort((a, b) => String(b.addedAtMax || "").localeCompare(String(a.addedAtMax || "")));
      break;
    case "added-old":
      arr.sort((a, b) => String(a.addedAtMin || "9999").localeCompare(String(b.addedAtMin || "9999")));
      break;
    case "duration-desc":
      arr.sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0));
      break;
    case "plays-desc":
    default:
      arr.sort((a, b) => b.plays - a.plays);
  }
  return arr;
}

export function activeFilterCount(filters) {
  let n = 0;
  for (const k of [
    "countries",
    "cities",
    "artists",
    "genres",
    "csvGenres",
    "playlists",
    "albums",
    "labels",
    "trackNames",
    "addedBy",
    "modes",
    "keys",
    "timeSignatures",
  ]) {
    if (filters[k]?.size) n += filters[k].size;
  }
  if (filters.playsMin != null || filters.playsMax != null) n += 1;
  if (filters.trackPopMin != null || filters.trackPopMax != null) n += 1;
  if (filters.releaseYearMin != null || filters.releaseYearMax != null) n += 1;
  if (filters.durationMin != null || filters.durationMax != null) n += 1;
  if (filters.addedYearMin != null || filters.addedYearMax != null) n += 1;
  if (filters.explicit && filters.explicit !== "any") n += 1;
  if (filters.savedOnly) n += 1;
  for (const feature of [
    "danceability",
    "energy",
    "valence",
    "acousticness",
    "instrumentalness",
    "speechiness",
    "liveness",
    "tempo",
    "loudness",
  ]) {
    if (filters[`${feature}Min`] != null) n += 1;
  }
  if (filters.radiusCenterKm != null) n += 1;
  if (filters.radiusUserKm != null) n += 1;
  if (filters.visibleOnly) n += 1;
  if (filters.hideIncomplete) n += 1;
  if (filters.multiLocation) n += 1;
  if (!filters.showClusters || !filters.showMarkers || filters.showHeatmap) n += 1;
  return n;
}

export function filterChips(filters, options) {
  const chips = [];
  const addSet = (key, label, set) => {
    for (const v of set || []) chips.push({ key, value: v, label: `${label}: ${v}` });
  };
  addSet("countries", "Country", filters.countries);
  addSet("cities", "City", filters.cities);
  addSet("artists", "Artist", filters.artists);
  addSet("genres", "Genre", filters.genres);
  addSet("csvGenres", "CSV genre", filters.csvGenres);
  addSet("playlists", "Playlist", filters.playlists);
  addSet("albums", "Album", filters.albums);
  addSet("labels", "Label", filters.labels);
  addSet("trackNames", "Track", filters.trackNames);
  addSet("addedBy", "Added by", filters.addedBy);
  addSet("modes", "Mode", filters.modes);
  addSet("keys", "Key", filters.keys);
  addSet("timeSignatures", "Time sig", filters.timeSignatures);
  if (filters.playsMin != null || filters.playsMax != null) {
    chips.push({
      key: "plays",
      label: `Library pop: ${filters.playsMin ?? options.playsMin}–${filters.playsMax ?? options.playsMax}`,
    });
  }
  if (filters.trackPopMin != null || filters.trackPopMax != null) {
    chips.push({
      key: "trackPop",
      label: `Track pop: ${filters.trackPopMin ?? options.trackPopMin}–${filters.trackPopMax ?? options.trackPopMax}`,
    });
  }
  if (filters.releaseYearMin != null || filters.releaseYearMax != null) {
    chips.push({
      key: "releaseYear",
      label: `Release: ${filters.releaseYearMin ?? options.releaseYearMin}–${filters.releaseYearMax ?? options.releaseYearMax}`,
    });
  }
  if (filters.durationMin != null || filters.durationMax != null) {
    chips.push({
      key: "duration",
      label: `Duration: ${Math.round((filters.durationMin ?? options.durationMin) / 1000)}s–${Math.round((filters.durationMax ?? options.durationMax) / 1000)}s`,
    });
  }
  if (filters.addedYearMin != null || filters.addedYearMax != null) {
    chips.push({
      key: "addedYear",
      label: `Added: ${filters.addedYearMin ?? options.addedYearMin}–${filters.addedYearMax ?? options.addedYearMax}`,
    });
  }
  if (filters.explicit && filters.explicit !== "any") {
    chips.push({ key: "explicit", label: filters.explicit === "explicit" ? "Explicit only" : "Clean only" });
  }
  if (filters.savedOnly) chips.push({ key: "savedOnly", label: "Liked / saved only" });
  for (const feature of [
    "danceability",
    "energy",
    "valence",
    "acousticness",
    "instrumentalness",
    "speechiness",
    "liveness",
    "tempo",
    "loudness",
  ]) {
    const minKey = `${feature}Min`;
    if (filters[minKey] != null) {
      chips.push({ key: minKey, label: `${feature} ≥ ${filters[minKey]}` });
    }
  }
  if (filters.radiusCenterKm != null) {
    chips.push({ key: "radiusCenterKm", label: `Within ${filters.radiusCenterKm} km of center` });
  }
  if (filters.radiusUserKm != null) {
    chips.push({ key: "radiusUserKm", label: `Within ${filters.radiusUserKm} km of you` });
  }
  if (filters.visibleOnly) chips.push({ key: "visibleOnly", label: "Visible area" });
  if (filters.hideIncomplete) chips.push({ key: "hideIncomplete", label: "Complete locations only" });
  if (filters.multiLocation) chips.push({ key: "multiLocation", label: "Multi-artist locations" });
  return chips;
}

export function removeFilterChip(filters, chip) {
  const next = cloneFilters(filters);
  const setKeys = new Set([
    "countries",
    "cities",
    "artists",
    "genres",
    "csvGenres",
    "playlists",
    "albums",
    "labels",
    "trackNames",
    "addedBy",
    "modes",
    "keys",
    "timeSignatures",
  ]);
  if (setKeys.has(chip.key) && chip.value != null) {
    next[chip.key] = new Set(next[chip.key]);
    next[chip.key].delete(chip.value);
  } else if (chip.key === "plays") {
    next.playsMin = null;
    next.playsMax = null;
  } else if (chip.key === "trackPop") {
    next.trackPopMin = null;
    next.trackPopMax = null;
  } else if (chip.key === "releaseYear") {
    next.releaseYearMin = null;
    next.releaseYearMax = null;
  } else if (chip.key === "duration") {
    next.durationMin = null;
    next.durationMax = null;
  } else if (chip.key === "addedYear") {
    next.addedYearMin = null;
    next.addedYearMax = null;
  } else if (chip.key === "explicit") {
    next.explicit = "any";
  } else if (chip.key in next) {
    if (typeof next[chip.key] === "boolean") next[chip.key] = false;
    else next[chip.key] = null;
  }
  return next;
}

function cloneFilters(f) {
  const base = defaultFilters();
  const o = { ...base, ...f };
  for (const k of Object.keys(base)) {
    if (base[k] instanceof Set) {
      o[k] = new Set(f[k] || []);
    }
  }
  return o;
}
