import { normalizeInput } from "./lib/url.js";

const SETTINGS_KEY = "incog.settings.v1";
const HISTORY_KEY = "incog.history.v1";
const MAX_HISTORY = 8;

const DEFAULTS = {
  engine: "ultraviolet",
  theme: "dark",
  openLinks: "same",
  privacyMode: false,
  forceHttps: false,
  userAgent: "desktop",
  userAgentCustom: "",
  homepage: "",
  forgetMe: false,
};

const urlInput = document.getElementById("url-input");
const navForm = document.getElementById("nav-form");
const emptyState = document.getElementById("empty-state");
const browse = document.getElementById("browse");
const frame = document.getElementById("view");
const progress = document.getElementById("progress");
const historyWrap = document.getElementById("history-wrap");
const historyList = document.getElementById("history");
const settingsPanel = document.getElementById("settings-panel");
const enginePill = document.getElementById("engine-pill");
const toast = document.getElementById("toast");
const uaCustomWrap = document.getElementById("ua-custom-wrap");
const byodCname = document.getElementById("byod-cname");
const byodForm = document.getElementById("byod-form");
const byodDomain = document.getElementById("byod-domain");
const byodStatus = document.getElementById("byod-status");
const byodCopy = document.getElementById("byod-copy");
const byodToggle = document.getElementById("byod-toggle");
const byodCard = document.getElementById("byod-card");

let settings = loadSettings();
let memoryHistory = [];
let enginesReady = null;
let connection = null;
let scramjet = null;
let scramjetFrame = null;

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function resolvedTheme(pref = settings.theme) {
  if (pref === "system") {
    return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return pref === "light" ? "light" : "dark";
}

function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme();
  document.documentElement.dataset.themePref = settings.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    resolvedTheme() === "light" ? "#f4f1ea" : "#0b0b0d",
  );
}

function toastMsg(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastMsg._t);
  toastMsg._t = setTimeout(() => {
    toast.hidden = true;
  }, 2400);
}

function wispUrl() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`;
}

async function registerSW() {
  if (!navigator.serviceWorker) {
    throw new Error("This browser cannot register a service worker.");
  }
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
}

async function ensureTransport() {
  if (!connection) {
    connection = new window.BareMux.BareMuxConnection("/baremux/worker.js");
  }
  if ((await connection.getTransport()) !== "/epoxy/index.mjs") {
    await connection.setTransport("/epoxy/index.mjs", [{ wisp: wispUrl() }]);
  }
}

function openIdb(name, version) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {};
  });
}

function deleteIdb(name) {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    request.onsuccess = finish;
    request.onerror = finish;
    request.onblocked = () => setTimeout(finish, 400);
    setTimeout(finish, 1500);
  });
}

async function resetScramjetDbIfBroken() {
  let stale = true;
  try {
    const db = await openIdb("$scramjet", 1);
    stale = !db.objectStoreNames.contains("config");
    db.close();
  } catch {
    stale = true;
  }
  if (!stale) return;
  await deleteIdb("$scramjet");
}

async function bootShared() {
  if (!enginesReady) {
    enginesReady = (async () => {
      await registerSW();
      await ensureTransport();
    })();
  }
  return enginesReady;
}

async function bootScramjet() {
  await bootShared();
  if (scramjetFrame) return;
  await resetScramjetDbIfBroken();
  const { ScramjetController } = window.$scramjetLoadController();
  scramjet = new ScramjetController({
    prefix: "/scramjet/",
    files: {
      wasm: "/scram/scramjet.wasm.wasm",
      all: "/scram/scramjet.all.js",
      sync: "/scram/scramjet.sync.js",
    },
  });
  await scramjet.init();
  scramjetFrame = scramjet.createFrame(frame);
}

function readHistory() {
  if (settings.forgetMe) return memoryHistory;
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeHistory(items) {
  memoryHistory = items.slice(0, MAX_HISTORY);
  if (!settings.forgetMe) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(memoryHistory));
  }
}

function remember(url) {
  writeHistory([url, ...readHistory().filter((item) => item !== url)]);
  renderHistory();
}

function renderHistory() {
  const items = readHistory();
  historyList.replaceChildren();
  historyWrap.hidden = items.length === 0;
  for (const url of items) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = url;
    button.addEventListener("click", () => openUrl(url, { fromChrome: true }));
    li.append(button);
    historyList.append(li);
  }
}

function setBrowseMode(on) {
  document.body.classList.toggle("is-browse", on);
  emptyState.hidden = on;
  browse.hidden = !on;
}

function syncSettingsUi() {
  document.querySelector(`input[name="engine"][value="${settings.engine}"]`).checked = true;
  document.getElementById("setting-theme").value = settings.theme;
  document.getElementById("setting-links").value = settings.openLinks;
  document.getElementById("setting-https").checked = settings.forceHttps;
  document.getElementById("setting-privacy").checked = settings.privacyMode;
  document.getElementById("setting-ua").value = settings.userAgent;
  document.getElementById("setting-ua-custom").value = settings.userAgentCustom;
  document.getElementById("setting-home").value = settings.homepage;
  document.getElementById("setting-forget").checked = settings.forgetMe;
  uaCustomWrap.hidden = settings.userAgent !== "custom";
  enginePill.textContent = settings.engine === "scramjet" ? "Scramjet" : "Ultraviolet";
}

function setSettingsOpen(open) {
  settingsPanel.hidden = !open;
  document.body.classList.toggle("settings-open", open);
  document.getElementById("settings-toggle").setAttribute("aria-expanded", String(open));
  if (open) document.getElementById("setting-theme").focus();
}

function encodeUv(url) {
  return `${window.__uv$config.prefix}${window.__uv$config.encodeUrl(url)}`;
}

async function navigate(url) {
  setBrowseMode(true);
  progress.hidden = false;
  if (settings.engine === "scramjet") {
    await bootScramjet();
    scramjetFrame.go(url);
    return;
  }
  await bootShared();
  frame.src = encodeUv(url);
}

async function openUrl(raw, { push = true, fromChrome = false } = {}) {
  let url;
  try {
    url = normalizeInput(raw, {
      forceHttps: settings.forceHttps,
      privacy: settings.privacyMode,
    });
  } catch (error) {
    toastMsg(error.message);
    return;
  }
  if (!url) {
    navForm.classList.remove("shake");
    void navForm.offsetWidth;
    navForm.classList.add("shake");
    return;
  }

  if (fromChrome && settings.openLinks === "new") {
    window.open(`/?url=${encodeURIComponent(url)}`, "_blank", "noopener");
    return;
  }

  urlInput.value = url;
  remember(url);
  const next = `/?url=${encodeURIComponent(url)}`;
  if (push) history.pushState({ url }, "", next);
  else history.replaceState({ url }, "", next);

  try {
    await navigate(url);
  } catch (error) {
    progress.hidden = true;
    toastMsg(error.message || "Could not start the proxy engine.");
  }
}

function goHome({ push = true } = {}) {
  setBrowseMode(false);
  progress.hidden = false;
  progress.hidden = true;
  frame.src = "about:blank";
  urlInput.value = "";
  if (push) history.pushState({}, "", "/");
  urlInput.focus();
}

async function clearSession({ keepSettings = true } = {}) {
  writeHistory([]);
  renderHistory();
  sessionStorage.clear();
  if (caches?.keys) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  goHome();
  if (!keepSettings) localStorage.removeItem(SETTINGS_KEY);
  toastMsg("Session cleared");
}

navForm.addEventListener("submit", (event) => {
  event.preventDefault();
  openUrl(urlInput.value);
});

document.getElementById("new-tab").addEventListener("click", () => {
  if (settings.openLinks === "new") {
    window.open("/", "_blank", "noopener");
    return;
  }
  goHome();
});

document.getElementById("clear-session").addEventListener("click", () => {
  clearSession();
});

document.getElementById("clear-history").addEventListener("click", () => {
  writeHistory([]);
  renderHistory();
});

document.getElementById("clear-cache").addEventListener("click", () => {
  clearSession();
});

document.getElementById("settings-toggle").addEventListener("click", () => {
  setSettingsOpen(settingsPanel.hidden);
});
document.getElementById("settings-close").addEventListener("click", () => setSettingsOpen(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setSettingsOpen(false);
});

byodToggle?.addEventListener("click", () => {
  goHome({ push: false });
  byodCard?.scrollIntoView({ behavior: "smooth", block: "center" });
  byodDomain?.focus();
});

byodCopy?.addEventListener("click", async () => {
  const value = byodCname?.textContent?.trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toastMsg("CNAME target copied — paste this into Destination, not an A record");
  } catch {
    toastMsg(value);
  }
});

document.getElementById("byod-copy-txt-host")?.addEventListener("click", async () => {
  const value = document.getElementById("byod-txt-host")?.textContent?.trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toastMsg("TXT hostname copied");
  } catch {
    toastMsg(value);
  }
});

document.getElementById("byod-copy-txt")?.addEventListener("click", async () => {
  const value = document.getElementById("byod-txt")?.textContent?.trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toastMsg("TXT value copied");
  } catch {
    toastMsg(value);
  }
});

function applyByodRecords(records, domain) {
  if (!records) return;
  if (byodCname && records.cname) byodCname.textContent = records.cname;
  const txtHost = document.getElementById("byod-txt-host");
  const txtVal = document.getElementById("byod-txt");
  if (txtHost && records.txtName) txtHost.textContent = records.txtName;
  if (txtVal && records.txt) txtVal.textContent = records.txt;
  if (domain && byodDomain && !byodDomain.value) byodDomain.value = domain;
}

byodForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  byodStatus.textContent = "Checking Railway DNS…";
  try {
    const res = await fetch("/api/byod", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: byodDomain.value }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Could not attach that domain.");
    applyByodRecords(body.records, body.domain);
    byodStatus.textContent = body.message;
    toastMsg(body.verified ? `https://${body.domain}` : "Set CNAME + TXT, not an A record");
  } catch (error) {
    byodStatus.textContent = error.message;
  }
});

async function loadByod() {
  try {
    const res = await fetch("/api/byod");
    const body = await res.json();
    const hints = body.hints || {};
    const known = Object.keys(hints)[0];
    if (known) {
      applyByodRecords(hints[known], known);
    } else if (body.cname && byodCname) {
      byodCname.textContent = body.cname;
    }
  } catch {
    // keep the HTML fallback
  }
}

document.getElementById("theme-toggle").addEventListener("click", () => {
  const order = ["dark", "light", "system"];
  settings.theme = order[(order.indexOf(settings.theme) + 1) % order.length];
  saveSettings();
  applyTheme();
  syncSettingsUi();
});

for (const radio of document.querySelectorAll('input[name="engine"]')) {
  radio.addEventListener("change", async () => {
    settings.engine = radio.value;
    saveSettings();
    syncSettingsUi();
    const current = new URLSearchParams(location.search).get("url");
    if (current) {
      await openUrl(current, { push: false });
    }
  });
}

document.getElementById("setting-theme").addEventListener("change", (event) => {
  settings.theme = event.target.value;
  saveSettings();
  applyTheme();
});
document.getElementById("setting-links").addEventListener("change", (event) => {
  settings.openLinks = event.target.value;
  saveSettings();
});
document.getElementById("setting-https").addEventListener("change", (event) => {
  settings.forceHttps = event.target.checked;
  saveSettings();
});
document.getElementById("setting-privacy").addEventListener("change", (event) => {
  settings.privacyMode = event.target.checked;
  saveSettings();
});
document.getElementById("setting-ua").addEventListener("change", (event) => {
  settings.userAgent = event.target.value;
  uaCustomWrap.hidden = settings.userAgent !== "custom";
  saveSettings();
});
document.getElementById("setting-ua-custom").addEventListener("input", (event) => {
  settings.userAgentCustom = event.target.value;
  saveSettings();
});
document.getElementById("setting-home").addEventListener("change", (event) => {
  settings.homepage = event.target.value.trim();
  saveSettings();
});
document.getElementById("setting-forget").addEventListener("change", (event) => {
  settings.forgetMe = event.target.checked;
  if (settings.forgetMe) localStorage.removeItem(HISTORY_KEY);
  saveSettings();
  renderHistory();
});

document.getElementById("popular").addEventListener("click", (event) => {
  const button = event.target.closest("[data-url]");
  if (button) openUrl(button.dataset.url, { fromChrome: true });
});

frame.addEventListener("load", () => {
  progress.hidden = true;
});

window.addEventListener("popstate", (event) => {
  const url = event.state?.url || new URLSearchParams(location.search).get("url");
  if (url) openUrl(url, { push: false });
  else goHome({ push: false });
});

window.addEventListener("pagehide", () => {
  if (settings.forgetMe) localStorage.removeItem(HISTORY_KEY);
});

matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  if (settings.theme === "system") applyTheme();
});

applyTheme();
syncSettingsUi();
renderHistory();
loadByod();

const bootUrl = new URLSearchParams(location.search).get("url") || settings.homepage;
if (bootUrl) {
  openUrl(bootUrl, { push: false });
} else {
  urlInput.focus();
}
