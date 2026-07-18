import { esc } from "./utils.js";
import { SORT_OPTIONS, FILTER_META, AUDIO_FEATURE_FILTERS, defaultFilters } from "./config.js";
import {
  activeFilterCount,
  filterChips,
  removeFilterChip,
} from "./filter-engine.js";
import { getGenreColor } from "./data-store.js";

export function createUI(root, handlers) {
  const els = {
    searchInput: root.querySelector("#searchInput"),
    searchDropdown: root.querySelector("#searchDropdown"),
    filterBtn: root.querySelector("#filterBtn"),
    filterBadge: root.querySelector("#filterBadge"),
    resultsBtn: root.querySelector("#resultsBtn"),
    accountBtn: root.querySelector("#accountBtn"),
    activeFilters: root.querySelector("#activeFilters"),
    filterPanel: root.querySelector("#filterPanel"),
    filterBackdrop: root.querySelector("#filterBackdrop"),
    filterBody: root.querySelector("#filterBody"),
    filterApply: root.querySelector("#filterApply"),
    filterClear: root.querySelector("#filterClear"),
    resultsPanel: root.querySelector("#resultsPanel"),
    resultsList: root.querySelector("#resultsList"),
    resultsCount: root.querySelector("#resultsCount"),
    sortSelect: root.querySelector("#sortSelect"),
    detailCard: root.querySelector("#detailCard"),
    tip: root.querySelector("#tip"),
    statusPill: root.querySelector("#statusPill"),
    viewHint: root.querySelector("#viewHint"),
    scaleBar: root.querySelector("#scaleBar"),
    scaleLine: root.querySelector("#scaleLine"),
    styleSelector: root.querySelector("#styleSelector"),
    fullscreenBtn: root.querySelector("#fullscreenBtn"),
    zoomInBtn: root.querySelector("#zoomInBtn"),
    zoomOutBtn: root.querySelector("#zoomOutBtn"),
    locateBtn: root.querySelector("#locateBtn"),
    compassBtn: root.querySelector("#compassBtn"),
    fitBtn: root.querySelector("#fitBtn"),
    resultsClose: root.querySelector("#resultsClose"),
    resultsHandle: root.querySelector("#resultsHandle"),
    filterClose: root.querySelector("#filterClose"),
    accountPanel: root.querySelector("#accountPanel"),
    accountBackdrop: root.querySelector("#accountBackdrop"),
    accountClose: root.querySelector("#accountClose"),
  };

  const panelReturnFocus = new WeakMap();
  let detailReturnFocus = null;
  let searchActiveIndex = -1;
  let detailPlaybackToken = 0;

  function renderDetailPlayback(status, track, opts = {}) {
    if (status === "loading") {
      return `<div class="detail-play" aria-live="polite"><p class="detail-play-status">Finding a liked song…</p></div>`;
    }
    if (status === "rate_limited") {
      const searchUrl =
        opts.searchUrl ||
        `https://open.spotify.com/search/${encodeURIComponent(opts.artistName || "")}`;
      return `<div class="detail-play" aria-live="polite">
        <p class="detail-play-status">Spotify rate limit — can't load your Liked Songs right now.</p>
        <a class="play-external" href="${esc(searchUrl)}" target="_blank" rel="noopener noreferrer">Open ${esc(opts.artistName || "artist")} on Spotify</a>
      </div>`;
    }
    if (!track?.id) {
      const searchUrl =
        opts.searchUrl ||
        `https://open.spotify.com/search/${encodeURIComponent(opts.artistName || "")}`;
      return `<div class="detail-play" aria-live="polite">
        <p class="detail-play-status">No cached liked track for this artist yet. Sync again after the rate limit clears.</p>
        <a class="play-external" href="${esc(searchUrl)}" target="_blank" rel="noopener noreferrer">Search on Spotify</a>
      </div>`;
    }
    const embedUrl = `https://open.spotify.com/embed/track/${encodeURIComponent(track.id)}?utm_source=generator&theme=0`;
    const spotifyUrl = track.url || `https://open.spotify.com/track/${track.id}`;
    return `
      <div class="detail-play" aria-live="polite">
        <p class="detail-play-label">From your Liked Songs</p>
        <button type="button" class="play-track-btn" id="detailPlayBtn" aria-expanded="false" aria-controls="detailEmbed">
          <span class="play-track-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </span>
          <span class="play-track-copy">
            <span class="play-track-action">Play song</span>
            <span class="play-track-title">${esc(track.name)}</span>
          </span>
        </button>
        <div class="detail-embed" id="detailEmbed" hidden>
          <iframe title="Spotify player for ${esc(track.name)}"
            src="about:blank"
            data-embed-src="${esc(embedUrl)}"
            width="100%" height="80" frameborder="0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            scrolling="no"></iframe>
        </div>
        <a class="play-external" href="${esc(spotifyUrl)}" target="_blank" rel="noopener noreferrer">Open in Spotify</a>
      </div>`;
  }

  function wireDetailPlayback() {
    const playBtn = els.detailCard.querySelector("#detailPlayBtn");
    const embed = els.detailCard.querySelector("#detailEmbed");
    const iframe = embed?.querySelector("iframe");
    if (!playBtn || !embed || !iframe) return;

    playBtn.addEventListener("click", () => {
      const opening = embed.hidden;
      embed.hidden = !opening;
      playBtn.classList.toggle("is-open", opening);
      playBtn.setAttribute("aria-expanded", opening ? "true" : "false");
      const icon = playBtn.querySelector(".play-track-icon");
      const action = playBtn.querySelector(".play-track-action");
      if (icon) {
        icon.innerHTML = opening
          ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h4v12H6zm8 0h4v12h-4z"/></svg>`
          : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
      }
      if (action) action.textContent = opening ? "Now playing" : "Play song";
      if (opening && (!iframe.src || iframe.src === "about:blank" || iframe.getAttribute("src") === "about:blank")) {
        iframe.src = iframe.dataset.embedSrc || iframe.getAttribute("data-embed-src");
      }
      if (opening) {
        requestAnimationFrame(() => {
          embed.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
      }
    });
  }

  function setPanelState(panel, backdrop, open) {
    if (!panel) return;
    panel.classList.toggle("open", open);
    panel.setAttribute("aria-hidden", String(!open));
    panel.toggleAttribute("inert", !open);
    if (backdrop) {
      backdrop.classList.toggle("open", open);
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.toggleAttribute("inert", !open);
    }
  }

  function openUiPanel(panel, backdrop, opener, initialFocus) {
    if (!panel) return;
    if (opener) panelReturnFocus.set(panel, opener);
    setPanelState(panel, backdrop, true);
    opener?.setAttribute("aria-expanded", "true");
    if (initialFocus) requestAnimationFrame(() => initialFocus.focus({ preventScroll: true }));
  }

  function closeUiPanel(panel, backdrop, opener, restoreFocus = true) {
    if (!panel) return;
    setPanelState(panel, backdrop, false);
    opener?.setAttribute("aria-expanded", "false");
    if (!restoreFocus) return;
    const target = panelReturnFocus.get(panel) || opener;
    if (target?.isConnected) requestAnimationFrame(() => target.focus({ preventScroll: true }));
  }

  function setResultsOpen(open, restoreFocus = false) {
    setPanelState(els.resultsPanel, null, open);
    document.body.classList.toggle("results-open", open);
    els.resultsBtn.setAttribute("aria-expanded", String(open));
    els.resultsHandle?.setAttribute("aria-expanded", String(open));
    if (open) panelReturnFocus.set(els.resultsPanel, els.resultsBtn);
    else if (restoreFocus) requestAnimationFrame(() => els.resultsBtn.focus({ preventScroll: true }));
  }

  function searchOptions() {
    return [...els.searchDropdown.querySelectorAll(".search-item")];
  }

  function setActiveSearchOption(index) {
    const options = searchOptions();
    searchActiveIndex = options.length ? Math.max(-1, Math.min(index, options.length - 1)) : -1;
    options.forEach((option, optionIndex) => {
      const active = optionIndex === searchActiveIndex;
      option.classList.toggle("active", active);
      option.setAttribute("aria-selected", String(active));
    });
    const active = options[searchActiveIndex];
    if (active) {
      els.searchInput.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    } else {
      els.searchInput.removeAttribute("aria-activedescendant");
    }
  }

  function setSearchOpen(open) {
    els.searchDropdown.classList.toggle("open", open);
    els.searchDropdown.setAttribute("aria-hidden", String(!open));
    els.searchDropdown.toggleAttribute("inert", !open);
    els.searchInput.setAttribute("aria-expanded", String(open));
    if (!open) setActiveSearchOption(-1);
  }

  function hideDetail({ restoreFocus = false, notify = false } = {}) {
    detailPlaybackToken += 1;
    els.detailCard.classList.remove("open", "anchored");
    els.detailCard.style.left = "";
    els.detailCard.style.top = "";
    els.detailCard.setAttribute("aria-hidden", "true");
    els.detailCard.toggleAttribute("inert", true);
    if (notify) handlers.onDetailClose?.();
    if (!restoreFocus) return;
    const target = detailReturnFocus?.isConnected
      ? detailReturnFocus
      : els.resultsBtn || els.searchInput;
    requestAnimationFrame(() => target?.focus({ preventScroll: true }));
  }

  els.searchInput.setAttribute("role", "combobox");
  els.searchInput.setAttribute("aria-autocomplete", "list");
  els.searchInput.setAttribute("aria-haspopup", "listbox");
  els.searchInput.setAttribute("aria-controls", els.searchDropdown.id);
  els.searchInput.setAttribute("aria-expanded", "false");
  els.searchDropdown.setAttribute("aria-hidden", "true");
  els.searchDropdown.toggleAttribute("inert", true);
  els.resultsCount.setAttribute("aria-live", "polite");

  els.filterPanel.setAttribute("role", "dialog");
  els.filterPanel.setAttribute("aria-modal", "true");
  els.accountPanel?.setAttribute("role", "dialog");
  els.accountPanel?.setAttribute("aria-modal", "true");
  els.accountBtn.setAttribute("aria-controls", "accountPanel");
  els.accountBtn.setAttribute("aria-expanded", "false");
  setPanelState(els.filterPanel, els.filterBackdrop, false);
  setPanelState(els.accountPanel, els.accountBackdrop, false);
  setResultsOpen(true);
  hideDetail();

  // Sort select — grouped for scanability
  const sortGroups = new Map();
  for (const o of SORT_OPTIONS) {
    const g = o.group || "Other";
    if (!sortGroups.has(g)) sortGroups.set(g, []);
    sortGroups.get(g).push(o);
  }
  els.sortSelect.innerHTML = [...sortGroups.entries()]
    .map(([group, opts]) => {
      const options = opts
        .map((o) => {
          if (!o.available) {
            return `<option value="${o.id}" disabled title="${esc(o.reason || "")}">${esc(o.label)}</option>`;
          }
          if (o.needsLocation) {
            return `<option value="${o.id}" data-needs-loc="1">${esc(o.label)}</option>`;
          }
          return `<option value="${o.id}">${esc(o.label)}</option>`;
        })
        .join("");
      return `<optgroup label="${esc(group)}">${options}</optgroup>`;
    })
    .join("");

  els.sortSelect.addEventListener("change", () => {
    handlers.onSortChange(els.sortSelect.value);
  });

  // Map style
  els.styleSelector.querySelectorAll(".style-thumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      const style = btn.dataset.style;
      els.styleSelector.querySelectorAll(".style-thumb").forEach((b) => {
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      handlers.onStyleChange(style);
    });
  });

  // Controls
  els.zoomInBtn.addEventListener("click", handlers.onZoomIn);
  els.zoomOutBtn.addEventListener("click", handlers.onZoomOut);
  els.compassBtn.addEventListener("click", handlers.onResetBearing);
  els.locateBtn.addEventListener("click", handlers.onLocate);
  els.fitBtn.addEventListener("click", handlers.onFitAll);
  els.fullscreenBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  els.filterBtn.addEventListener("click", () => {
    setSearchOpen(false);
    openUiPanel(els.filterPanel, els.filterBackdrop, els.filterBtn, els.filterClose);
  });
  els.filterClose.addEventListener("click", () => closeUiPanel(els.filterPanel, els.filterBackdrop, els.filterBtn));
  els.filterBackdrop.addEventListener("click", () => closeUiPanel(els.filterPanel, els.filterBackdrop, els.filterBtn));
  els.filterApply.addEventListener("click", () => {
    handlers.onFilterApply(collectFilterDraft(els.filterBody));
    closeUiPanel(els.filterPanel, els.filterBackdrop, els.filterBtn);
  });
  els.filterClear.addEventListener("click", () => {
    handlers.onFilterClear();
    closeUiPanel(els.filterPanel, els.filterBackdrop, els.filterBtn);
  });

  els.resultsBtn.addEventListener("click", () => {
    setResultsOpen(!els.resultsPanel.classList.contains("open"));
  });
  els.resultsClose.addEventListener("click", () => setResultsOpen(false, true));
  els.resultsHandle?.addEventListener("click", () => {
    setResultsOpen(!els.resultsPanel.classList.contains("open"));
  });

  els.accountBtn.addEventListener("click", () => {
    setSearchOpen(false);
    handlers.onAccountOpen();
    openUiPanel(els.accountPanel, els.accountBackdrop, els.accountBtn, els.accountClose);
  });
  els.accountClose?.addEventListener("click", () => closeUiPanel(els.accountPanel, els.accountBackdrop, els.accountBtn));
  els.accountBackdrop?.addEventListener("click", () => closeUiPanel(els.accountPanel, els.accountBackdrop, els.accountBtn));

  let searchTimer;
  els.searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    setActiveSearchOption(-1);
    els.searchInput.setAttribute("aria-busy", "true");
    if (!els.searchInput.value.trim()) setSearchOpen(false);
    searchTimer = setTimeout(() => {
      handlers.onSearch(els.searchInput.value);
    }, 200);
  });
  els.searchInput.addEventListener("focus", () => {
    if (els.searchInput.value.trim() && els.searchDropdown.childElementCount) setSearchOpen(true);
  });
  els.searchInput.addEventListener("keydown", (e) => {
    const options = searchOptions();
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && options.length) {
      e.preventDefault();
      setSearchOpen(true);
      if (e.key === "ArrowDown") {
        setActiveSearchOption(searchActiveIndex < options.length - 1 ? searchActiveIndex + 1 : 0);
      } else {
        setActiveSearchOption(searchActiveIndex > 0 ? searchActiveIndex - 1 : options.length - 1);
      }
    } else if (e.key === "Enter" && searchActiveIndex >= 0) {
      e.preventDefault();
      options[searchActiveIndex]?.click();
    } else if (e.key === "Escape" && els.searchDropdown.classList.contains("open")) {
      e.preventDefault();
      e.stopPropagation();
      setSearchOpen(false);
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".topbar-search")) setSearchOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (els.searchDropdown.classList.contains("open")) {
        e.preventDefault();
        setSearchOpen(false);
      } else if (els.filterPanel.classList.contains("open")) {
        e.preventDefault();
        closeUiPanel(els.filterPanel, els.filterBackdrop, els.filterBtn);
      } else if (els.accountPanel?.classList.contains("open")) {
        e.preventDefault();
        closeUiPanel(els.accountPanel, els.accountBackdrop, els.accountBtn);
      } else if (els.detailCard.classList.contains("open")) {
        e.preventDefault();
        hideDetail({ restoreFocus: true, notify: true });
      } else if (els.resultsPanel.classList.contains("open")) {
        e.preventDefault();
        setResultsOpen(false, true);
      }
      return;
    }

    if (e.key !== "Tab") return;
    const modal = [els.filterPanel, els.accountPanel].find((panel) => panel?.classList.contains("open"));
    if (!modal) return;
    const focusable = [...modal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((el) => !el.hidden && el.getAttribute("aria-hidden") !== "true" && el.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  return {
    els,
    renderFilterPanel(options, filters, hasLocation) {
      const draft = cloneFilters(filters);
      els.filterBody.innerHTML = buildFilterHtml(options, draft, hasLocation);
      wireFilterBody(els.filterBody, draft);
      els.filterBadge.textContent = activeFilterCount(filters) || "";
      els.filterBadge.style.display = activeFilterCount(filters) ? "" : "none";
    },
    renderActiveChips(filters, options) {
      const chips = filterChips(filters, options);
      els.activeFilters.innerHTML = chips
        .map(
          (c) => `
        <span class="filter-chip">
          ${esc(c.label)}
          <button type="button" aria-label="Remove ${esc(c.label)} filter" data-key="${esc(c.key)}" data-value="${esc(c.value || "")}">×</button>
        </span>`
        )
        .join("");
      els.activeFilters.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
          const chip = { key: btn.dataset.key, value: btn.dataset.value || undefined };
          handlers.onFilterChipRemove(chip);
        });
      });
    },
    renderPlaylists(playlists, activePlaylists = new Set()) {
      els.resultsCount.textContent = `${playlists.length} ${playlists.length === 1 ? "playlist" : "playlists"}`;
      els.resultsList.setAttribute("aria-busy", "false");
      if (!playlists.length) {
        els.resultsList.innerHTML = `
          <div class="results-empty" role="status">
            <strong>No playlists yet</strong>
            <span>Connect Spotify and sync your library to see your playlists here.</span>
          </div>`;
        return;
      }

      const blocked = playlists.filter(
        (p) => p.tracksBlocked && p.name !== "Liked Songs" && p.blockReason !== "followed"
      );
      const note = blocked.length
        ? `<p class="filter-note results-note" role="note">${blocked.length} playlist${blocked.length === 1 ? "" : "s"} couldn't load tracks. Try <strong>Exportify &amp; map</strong> again.</p>`
        : "";

      els.resultsList.innerHTML = note + playlists.map((playlist) => {
        const active = activePlaylists.has(playlist.name);
        const meta = playlist.artistCount > 0
          ? `${playlist.artistCount} ${playlist.artistCount === 1 ? "artist" : "artists"} on map`
          : playlist.name === "Liked Songs" && playlist.artistTotal > 0
            ? `${playlist.artistTotal} artists from your library`
          : playlist.artistTotal > 0
            ? `${playlist.artistTotal} artists · none on map yet`
            : playlist.blockReason === "api_restricted"
              ? `${playlist.trackCount ?? "?"} tracks · API limit`
              : playlist.tracksBlocked
                ? `${playlist.trackCount ?? "?"} tracks · can't read track list`
                : playlist.trackCount != null
                  ? `${playlist.trackCount} ${playlist.trackCount === 1 ? "track" : "tracks"}`
                  : "Exportify & map to load artists";
        return `
          <div class="result-item playlist-item" role="listitem">
            <button type="button" class="result-row playlist-row ${active ? "active" : ""}" data-playlist="${esc(playlist.name)}"
              ${active ? 'aria-pressed="true"' : 'aria-pressed="false"'}
              aria-label="Filter map to ${esc(playlist.name)}, ${meta}">
              <span class="result-dot" aria-hidden="true"></span>
              <span class="result-info">
                <span class="result-name">${esc(playlist.name)}</span>
                <span class="result-meta">${meta}</span>
              </span>
            </button>
            ${
              playlist.id
                ? `<a class="playlist-export" href="/api/library/export-csv?playlist_id=${encodeURIComponent(
                    playlist.name === "Liked Songs" || playlist.id === "liked-songs"
                      ? "liked-songs"
                      : playlist.id
                  )}" download title="Download CSV" aria-label="Download CSV for ${esc(playlist.name)}">CSV</a>`
                : ""
            }
          </div>`;
      }).join("");

      const rows = [...els.resultsList.querySelectorAll(".result-row")];
      rows.forEach((row, rowIndex) => {
        row.addEventListener("click", () => handlers.onPlaylistToggle(row.dataset.playlist));
        row.addEventListener("keydown", (e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const nextIndex = e.key === "ArrowDown"
              ? Math.min(rows.length - 1, rowIndex + 1)
              : Math.max(0, rowIndex - 1);
            rows[nextIndex]?.focus();
          } else if (e.key === "Home" || e.key === "End") {
            e.preventDefault();
            rows[e.key === "Home" ? 0 : rows.length - 1]?.focus();
          }
        });
      });
    },
    renderSearchResults(groups) {
      const parts = [];
      let optionIndex = 0;
      const optionId = () => `search-option-${optionIndex++}`;

      if (groups.artists?.length) {
        parts.push(`<div class="search-group" role="group" aria-labelledby="search-group-artists">
          <div class="search-group-title" id="search-group-artists">Artists</div>
          ${groups.artists
            .map(
              (d) => `
          <button type="button" class="search-item" id="${optionId()}" role="option" aria-selected="false" tabindex="-1" data-type="artist" data-id="${esc(d.id)}">
            <span>${esc(d.name)}</span>
            <span class="sub">${esc(d.city)}, ${esc(d.country)}</span>
          </button>`
            )
            .join("")}</div>`);
      }
      if (groups.locations?.length) {
        parts.push(`<div class="search-group" role="group" aria-labelledby="search-group-locations">
          <div class="search-group-title" id="search-group-locations">Locations</div>
          ${groups.locations
            .map(
              (l, i) => `
          <button type="button" class="search-item" id="${optionId()}" role="option" aria-selected="false" tabindex="-1" data-type="location" data-idx="${i}">
            <span>${esc(l.city)}, ${esc(l.country)}</span>
            <span class="sub">${l.count} ${l.count === 1 ? "artist" : "artists"}</span>
          </button>`
            )
            .join("")}</div>`);
      }
      if (groups.playlists?.length) {
        parts.push(`<div class="search-group" role="group" aria-labelledby="search-group-playlists">
          <div class="search-group-title" id="search-group-playlists">Playlists</div>
          ${groups.playlists
            .map(
              (p) => `
          <button type="button" class="search-item" id="${optionId()}" role="option" aria-selected="false" tabindex="-1" data-type="playlist" data-name="${esc(p)}">
            <span>${esc(p)}</span>
          </button>`
            )
            .join("")}</div>`);
      }
      if (groups.genres?.length) {
        parts.push(`<div class="search-group" role="group" aria-labelledby="search-group-genres">
          <div class="search-group-title" id="search-group-genres">Genres</div>
          ${groups.genres
            .map(
              (g) => `
          <button type="button" class="search-item" id="${optionId()}" role="option" aria-selected="false" tabindex="-1" data-type="genre" data-name="${esc(g)}">
            <span>${esc(g)}</span>
          </button>`
            )
            .join("")}</div>`);
      }
      const query = els.searchInput.value.trim();
      els.searchDropdown.innerHTML = parts.join("") ||
        `<div class="search-empty" role="status">No matches for “${esc(query)}”</div>`;
      els.searchInput.setAttribute("aria-busy", "false");
      setActiveSearchOption(-1);
      setSearchOpen(Boolean(query));

      els.searchDropdown.querySelectorAll(".search-item").forEach((btn) => {
        btn.addEventListener("click", () => {
          const type = btn.dataset.type;
          if (type === "artist") {
            const item = groups.artists.find((d) => d.id === btn.dataset.id);
            handlers.onSearchSelect({ type, item });
          } else if (type === "location") {
            const loc = groups.locations[+btn.dataset.idx];
            handlers.onSearchSelect({ type, item: loc });
          } else if (type === "playlist") {
            handlers.onSearchSelect({ type, name: btn.dataset.name });
          } else if (type === "genre") {
            handlers.onSearchSelect({ type, name: btn.dataset.name });
          }
          setSearchOpen(false);
          els.searchInput.focus({ preventScroll: true });
        });
      });
    },
    showDetail(item, index, total, opts = {}) {
      if (!item) {
        hideDetail();
        return;
      }
      if (!els.detailCard.classList.contains("open") && document.activeElement !== document.body) {
        detailReturnFocus = document.activeElement;
      }
      const playlists = (item.playlists || []).slice(0, 4);
      const place = opts.place || `${item.city || "—"}, ${item.country || "—"}`;
      const stacked = opts.mode === "location" && total > 1;
      const navLabel = stacked
        ? `${index + 1} of ${total} here`
        : total > 1
          ? `${index + 1} / ${total}`
          : "";
      els.detailCard.innerHTML = `
        <button type="button" class="icon-btn detail-close" data-detail-close aria-label="Close artist details">×</button>
        <div class="detail-card-body">
          <div class="detail-heading">
            <h3 id="detailTitle">${esc(item.name)}</h3>
            <div class="detail-location">${esc(place)}</div>
            ${navLabel ? `<div class="detail-stack" aria-live="polite">${esc(navLabel)}</div>` : ""}
          </div>
          <div class="detail-stats">
            <div class="detail-stat"><div class="val">${Number(item.plays || 0).toLocaleString()}</div><div class="lbl">Popularity score</div></div>
            <div class="detail-stat"><div class="val">${esc(item.genre)}</div><div class="lbl">Genre</div></div>
          </div>
          <div class="detail-tags" aria-label="Playlists">${playlists.map((p) => `<span class="tag">${esc(p)}</span>`).join("") || '<span class="tag">No playlist data</span>'}</div>
          <div id="detailPlay">${renderDetailPlayback("loading")}</div>
          <div class="detail-nav">
            <button type="button" class="btn ghost" id="detailPrev" ${total <= 1 ? "disabled" : ""}>${stacked ? "Previous artist" : "Previous"}</button>
            <button type="button" class="btn primary" id="detailNext" ${total <= 1 ? "disabled" : ""}>${stacked ? "Next artist" : "Next"}</button>
          </div>
        </div>
      `;
      els.detailCard.classList.add("open");
      els.detailCard.classList.toggle("anchored", opts.mode === "location");
      els.detailCard.setAttribute("aria-hidden", "false");
      els.detailCard.setAttribute("aria-labelledby", "detailTitle");
      els.detailCard.toggleAttribute("inert", false);
      els.detailCard.querySelector("[data-detail-close]")?.addEventListener("click", () => {
        hideDetail({ restoreFocus: true, notify: true });
      });
      els.detailCard.querySelector("#detailPrev")?.addEventListener("click", () => handlers.onDetailNav(-1));
      els.detailCard.querySelector("#detailNext")?.addEventListener("click", () => handlers.onDetailNav(1));
      const token = ++detailPlaybackToken;
      handlers.onDetailOpen?.(item, token);
    },
    setDetailPlayback(status, track, token = detailPlaybackToken, opts = {}) {
      if (token !== detailPlaybackToken) return;
      const mount = els.detailCard.querySelector("#detailPlay");
      if (!mount) return;
      mount.innerHTML = renderDetailPlayback(status, track, opts);
      wireDetailPlayback();
    },
    positionDetail(x, y) {
      if (window.innerWidth <= 768) return;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const card = els.detailCard;
      const width = card.offsetWidth || 340;
      const height = Math.min(card.offsetHeight || 320, window.innerHeight - 24);
      const margin = 12;
      let left = x + 18;
      let top = y - 28;
      if (left + width > window.innerWidth - margin) left = x - width - 18;
      if (left < margin) left = margin;
      if (top + height > window.innerHeight - margin) {
        top = window.innerHeight - height - margin;
      }
      if (top < margin) top = margin;
      card.style.left = `${Math.round(left)}px`;
      card.style.top = `${Math.round(top)}px`;
      card.classList.add("anchored");
    },
    showTooltip(hit, item) {
      if (!item || hit?.type === "cluster") {
        if (hit?.type === "cluster") {
          els.tip.innerHTML = `<div class="a">${hit.data.count} artists</div><div class="c">Click to zoom in</div>`;
          els.tip.style.left = hit.data._x + "px";
          els.tip.style.top = hit.data._y + "px";
          els.tip.style.opacity = 1;
        } else {
          els.tip.style.opacity = 0;
        }
        return;
      }
      const stackCount = Number(hit?.stackCount) || hit?.group?.length || 1;
      const stackLine =
        stackCount > 1
          ? `<div class="g">${stackCount} artists at this spot · click to browse</div>`
          : `<div class="g">${esc(item.genre)} · ${Number(item.plays || 0).toLocaleString()} popularity</div>`;
      els.tip.innerHTML = `<div class="a">${esc(item.name)}</div>
        <div class="c">${esc(item.city)}, ${esc(item.country)}</div>
        ${stackLine}`;
      els.tip.style.left = item._x + "px";
      els.tip.style.top = item._y + "px";
      els.tip.style.opacity = 1;
    },
    hideTooltip() {
      els.tip.style.opacity = 0;
    },
    setStatus(text) {
      els.statusPill.textContent = text;
    },
    setViewHint(globe, map, t) {
      if (globe) els.viewHint.textContent = "Drag to spin · Scroll to zoom";
      else if (map) els.viewHint.textContent = "Drag to pan · Scroll to zoom";
      else els.viewHint.textContent = "Transitioning to map view…";
    },
    setScale(km, px) {
      const width = Math.min(120, Math.max(40, px));
      els.scaleLine.style.width = width + "px";
      els.scaleBar.querySelector(".scale-label").textContent =
        km >= 1000 ? `${(km / 1000).toFixed(0)}k km` : km >= 1 ? `${km.toFixed(0)} km` : `${(km * 1000).toFixed(0)} m`;
    },
    setStyleActive(style) {
      document.body.classList.toggle("map-style-satellite", style === "satellite");
      if (style !== "satellite") document.body.classList.remove("map-zoom-flat");
      els.styleSelector.querySelectorAll(".style-thumb").forEach((b) => {
        b.setAttribute("aria-pressed", b.dataset.style === style ? "true" : "false");
      });
    },
    setSearchQuery(q) {
      els.searchInput.value = q || "";
    },
    setSort(sortId, hasLocation) {
      els.sortSelect.value = sortId;
      els.sortSelect.querySelectorAll("[data-needs-loc]").forEach((o) => {
        o.disabled = !hasLocation;
      });
    },
  };
}

function cloneFilters(f) {
  const base = defaultFilters();
  const o = { ...base, ...f };
  for (const k of Object.keys(base)) {
    if (base[k] instanceof Set) {
      o[k] = new Set(f?.[k] || []);
    }
  }
  return o;
}

function hasAdvancedFilters(draft) {
  return (
    draft.cities.size > 0
    || draft.artists.size > 0
    || draft.csvGenres?.size > 0
    || draft.albums?.size > 0
    || draft.labels?.size > 0
    || draft.trackNames?.size > 0
    || draft.addedBy?.size > 0
    || draft.modes?.size > 0
    || draft.keys?.size > 0
    || draft.timeSignatures?.size > 0
    || draft.trackPopMin != null
    || draft.trackPopMax != null
    || draft.durationMin != null
    || draft.durationMax != null
    || draft.addedYearMin != null
    || draft.addedYearMax != null
    || draft.danceabilityMin != null
    || draft.energyMin != null
    || draft.valenceMin != null
    || draft.acousticnessMin != null
    || draft.instrumentalnessMin != null
    || draft.speechinessMin != null
    || draft.livenessMin != null
    || draft.tempoMin != null
    || draft.loudnessMin != null
    || draft.radiusCenterKm != null
    || draft.radiusUserKm != null
    || draft.visibleOnly
    || draft.hideIncomplete
    || draft.multiLocation
    || !draft.showClusters
    || !draft.showMarkers
    || draft.showHeatmap
  );
}

function countSet(set) {
  return set?.size || 0;
}

function advancedActiveCount(draft) {
  let n = 0;
  n += countSet(draft.cities);
  n += countSet(draft.artists);
  n += countSet(draft.csvGenres);
  n += countSet(draft.albums);
  n += countSet(draft.labels);
  n += countSet(draft.trackNames);
  n += countSet(draft.addedBy);
  n += countSet(draft.modes);
  n += countSet(draft.keys);
  n += countSet(draft.timeSignatures);
  for (const k of [
    "trackPopMin",
    "trackPopMax",
    "durationMin",
    "durationMax",
    "addedYearMin",
    "addedYearMax",
    "danceabilityMin",
    "energyMin",
    "valenceMin",
    "acousticnessMin",
    "instrumentalnessMin",
    "speechinessMin",
    "livenessMin",
    "tempoMin",
    "loudnessMin",
    "radiusCenterKm",
    "radiusUserKm",
  ]) {
    if (draft[k] != null) n += 1;
  }
  if (draft.visibleOnly) n += 1;
  if (draft.hideIncomplete) n += 1;
  if (draft.multiLocation) n += 1;
  if (!draft.showClusters) n += 1;
  if (!draft.showMarkers) n += 1;
  if (draft.showHeatmap) n += 1;
  return n;
}

function buildAdvancedFilterHtml(options, draft, hasLocation) {
  const audioBounds = options.audioBounds || {};
  const blocks = [];

  blocks.push(accordion("Place & distance", [
    multiSelect("cities", "City", options.cities, draft.cities, { compact: true }),
    rangeField("radiusCenterKm", "Radius from map center (km)", draft.radiusCenterKm, 50, 5000, 500),
    hasLocation
      ? rangeField("radiusUserKm", "Radius from your location (km)", draft.radiusUserKm, 50, 5000, 500)
      : `<p class="filter-note">Enable location access to filter by distance from you.</p>`,
    toggleRow([
      ["visibleOnly", "Visible map area only", draft.visibleOnly],
      ["hideIncomplete", "Hide incomplete locations", draft.hideIncomplete],
      ["multiLocation", "Only multi-artist locations", draft.multiLocation],
    ]),
    unavailableNote("region", FILTER_META.region),
  ]));

  blocks.push(accordion("Catalog details", [
    multiSelect("artists", "Artist", options.artists, draft.artists, { compact: true }),
    options.csvGenres?.length
      ? pillSelect("csvGenres", "Genre (CSV)", options.csvGenres, draft.csvGenres)
      : `<p class="filter-note">CSV genres appear after Exportify &amp; map / CSV import.</p>`,
    options.albums?.length
      ? multiSelect("albums", "Album", options.albums, draft.albums, { compact: true })
      : `<p class="filter-note">Albums appear after Exportify pull/import.</p>`,
    options.trackNames?.length
      ? multiSelect("trackNames", "Track name", options.trackNames, draft.trackNames, { compact: true })
      : "",
    options.labels?.length
      ? multiSelect("labels", "Record label", options.labels, draft.labels, { compact: true })
      : `<p class="filter-note">Record labels need a full Exportify CSV with enrichment.</p>`,
    options.addedBy?.length
      ? multiSelect("addedBy", "Added by", options.addedBy, draft.addedBy, { compact: true })
      : "",
    dualRange(
      "trackPop",
      "Track popularity",
      draft.trackPopMin,
      draft.trackPopMax,
      options.trackPopMin,
      options.trackPopMax,
      1
    ),
    dualRange(
      "duration",
      "Avg duration (ms)",
      draft.durationMin,
      draft.durationMax,
      options.durationMin,
      options.durationMax,
      1000
    ),
    dualRange(
      "addedYear",
      "Date added (year)",
      draft.addedYearMin,
      draft.addedYearMax,
      options.addedYearMin,
      options.addedYearMax,
      1
    ),
  ]));

  const audioControls = AUDIO_FEATURE_FILTERS.map((feature) => {
    const bounds = audioBounds[feature.key];
    if (!bounds || !Number.isFinite(bounds.min)) return null;
    const minKey = `${feature.key}Min`;
    return rangeField(
      minKey,
      `${feature.label} (minimum)`,
      draft[minKey],
      feature.min,
      feature.max,
      feature.step
    );
  }).filter(Boolean);

  blocks.push(accordion("Audio & theory", [
    audioControls.length
      ? audioControls.join("")
      : `<p class="filter-note">Audio features need a full Exportify CSV (with audio enrichment).</p>`,
    options.modes?.length
      ? pillSelect("modes", "Mode", options.modes, draft.modes)
      : "",
    options.keys?.length
      ? pillSelect("keys", "Key", options.keys, draft.keys)
      : "",
    options.timeSignatures?.length
      ? pillSelect("timeSignatures", "Time signature", options.timeSignatures, draft.timeSignatures)
      : "",
  ]));

  blocks.push(accordion("Map display", [
    toggleRow([
      ["showMarkers", "Individual markers", draft.showMarkers],
      ["showClusters", "Clustered markers", draft.showClusters],
      ["showHeatmap", "Heatmap overlay", draft.showHeatmap],
    ]),
  ]));

  return blocks.join("");
}

function buildFilterHtml(options, draft, hasLocation) {
  const advancedOpen = hasAdvancedFilters(draft);
  const advancedCount = advancedActiveCount(draft);

  return `
    <div class="filter-basic">
      ${section("Playlists", [
        multiSelect("playlists", null, options.playlists, draft.playlists, { primary: true }),
        `<p class="filter-note">Pick playlists to show only their artists on the map.</p>`,
      ])}
      ${section("Genre", [
        options.genres?.length
          ? pillSelect("genres", null, options.genres, draft.genres)
          : `<p class="filter-note">Genres appear after you map artists.</p>`,
      ])}
      ${section("Country", [
        options.countries?.length
          ? (options.countries.length <= 20
              ? pillSelect("countries", null, options.countries, draft.countries)
              : multiSelect("countries", null, options.countries, draft.countries, { compact: true }))
          : `<p class="filter-note">Countries appear after you map artists.</p>`,
      ])}
      ${section("Quick filters", [
        toggleRow([
          ["savedOnly", "Liked / saved songs only", draft.savedOnly],
        ]),
        explicitSelect(draft.explicit),
        popularityRange(draft, options),
        dualRange(
          "releaseYear",
          "Release year",
          draft.releaseYearMin,
          draft.releaseYearMax,
          options.releaseYearMin,
          options.releaseYearMax,
          1
        ),
      ])}
    </div>
    <details class="filter-advanced" ${advancedOpen ? "open" : ""}>
      <summary>
        <span class="filter-advanced-title">More filters</span>
        ${advancedCount
          ? `<span class="filter-advanced-count">${advancedCount} active</span>`
          : `<span class="filter-advanced-hint">City, audio, albums…</span>`}
      </summary>
      <div class="filter-advanced-body">
        ${buildAdvancedFilterHtml(options, draft, hasLocation)}
      </div>
    </details>`;
}

function section(title, content) {
  const body = content.filter(Boolean).join("");
  return `<div class="filter-section"><h3>${esc(title)}</h3>${body}</div>`;
}

function accordion(title, content) {
  const body = content.filter(Boolean).join("");
  return `
    <details class="filter-sub">
      <summary>${esc(title)}</summary>
      <div class="filter-sub-body">${body}</div>
    </details>`;
}

function multiSelect(key, label, values, selected, { primary = false, compact = false } = {}) {
  const id = `f-${key}`;
  const list = values || [];
  const labelHtml = label
    ? `<label class="filter-option filter-field-cap" for="${id}-search">${esc(label)}</label>`
    : "";
  return `
    ${labelHtml}
    <input class="filter-search" id="${id}-search" type="search" placeholder="Search ${esc((label || key).toLowerCase())}…" data-filter-search="${key}">
    <div class="filter-options ${primary ? "filter-options-primary" : ""} ${compact ? "filter-options-compact" : ""}" data-filter-list="${key}">
      ${list
        .slice(0, primary ? 120 : 80)
        .map(
          (v) => `
        <label class="filter-option">
          <input type="checkbox" data-filter="${key}" value="${esc(v)}" ${(selected || new Set()).has(v) ? "checked" : ""}>
          <span>${esc(v)}</span>
        </label>`
        )
        .join("")}
      ${!list.length ? `<p class="filter-note">Nothing to choose yet.</p>` : ""}
    </div>`;
}

function pillSelect(key, label, values, selected) {
  const list = values || [];
  const labelHtml = label
    ? `<div class="filter-field-cap">${esc(label)}</div>`
    : "";
  return `
    ${labelHtml}
    <div class="filter-pills" data-filter-list="${key}">
      ${list
        .slice(0, 48)
        .map(
          (v) => `
        <label class="filter-pill">
          <input type="checkbox" data-filter="${key}" value="${esc(v)}" ${(selected || new Set()).has(v) ? "checked" : ""}>
          <span>${esc(v)}</span>
        </label>`
        )
        .join("")}
    </div>`;
}

function toggleRow(items) {
  return `<div class="filter-toggle-row">${items
    .map(([key, label, on]) => toggle(key, label, on))
    .join("")}</div>`;
}

function rangeField(key, label, val, min, max, step) {
  return `
    <div class="filter-range-block">
      <div class="filter-field-cap">${esc(label)} · <span data-range-label="${key}">${val ?? "off"}</span></div>
      <div class="filter-range">
        <input type="range" min="${min}" max="${max}" step="${step}" value="${val ?? min}" data-range="${key}">
        <button type="button" class="btn ghost filter-range-clear" data-range-clear="${key}">Clear</button>
      </div>
    </div>`;
}

function popularityRange(draft, options) {
  const minimum = draft.playsMin ?? options.playsMin;
  const maximum = draft.playsMax ?? options.playsMax;
  const isUnbounded = draft.playsMin == null && draft.playsMax == null;
  return `
    <div class="filter-range-block">
      <div class="filter-field-cap">Library popularity</div>
      <div class="filter-range filter-range-dual">
        <input type="range" aria-label="Minimum popularity" min="${options.playsMin}" max="${options.playsMax}" value="${minimum}" data-plays="min">
        <input type="range" aria-label="Maximum popularity" min="${options.playsMin}" max="${options.playsMax}" value="${maximum}" data-plays="max">
      </div>
      <p class="filter-note" data-plays-label>${isUnbounded ? "Any popularity" : `${minimum} – ${maximum}`}</p>
    </div>`;
}

function dualRange(prefix, label, draftMin, draftMax, optMin, optMax, step = 1) {
  if (!Number.isFinite(optMin) || !Number.isFinite(optMax) || optMin === optMax) {
    return `<p class="filter-note">${esc(label)}: no data yet.</p>`;
  }
  const minimum = draftMin ?? optMin;
  const maximum = draftMax ?? optMax;
  const isUnbounded = draftMin == null && draftMax == null;
  return `
    <div class="filter-range-block">
      <div class="filter-field-cap">${esc(label)}</div>
      <div class="filter-range filter-range-dual">
        <input type="range" aria-label="Minimum ${esc(label)}" min="${optMin}" max="${optMax}" step="${step}" value="${minimum}" data-dual="${prefix}" data-dual-bound="min">
        <input type="range" aria-label="Maximum ${esc(label)}" min="${optMin}" max="${optMax}" step="${step}" value="${maximum}" data-dual="${prefix}" data-dual-bound="max">
      </div>
      <p class="filter-note" data-dual-label="${prefix}">${isUnbounded ? "Any" : `${minimum} – ${maximum}`}</p>
    </div>`;
}

function explicitSelect(value) {
  const v = value || "any";
  return `
    <div class="filter-range-block">
      <label class="filter-field-cap" for="f-explicit">Explicit content</label>
      <div class="filter-seg" role="group" aria-label="Explicit content">
        <label class="filter-seg-opt"><input type="radio" name="explicit" data-select="explicit" value="any" ${v === "any" ? "checked" : ""}><span>Any</span></label>
        <label class="filter-seg-opt"><input type="radio" name="explicit" data-select="explicit" value="explicit" ${v === "explicit" ? "checked" : ""}><span>Explicit</span></label>
        <label class="filter-seg-opt"><input type="radio" name="explicit" data-select="explicit" value="clean" ${v === "clean" ? "checked" : ""}><span>Clean</span></label>
      </div>
    </div>`;
}

function toggle(key, label, on) {
  return `
    <label class="filter-toggle">
      <input type="checkbox" data-toggle="${key}" ${on ? "checked" : ""}>
      <span class="filter-toggle-ui" aria-hidden="true"></span>
      <span class="filter-toggle-label">${esc(label)}</span>
    </label>`;
}

function unavailableNote(key, meta) {
  if (meta.available !== false) return "";
  return `<p class="filter-note filter-option disabled">${esc(meta.label)}: ${esc(meta.reason || "Not available")}</p>`;
}

function wireDualRange(body, prefix) {
  const minInp = body.querySelector(`[data-dual="${prefix}"][data-dual-bound="min"]`);
  const maxInp = body.querySelector(`[data-dual="${prefix}"][data-dual-bound="max"]`);
  const label = body.querySelector(`[data-dual-label="${prefix}"]`);
  if (!minInp || !maxInp || !label) return;
  const update = (changed) => {
    if (+minInp.value > +maxInp.value) {
      if (changed === minInp) maxInp.value = minInp.value;
      else minInp.value = maxInp.value;
    }
    label.textContent = `${minInp.value} – ${maxInp.value}`;
  };
  minInp.addEventListener("input", () => update(minInp));
  maxInp.addEventListener("input", () => update(maxInp));
}

function wireFilterBody(body, draft) {
  body.querySelectorAll("[data-filter]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const k = inp.dataset.filter;
      if (!(draft[k] instanceof Set)) draft[k] = new Set();
      if (inp.checked) draft[k].add(inp.value);
      else draft[k].delete(inp.value);
    });
  });
  body.querySelectorAll("[data-toggle]").forEach((inp) => {
    inp.addEventListener("change", () => {
      draft[inp.dataset.toggle] = inp.checked;
    });
  });
  body.querySelectorAll("[data-select]").forEach((inp) => {
    inp.addEventListener("change", () => {
      draft[inp.dataset.select] = inp.value;
    });
  });
  body.querySelectorAll("[data-range]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const k = inp.dataset.range;
      draft[k] = +inp.value;
      body.querySelector(`[data-range-label="${k}"]`).textContent = inp.value;
    });
  });
  body.querySelectorAll("[data-range-clear]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.rangeClear;
      draft[k] = null;
      body.querySelector(`[data-range-label="${k}"]`).textContent = "off";
    });
  });
  body.querySelectorAll("[data-filter-search]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const key = inp.dataset.filterSearch;
      const q = inp.value.toLowerCase();
      body
        .querySelectorAll(`[data-filter-list="${key}"] .filter-option, [data-filter-list="${key}"] .filter-pill`)
        .forEach((row) => {
          const text = row.textContent.toLowerCase();
          row.style.display = text.includes(q) ? "" : "none";
        });
    });
  });
  const popularityMin = body.querySelector("[data-plays=min]");
  const popularityMax = body.querySelector("[data-plays=max]");
  const popularityLabel = body.querySelector("[data-plays-label]");
  const updatePopularity = (changed) => {
    if (!popularityMin || !popularityMax || !popularityLabel) return;
    if (+popularityMin.value > +popularityMax.value) {
      if (changed === popularityMin) popularityMax.value = popularityMin.value;
      else popularityMin.value = popularityMax.value;
    }
    popularityLabel.textContent = `${popularityMin.value} – ${popularityMax.value}`;
  };
  popularityMin?.addEventListener("input", () => updatePopularity(popularityMin));
  popularityMax?.addEventListener("input", () => updatePopularity(popularityMax));

  for (const prefix of ["trackPop", "releaseYear", "duration", "addedYear"]) {
    wireDualRange(body, prefix);
  }
}

function collectDual(body, prefix, minKey, maxKey, draft) {
  const minInp = body.querySelector(`[data-dual="${prefix}"][data-dual-bound="min"]`);
  const maxInp = body.querySelector(`[data-dual="${prefix}"][data-dual-bound="max"]`);
  if (!minInp || !maxInp) return;
  if (+minInp.value > +minInp.min) draft[minKey] = +minInp.value;
  if (+maxInp.value < +maxInp.max) draft[maxKey] = +maxInp.value;
}

function collectFilterDraft(body) {
  const draft = defaultFilters();
  body.querySelectorAll("[data-filter]:checked").forEach((inp) => {
    const k = inp.dataset.filter;
    if (!(draft[k] instanceof Set)) draft[k] = new Set();
    draft[k].add(inp.value);
  });
  body.querySelectorAll("[data-toggle]").forEach((inp) => {
    draft[inp.dataset.toggle] = inp.checked;
  });
  body.querySelectorAll("[data-select]").forEach((inp) => {
    if (inp.type === "radio" && !inp.checked) return;
    draft[inp.dataset.select] = inp.value;
  });
  body.querySelectorAll("[data-range]").forEach((inp) => {
    const k = inp.dataset.range;
    const label = body.querySelector(`[data-range-label="${k}"]`)?.textContent;
    if (label !== "off") draft[k] = +inp.value;
  });
  const pMin = body.querySelector("[data-plays=min]");
  const pMax = body.querySelector("[data-plays=max]");
  if (pMin && +pMin.value > +pMin.min) draft.playsMin = +pMin.value;
  if (pMax && +pMax.value < +pMax.max) draft.playsMax = +pMax.value;
  collectDual(body, "trackPop", "trackPopMin", "trackPopMax", draft);
  collectDual(body, "releaseYear", "releaseYearMin", "releaseYearMax", draft);
  collectDual(body, "duration", "durationMin", "durationMax", draft);
  collectDual(body, "addedYear", "addedYearMin", "addedYearMax", draft);
  return draft;
}

export { removeFilterChip };
