import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { server, start } from "../server/index.js";

describe("standalone website server", () => {
  let base = "";

  it("serves the site, health check, and engine assets from one process", async () => {
    await start(0, "127.0.0.1");
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    base = `http://127.0.0.1:${addr.port}`;

    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.engines, ["ultraviolet", "scramjet"]);
    assert.equal(body.transport, "wisp+epoxy");

    const home = await fetch(base);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /Incog/);
    assert.match(html, /ultraviolet/i);
    assert.match(html, /\/app\.js/);
    assert.doesNotMatch(html, /Live site/i);
    assert.doesNotMatch(html, /Use this Railway URL/);
    assert.doesNotMatch(html, /byod-card/);
    assert.doesNotMatch(html, /Pick <strong>Ultraviolet<\/strong>/);
    assert.doesNotMatch(html, /class="tips"/);
    assert.doesNotMatch(html, /id="popular"/);
    assert.doesNotMatch(html, /wikipedia\.org/);

    const uv = await fetch(`${base}/uv/uv.bundle.js`);
    assert.equal(uv.status, 200);

    const sj = await fetch(`${base}/scram/scramjet.all.js`);
    assert.equal(sj.status, 200);

    const byod = await fetch(`${base}/api/byod`);
    assert.equal(byod.status, 200);
    const byodBody = await byod.json();
    assert.equal(byodBody.ok, true);
    assert.ok(byodBody.cname);
    assert.ok(Array.isArray(byodBody.a));

    const attach = await fetch(`${base}/api/byod`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "incog.freeddns.org" }),
    });
    assert.equal(attach.status, 200);
    const attachBody = await attach.json();
    assert.equal(attachBody.ok, true);
    assert.equal(attachBody.domain, "incog.freeddns.org");
    assert.equal(attachBody.records.cname, "2q9gavwd.up.railway.app");
    assert.equal(attachBody.dynu, true);
    assert.match(attachBody.message, /Dynu/);
  });

  after(
    () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  );
});
