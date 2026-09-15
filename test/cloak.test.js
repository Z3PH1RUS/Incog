import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeEntities, parseCloakTarget } from "../server/cloak.js";

describe("cloak target", () => {
  it("accepts a public hostname", async () => {
    const url = await parseCloakTarget("example.com");
    assert.equal(url.hostname, "example.com");
    assert.equal(url.protocol, "https:");
  });

  it("rejects private and dangerous targets", async () => {
    await assert.rejects(() => parseCloakTarget("javascript:alert(1)"));
    await assert.rejects(() => parseCloakTarget("http://127.0.0.1/"));
    await assert.rejects(() => parseCloakTarget("http://localhost/"));
    await assert.rejects(() => parseCloakTarget("http://169.254.169.254/"));
  });

  it("decodes title entities", () => {
    assert.equal(decodeEntities("Example&nbsp;Domain"), "Example Domain");
  });
});
