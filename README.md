# Incog

Incog is a privacy-oriented web proxy with an incognito-mode look: matte black, charcoal surfaces, and a quiet purple accent. You type a URL, the Node server fetches it, rewrites links and assets, and shows the page through Incog so the destination sees the proxy host instead of your browser.

This is a **working HTTP(S) proxy**, not a UI mock. It is a personal hop, not Tor and not an anonymity network.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and submit `https://example.com`. You should see the proxied Example Domain page inside Incog.

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the server with file watching (`node --watch`) |
| `npm start` | Production listen on `PORT` or `3000` |
| `npm run build` | No-op — the frontend is static |
| `npm test` | SSRF and HTML-rewrite unit tests |

Requires **Node 18.18+**.

## Architecture

```
browser  →  Incog UI (static)  →  GET /proxy?url=…
                 │
                 ▼
         validate + SSRF checks
         DNS pin to a public address
         fetch target (timeout, redirect re-check)
         rewrite HTML/CSS URLs back through /proxy
                 │
                 ▼
         iframe / navigation in the Incog chrome
```

- **Frontend:** static files in `public/` (landing URL bar, browse chrome, optional `localStorage` history).
- **Backend:** Express in `server/index.js`.
- **Safety:** `server/ssrf.js` normalizes URLs, blocks dangerous schemes, and refuses localhost, private, link-local, CGNAT, unique-local, and reserved ranges — including cloud metadata addresses such as `169.254.169.254` and `metadata.google.internal`.
- **Rewriting:** `server/rewrite.js` points `href` / `src` / `srcset` / CSS `url()` / form actions at `/proxy` so basic browsing stays on the hop.

Recent URLs are stored only in the browser (`localStorage`). Clearing history never hits the server.

## Security notes

Incog is meant for **self-hosted, trusted use**. Treat an open proxy on the public internet as a liability.

What it does:

- Allows only `http:` and `https:`
- Rejects credentials in URLs, oversized URLs, and unknown schemes (`file:`, `javascript:`, `data:`, …)
- Resolves DNS, drops private/reserved answers, and pins the TCP connection to a pre-checked address (limits DNS rebinding)
- Re-validates every redirect target
- Uses fetch timeouts and response size caps
- Strips `Set-Cookie`, CSP, and `X-Frame-Options` from upstream so the page can render in the Incog frame without writing cookies on the Incog origin
- Applies a simple per-IP rate limit on `/proxy`

What it does not do:

- Hide you from the proxy operator (that is you, if you self-host)
- Hide the server’s IP from the destination
- Perfectly rewrite JavaScript-driven navigation or XHR to same-origin paths
- Replace a VPN, Tor, or a hardened corporate proxy

Do not point Incog at systems you are not allowed to reach. SSRF protections are there to stop the server from being used against itself and internal networks — they are not a permission slip.

## Deploy

The proxy **must run on a Node host**. Plain GitHub Pages (or any static file host) can serve the UI but cannot fetch third-party sites.

Good fits:

- [Render](https://render.com), [Railway](https://railway.app), [Fly.io](https://fly.io), or a VPS
- `PORT` is honored; a `Procfile` (`web: npm start`) is included
- Set the start command to `npm start` and the install command to `npm install`

Environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Listen address |

Put the service behind HTTPS at the edge (the platform’s TLS or Caddy/nginx). Keep the instance private or authenticated if you are not intentionally running a public proxy.

## License

[MIT](./LICENSE)
