const TRACKER_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "msclkid",
  "twclid",
  "ttclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "_ga",
  "_gl",
]);

export const SEARCH_ENGINES = {
  google: "https://www.google.com/search?q=",
  edge: "https://www.bing.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q=",
};

export function usableDestination(raw, selfOrigin = "") {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  if (selfOrigin) {
    try {
      if (parsed.origin === new URL(selfOrigin).origin) {
        const path = parsed.pathname || "/";
        if (
          path === "/" ||
          path === "/index.html" ||
          path === "/sw.js" ||
          path.startsWith("/api/") ||
          parsed.searchParams.has("url")
        ) {
          return "";
        }
      }
    } catch {}
  }
  return parsed.href;
}

export function searchUrl(query, engine = "duckduckgo") {
  const base = SEARCH_ENGINES[engine] || SEARCH_ENGINES.duckduckgo;
  return `${base}${encodeURIComponent(String(query ?? "").trim())}`;
}

export function looksLikeUrl(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(trimmed)) return true;

  const host = trimmed.split("/")[0].split("?")[0].split("#")[0].split(":")[0];
  if (!host) return false;
  if (host.toLowerCase() === "localhost") return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes(":")) return true;
  return host.includes(".");
}

function shouldSearchHost(host) {
  const name = String(host ?? "").replace(/^\[|\]$/g, "");
  if (!name) return true;
  if (name.toLowerCase() === "localhost") return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(name)) return false;
  if (name.includes(":")) return false;
  return !name.includes(".");
}

export function normalizeInput(
  raw,
  { forceHttps = false, privacy = false, searchEngine = "duckduckgo" } = {},
) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";

  if (!looksLikeUrl(trimmed)) {
    return searchUrl(trimmed, searchEngine);
  }

  let value = trimmed;
  if (!/^[a-zA-Z][a-zA-Z+\-.]*:/.test(value)) {
    value = `https://${value}`;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Enter a valid http(s) URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs can be opened.");
  }

  if (shouldSearchHost(parsed.hostname)) {
    return searchUrl(parsed.hostname || trimmed, searchEngine);
  }

  if (forceHttps && parsed.protocol === "http:") {
    parsed.protocol = "https:";
  }

  if (privacy) {
    for (const key of [...parsed.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (TRACKER_PARAMS.has(lower) || lower.startsWith("utm_")) {
        parsed.searchParams.delete(key);
      }
    }
  }

  parsed.hash = "";
  return parsed.href;
}
