# Incog

Incog is a privacy-oriented web proxy with an incognito-mode look: matte black, charcoal surfaces, and a quiet purple accent. You type a URL; Incog opens it through a real interception proxy so the destination sees this host instead of your browser.

The **primary engine is [Ultraviolet](https://github.com/titaniumnetwork-dev/Ultraviolet)** (Titanium Network). **[Scramjet](https://github.com/MercuryWorkshop/scramjet)** is available as an alternate engine. Both share the same **Wisp + Epoxy** transport. Switch engines in Settings — the choice is saved in `localStorage` and used for the next navigation.

This is a personal hop, not Tor and not an anonymity network.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and submit `https://example.com`. You should see Example Domain through Ultraviolet (the default). Open **Settings**, choose **Scramjet**, and submit the URL again — same page, other rewriter.

| Script | What it does |
| --- | --- |
| `npm run dev` | Start with file watching (`node --watch`) |
| `npm start` | Production listen on `PORT` or `3000` |
| `npm run build` | No-op — static frontend + vendored engine files |
| `npm test` | URL helpers + engine asset checks |

Requires **Node 18.18+**. Service workers need a secure context: `localhost` or HTTPS.

## Architecture

```
browser (Incog chrome)
   │  URL bar
   ▼
selected engine
   ├─ Ultraviolet  →  /uv/service/<encoded>
   └─ Scramjet     →  /scramjet/<encoded>
   │
   ▼
service worker (public/sw.js)
   routes UV prefix and Scramjet prefix
   │
   ▼
BareMux SharedWorker  →  Epoxy transport  →  WebSocket /wisp/
   │
   ▼
@mercuryworkshop/wisp-js  (Node upgrade handler)
   TCP to the public destination
```

### What is installed

| Package | Role |
| --- | --- |
| `@titaniumnetwork-dev/ultraviolet` | UV rewriter, SW helper, client bundle |
| `@mercuryworkshop/scramjet` | Scramjet rewriter, WASM, controller/SW bundle |
| `@mercuryworkshop/bare-mux` | Transport multiplexer (SharedWorker) |
| `@mercuryworkshop/epoxy-transport` | Encrypted client transport over Wisp |
| `@mercuryworkshop/wisp-js` | Maintained Wisp server (WebSocket upgrade) |
| `express` | Static UI + vendor mounts |

`wisp-server-node` is **not** used — it is deprecated. Incog uses `@mercuryworkshop/wisp-js`.

### How the server is wired

`server/index.js` creates a Node HTTP server (not `app.listen`) so WebSocket upgrades can be handled:

- **HTTP** → Express: `public/`, `/uv/` (UV dist), `/scram/` (Scramjet dist), `/epoxy/`, `/baremux/`
- **Upgrade** `/wisp/` → `wisp.routeRequest(...)`
- Responses set `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (required by this SW / SharedWorker stack)
- `/sw.js` is served with `Service-Worker-Allowed: /` so one worker can own both engine prefixes

Our `public/uv/uv.config.js` overrides UV’s stock config so the prefix is `/uv/service/`.

### How the engine switch works

1. Settings → **Proxy engine** → Ultraviolet or Scramjet.
2. The choice is stored in `localStorage` (`incog.settings.v1`).
3. **Go**, recents, popular chips, and `?url=` all call the same `navigate()` helper.
4. Ultraviolet sets the iframe to `__uv$config.prefix + encodeUrl(url)`.
5. Scramjet uses `ScramjetController.createFrame(iframe)` then `frame.go(url)`.
6. Changing the engine while a page is open reloads that URL through the new rewriter.
7. Both engines already share the BareMux → Epoxy → `/wisp/` hop, so you are not picking a different backend — only the client rewriter.

## Settings (v1)

Persisted in `localStorage`:

| Setting | Behavior |
| --- | --- |
| **Proxy engine** | Ultraviolet (default) or Scramjet |
| Theme | Dark (incognito default), light, or system |
| Open links | Same tab (iframe) or new Incog tab for chrome links |
| Force HTTPS | Upgrade `http://` before the engine runs |
| Strip trackers | Drop `utm_*`, `fbclid`, `gclid`, and similar query params |
| User-agent | Stored (desktop / mobile / custom). SW engines still send a browser-like UA; this is best-effort |
| Homepage | Auto-open this URL when there is no `?url=` |
| Forget me on exit | Do not persist recents; wipe history on `pagehide` |
| Clear cookies & cache | Blank the session, drop recents, delete Cache Storage |

Light privacy mode cannot fully strip scripts the way a toy HTML rewriter could — Ultraviolet and Scramjet must keep page JS to browse. Tracker-query stripping still runs on the URL you submit.

## Security notes

Incog is meant for **self-hosted, trusted use**. An open proxy on the public internet is a liability.

Wisp (`@mercuryworkshop/wisp-js`) is configured with:

- `allow_private_ips: false`
- `allow_loopback_ips: false`
- hostname denylist for `localhost`, `*.internal`, `metadata.google.internal`, Kubernetes in-cluster DNS, etc.

That is the SSRF boundary now: the Wisp server will not open TCP to private, loopback, link-local, CGNAT, or reserved addresses.

What this stack does **not** do:

- Hide you from the proxy operator
- Hide the server IP from the destination
- Replace Tor, a VPN, or a hardened corporate proxy

Do not point Incog at systems you are not allowed to reach.

## Deploy

The proxy **must run on a Node host that supports WebSockets**. Plain GitHub Pages cannot run Wisp. Serverless platforms that drop `upgrade` requests (typical Vercel/Netlify functions) will serve the UI but **will not proxy**.

Good fits: Render, Railway, Fly.io, a VPS, or any long-lived Node process. `PORT` is honored. A `Procfile` (`web: npm start`) is included. Terminate TLS at the edge.

## License

[MIT](./LICENSE) for Incog’s own code.

Upstream: Ultraviolet is **GPL-3.0-or-later**; Scramjet is **MIT**; wisp-js is **LGPL-3.0-or-later**. Check those packages if you redistribute the full stack.
