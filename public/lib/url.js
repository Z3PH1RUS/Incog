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

export function normalizeInput(raw, { forceHttps = false, privacy = false } = {}) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";

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

  const host = parsed.hostname;
  const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
  const isIpv6 = host.includes(":");
  if (
    host &&
    !host.includes(".") &&
    !isIpv4 &&
    !isIpv6 &&
    host.toLowerCase() !== "localhost"
  ) {
    parsed.hostname = `${host}.com`;
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
