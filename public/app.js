const HISTORY_KEY = "incog.history.v1";
const MAX_HISTORY = 8;

const home = document.getElementById("home");
const browse = document.getElementById("browse");
const homeForm = document.getElementById("home-form");
const browseForm = document.getElementById("browse-form");
const homeInput = document.getElementById("home-url");
const browseInput = document.getElementById("browse-url");
const frame = document.getElementById("view");
const progress = document.getElementById("progress");
const historyWrap = document.getElementById("history-wrap");
const historyList = document.getElementById("history");
const topActions = document.querySelector(".top-actions");

function normalizeInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function proxySrc(url) {
  return `/proxy?url=${encodeURIComponent(url)}`;
}

function readHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
}

function remember(url) {
  const next = [url, ...readHistory().filter((item) => item !== url)];
  writeHistory(next);
  renderHistory();
}

function renderHistory() {
  const items = readHistory();
  historyList.replaceChildren();
  if (!items.length) {
    historyWrap.hidden = true;
    return;
  }
  historyWrap.hidden = false;
  for (const url of items) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "item";
    button.textContent = url;
    button.addEventListener("click", () => openUrl(url));
    li.append(button);
    historyList.append(li);
  }
}

function setBrowseMode(on) {
  document.body.classList.toggle("is-browse", on);
  home.hidden = on;
  browse.hidden = !on;
  browseForm.hidden = !on;
  topActions.hidden = !on;
}

function setLoading(on) {
  progress.hidden = !on;
}

function openUrl(raw, { push = true } = {}) {
  const url = normalizeInput(raw);
  if (!url) {
    homeForm.classList.remove("shake");
    void homeForm.offsetWidth;
    homeForm.classList.add("shake");
    return;
  }

  homeInput.value = url;
  browseInput.value = url;
  setBrowseMode(true);
  setLoading(true);
  frame.src = proxySrc(url);
  remember(url);

  const next = `/?url=${encodeURIComponent(url)}`;
  if (push) {
    history.pushState({ url }, "", next);
  } else {
    history.replaceState({ url }, "", next);
  }
}

homeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  openUrl(homeInput.value);
});

browseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  openUrl(browseInput.value);
});

document.getElementById("home-btn").addEventListener("click", () => {
  setBrowseMode(false);
  setLoading(false);
  frame.src = "about:blank";
  history.pushState({}, "", "/");
  homeInput.focus();
});

document.getElementById("clear-history").addEventListener("click", () => {
  writeHistory([]);
  renderHistory();
});

frame.addEventListener("load", () => {
  setLoading(false);
  try {
    const proxied = new URL(frame.contentWindow.location.href);
    const current = proxied.searchParams.get("url");
    if (current) {
      browseInput.value = current;
      homeInput.value = current;
      history.replaceState({ url: current }, "", `/?url=${encodeURIComponent(current)}`);
    }
  } catch {
    /* cross-origin or empty frame */
  }
});

window.addEventListener("popstate", (event) => {
  const url = event.state?.url || new URLSearchParams(location.search).get("url");
  if (url) {
    openUrl(url, { push: false });
  } else {
    setBrowseMode(false);
    frame.src = "about:blank";
  }
});

const bootUrl = new URLSearchParams(location.search).get("url");
renderHistory();
if (bootUrl) {
  openUrl(bootUrl, { push: false });
} else {
  homeInput.focus();
}
