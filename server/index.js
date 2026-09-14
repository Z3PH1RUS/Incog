import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import {
  CNAME_TARGET,
  attachRailwayDomain,
  byodHints,
  byodSetupMessage,
  currentCname,
  domainPointsAtTarget,
  isAfraidOrgHost,
  isDynuHost,
  parseByodDomain,
  railwayConfig,
  recordsForDomain,
  targetARecords,
} from "./byod.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../public");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;
const thisFile = fileURLToPath(import.meta.url);

wisp.options.allow_private_ips = false;
wisp.options.allow_loopback_ips = false;
// Railway (and similar PaaS) often have no IPv6 egress. Prefer A records so
// TLS to youtube.com / similar hosts does not EOF on a dead AAAA path.
wisp.options.dns_result_order = "ipv4first";
wisp.options.hostname_blacklist = [
  /^(.*\.)?localhost$/i,
  /^(.*\.)?local$/i,
  /^(.*\.)?internal$/i,
  /^metadata\.google\.internal$/i,
  /^metadata\.goog$/i,
  /^metadata$/i,
  /^kubernetes(\.default(\.svc(\.cluster\.local)?)?)?$/i,
];

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((req, res, next) => {
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=()",
  );
  next();
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    name: "incog",
    engines: ["ultraviolet", "scramjet"],
    transport: "wisp+epoxy",
    byod: {
      cname: CNAME_TARGET,
      attach: Boolean(railwayConfig()),
    },
  });
});

app.get("/api/byod", async (req, res) => {
  const a = await targetARecords();
  const requested = String(req.query.domain || "").trim();
  let domain = "";
  try {
    if (requested) domain = parseByodDomain(requested);
  } catch {
    domain = "";
  }
  const records = domain ? recordsForDomain(domain) : null;
  res.json({
    ok: true,
    cname: CNAME_TARGET,
    a,
    attach: Boolean(railwayConfig()),
    hints: byodHints(),
    records,
  });
});

app.post("/api/byod", express.json({ limit: "8kb" }), async (req, res) => {
  try {
    const domain = parseByodDomain(req.body?.domain);
    const dns = await domainPointsAtTarget(domain);
    const seenCname = await currentCname(domain);
    const train404 = dns === "a";
    const freedns = await isAfraidOrgHost(domain);
    const dynu = isDynuHost(domain);
    const attach = await attachRailwayDomain(domain);
    const records = attach.records || recordsForDomain(domain);
    const verified = Boolean(attach.verified);
    res.json({
      ok: true,
      domain,
      dns,
      seenCname,
      train404,
      freedns,
      dynu,
      attached: attach.attached,
      verified,
      records,
      message: byodSetupMessage({
        domain,
        attached: attach.attached,
        verified,
        train404,
        records,
        freedns,
        dynu,
        seenCname,
      }),
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "Could not attach that domain.",
    });
  }
});

app.get("/sw.js", (_req, res) => {
  res.setHeader("Service-Worker-Allowed", "/");
  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript");
  res.sendFile(path.join(publicDir, "sw.js"));
});

app.use(express.static(publicDir, { extensions: ["html"] }));
app.use("/uv/", express.static(uvPath));
app.use("/epoxy/", express.static(epoxyPath));
app.use("/baremux/", express.static(baremuxPath));
app.use(
  "/scram/",
  express.static(scramjetPath, {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".wasm") || filePath.endsWith(".wasm.wasm")) {
        res.setHeader("Content-Type", "application/wasm");
      }
    },
  }),
);

app.use((req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const server = createServer();

server.on("request", (req, res) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  app(req, res);
});

server.on("upgrade", (req, socket, head) => {
  if (req.url && (req.url === "/wisp/" || req.url.endsWith("/wisp/"))) {
    wisp.routeRequest(req, socket, head);
    return;
  }
  socket.end();
});

function start(port = PORT, host = HOST) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const addr = server.address();
      const shown =
        typeof addr === "object" && addr
          ? `${addr.address}:${addr.port}`
          : `${host}:${port}`;
      console.log(`Incog ready at http://${shown}`);
      console.log("Engines: Ultraviolet + Scramjet over Wisp/Epoxy");
      resolve(server);
    });
  });
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === thisFile;

if (invokedDirectly) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { app, server, start };
