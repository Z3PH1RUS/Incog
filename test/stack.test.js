import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { existsSync } from "node:fs";
import path from "node:path";

describe("proxy engine assets", () => {
  it("resolves Ultraviolet, Scramjet, Epoxy, and BareMux paths", () => {
    assert.ok(existsSync(path.join(uvPath, "uv.bundle.js")));
    assert.ok(existsSync(path.join(uvPath, "uv.sw.js")));
    assert.ok(existsSync(path.join(scramjetPath, "scramjet.all.js")));
    assert.ok(existsSync(path.join(scramjetPath, "scramjet.wasm.wasm")));
    assert.ok(existsSync(path.join(epoxyPath, "index.mjs")));
    assert.ok(existsSync(path.join(baremuxPath, "worker.js")));
  });
});
