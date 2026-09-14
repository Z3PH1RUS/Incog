const DEFAULT_ORIGIN = "incog-production-591c.up.railway.app";

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const originHost = env.ORIGIN || DEFAULT_ORIGIN;
    const outbound = new URL(incoming.toString());
    outbound.hostname = originHost;
    outbound.protocol = "https:";

    const headers = new Headers(request.headers);
    headers.set("Host", originHost);
    headers.set("X-Forwarded-Host", incoming.hostname);
    headers.set("X-Forwarded-Proto", "https");

    return fetch(outbound.toString(), {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });
  },
};
