/* global UVServiceWorker, $scramjetLoadWorker */
importScripts("/uv/uv.bundle.js");
importScripts("/uv/uv.config.js");
importScripts("/uv/uv.sw.js");
importScripts("/scram/scramjet.all.js");

const uv = new UVServiceWorker();
const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

function isScramjetRequest(request) {
  try {
    const { pathname } = new URL(request.url);
    return pathname.startsWith("/scramjet/") || pathname.includes("scramjet.wasm");
  } catch {
    return false;
  }
}

async function handleRequest(event) {
  if (uv.route(event)) {
    return await uv.fetch(event);
  }

  if (isScramjetRequest(event.request)) {
    try {
      await scramjet.loadConfig();
      if (scramjet.route(event)) {
        return await scramjet.fetch(event);
      }
    } catch (error) {
      console.error("[incog] scramjet route failed", error);
    }
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
