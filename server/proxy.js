import { Readable } from "node:stream";
import { Agent, fetch as undiciFetch } from "undici";
import { assertSafeTarget, UrlValidationError } from "./ssrf.js";
import { rewriteCss, rewriteHtml } from "./rewrite.js";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;
const MAX_REWRITE_BYTES = 8 * 1024 * 1024;
const MAX_STREAM_BYTES = 40 * 1024 * 1024;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
  "set-cookie",
  "set-cookie2",
  "strict-transport-security",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "x-xss-protection",
  "clear-site-data",
  "report-to",
  "nel",
]);

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function createPinnedAgent(address, family) {
  return new Agent({
    connectTimeout: FETCH_TIMEOUT_MS,
    headersTimeout: FETCH_TIMEOUT_MS,
    bodyTimeout: FETCH_TIMEOUT_MS,
    connect: {
      timeout: FETCH_TIMEOUT_MS,
      lookup(hostname, options, callback) {
        callback(null, address, family);
      },
    },
  });
}

async function fetchPinned(url, addresses, init) {
  const pinned = addresses[0];
  const agent = createPinnedAgent(pinned.address, pinned.family);
  try {
    return await undiciFetch(url.href, {
      ...init,
      dispatcher: agent,
    });
  } finally {
    agent.close();
  }
}

async function followSafely(startUrl) {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const { url, addresses } = await assertSafeTarget(current.href);
    const response = await fetchPinned(url, addresses, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.8",
        "user-agent": BROWSER_UA,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel?.();
      if (!location) {
        throw new UrlValidationError("Redirect was missing a Location header.");
      }
      if (hop === MAX_REDIRECTS) {
        throw new UrlValidationError("Too many redirects.", 502);
      }
      current = new URL(location, url);
      continue;
    }

    return { response, finalUrl: url };
  }

  throw new UrlValidationError("Too many redirects.", 502);
}

function contentTypeOf(response) {
  return (response.headers.get("content-type") || "application/octet-stream")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function copySafeHeaders(from, to) {
  for (const [key, value] of from.entries()) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    to.setHeader(key, value);
  }
  to.setHeader("cache-control", "private, no-store");
  to.setHeader("referrer-policy", "no-referrer");
  to.setHeader("x-content-type-options", "nosniff");
}

function errorPage(title, detail) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Incog</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: #0c0c0e; color: #ece9e4;
      font: 16px/1.5 "Segoe UI", "Helvetica Neue", ui-sans-serif, system-ui, sans-serif;
    }
    main {
      width: min(440px, calc(100% - 48px));
      padding: 28px;
      border: 1px solid #26252c;
      background: #141417;
      border-radius: 18px;
    }
    h1 { font-size: 1.15rem; margin: 0 0 8px; font-weight: 600; }
    p { margin: 0; color: #9b97a3; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(detail)}</p>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sendError(res, status, title, detail) {
  if (res.headersSent) return;
  res.status(status).type("html").send(errorPage(title, detail));
}

async function readLimited(response, limit) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > limit) {
      const err = new UrlValidationError("Response is too large to rewrite.", 413);
      throw err;
    }
    return buf;
  }

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new UrlValidationError("Response is too large to rewrite.", 413);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function handleProxy(req, res) {
  try {
    const rawUrl = req.query.url;
    const { response, finalUrl } = await followSafely(
      (await assertSafeTarget(rawUrl)).url,
    );

    const type = contentTypeOf(response);
    copySafeHeaders(response.headers, res);
    res.status(response.status);

    if (type.includes("html")) {
      const body = await readLimited(response, MAX_REWRITE_BYTES);
      const html = rewriteHtml(body.toString("utf8"), finalUrl.href);
      res.type("html").send(html);
      return;
    }

    if (type === "text/css") {
      const body = await readLimited(response, MAX_REWRITE_BYTES);
      res.type("css").send(rewriteCss(body.toString("utf8"), finalUrl.href));
      return;
    }

    if (!response.body) {
      res.end();
      return;
    }

    let transferred = 0;
    const nodeStream = Readable.fromWeb(response.body);
    nodeStream.on("data", (chunk) => {
      transferred += chunk.length;
      if (transferred > MAX_STREAM_BYTES) {
        nodeStream.destroy(new Error("too-large"));
      }
    });
    nodeStream.on("error", () => {
      if (!res.headersSent) {
        sendError(res, 502, "Upstream failed", "The remote response could not be streamed.");
      } else {
        res.destroy();
      }
    });
    nodeStream.pipe(res);
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.code === "UND_ERR_CONNECT_TIMEOUT") {
      sendError(res, 504, "Timed out", "The remote site did not respond in time.");
      return;
    }
    if (error instanceof UrlValidationError) {
      sendError(res, error.status, "Request blocked", error.message);
      return;
    }
    sendError(
      res,
      502,
      "Proxy error",
      error?.message || "Incog could not fetch that page.",
    );
  }
}
