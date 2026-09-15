import { normalizeInput } from "./lib/url.js";

const SETTINGS_KEY = "incog.settings.v1";
const HISTORY_KEY = "incog.history.v1";
const CLOAK_KEY = "incog.cloak.v1";
const MAX_HISTORY = 8;
const DEFAULT_TITLE = "Incog — private proxy";
const DEFAULT_ICON = "/favicon.svg";

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
  searchEngine: "duckduckgo",
};

const urlInput = document.getElementById("url-input");
const navForm = document.getElementById("nav-form");
const emptyState = document.getElementById("empty-state");
const browse = document.getElementById("browse");
const framesEl = document.getElementById("frames");
const progress = document.getElementById("progress");
const historyWrap = document.getElementById("history-wrap");
const historyList = document.getElementById("history");
const settingsPanel = document.getElementById("settings-panel");
const enginePill = document.getElementById("engine-pill");
const toast = document.getElementById("toast");
const uaCustomWrap = document.getElementById("ua-custom-wrap");
const tabStrip = document.getElementById("tab-strip");
const navBack = document.getElementById("nav-back");
const navReload = document.getElementById("nav-reload");
const cloakModal = document.getElementById("cloak-modal");
const cloakForm = document.getElementById("cloak-form");
const cloakUrl = document.getElementById("cloak-url");
const cloakStatus = document.getElementById("cloak-status");
const tabIcon = document.getElementById("tab-icon");

let settings = loadSettings();
let memoryHistory = [];
let enginesReady = null;
let connection = null;
let scramjet = null;
const tabs = [];
let activeId = "";

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

async function ensureScramjet() {
  await bootShared();
  if (scramjet) return;
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

function activeTab() {
  return tabs.find((tab) => tab.id === activeId) || tabs[0];
}

function tabTitle(url) {
  if (!url) return "New tab";
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("google.") && parsed.pathname === "/search") {
      return parsed.searchParams.get("q") || "Google";
    }
    if (parsed.hostname.includes("bing.") && parsed.pathname === "/search") {
      return parsed.searchParams.get("q") || "Edge";
    }
    if (parsed.hostname.includes("duckduckgo.")) {
      return parsed.searchParams.get("q") || "DuckDuckGo";
    }
    return parsed.hostname.replace(/^www\./, "") || parsed.href;
  } catch {
    return url;
  }
}

function renderTabs() {
  tabStrip.replaceChildren();
  for (const tab of tabs) {
    const wrap = document.createElement("div");
    wrap.className = `tab${tab.id === activeId ? " is-active" : ""}`;
    const label = document.createElement("button");
    label.type = "button";
    label.className = "tab-label";
    label.textContent = tab.title;
    label.addEventListener("click", () => selectTab(tab.id));
    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.setAttribute("aria-label", "Close tab");
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(tab.id);
    });
    wrap.append(label, close);
    tabStrip.append(wrap);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "tab-new";
  add.title = "New tab";
  add.setAttribute("aria-label", "New tab");
  add.textContent = "+";
  add.addEventListener("click", () => createTab());
  tabStrip.append(add);
  syncNavButtons();
}

function syncNavButtons() {
  const tab = activeTab();
  navBack.disabled = !tab || !canGoBack(tab);
}

function canGoBack(tab) {
  if (tab.index > 0) return true;
  try {
    return Boolean(tab.url && tab.iframe.contentWindow?.history.length > 1);
  } catch {
    return false;
  }
}

function setBrowseMode(on) {
  document.body.classList.toggle("is-browse", on);
  emptyState.hidden = on;
  browse.hidden = !on;
  for (const tab of tabs) {
    tab.iframe.hidden = !on || tab.id !== activeId;
  }
}

function showActiveTab() {
  const tab = activeTab();
  if (!tab) return;
  urlInput.value = tab.url;
  setBrowseMode(Boolean(tab.url));
  syncNavButtons();
}

function makeIframe() {
  const iframe = document.createElement("iframe");
  iframe.title = "Proxied page";
  iframe.referrerPolicy = "no-referrer";
  iframe.hidden = true;
  iframe.addEventListener("load", () => onFrameLoad(iframe));
  framesEl.append(iframe);
  return iframe;
}

function createTab({ focus = true } = {}) {
  const tab = {
    id: crypto.randomUUID(),
    title: "New tab",
    url: "",
    stack: [],
    index: -1,
    iframe: makeIframe(),
    scramjetFrame: null,
  };
  tabs.push(tab);
  if (focus) {
    activeId = tab.id;
    urlInput.value = "";
    setBrowseMode(false);
    urlInput.focus();
  }
  renderTabs();
  return tab;
}

function selectTab(id) {
  const tab = tabs.find((item) => item.id === id);
  if (!tab) return;
  activeId = tab.id;
  showActiveTab();
  renderTabs();
}

function closeTab(id) {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  const [removed] = tabs.splice(index, 1);
  removed.iframe.remove();
  if (!tabs.length) createTab();
  if (activeId === id) {
    const next = tabs[Math.max(0, index - 1)];
    activeId = next.id;
  }
  showActiveTab();
  renderTabs();
}

function decodeFrameUrl(iframe) {
  try {
    const loc = iframe.contentWindow.location;
    const path = `${loc.pathname}${loc.search}`;
    const uvPrefix = window.__uv$config?.prefix;
    if (uvPrefix && path.startsWith(uvPrefix)) {
      return window.__uv$config.decodeUrl(path.slice(uvPrefix.length));
    }
    if (path.startsWith("/scramjet/")) {
      return iframe.contentDocument?.title || "";
    }
  } catch {}
  return "";
}

function onFrameLoad(iframe) {
  const tab = tabs.find((item) => item.iframe === iframe);
  if (!tab) return;
  progress.hidden = true;
  const decoded = decodeFrameUrl(iframe);
  if (decoded) {
    tab.url = decoded;
    tab.title = tabTitle(decoded);
    if (tab.id === activeId) urlInput.value = decoded;
  } else if (tab.url) {
    tab.title = tabTitle(tab.url);
  }
  try {
    const pageTitle = iframe.contentDocument?.title?.trim();
    if (pageTitle) tab.title = pageTitle.slice(0, 48);
  } catch {}
  if (tab.id === activeId) renderTabs();
}

function encodeUv(url) {
  return `${window.__uv$config.prefix}${window.__uv$config.encodeUrl(url)}`;
}

async function navigateTab(tab, url, { record = true } = {}) {
  setBrowseMode(true);
  progress.hidden = false;
  tab.url = url;
  tab.title = tabTitle(url);
  if (record) {
    tab.stack = tab.stack.slice(0, tab.index + 1);
    tab.stack.push(url);
    tab.index = tab.stack.length - 1;
  }
  renderTabs();
  if (settings.engine === "scramjet") {
    await ensureScramjet();
    if (!tab.scramjetFrame) tab.scramjetFrame = scramjet.createFrame(tab.iframe);
    tab.scramjetFrame.go(url);
    return;
  }
  await bootShared();
  tab.iframe.src = encodeUv(url);
}

async function openUrl(raw, { push = true, fromChrome = false } = {}) {
  let url;
  try {
    url = normalizeInput(raw, {
      forceHttps: settings.forceHttps,
      privacy: settings.privacyMode,
      searchEngine: settings.searchEngine,
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
    createTab();
  }

  const tab = activeTab();
  urlInput.value = url;
  remember(url);
  const next = `/?url=${encodeURIComponent(url)}`;
  if (push) history.pushState({ url }, "", next);
  else history.replaceState({ url }, "", next);

  try {
    await navigateTab(tab, url);
  } catch (error) {
    progress.hidden = true;
    toastMsg(error.message || "Could not start the proxy engine.");
  }
}

function goHome({ push = true } = {}) {
  const tab = activeTab();
  if (tab) {
    tab.url = "";
    tab.title = "New tab";
    tab.stack = [];
    tab.index = -1;
    tab.iframe.src = "about:blank";
  }
  progress.hidden = true;
  urlInput.value = "";
  setBrowseMode(false);
  renderTabs();
  if (push) history.pushState({}, "", "/");
  urlInput.focus();
}

async function goBack() {
  const tab = activeTab();
  if (!tab) return;
  try {
    if (tab.iframe.contentWindow?.history.length > 1) {
      tab.iframe.contentWindow.history.back();
      if (tab.index > 0) {
        tab.index -= 1;
        tab.url = tab.stack[tab.index] || tab.url;
        tab.title = tabTitle(tab.url);
        urlInput.value = tab.url;
      }
      renderTabs();
      return;
    }
  } catch {}
  if (tab.index > 0) {
    tab.index -= 1;
    const url = tab.stack[tab.index];
    urlInput.value = url;
    await navigateTab(tab, url, { record: false });
  }
}

async function reloadTab() {
  const tab = activeTab();
  if (!tab?.url) return;
  progress.hidden = false;
  try {
    tab.iframe.contentWindow.location.reload();
  } catch {
    await navigateTab(tab, tab.url, { record: false });
  }
}

function syncSettingsUi() {
  document.querySelector(`input[name="engine"][value="${settings.engine}"]`).checked = true;
  document.getElementById("setting-search").value = SEARCH_OR_DEFAULT(settings.searchEngine);
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

function SEARCH_OR_DEFAULT(value) {
  return ["google", "edge", "duckduckgo"].includes(value) ? value : "duckduckgo";
}

function setSettingsOpen(open) {
  settingsPanel.hidden = !open;
  document.body.classList.toggle("settings-open", open);
  document.getElementById("settings-toggle").setAttribute("aria-expanded", String(open));
  if (open) document.getElementById("setting-search").focus();
}

function setCloakOpen(open) {
  cloakModal.hidden = !open;
  if (open) {
    cloakStatus.textContent = "";
    cloakUrl.focus();
  }
}

function applyCloakTo(doc, { title, icon }) {
  if (!doc) return;
  doc.title = title;
  let link = doc.querySelector("link[rel='icon'], link[rel='shortcut icon']");
  if (!link) {
    link = doc.createElement("link");
    link.rel = "icon";
    doc.head?.append(link);
  }
  link.href = icon;
}

function applyCloak(meta) {
  const payload = {
    title: meta.title || DEFAULT_TITLE,
    icon: meta.icon || DEFAULT_ICON,
  };
  applyCloakTo(document, payload);
  if (tabIcon) {
    tabIcon.href = payload.icon;
    tabIcon.type = payload.icon.startsWith("data:") ? "" : "image/svg+xml";
  }
  try {
    if (window.parent !== window) applyCloakTo(window.parent.document, payload);
  } catch {}
}

function loadCloak() {
  try {
    const stored = JSON.parse(localStorage.getItem(CLOAK_KEY) || "null");
    if (stored?.title) applyCloak(stored);
  } catch {}
}

function saveCloak(meta) {
  localStorage.setItem(CLOAK_KEY, JSON.stringify(meta));
  applyCloak(meta);
}

function resetCloak() {
  localStorage.removeItem(CLOAK_KEY);
  applyCloak({ title: DEFAULT_TITLE, icon: DEFAULT_ICON });
}

function paintAboutBlank(win, { title, icon, src }) {
  const doc = win.document;
  doc.open();
  doc.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><link rel="icon" href="${escapeAttr(icon)}"><style>html,body,iframe{margin:0;height:100%;width:100%;border:0;background:#0b0b0d}</style></head><body></body></html>`,
  );
  doc.close();
  const frame = doc.createElement("iframe");
  frame.src = src;
  frame.setAttribute("allow", "fullscreen");
  frame.style.cssText = "border:0;width:100%;height:100%";
  doc.body.append(frame);
}

function openAboutBlank() {
  const popup = window.open("about:blank", "_blank");
  if (!popup) {
    toastMsg("Allow popups to open about:blank.");
    return;
  }
  const cloak = (() => {
    try {
      return JSON.parse(localStorage.getItem(CLOAK_KEY) || "null");
    } catch {
      return null;
    }
  })();
  const payload = {
    title: cloak?.title || "about:blank",
    icon: cloak?.icon || DEFAULT_ICON,
    src: `${location.origin}/${location.search}`,
  };
  const fill = () => {
    try {
      if (!popup.document.querySelector("iframe")) paintAboutBlank(popup, payload);
    } catch {}
  };
  fill();
  popup.addEventListener("load", fill);
  setTimeout(fill, 50);
  setTimeout(fill, 250);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

async function clearSession({ keepSettings = true } = {}) {
  writeHistory([]);
  renderHistory();
  sessionStorage.clear();
  if (caches?.keys) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  for (const tab of [...tabs]) tab.iframe.remove();
  tabs.length = 0;
  createTab();
  goHome({ push: false });
  if (!keepSettings) localStorage.removeItem(SETTINGS_KEY);
  toastMsg("Session cleared");
}

navForm.addEventListener("submit", (event) => {
  event.preventDefault();
  openUrl(urlInput.value);
});

document.getElementById("brand").addEventListener("click", (event) => {
  event.preventDefault();
  goHome();
});

document.getElementById("new-tab").addEventListener("click", () => {
  createTab();
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
document.getElementById("about-blank").addEventListener("click", openAboutBlank);
document.getElementById("cloak-toggle").addEventListener("click", () => setCloakOpen(true));
document.getElementById("cloak-cancel").addEventListener("click", () => setCloakOpen(false));
document.getElementById("cloak-reset").addEventListener("click", () => {
  resetCloak();
  setCloakOpen(false);
  toastMsg("Tab name and icon restored");
});
cloakForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  cloakStatus.textContent = "Copying name and icon…";
  try {
    const res = await fetch(`/api/cloak?url=${encodeURIComponent(cloakUrl.value)}`);
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error(body.error || "Could not copy that site.");
    saveCloak({ title: body.title, icon: body.icon || DEFAULT_ICON });
    setCloakOpen(false);
    toastMsg(`Tab is now ${body.title}`);
  } catch (error) {
    cloakStatus.textContent = error.message;
  }
});
navBack.addEventListener("click", () => {
  goBack();
});
navReload.addEventListener("click", () => {
  reloadTab();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setSettingsOpen(false);
    setCloakOpen(false);
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "t") {
    event.preventDefault();
    createTab();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w" && tabs.length) {
    event.preventDefault();
    closeTab(activeId);
  }
});

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
    const tab = activeTab();
    if (tab?.url) await navigateTab(tab, tab.url, { record: false });
  });
}

document.getElementById("setting-search").addEventListener("change", (event) => {
  settings.searchEngine = event.target.value;
  saveSettings();
});
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
loadCloak();
syncSettingsUi();
renderHistory();
createTab();

const bootUrl = new URLSearchParams(location.search).get("url") || settings.homepage;
if (bootUrl) {
  openUrl(bootUrl, { push: false });
} else {
  urlInput.focus();
}
