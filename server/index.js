import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleProxy } from "./proxy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../public");
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "SAMEORIGIN");
  res.setHeader(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=()",
  );
  next();
});

const hits = new Map();
const RATE_LIMIT = 90;
const RATE_WINDOW_MS = 60_000;

app.use("/proxy", (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = hits.get(ip) || { count: 0, reset: now + RATE_WINDOW_MS };
  if (now > bucket.reset) {
    bucket.count = 0;
    bucket.reset = now + RATE_WINDOW_MS;
  }
  bucket.count += 1;
  hits.set(ip, bucket);
  if (bucket.count > RATE_LIMIT) {
    res.status(429).type("html").send("Too many proxy requests. Try again shortly.");
    return;
  }
  next();
});

app.get("/proxy", handleProxy);
app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "incog" });
});

app.use(express.static(publicDir, { extensions: ["html"] }));

app.use((req, res) => {
  if (req.path.startsWith("/proxy")) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.sendFile(path.join(publicDir, "index.html"));
});

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Incog ready at http://localhost:${PORT}`);
  });
}

export { app };
