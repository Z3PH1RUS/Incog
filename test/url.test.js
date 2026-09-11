import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeInput } from "../public/lib/url.js";

describe("normalizeInput", () => {
  it("adds https and accepts a public URL", () => {
    assert.equal(normalizeInput("example.com"), "https://example.com/");
    assert.equal(normalizeInput("https://example.com/path"), "https://example.com/path");
  });

  it("rejects dangerous schemes", () => {
    assert.throws(() => normalizeInput("file:///etc/passwd"));
    assert.throws(() => normalizeInput("javascript:alert(1)"));
  });

  it("can force HTTPS", () => {
    assert.equal(
      normalizeInput("http://example.com/x", { forceHttps: true }),
      "https://example.com/x",
    );
  });

  it("strips tracker query params in privacy mode", () => {
    assert.equal(
      normalizeInput("https://example.com/?utm_source=ad&keep=1&fbclid=abc", {
        privacy: true,
      }),
      "https://example.com/?keep=1",
    );
  });
});
