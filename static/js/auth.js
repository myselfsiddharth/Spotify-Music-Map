import { CACHE_KEY } from "./config.js";
import { getData, setPlaylists } from "./data-store.js";

const RATE_LIMIT_KEY = "sonic_cart_rate_limit_until";

export function createAuth(handlers) {
  const els = {
    overlay: document.getElementById("loginOverlay"),
    overlayLoginBtn: document.getElementById("overlayLoginBtn"),
    loginError: document.getElementById("loginError"),
    syncProgress: document.getElementById("syncProgress"),
    authStatus: document.getElementById("authStatus"),
    loginBtn: document.getElementById("spotifyLoginBtn"),
    syncBtn: document.getElementById("spotifySyncBtn"),
    pullBtn: document.getElementById("spotifyPullBtn"),
    logoutBtn: document.getElementById("spotifyLogoutBtn"),
    accountBtn: document.getElementById("accountBtn"),
    accountPanel: document.getElementById("accountPanel"),
    accountBackdrop: document.getElementById("accountBackdrop"),
    accountClose: document.getElementById("accountClose"),
    arcSw: document.getElementById("arcSw"),
    spinSw: document.getElementById("spinSw"),
    fileInput: document.getElementById("fileInput"),
    csvInput: document.getElementById("csvInput"),
    csvImportStatus: document.getElementById("csvImportStatus"),
    overlayCsvInput: document.getElementById("overlayCsvInput"),
  };

  const backgroundInertState = new Map();
  const wiredSwitches = new WeakSet();
  let accountTrigger = null;
  let overlayHideTimer = null;

  function renderOverlayAction(label, icon = "music-2") {
    if (!els.overlayLoginBtn) return;
    const iconNode = document.createElement("i");
    iconNode.setAttribute("data-lucide", icon);
    iconNode.setAttribute("aria-hidden", "true");
    const textNode = document.createElement("span");
    textNode.textContent = label;
    els.overlayLoginBtn.replaceChildren(iconNode, textNode);
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.9 } });
  }

  function setInert(element, inert) {
    if (!element) return;
    element.inert = inert;
    element.toggleAttribute("inert", inert);
  }

  function setBackgroundInert(inert) {
    if (inert) {
      Array.from(document.body.children).forEach((child) => {
        if (child === els.overlay || backgroundInertState.has(child)) return;
        backgroundInertState.set(child, child.inert || child.hasAttribute("inert"));
        setInert(child, true);
      });
      return;
    }

    backgroundInertState.forEach((wasInert, child) => setInert(child, wasInert));
    backgroundInertState.clear();
  }

  function focusLoginOverlay() {
    const loginButtonVisible =
      els.overlayLoginBtn &&
      !els.overlayLoginBtn.disabled &&
      els.overlayLoginBtn.style.display !== "none";
    (loginButtonVisible ? els.overlayLoginBtn : els.overlay)?.focus({ preventScroll: true });
  }

  function setOverlayVisible(visible, { focus = false, animate = true } = {}) {
    if (!els.overlay) return;
    window.clearTimeout(overlayHideTimer);

    if (visible) {
      els.overlay.hidden = false;
      setInert(els.overlay, false);
      setBackgroundInert(true);
      els.overlay.setAttribute("aria-hidden", "false");
      els.overlay.style.pointerEvents = "auto";

      const reveal = () => els.overlay.classList.remove("hidden");
      if (animate) window.requestAnimationFrame(reveal);
      else reveal();

      if (focus) window.requestAnimationFrame(focusLoginOverlay);
      return;
    }

    setBackgroundInert(false);
    if (els.overlay.contains(document.activeElement)) {
      document.getElementById("searchInput")?.focus({ preventScroll: true });
    }
    els.overlay.classList.add("hidden");
    els.overlay.setAttribute("aria-hidden", "true");
    els.overlay.style.pointerEvents = "none";
    setInert(els.overlay, true);

    if (animate) {
      overlayHideTimer = window.setTimeout(() => {
        if (els.overlay.classList.contains("hidden")) els.overlay.hidden = true;
      }, 450);
    } else {
      els.overlay.hidden = true;
    }
  }

  function resetOverlayPrompt() {
    els.overlayLoginBtn.style.display = "";
    els.overlayLoginBtn.disabled = false;
    renderOverlayAction("Connect with Spotify");
    els.syncProgress.style.display = "none";
  }

  function accountIsOpen() {
    return !!els.accountPanel?.classList.contains("open");
  }

  function getAccountFocusableElements() {
    if (!els.accountPanel) return [];
    const selector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled]):not([type='hidden'])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    return Array.from(els.accountPanel.querySelectorAll(selector)).filter((element) => {
      const style = window.getComputedStyle(element);
      return !element.hidden && style.display !== "none" && style.visibility !== "hidden";
    });
  }

  function closeAccount({ restoreFocus = true } = {}) {
    if (!els.accountPanel) return;
    els.accountPanel.classList.remove("open");
    els.accountBackdrop?.classList.remove("open");
    els.accountPanel.setAttribute("aria-hidden", "true");
    els.accountBackdrop?.setAttribute("aria-hidden", "true");
    els.accountBtn?.setAttribute("aria-expanded", "false");
    setInert(els.accountPanel, true);

    if (restoreFocus) {
      const target = accountTrigger?.isConnected ? accountTrigger : els.accountBtn;
      target?.focus({ preventScroll: true });
    }
    accountTrigger = null;
  }

  function openAccount() {
    if (!els.accountPanel || accountIsOpen()) return;
    if (els.overlay && els.overlay.getAttribute("aria-hidden") !== "true") {
      focusLoginOverlay();
      return;
    }

    accountTrigger = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : els.accountBtn;
    els.accountPanel.hidden = false;
    setInert(els.accountPanel, false);
    els.accountPanel.setAttribute("aria-hidden", "false");
    els.accountBackdrop?.setAttribute("aria-hidden", "false");
    els.accountPanel.classList.add("open");
    els.accountBackdrop?.classList.add("open");
    els.accountBtn?.setAttribute("aria-expanded", "true");

    window.requestAnimationFrame(() => {
      if (!accountIsOpen()) return;
      (els.accountClose || getAccountFocusableElements()[0] || els.accountPanel).focus({
        preventScroll: true,
      });
    });
  }

  function handleAccountKeydown(event) {
    if (!accountIsOpen()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeAccount();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = getAccountFocusableElements();
    if (!focusable.length) {
      event.preventDefault();
      els.accountPanel.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!els.accountPanel.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function setSwitchState(element, on) {
    element.classList.toggle("on", on);
    element.setAttribute("aria-checked", String(on));
  }

  function wireSwitch(element, onChange) {
    if (!element || wiredSwitches.has(element)) return;
    wiredSwitches.add(element);

    element.setAttribute("role", "switch");
    if (!element.hasAttribute("tabindex")) element.tabIndex = 0;
    if (!element.hasAttribute("aria-label")) {
      const label = element.closest(".switchrow")?.querySelector("span")?.textContent?.trim();
      if (label) element.setAttribute("aria-label", label);
    }
    setSwitchState(
      element,
      element.classList.contains("on") || element.getAttribute("aria-checked") === "true"
    );

    const activate = () => {
      const on = element.getAttribute("aria-checked") !== "true";
      setSwitchState(element, on);
      onChange(on);
    };
    element.addEventListener("click", activate);
    element.addEventListener("keydown", (event) => {
      if ((event.key === " " || event.key === "Enter") && !event.repeat) {
        event.preventDefault();
        activate();
      }
    });
  }

  function unlockUi() {
    setOverlayVisible(false);
  }

  function lockUi() {
    closeAccount({ restoreFocus: false });
    resetOverlayPrompt();
    setOverlayVisible(true, { focus: true });
  }

  function setAuthUi(authenticated, name = "", { rateLimited = false } = {}) {
    if (authenticated) {
      els.authStatus.textContent = rateLimited
        ? `Connected as ${name || "Spotify user"} · Spotify rate limit (sync later)`
        : `Connected as ${name || "Spotify user"}`;
      els.loginBtn.style.display = "none";
      els.syncBtn.style.display = "";
      if (els.pullBtn) els.pullBtn.style.display = "";
      els.logoutBtn.style.display = "";
      unlockUi();
    } else {
      els.authStatus.textContent = "Not connected";
      els.loginBtn.style.display = "";
      els.syncBtn.style.display = "none";
      if (els.pullBtn) els.pullBtn.style.display = "none";
      els.logoutBtn.style.display = "none";
      lockUi();
    }
  }

  async function checkAuth() {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) {
        setAuthUi(false);
        return false;
      }
      const me = await res.json();
      if (!me.authenticated) {
        setAuthUi(false);
        return false;
      }
      setAuthUi(true, me.display_name, { rateLimited: !!me.rate_limited });
      return true;
    } catch {
      setAuthUi(false);
      return false;
    }
  }

  async function fetchPlaylists() {
    try {
      const res = await fetch("/api/library/playlists");
      if (!res.ok) return 0;
      const payload = await res.json();
      const list = payload.playlists || [];
      if (!list.length) return 0;
      setPlaylists(list);
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const items = Array.isArray(parsed) ? parsed : parsed.items || [];
        const playlistArtists = Array.isArray(parsed) ? {} : parsed.playlistArtists || {};
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ items, playlists: list, playlistArtists })
        );
      } catch {
        /* ignore */
      }
      return list.length;
    } catch {
      return 0;
    }
  }

  function rateLimitUntil() {
    try {
      return Number(localStorage.getItem(RATE_LIMIT_KEY) || 0) || 0;
    } catch {
      return 0;
    }
  }

  function setRateLimitCooldown(seconds) {
    const wait = Math.max(60, Number(seconds) || 3600);
    try {
      localStorage.setItem(RATE_LIMIT_KEY, String(Date.now() + wait * 1000));
    } catch {
      /* ignore */
    }
    return wait;
  }

  function clearRateLimitCooldown() {
    try {
      localStorage.removeItem(RATE_LIMIT_KEY);
    } catch {
      /* ignore */
    }
  }

  function formatWait(seconds) {
    const mins = Math.max(1, Math.ceil(Number(seconds || 0) / 60));
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      const rem = mins % 60;
      return rem ? `${hours}h ${rem}m` : `${hours}h`;
    }
    return `${mins} min`;
  }

  function isInRateLimitCooldown() {
    return Date.now() < rateLimitUntil();
  }

  function syncStatusMessage(payload) {
    const meta = payload?.meta || {};
    const resolved = meta.resolved ?? (payload.items || []).length;
    if (meta.from_cache && meta.rate_limited) {
      const wait = meta.retry_after_seconds
        ? formatWait(meta.retry_after_seconds)
        : formatWait(Math.max(0, (rateLimitUntil() - Date.now()) / 1000));
      return `Showing ${resolved} cached artists · Spotify rate limit (~${wait})`;
    }
    if (meta.from_cache) {
      return `Showing ${resolved} cached artists`;
    }
    if (meta.rate_limited && resolved > 0) {
      return `Synced ${resolved} artists · Spotify rate limit hit mid-sync`;
    }
    return `Synced ${resolved} mapped artists`;
  }

  async function doSync(silent, { force = false } = {}) {
    if (!force && isInRateLimitCooldown()) {
      const wait = formatWait((rateLimitUntil() - Date.now()) / 1000);
      const had = loadCached();
      unlockUi();
      els.authStatus.textContent = had
        ? `Cached map loaded · Spotify rate limit (~${wait}). Sync later.`
        : `Spotify rate limit (~${wait}). Try Sync again later.`;
      if (!silent) {
        els.syncProgress.style.display = "";
        els.syncProgress.textContent = `Spotify is rate-limiting this app. Wait about ${wait}, then sync again.`;
      }
      return getData().length;
    }

    if (!silent) {
      els.overlayLoginBtn.style.display = "none";
      els.loginError.style.display = "none";
      els.syncProgress.style.display = "";
      els.syncProgress.textContent = "Syncing your library\u2026 this can take a few minutes.";
    }
    els.syncBtn.disabled = true;
    els.syncBtn.setAttribute("aria-busy", "true");
    els.authStatus.textContent = "Syncing library and resolving origins\u2026";
    try {
      const res = await fetch("/api/library/sync?max_artists=120", { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (payload.rate_limited) {
          setRateLimitCooldown(payload.retry_after_seconds || 3600);
        }
        const wait = formatWait(payload.retry_after_seconds || 3600);
        const msg = payload.rate_limited
          ? `Spotify rate limit — wait ~${wait}, then Sync again.`
          : payload.error || "Sync failed";
        throw new Error(msg);
      }

      const items = payload.items || [];
      const meta = payload.meta || {};
      if (meta.rate_limited || meta.from_cache) {
        setRateLimitCooldown(meta.retry_after_seconds || 1800);
      } else if (items.length) {
        clearRateLimitCooldown();
      }

      // Never wipe a populated map with an empty Spotify failure response
      if (!items.length && getData().length) {
        els.authStatus.textContent =
          "Spotify returned no artists (often rate limit). Keeping your current map.";
        unlockUi();
        els.syncProgress.style.display = "none";
        return getData().length;
      }

      const count = handlers.onDataLoaded(
        items,
        payload.playlists || [],
        payload.playlistArtists || null
      );
      if (items.length) {
        try {
          localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
              items,
              playlists: payload.playlists || [],
              playlistArtists: payload.playlistArtists || {},
            })
          );
        } catch {
          /* ignore */
        }
      }
      els.authStatus.textContent = syncStatusMessage(payload);
      unlockUi();
      els.syncProgress.style.display = "none";
      return count;
    } catch (err) {
      const rateLimited = /rate limit/i.test(err.message);
      loadCached();
      if (rateLimited) {
        unlockUi();
        if (!silent) {
          els.syncProgress.style.display = "";
          els.syncProgress.textContent = err.message;
        }
      } else if (!silent) {
        els.syncProgress.textContent = `Sync error: ${err.message}`;
        els.overlayLoginBtn.style.display = "";
        els.overlayLoginBtn.disabled = false;
        renderOverlayAction("Connect with Spotify");
      }
      els.authStatus.textContent = rateLimited
        ? `Connected · ${err.message}`
        : `Sync error: ${err.message}`;
      return getData().length;
    } finally {
      els.syncBtn.disabled = false;
      els.syncBtn.removeAttribute("aria-busy");
    }
  }

  function loadCached() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : parsed.items || [];
      const playlistList = Array.isArray(parsed) ? [] : parsed.playlists || [];
      const playlistArtistMap = Array.isArray(parsed) ? null : parsed.playlistArtists || null;
      if (!items.length && !playlistList.length) return false;
      handlers.onDataLoaded(items, playlistList, playlistArtistMap);
      return true;
    } catch {
      return false;
    }
  }

  els.overlayLoginBtn?.addEventListener("click", () => {
    if (!els.overlayLoginBtn) return;
    els.overlayLoginBtn.disabled = true;
    renderOverlayAction("Redirecting to Spotify…", "loader-circle");
    window.location.href = "/api/auth/login";
  });
  els.loginBtn?.addEventListener("click", () => {
    els.authStatus.textContent = "Redirecting to Spotify login\u2026";
    window.location.href = "/api/auth/login";
  });
  els.logoutBtn.onclick = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      /* ignore */
    }
    handlers.onLogout();
    setAuthUi(false);
  };
  async function pullPlaylistsFromSpotify() {
    if (els.pullBtn) {
      els.pullBtn.disabled = true;
      els.pullBtn.setAttribute("aria-busy", "true");
    }
    if (els.csvImportStatus) {
      els.csvImportStatus.textContent = "Exportify: fetching playlists as CSV…";
    }
    els.authStatus.textContent = "Exportify: fetching playlists as CSV…";
    try {
      const res = await fetch("/api/library/pull-playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (payload.rate_limited) {
          setRateLimitCooldown(payload.retry_after_seconds || 3600);
        }
        throw new Error(payload.error || "Exportify pull failed");
      }
      const count = handlers.onCsvImported
        ? handlers.onCsvImported(
            payload.items || [],
            payload.playlists || [],
            payload.playlistArtists || null
          )
        : handlers.onDataLoaded(
            payload.items || [],
            payload.playlists || [],
            payload.playlistArtists || null
          );
      try {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({
            items: payload.items || [],
            playlists: payload.playlists || [],
            playlistArtists: payload.playlistArtists || {},
          })
        );
      } catch {
        /* ignore */
      }
      clearRateLimitCooldown();
      const resolved = payload.meta?.resolved ?? count;
      const pulled = (payload.meta?.pulled_playlists || []).length || payload.meta?.playlist_count || 0;
      const msg = `Exportify mapped ${pulled} playlist${pulled === 1 ? "" : "s"} · ${resolved} artists`;
      if (els.csvImportStatus) els.csvImportStatus.textContent = msg;
      els.authStatus.textContent = msg;
      unlockUi();
      return count;
    } catch (err) {
      if (els.csvImportStatus) els.csvImportStatus.textContent = `Pull error: ${err.message}`;
      els.authStatus.textContent = `Pull error: ${err.message}`;
      return getData().length;
    } finally {
      if (els.pullBtn) {
        els.pullBtn.disabled = false;
        els.pullBtn.removeAttribute("aria-busy");
      }
    }
  }

  els.syncBtn.onclick = () => doSync(false, { force: true });
  els.pullBtn?.addEventListener("click", () => pullPlaylistsFromSpotify());

  els.fileInput?.addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(r.result);
        const items = Array.isArray(parsed) ? parsed : parsed.items || [];
        const playlistList = Array.isArray(parsed) ? [] : parsed.playlists || [];
        const playlistArtistMap = Array.isArray(parsed) ? null : parsed.playlistArtists || null;
        handlers.onDataLoaded(items, playlistList, playlistArtistMap);
        unlockUi();
      } catch (err) {
        alert("Could not parse JSON: " + err.message);
      }
    };
    r.readAsText(f);
  });

  async function importExportifyCsv(fileList) {
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return 0;
    if (els.csvImportStatus) {
      els.csvImportStatus.textContent = `Importing ${files.length} CSV file${files.length === 1 ? "" : "s"}…`;
    }
    els.authStatus.textContent = "Importing Exportify playlist CSV…";
    try {
      const body = new FormData();
      for (const file of files) body.append("files", file);
      const res = await fetch("/api/library/import-csv", { method: "POST", body });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "CSV import failed");

      const count = handlers.onCsvImported
        ? handlers.onCsvImported(
            payload.items || [],
            payload.playlists || [],
            payload.playlistArtists || null
          )
        : handlers.onDataLoaded(
            payload.items || [],
            payload.playlists || [],
            payload.playlistArtists || null
          );

      try {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({
            items: payload.items || [],
            playlists: payload.playlists || [],
            playlistArtists: payload.playlistArtists || {},
          })
        );
      } catch {
        /* ignore */
      }

      const resolved = payload.meta?.resolved ?? count;
      const playlists = payload.meta?.playlist_count ?? (payload.playlists || []).length;
      const msg = `Imported ${playlists} playlist${playlists === 1 ? "" : "s"} · ${resolved} artists on map`;
      if (els.csvImportStatus) els.csvImportStatus.textContent = msg;
      els.authStatus.textContent = msg;
      unlockUi();
      return count;
    } catch (err) {
      if (els.csvImportStatus) els.csvImportStatus.textContent = `Import error: ${err.message}`;
      els.authStatus.textContent = `CSV import error: ${err.message}`;
      return 0;
    } finally {
      if (els.csvInput) els.csvInput.value = "";
      if (els.overlayCsvInput) els.overlayCsvInput.value = "";
    }
  }

  els.csvInput?.addEventListener("change", (e) => {
    importExportifyCsv(e.target.files);
  });
  els.overlayCsvInput?.addEventListener("change", (e) => {
    importExportifyCsv(e.target.files);
  });

  els.accountClose?.addEventListener("click", () => closeAccount());
  els.accountBackdrop?.addEventListener("click", () => closeAccount());
  document.addEventListener("keydown", handleAccountKeydown);

  els.overlay?.setAttribute("role", "dialog");
  els.overlay?.setAttribute("aria-modal", "true");
  if (els.overlay) els.overlay.tabIndex = -1;
  const overlayTitle = els.overlay?.querySelector("h2");
  if (overlayTitle) {
    overlayTitle.id ||= "loginOverlayTitle";
    els.overlay.setAttribute("aria-labelledby", overlayTitle.id);
  }
  els.loginError?.setAttribute("role", "alert");
  els.loginError?.setAttribute("aria-live", "assertive");
  els.syncProgress?.setAttribute("role", "status");
  els.syncProgress?.setAttribute("aria-live", "polite");
  els.syncProgress?.setAttribute("aria-atomic", "true");
  els.authStatus?.setAttribute("role", "status");
  els.authStatus?.setAttribute("aria-live", "polite");

  els.accountPanel?.setAttribute("role", "dialog");
  els.accountPanel?.setAttribute("aria-modal", "true");
  if (els.accountPanel) els.accountPanel.tabIndex = -1;
  els.accountBtn?.setAttribute("aria-controls", "accountPanel");
  els.accountBtn?.setAttribute("aria-haspopup", "dialog");
  els.accountBtn?.setAttribute("aria-expanded", String(accountIsOpen()));
  if (accountIsOpen()) {
    setInert(els.accountPanel, false);
    els.accountPanel?.setAttribute("aria-hidden", "false");
  } else {
    setInert(els.accountPanel, true);
    els.accountPanel?.setAttribute("aria-hidden", "true");
  }
  els.accountBackdrop?.setAttribute("aria-hidden", String(!accountIsOpen()));

  const overlayStartsVisible = !els.overlay?.classList.contains("hidden") && !els.overlay?.hidden;
  setOverlayVisible(overlayStartsVisible, { focus: false, animate: false });

  return {
    checkAuth,
    doSync,
    doPull: pullPlaylistsFromSpotify,
    fetchPlaylists,
    loadCached,
    unlockUi,
    lockUi,
    setAuthUi,
    openAccount,
    isInRateLimitCooldown,
    wireMapToggles(onArcs, onSpin) {
      wireSwitch(els.arcSw, onArcs);
      wireSwitch(els.spinSw, onSpin);
    },
    handleAuthParams() {
      const params = new URLSearchParams(window.location.search);
      const authResult = params.get("auth");
      const reason = params.get("reason");
      if (authResult) window.history.replaceState({}, "", window.location.pathname);
      if (authResult === "failed") {
        els.loginError.style.display = "";
        els.loginError.textContent =
          reason === "token_error"
            ? "Spotify login failed. Please try again."
            : reason === "access_denied"
              ? "Permission denied. Please allow access to continue."
              : reason === "invalid_state"
                ? "Session expired. Please try again."
                : `Login failed: ${reason || "unknown error"}`;
        setAuthUi(false);
        return { authed: false, justLoggedIn: false };
      }
      return { authResult, justLoggedIn: authResult === "success" };
    },
  };
}
