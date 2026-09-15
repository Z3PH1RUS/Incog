import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOST =
  /^(localhost|metadata|metadata\.google\.internal|metadata\.goog)(\.|$)/i;
const BLOCKED_SUFFIX = /\.(localhost|local|internal|lan)$/i;
const MAX_HTML = 200_000;
const MAX_ICON = 80_000;
const MAX_REDIRECTS = 3;

function isPrivateIp(ip) {
  const value = String(ip ?? "").replace(/^\[|\]$/g, "");
  if (!value) return true;
  if (value.startsWith("::ffff:")) return isPrivateIp(value.slice(7));
  if (value === "127.0.0.1" || value === "0.0.0.0" || value === "::1") return true;
  if (value.startsWith("10.") || value.startsWith("192.168.") || value.startsWith("169.254.")) {
    return true;
  }
  const match = value.match(/^172\.(\d+)\./);
  if (match) {
    const octet = Number(match[1]);
    if (octet >= 16 && octet <= 31) return true;
  }
  return false;
}

export function decodeEntities(text) {
  return String(text ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

export async function parseCloakTarget(raw) {
  let value = String(raw ?? "").trim();
  if (!value) throw new Error("Enter a site to copy.");
  if (!/^[a-zA-Z][a-zA-Z+\-.]*:/.test(value)) value = `https://${value}`;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Enter a valid http(s) URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https sites can be copied.");
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!host || BLOCKED_HOST.test(host) || BLOCKED_SUFFIX.test(host)) {
    throw new Error("That host cannot be used.");
  }
  if (isIP(host) && isPrivateIp(host)) {
    throw new Error("That host cannot be used.");
  }
  if (!isIP(host)) {
    const rows = await lookup(host, { all: true });
    if (rows.some((row) => isPrivateIp(row.address))) {
      throw new Error("That host cannot be used.");
    }
  }
  return parsed;
}

async function readLimited(res, max) {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    chunks.push(Buffer.from(value));
    if (size >= max) break;
  }
  try {
    await reader.cancel();
  } catch {}
  return Buffer.concat(chunks).subarray(0, max);
}

async function fetchPublic(url, accept, { allowError = false } = {}) {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    current = await parseCloakTarget(current.href);
    const res = await fetch(current, {
      redirect: "manual",
      headers: {
        accept,
        "user-agent": "IncogCloak/1.0",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("Could not read that site.");
      current = new URL(location, current);
      continue;
    }
    if (!res.ok && !allowError) throw new Error("Could not read that site.");
    return { res, finalUrl: current };
  }
  throw new Error("Too many redirects.");
}

function titleFromHtml(html, fallbackHost) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = decodeEntities(match?.[1] || "");
  if (title) return title.slice(0, 120);
  return fallbackHost.replace(/^www\./i, "") || "Cloaked tab";
}

function iconHrefFromHtml(html, base) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/rel\s*=\s*["'][^"']*icon[^"']*["']/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href) return new URL(href, base);
  }
  return new URL("/favicon.ico", base);
}

function iconDataUrl(buffer, contentType) {
  const type = (contentType || "image/x-icon").split(";")[0].trim() || "image/x-icon";
  if (!type.startsWith("image/") && type !== "image/svg+xml") return "";
  return `data:${type};base64,${buffer.toString("base64")}`;
}

function fallbackIcon(host) {
  const letter = (String(host || "?").replace(/^www\./i, "")[0] || "?").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#5b4db8"/><text x="32" y="42" text-anchor="middle" font-size="30" fill="#f7f4ff" font-family="sans-serif">${letter}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

async function fetchIcon(url) {
  try {
    const { res } = await fetchPublic(
      url,
      "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      { allowError: true },
    );
    const type = res.headers.get("content-type") || "";
    if (type.includes("text/html") || type.includes("text/plain")) return "";
    const body = await readLimited(res, MAX_ICON);
    if (!body.length) return "";
    return iconDataUrl(body, type.startsWith("image/") ? type : "image/png");
  } catch {
    return "";
  }
}

export async function fetchCloakMeta(raw) {
  const target = await parseCloakTarget(raw);
  const { res, finalUrl } = await fetchPublic(
    target,
    "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  );
  const html = (await readLimited(res, MAX_HTML)).toString("utf8");
  const title = titleFromHtml(html, finalUrl.hostname);
  const icon =
    (await fetchIcon(iconHrefFromHtml(html, finalUrl))) ||
    (await fetchIcon(new URL(`https://www.google.com/s2/favicons?domain=${finalUrl.hostname}&sz=64`))) ||
    fallbackIcon(finalUrl.hostname);
  return {
    ok: true,
    url: finalUrl.href,
    title,
    icon,
  };
}
