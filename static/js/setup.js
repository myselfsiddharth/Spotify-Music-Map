/** First-run screen: collect the user's own Spotify API keys before any login. */

const CONFIG_URL = "/api/config/spotify";

export function createSetup(handlers = {}) {
  const els = {
    setupCard: document.getElementById("setupCard"),
    loginCard: document.getElementById("loginCard"),
    form: document.getElementById("setupForm"),
    clientId: document.getElementById("setupClientId"),
    clientSecret: document.getElementById("setupClientSecret"),
    revealBtn: document.getElementById("setupRevealBtn"),
    submitBtn: document.getElementById("setupSubmit"),
    redirectUri: document.getElementById("setupRedirectUri"),
    copyBtn: document.getElementById("setupCopyBtn"),
    dashboardLink: document.getElementById("setupDashboardLink"),
    actions: document.getElementById("setupActions"),
    backBtn: document.getElementById("setupBackBtn"),
    forgetBtn: document.getElementById("setupForgetBtn"),
    changeBtn: document.getElementById("setupChangeBtn"),
    error: document.getElementById("setupError"),
    status: document.getElementById("setupStatus"),
  };

  let status = { configured: false, source: null };
  let copyResetTimer = null;

  function renderSubmit(label, icon = "key-round") {
    if (!els.submitBtn) return;
    const iconNode = document.createElement("i");
    iconNode.setAttribute("data-lucide", icon);
    iconNode.setAttribute("aria-hidden", "true");
    const textNode = document.createElement("span");
    textNode.textContent = label;
    els.submitBtn.replaceChildren(iconNode, textNode);
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.9 } });
  }

  function showError(message) {
    if (!els.error) return;
    els.error.textContent = message || "";
    els.error.style.display = message ? "" : "none";
    if (message && els.status) els.status.style.display = "none";
  }

  function showStatus(message) {
    if (!els.status) return;
    els.status.textContent = message || "";
    els.status.style.display = message ? "" : "none";
    if (message) showError("");
  }

  function setBusy(busy) {
    if (!els.submitBtn) return;
    els.submitBtn.disabled = busy;
    els.submitBtn.setAttribute("aria-busy", String(busy));
    renderSubmit(
      busy ? "Checking with Spotify…" : "Save keys & continue",
      busy ? "loader-circle" : "key-round"
    );
  }

  function applyStatus(next) {
    status = next || status;
    if (els.redirectUri && status.redirectUri) {
      els.redirectUri.textContent = status.redirectUri;
    }
    if (els.dashboardLink && status.dashboardUrl) {
      els.dashboardLink.href = status.dashboardUrl;
    }
    if (els.clientId && status.clientId && !els.clientId.value) {
      els.clientId.value = status.clientId;
    }
    // Escape hatches only make sense once something is already configured
    if (els.actions) els.actions.hidden = !status.configured;
    if (els.backBtn) els.backBtn.hidden = !status.configured;
    if (els.forgetBtn) els.forgetBtn.hidden = status.source !== "session";
    if (els.changeBtn) els.changeBtn.hidden = !status.configured;
    return status;
  }

  function showCard(which) {
    if (els.setupCard) els.setupCard.hidden = which !== "setup";
    if (els.loginCard) els.loginCard.hidden = which !== "login";
    // Keep the dialog label pointing at the heading that is actually visible
    const title = which === "setup" ? "setupCardTitle" : "loginCardTitle";
    document.getElementById("loginOverlay")?.setAttribute("aria-labelledby", title);
  }

  function showSetup({ focus = true } = {}) {
    showCard("setup");
    if (focus) {
      window.requestAnimationFrame(() => {
        const target = els.clientId?.value ? els.clientSecret : els.clientId;
        target?.focus({ preventScroll: true });
      });
    }
  }

  function showLogin() {
    showCard("login");
  }

  async function refresh() {
    try {
      const res = await fetch(CONFIG_URL);
      if (res.ok) applyStatus(await res.json());
    } catch {
      /* offline or server down — fall through to the setup prompt */
    }
    if (status.configured) showLogin();
    else showSetup({ focus: false });
    return status.configured;
  }

  async function save(event) {
    event?.preventDefault();
    const clientId = (els.clientId?.value || "").trim();
    const clientSecret = (els.clientSecret?.value || "").trim();
    if (!clientId || !clientSecret) {
      showError("Enter both your Client ID and Client secret.");
      (clientId ? els.clientSecret : els.clientId)?.focus();
      return false;
    }

    setBusy(true);
    showStatus("Verifying your keys with Spotify…");
    try {
      const res = await fetch(CONFIG_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(payload.error || "Could not save your keys. Try again.");
        return false;
      }
      applyStatus(payload);
      if (els.clientSecret) els.clientSecret.value = "";
      showStatus("");
      showLogin();
      await handlers.onConfigured?.(status);
      return true;
    } catch (err) {
      showError(`Could not reach the server: ${err.message}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    try {
      const res = await fetch(CONFIG_URL, { method: "DELETE" });
      if (res.ok) applyStatus(await res.json());
    } catch {
      /* ignore — the UI still returns to the setup prompt */
    }
    if (els.clientId) els.clientId.value = status.clientId || "";
    if (els.clientSecret) els.clientSecret.value = "";
    showError("");
    showStatus("Saved keys removed. Enter a Client ID and secret to continue.");
    showSetup();
    await handlers.onCleared?.(status);
  }

  function selectRedirectUri() {
    if (!els.redirectUri) return;
    const range = document.createRange();
    range.selectNodeContents(els.redirectUri);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  async function copyRedirectUri() {
    const value = els.redirectUri?.textContent?.trim();
    if (!value || !els.copyBtn) return;
    try {
      await navigator.clipboard.writeText(value);
      els.copyBtn.textContent = "Copied";
    } catch {
      // No clipboard access (insecure origin, denied permission) — select it
      // so the URI is one Ctrl+C away.
      selectRedirectUri();
      els.copyBtn.textContent = "Press Ctrl+C";
    }
    window.clearTimeout(copyResetTimer);
    copyResetTimer = window.setTimeout(() => {
      els.copyBtn.textContent = "Copy";
    }, 2400);
  }

  els.form?.addEventListener("submit", save);
  els.copyBtn?.addEventListener("click", copyRedirectUri);
  els.revealBtn?.addEventListener("click", () => {
    if (!els.clientSecret) return;
    const reveal = els.clientSecret.type === "password";
    els.clientSecret.type = reveal ? "text" : "password";
    els.revealBtn.textContent = reveal ? "Hide" : "Show";
    els.revealBtn.setAttribute("aria-pressed", String(reveal));
    els.revealBtn.setAttribute(
      "aria-label",
      reveal ? "Hide client secret" : "Show client secret"
    );
  });
  els.backBtn?.addEventListener("click", () => {
    showError("");
    showStatus("");
    showLogin();
    handlers.onBack?.();
  });
  els.forgetBtn?.addEventListener("click", forget);
  els.changeBtn?.addEventListener("click", () => {
    showError("");
    showStatus("");
    showSetup();
  });

  return {
    refresh,
    showSetup,
    showLogin,
    showError,
    getStatus: () => status,
    isConfigured: () => !!status.configured,
  };
}
