/* global UVServiceWorker, $scramjetLoadWorker */
importScripts("/uv/uv.bundle.js");
importScripts("/uv/uv.config.js");
importScripts("/uv/uv.sw.js");
importScripts("/scram/scramjet.all.js");

const uv = new UVServiceWorker();
const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

function pathnameOf(request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "";
  }
}

function isScramjetPrefix(request) {
  return pathnameOf(request).startsWith("/scramjet/");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureScramjetConfig() {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await scramjet.loadConfig();
    } catch (error) {
      console.error("[incog] scramjet loadConfig failed", error);
    }
    if (scramjet.config?.prefix) return true;
    await sleep(50);
  }
  return Boolean(scramjet.config?.prefix);
}

async function handleRequest(event) {
  if (uv.route(event)) {
    return await uv.fetch(event);
  }

  // /scramjet/<encoded> is SW-only. Falling through to the network hits
  // Express's "Not found" catch-all. Wait for IndexedDB config, then always
  // handle the prefix — even if route() would throw on a missing config.
  if (isScramjetPrefix(event.request)) {
    await ensureScramjetConfig();
    try {
      return await scramjet.fetch(event);
    } catch (error) {
      console.error("[incog] scramjet fetch failed", error);
      return new Response("Scramjet could not open that page.", {
        status: 502,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  }

  try {
    await scramjet.loadConfig();
    if (scramjet.config && scramjet.route(event)) {
      return await scramjet.fetch(event);
    }
  } catch (error) {
    console.error("[incog] scramjet route failed", error);
  }

  return fetch(event.request);
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});
