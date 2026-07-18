import { GENRE_PALETTE } from "./config.js";

/**
 * Factory that wires up screenshot capture, stats computation,
 * image compositing, and share-link creation for the share modal.
 *
 * @param {() => HTMLCanvasElement} getCanvas  - returns the MapLibre canvas
 * @param {() => Array}            getData    - returns the current dataset
 * @param {Object}                 els        - DOM element references
 */
export function createShare(getCanvas, getData, els) {
  /* ------------------------------------------------------------------ */
  /*  1. computeStats                                                   */
  /* ------------------------------------------------------------------ */

  function computeStats(items) {
    const totalArtists = items.length;

    const countryCounts = new Map();
    const cityCounts = new Map();
    const genreCounts = new Map();

    for (const item of items) {
      const country = item.country || "\u2014";
      countryCounts.set(country, (countryCounts.get(country) || 0) + 1);

      const city = item.city || "\u2014";
      cityCounts.set(city, (cityCounts.get(city) || 0) + 1);

      const genre = item.genre || "Other";
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    }

    const totalCountries = countryCounts.size;
    const totalCities = cityCounts.size;

    const sortedCountries = [...countryCounts.entries()]
      .sort((a, b) => b[1] - a[1]);

    const topCountries = sortedCountries.slice(0, 5).map(([name, count]) => ({
      name,
      count,
      pct: totalArtists ? Math.round((count / totalArtists) * 1000) / 10 : 0,
    }));

    const topCities = [...cityCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    const genreBreakdown = [...genreCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([genre, count]) => ({
        genre,
        count,
        pct: totalArtists ? Math.round((count / totalArtists) * 1000) / 10 : 0,
        color: GENRE_PALETTE[genre] || "#4ECDC4",
      }));

    const topGenre = genreBreakdown.length ? genreBreakdown[0].genre : "Other";

    return {
      totalArtists,
      totalCountries,
      totalCities,
      topCountries,
      topCities,
      genreBreakdown,
      topGenre,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  3. drawStatsOverlay                                               */
  /* ------------------------------------------------------------------ */

  function drawStatsOverlay(ctx, stats, width, height) {
    const panelW = 320;
    const panelX = width - panelW;

    // Semi-transparent background
    ctx.fillStyle = "rgba(10, 10, 15, 0.85)";
    ctx.fillRect(panelX, 0, panelW, height);

    // Left green edge
    ctx.fillStyle = "#1db954";
    ctx.fillRect(panelX, 0, 2, height);

    const pad = 24;
    let y = pad + 6;
    const textX = panelX + pad;
    const maxTextW = panelW - pad * 2;

    // Title
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px Inter, system-ui, sans-serif";
    ctx.fillText("My Music Map", textX, y);
    y += 36;

    // Summary
    ctx.font = "18px Inter, system-ui, sans-serif";
    ctx.fillText(
      `${stats.totalArtists} artists \u00b7 ${stats.totalCountries} countries`,
      textX,
      y
    );
    y += 40;

    // --- Top Countries ---
    ctx.font = "bold 16px Inter, system-ui, sans-serif";
    ctx.fillText("Top Countries", textX, y);
    y += 28;

    const maxCount = stats.topCountries.length
      ? stats.topCountries[0].count
      : 1;
    const barMaxW = maxTextW - 60;

    ctx.font = "14px Inter, system-ui, sans-serif";
    for (const c of stats.topCountries) {
      ctx.fillStyle = "#ffffff";
      ctx.fillText(c.name, textX, y);
      ctx.fillText(String(c.count), textX + maxTextW - 30, y);

      // Proportional bar
      const barW = Math.max(4, (c.count / maxCount) * barMaxW);
      ctx.fillStyle = "#1db954";
      ctx.globalAlpha = 0.6;
      ctx.fillRect(textX, y + 4, barW, 6);
      ctx.globalAlpha = 1;

      y += 24;
    }
    y += 12;

    // --- Genres ---
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 16px Inter, system-ui, sans-serif";
    ctx.fillText("Genres", textX, y);
    y += 28;

    ctx.font = "14px Inter, system-ui, sans-serif";
    for (const g of stats.genreBreakdown) {
      // Colored dot
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.arc(textX + 5, y - 4, 5, 0, Math.PI * 2);
      ctx.fill();

      // Genre name + count
      ctx.fillStyle = "#ffffff";
      ctx.fillText(g.genre, textX + 16, y);
      ctx.fillText(String(g.count), textX + maxTextW - 30, y);
      y += 24;
    }
    y += 12;

    // --- Top Cities ---
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 16px Inter, system-ui, sans-serif";
    ctx.fillText("Top Cities", textX, y);
    y += 28;

    ctx.font = "14px Inter, system-ui, sans-serif";
    const topCitiesSlice = stats.topCities.slice(0, 3);
    for (const c of topCitiesSlice) {
      ctx.fillStyle = "#ffffff";
      ctx.fillText(c.name, textX, y);
      ctx.fillText(String(c.count), textX + maxTextW - 30, y);
      y += 24;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  2. captureScreenshot                                              */
  /* ------------------------------------------------------------------ */

  async function captureScreenshot(includeStats) {
    const mapCanvas = getCanvas();
    const w = 1200;
    const h = 630;

    const offscreen = document.createElement("canvas");
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext("2d");

    // Cover-fit the map canvas into the 1200x630 area
    const srcW = mapCanvas.width;
    const srcH = mapCanvas.height;
    const scale = Math.max(w / srcW, h / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    const offsetX = (w - drawW) / 2;
    const offsetY = (h - drawH) / 2;

    ctx.drawImage(mapCanvas, offsetX, offsetY, drawW, drawH);

    // Optional stats overlay
    if (includeStats) {
      const items = getData();
      const stats = computeStats(items);
      drawStatsOverlay(ctx, stats, w, h);
    }

    // Watermark — bottom-left, 50% opacity
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#ffffff";
    ctx.font = "14px Inter, system-ui, sans-serif";
    ctx.fillText("Sonic Cartography", 16, h - 16);
    ctx.globalAlpha = 1;

    return offscreen.toDataURL("image/png");
  }

  /* ------------------------------------------------------------------ */
  /*  4. renderStatsPreview                                             */
  /* ------------------------------------------------------------------ */

  function renderStatsPreview(stats, container) {
    container.textContent = "";

    // --- Summary section ---
    const summarySection = document.createElement("div");
    summarySection.className = "share-stat-section";

    const bigStat = document.createElement("div");
    bigStat.className = "share-stat-big";
    bigStat.textContent = `${stats.totalArtists} artists`;
    summarySection.appendChild(bigStat);

    const subStat = document.createElement("div");
    subStat.className = "share-stat-sub";
    subStat.textContent = `${stats.totalCountries} countries \u00b7 ${stats.totalCities} cities`;
    summarySection.appendChild(subStat);

    container.appendChild(summarySection);

    // --- Top Countries section ---
    const countriesSection = document.createElement("div");
    countriesSection.className = "share-stat-section";

    const countriesLabel = document.createElement("div");
    countriesLabel.className = "share-stat-label";
    countriesLabel.textContent = "Top countries";
    countriesSection.appendChild(countriesLabel);

    for (const c of stats.topCountries) {
      const row = document.createElement("div");
      row.className = "share-stat-row";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = c.name;
      row.appendChild(nameSpan);

      const countSpan = document.createElement("span");
      countSpan.textContent = String(c.count);
      row.appendChild(countSpan);

      const bar = document.createElement("div");
      bar.className = "share-stat-bar";
      bar.style.width = `${c.pct}%`;
      row.appendChild(bar);

      countriesSection.appendChild(row);
    }

    container.appendChild(countriesSection);

    // --- Genres section ---
    const genresSection = document.createElement("div");
    genresSection.className = "share-stat-section";

    const genresLabel = document.createElement("div");
    genresLabel.className = "share-stat-label";
    genresLabel.textContent = "Genres";
    genresSection.appendChild(genresLabel);

    for (const g of stats.genreBreakdown) {
      const row = document.createElement("div");
      row.className = "share-stat-row";

      const dot = document.createElement("span");
      dot.style.color = g.color;
      dot.textContent = "\u25cf";
      row.appendChild(dot);

      const space = document.createTextNode(" ");
      row.appendChild(space);

      const nameSpan = document.createElement("span");
      nameSpan.textContent = g.genre;
      row.appendChild(nameSpan);

      const countSpan = document.createElement("span");
      countSpan.textContent = String(g.count);
      row.appendChild(countSpan);

      genresSection.appendChild(row);
    }

    container.appendChild(genresSection);
  }

  /* ------------------------------------------------------------------ */
  /*  5. Modal controls                                                 */
  /* ------------------------------------------------------------------ */

  function setPanelOpen(open) {
    if (els.modal) {
      els.modal.removeAttribute("hidden");
      els.modal.classList.toggle("open", open);
      els.modal.setAttribute("aria-hidden", String(!open));
      els.modal.toggleAttribute("inert", !open);
    }
    if (els.backdrop) {
      els.backdrop.classList.toggle("open", open);
      els.backdrop.toggleAttribute("inert", !open);
    }
  }

  async function openModal() {
    setPanelOpen(true);

    // Hide link row from previous session
    if (els.linkRow) els.linkRow.style.display = "none";

    const items = getData();
    const stats = computeStats(items);
    renderStatsPreview(stats, els.statsContent);

    // Capture preview image
    try {
      const includeStats = els.statsToggle ? els.statsToggle.checked : false;
      const dataUrl = await captureScreenshot(includeStats);
      els.preview.textContent = "";
      const img = document.createElement("img");
      img.src = dataUrl;
      img.alt = "Map screenshot preview";
      els.preview.appendChild(img);
    } catch {
      /* preview generation may fail if canvas is tainted */
    }
  }

  function closeModal() {
    setPanelOpen(false);
  }

  async function downloadImage() {
    const includeStats = els.statsToggle ? els.statsToggle.checked : false;
    const dataUrl = await captureScreenshot(includeStats);

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "sonic-cartography-map.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function createShareLink() {
    const includeStats = els.statsToggle ? els.statsToggle.checked : false;
    const dataUrl = await captureScreenshot(includeStats);

    const items = getData();
    const stats = computeStats(items);

    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: dataUrl,
          stats,
          itemCount: stats.totalArtists,
          countryCount: stats.totalCountries,
        }),
      });
      const payload = await res.json();

      if (els.linkInput) {
        const fullUrl = window.location.origin + (payload.url || "");
        els.linkInput.value = fullUrl;
        if (els.linkRow) els.linkRow.style.display = "";
        els.linkInput.select();
      }
    } catch {
      if (els.linkInput) {
        els.linkInput.value = "Error creating share link";
        if (els.linkRow) els.linkRow.style.display = "";
      }
    }
  }

  async function refreshPreview() {
    try {
      const includeStats = els.statsToggle ? els.statsToggle.checked : false;
      const dataUrl = await captureScreenshot(includeStats);
      els.preview.textContent = "";
      const img = document.createElement("img");
      img.src = dataUrl;
      img.alt = "Map screenshot preview";
      els.preview.appendChild(img);
    } catch {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ */
  /*  6. Event wiring                                                   */
  /* ------------------------------------------------------------------ */

  els.closeBtn?.addEventListener("click", closeModal);
  els.backdrop?.addEventListener("click", closeModal);
  els.downloadBtn?.addEventListener("click", downloadImage);
  els.linkBtn?.addEventListener("click", createShareLink);
  els.statsToggle?.addEventListener("change", refreshPreview);

  els.copyBtn?.addEventListener("click", () => {
    if (!els.linkInput?.value) return;
    navigator.clipboard.writeText(els.linkInput.value).then(() => {
      const orig = els.copyBtn.textContent;
      els.copyBtn.textContent = "Copied!";
      setTimeout(() => { els.copyBtn.textContent = orig; }, 2000);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && els.modal?.classList.contains("open")) {
      closeModal();
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Return public API                                                 */
  /* ------------------------------------------------------------------ */

  return { openModal, closeModal, computeStats };
}
