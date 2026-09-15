/* global UVServiceWorker, $scramjetLoadWorker */
importScripts("/uv/uv.bundle.js");
importScripts("/uv/uv.config.js");
importScripts("/uv/uv.sw.js");
importScripts("/scram/scramjet.all.js");

const uv = new UVServiceWorker();
const { ScramjetServiceWorker } = $scramjetLoadWorker();

const SCRAMJET_STORES = [
  "config",
  "cookies",
  "redirectTrackers",
  "referrerPolicies",
  "publicSuffixList",
];

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

function openScramjetDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("$scramjet", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const name of SCRAMJET_STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
  });
}

function deleteScramjetDb() {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase("$scramjet");
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

// ScramjetServiceWorker’s constructor opens $scramjet at version 1 with no
// upgrade callback. If that runs first it creates a store-less DB that
// ScramjetController.init() can never repair. Create the schema first.
async function ensureScramjetSchema() {
  let db = await openScramjetDb();
  const missing = SCRAMJET_STORES.some((name) => !db.objectStoreNames.contains(name));
  db.close();
  if (!missing) return;
  await deleteScramjetDb();
  db = await openScramjetDb();
  db.close();
}

const schemaReady = ensureScramjetSchema();
let scramjetPromise;
let rewriterReady = false;

function getScramjet() {
  if (!scramjetPromise) {
    scramjetPromise = schemaReady.then(() => new ScramjetServiceWorker());
  }
  return scramjetPromise;
}

async function ensureScramjetConfig(scramjet) {
  if (rewriterReady && scramjet.config?.prefix) return true;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      // postMessage can set config without fetching WASM. Clear it so
      // loadConfig() reads IndexedDB and loads the rewriter.
      scramjet.config = undefined;
      await scramjet.loadConfig();
      if (scramjet.config?.prefix) {
        rewriterReady = true;
        return true;
      }
    } catch (error) {
      console.error("[incog] scramjet loadConfig failed", error);
    }
    await sleep(50);
  }
  return Boolean(scramjet.config?.prefix);
}

async function handleRequest(event) {
  if (uv.route(event)) {
    return await uv.fetch(event);
  }

  if (!isScramjetPrefix(event.request)) {
    return fetch(event.request);
  }

  const scramjet = await getScramjet();
  await ensureScramjetConfig(scramjet);
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

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all([schemaReady, self.skipWaiting()]));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(schemaReady.then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});
