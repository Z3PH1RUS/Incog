import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../public");
const PORT = Number(process.env.PORT) || 3000;

wisp.options.allow_private_ips = false;
wisp.options.allow_loopback_ips = false;
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
  });
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

if (process.env.NODE_ENV !== "test") {
  server.listen(PORT, () => {
    console.log(`Incog ready at http://localhost:${PORT}`);
    console.log("Engines: Ultraviolet + Scramjet over Wisp/Epoxy");
  });
}

export { app, server };
