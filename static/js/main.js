import { defaultFilters, defaultMapState } from "./config.js";
import {
  getData,
  loadData,
  mergeData,
  clearData,
  deriveOptions,
  derivePlaylists,
  subscribe,
} from "./data-store.js";
import {
  applyFilters,
  sortItems,
  searchItems,
  removeFilterChip,
} from "./filter-engine.js";
import {
  parseUrlState,
  buildUrlState,
  deserializeFilters,
  locationKey,
} from "./utils.js";
import { createMapController } from "./map-controller.js";
import { createUI } from "./ui.js";
import { createAuth } from "./auth.js";

let landData = null;

export function setLandData(land) {
  landData = land;
}

export async function bootstrap() {
  const canvas = document.getElementById("c");
  let filters = defaultFilters();
  let sortId = "plays-desc";
  let searchQuery = "";
  let selected = null;
  let userLocation = null;
  let locationDenied = false;
  let displayItems = [];
  let mapCtx = { bounds: null, center: { lat: 24, lng: -20 } };
  let locationGroup = [];
  let locationIndex = 0;

  const urlInit = parseUrlState(window.location.search);
  const mapDefaults = { ...defaultMapState(), ...urlInit };
  if (urlInit.filters) filters = deserializeFilters(urlInit.filters);
  if (urlInit.search) searchQuery = urlInit.search;
  if (urlInit.sort) sortId = urlInit.sort;

  let pendingSelectedId = urlInit.selectedId || null;
  let ui;

  async function resolveLikedTrack(item) {
    if (item?.likedTrack?.id) {
      return { status: "ready", track: item.likedTrack };
    }
    if (!item?.spotifyId && !item?.name) {
      return { status: "none", track: null };
    }
    try {
      const params = new URLSearchParams();
      if (item.spotifyId) params.set("artist_id", item.spotifyId);
      if (item.name) params.set("name", item.name);
      const res = await fetch(`/api/library/liked-track?${params.toString()}`);
      const payload = await res.json().catch(() => ({}));
      if (payload.likedTrack?.id) {
        return { status: "ready", track: payload.likedTrack };
      }
      if (res.status === 429 || payload.rate_limited) {
        return {
          status: "rate_limited",
          track: null,
          searchUrl:
            payload.searchUrl ||
            `https://open.spotify.com/search/${encodeURIComponent(item.name || "")}`,
        };
      }
      return {
        status: "none",
        track: null,
        searchUrl:
          payload.searchUrl ||
          `https://open.spotify.com/search/${encodeURIComponent(item.name || "")}`,
      };
    } catch {
      return {
        status: "none",
        track: null,
        searchUrl: `https://open.spotify.com/search/${encodeURIComponent(item.name || "")}`,
      };
    }
  }

  async function loadDetailPlayback(item, token) {
    const result = await resolveLikedTrack(item);
    if (selected?.id !== item.id) return;
    if (result.track) item.likedTrack = result.track;
    ui.setDetailPlayback(result.status, result.track, token, {
      searchUrl: result.searchUrl,
      artistName: item.name,
    });
  }

  function refresh() {
    const options = deriveOptions();
    const ctx = {
      mapCenter: mapCtx.center,
      userLocation,
      bounds: filters.visibleOnly ? mapCtx.bounds : null,
      locCounts: null,
    };
    let items = applyFilters(getData(), filters, ctx);
    items = sortItems(items, sortId, ctx);
    displayItems = items;
    map.setItems(items);
    map.setFilters(filters);
    ui.renderPlaylists(derivePlaylists(), filters.playlists);
    ui.renderFilterPanel(options, filters, !!userLocation);
    ui.renderActiveChips(filters, options);
    ui.setStatus(items.length ? `${items.length} artists on map` : "No matching artists");
    ui.setSort(sortId, !!userLocation);
    if (selected) {
      const stillVisible = items.some((d) => d.id === selected.id);
      if (stillVisible) {
        openArtistDetail(selected);
      } else {
        selected = null;
        locationGroup = [];
        locationIndex = 0;
        map.setSelected(null);
        ui.showDetail(null);
      }
    } else if (pendingSelectedId) {
      const item = items.find((d) => d.id === pendingSelectedId);
      if (item) {
        openArtistDetail(item);
        pendingSelectedId = null;
      }
    }
    syncUrl();
  }

  function syncUrl() {
    const view = map.getView();
    const url = buildUrlState({
      map: view,
      search: searchQuery,
      sort: sortId,
      selectedId: selected?.id,
      filters,
    });
    history.replaceState(null, "", url);
  }

  function artistsAtSamePlace(item, pool = displayItems) {
    if (!item || item.lat == null || item.lng == null) return item ? [item] : [];
    const key = locationKey(item);
    const matches = pool.filter(
      (candidate) =>
        candidate?.lat != null &&
        candidate?.lng != null &&
        locationKey(candidate) === key
    );
    return matches.length ? matches : [item];
  }

  function openArtistDetail(item, meta = {}) {
    if (!item) return;
    const group =
      meta.group?.length > 0
        ? meta.group
        : artistsAtSamePlace(item, displayItems);
    locationGroup = group;
    locationIndex = Number.isFinite(meta.index)
      ? Math.max(0, Math.min(group.length - 1, meta.index))
      : Math.max(0, group.findIndex((entry) => entry.id === item.id));
    if (locationIndex < 0) locationIndex = 0;
    selected = locationGroup[locationIndex] || item;
    map.setSelected(selected);
    ui.showDetail(selected, locationIndex, locationGroup.length, {
      mode: "location",
      place: `${selected.city || "—"}, ${selected.country || "—"}`,
    });
    const screen =
      meta.screen ||
      (selected._x != null && selected._y != null
        ? { x: selected._x, y: selected._y }
        : map.projectScreen?.(selected.lng, selected.lat));
    if (screen) ui.positionDetail(screen.x, screen.y);
    syncUrl();
  }

  function anchorSelectedDetail() {
    if (!selected) return;
    const screen = map.projectScreen?.(selected.lng, selected.lat);
    if (screen) ui.positionDetail(screen.x, screen.y);
  }

  const map = createMapController(canvas, landData, {
    onViewChange(view) {
      mapCtx.center = { lat: view.lat, lng: view.lng };
      map.notifyViewChange();
      syncUrl();
    },
    onRender(ctx) {
      mapCtx = { ...ctx, center: { lat: map.getView().lat, lng: map.getView().lng } };
      ui?.setViewHint(ctx.globe, ctx.map, ctx.t);
      const km = ctx.kmPerPx * 80;
      ui?.setScale(km, 80);
    },
    onSelect(item, meta = {}) {
      openArtistDetail(item, meta);
    },
    onAnchorMove(screen) {
      if (!selected) return;
      if (screen) ui.positionDetail(screen.x, screen.y);
    },
    onHover(hit) {
      const item = hit?.type === "item" ? hit.data : null;
      ui.showTooltip(hit, item);
    },
    onClusterClick(cluster) {
      ui.renderSearchResults({ artists: cluster.items.slice(0, 8), locations: [], playlists: [], genres: [] });
    },
  });

  ui = createUI(document.body, {
    onSortChange(id) {
      sortId = id;
      refresh();
    },
    onStyleChange(style) {
      map.setView({ mapStyle: style });
      ui.setStyleActive(style);
      syncUrl();
    },
    onZoomIn: () => map.zoomIn(),
    onZoomOut: () => map.zoomOut(),
    onResetBearing: () => map.resetBearing(),
    onLocate: () => requestUserLocation(),
    onFitAll: () => map.fitBounds(displayItems),
    onFilterApply(draft) {
      filters = draft;
      refresh();
    },
    onFilterClear() {
      filters = defaultFilters();
      refresh();
    },
    onFilterChipRemove(chip) {
      filters = removeFilterChip(filters, chip);
      refresh();
    },
    onSearch(q) {
      searchQuery = q;
      const groups = searchItems(getData(), q);
      ui.renderSearchResults(groups);
      syncUrl();
    },
    onSearchSelect(sel) {
      if (sel.type === "artist" && sel.item) {
        openArtistDetail(sel.item);
        map.flyTo(sel.item.lng, sel.item.lat);
        refresh();
      } else if (sel.type === "location" && sel.item) {
        map.flyTo(sel.item.lng, sel.item.lat, 3);
      } else if (sel.type === "playlist") {
        filters = { ...filters, playlists: new Set([sel.name]) };
        searchQuery = sel.name;
        ui.setSearchQuery(sel.name);
        refresh();
      } else if (sel.type === "genre") {
        filters = { ...filters, genres: new Set([sel.name]) };
        refresh();
      }
    },
    onDetailNav(dir) {
      if (!locationGroup.length) {
        locationGroup = artistsAtSamePlace(selected, displayItems);
        locationIndex = Math.max(
          0,
          locationGroup.findIndex((entry) => entry.id === selected?.id)
        );
      }
      if (!locationGroup.length) return;
      locationIndex =
        (locationIndex + dir + locationGroup.length) % locationGroup.length;
      const next = locationGroup[locationIndex];
      if (!next) return;
      selected = next;
      map.setSelected(next);
      ui.showDetail(next, locationIndex, locationGroup.length, {
        mode: "location",
        place: `${next.city || "—"}, ${next.country || "—"}`,
      });
      anchorSelectedDetail();
      syncUrl();
    },
    onPlaylistToggle(name) {
      const next = new Set(filters.playlists);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      filters = { ...filters, playlists: next };
      refresh();
    },
    onDetailClose() {
      selected = null;
      locationGroup = [];
      locationIndex = 0;
      map.setSelected(null);
      refresh();
    },
    onDetailOpen(item, token) {
      loadDetailPlayback(item, token);
    },
    onAccountOpen: () => auth.openAccount(),
  });

  ui.setStyleActive(mapDefaults.mapStyle || "satellite");
  ui.setSearchQuery(searchQuery);
  map.setView(mapDefaults);

  function requestUserLocation() {
    if (locationDenied || !navigator.geolocation) {
      ui.setStatus("Location unavailable");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        map.setUserLocation(userLocation);
        map.recenterUser();
        refresh();
      },
      () => {
        locationDenied = true;
        ui.setStatus("Location permission denied");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  const auth = createAuth({
    onDataLoaded(arr, playlistList = [], playlistArtistMap = null) {
      const n = loadData(arr, playlistList, playlistArtistMap);
      refresh();
      auth.unlockUi();
      ui.setStatus(`Loaded ${n} artists`);
      return n;
    },
    onCsvImported(arr, playlistList = [], playlistArtistMap = null) {
      const n = mergeData(arr, playlistList, playlistArtistMap);
      refresh();
      auth.unlockUi();
      ui.setStatus(`Mapped ${n} artists from Exportify CSV`);
      return n;
    },
    onLogout() {
      clearData();
      selected = null;
      refresh();
      ui.setStatus("Disconnected");
    },
  });

  auth.wireMapToggles(
    (on) => map.setView({ arcs: on }),
    (on) => map.setView({ spin: on })
  );

  map.start();
  subscribe(refresh);

  const { justLoggedIn } = auth.handleAuthParams();
  const isAuthed = await auth.checkAuth();

  if (isAuthed && justLoggedIn) {
    auth.unlockUi();
    auth.loadCached();
    refresh();
    // Auto-pull playlists on fresh login — gives users the full map immediately
    if (!auth.isInRateLimitCooldown()) {
      await auth.doPull();
    } else {
      await auth.doSync(true); // shows cooldown status, keeps cache
    }
  } else if (isAuthed) {
    const hadCache = auth.loadCached();
    if (hadCache) {
      auth.unlockUi();
      refresh();
      if (!auth.isInRateLimitCooldown()) {
        auth.doPull();
      }
    } else if (!auth.isInRateLimitCooldown()) {
      auth.unlockUi();
      await auth.doPull();
    } else {
      auth.unlockUi();
      await auth.doSync(true);
    }
  }

  refresh();
}
