const DEFAULT_ORIGIN = "incog-production-591c.up.railway.app";

// Cloudflare cannot run Incog (no long-lived Node, no Wisp). This Worker is
// only a public hostname: it forwards HTTP and /wisp/ WebSocket upgrades to
// Railway with the origin Host header, which avoids Railway's train 404.
export default {
  async fetch(request, env) {
    const originHost = env.ORIGIN || DEFAULT_ORIGIN;
    const outbound = new URL(request.url);
    outbound.hostname = originHost;
    outbound.protocol = "https:";
    return fetch(outbound, request);
  },
};
