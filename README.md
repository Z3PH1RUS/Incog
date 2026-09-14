# Incog

Incog is a privacy-oriented web proxy with an incognito-mode look: matte black, charcoal surfaces, and a quiet purple accent. You type a URL; Incog opens it through a real interception proxy so the destination sees this host instead of your browser.

The **primary engine is [Ultraviolet](https://github.com/titaniumnetwork-dev/Ultraviolet)** (Titanium Network). **[Scramjet](https://github.com/MercuryWorkshop/scramjet)** is available as an alternate engine. Both share the same **Wisp + Epoxy** transport. Switch engines in Settings — the choice is saved in `localStorage` and used for the next navigation.

This is a personal hop, not Tor and not an anonymity network.

**Live site:** [https://incog-production-591c.up.railway.app](https://incog-production-591c.up.railway.app)

Want to host your own copy? One Node process is the whole product — see [Host it as its own website](#host-it-as-its-own-website). GitHub Pages cannot do this.

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

## Host it as its own website

Incog **is** the proxy. One Node process serves the UI, Ultraviolet, Scramjet, and the Wisp WebSocket server. There is no extra backend to attach and no tunnel back to a laptop.

GitHub Pages, Cloudflare Pages, and typical Vercel/Netlify functions cannot run this. They have no long-lived process and they drop `/wisp/` upgrades. The UI would load; browsing would not.

Use a host that keeps a Node process up and passes WebSockets through.

### Render (public URL, free)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Z3PH1RUS/Incog)

1. Open the button (Render account + GitHub login; free web service is enough).
2. After the first deploy you get a URL like `https://incog.onrender.com`. That origin runs the whole stack.

`render.yaml` already sets `npm start`, `NODE_ENV=production`, and `/health`. Free instances sleep after ~15 minutes idle and take about a minute to wake.

### Railway

Live deployment: [https://incog-production-591c.up.railway.app](https://incog-production-591c.up.railway.app)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?repo=https://github.com/Z3PH1RUS/Incog)

Same app: `npm start`, health check `/health`. Deploys from `main`.

### Custom domains (paused)

The live product is the Railway URL above. FreeDNS/Dynu CNAMEs were parked after Railway’s train-404 / TXT-quota issues.

### How nowgg.fun is run (reference)

[nowgg.fun](https://nowgg.fun/) is Frogie’s Arcade, not Railway:

- Cloudflare nameservers (`jeff.ns.cloudflare.com` / `nelci.ns.cloudflare.com`)
- A record to a VPS (`69.164.251.212`, `use.frogiesarcade.win` on Interserver)
- Caddy terminates HTTPS (`via: 1.1 Caddy`) and reverse-proxies Express
- Let’s Encrypt HTTP-01 on a **static IP** — no Railway CNAME/TXT

Do **not** point Incog at Frogie’s IP. Copy the pattern: Cloudflare (or Caddy) owns HTTPS; the Node proxy sits behind it.

**Same stack on a VPS** (`docker-compose.yml` + `deploy/Caddyfile`):

```bash
INCOG_DOMAIN=incog.example.com docker compose up -d --build
```

Point an A record at that machine. Caddy gets the certificate.

**Same idea while Incog stays on Railway:** deploy `deploy/cf-worker.js` with Wrangler. Cloudflare issues HTTPS and rewrites `Host` to `incog-production-591c.up.railway.app`, so you never see Railway’s train 404.

```bash
cd deploy && npx wrangler deploy
```

That gives a `*.workers.dev` URL. To keep `incog.freeddns.org`, add that hostname as a Cloudflare zone, put Cloudflare **NS** records on Dynu (delete the Railway CNAME), and attach the Worker route.

Dynu CNAME → Railway still needs a TXT and will 404 until both records match. That is why nowgg.fun does not do it that way.

### Docker / VPS

```bash
docker build -t incog .
docker run --rm -p 3000:3000 incog
```

Or without Docker: `npm ci && npm start`. Listen address is `0.0.0.0` (`HOST`) and `PORT`. Forward WebSocket upgrades for `/wisp/`.

## License

[MIT](./LICENSE) for Incog’s own code.

Upstream: Ultraviolet is **GPL-3.0-or-later**; Scramjet is **MIT**; wisp-js is **LGPL-3.0-or-later**. Check those packages if you redistribute the full stack.
