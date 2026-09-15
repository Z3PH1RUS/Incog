import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeUrl, normalizeInput, searchUrl, usableDestination } from "../public/lib/url.js";

describe("normalizeInput", () => {
  it("adds https and accepts a public URL", () => {
    assert.equal(normalizeInput("example.com"), "https://example.com/");
    assert.equal(normalizeInput("https://example.com/path"), "https://example.com/path");
  });

  it("searches single words like youtube in the selected engine", () => {
    assert.equal(
      normalizeInput("youtube", { searchEngine: "duckduckgo" }),
      "https://duckduckgo.com/?q=youtube",
    );
    assert.equal(
      normalizeInput("youtube", { searchEngine: "google" }),
      "https://www.google.com/search?q=youtube",
    );
    assert.equal(
      normalizeInput("youtube", { searchEngine: "edge" }),
      "https://www.bing.com/search?q=youtube",
    );
    assert.equal(
      normalizeInput("https://youtube/", { searchEngine: "duckduckgo" }),
      "https://duckduckgo.com/?q=youtube",
    );
    assert.equal(
      normalizeInput("https://youtube.com/watch?v=1"),
      "https://youtube.com/watch?v=1",
    );
  });

  it("does not treat the Incog chrome or a page title as a destination", () => {
    assert.equal(usableDestination("Incog — private proxy"), "");
    assert.equal(
      usableDestination(
        "https://incog.example/?url=Incog%20%E2%80%94%20private%20proxy",
        "https://incog.example",
      ),
      "",
    );
    assert.equal(usableDestination("https://example.com/"), "https://example.com/");
  });

  it("treats spaced text as a search", () => {
    assert.equal(
      normalizeInput("funny cats", { searchEngine: "google" }),
      "https://www.google.com/search?q=funny%20cats",
    );
    assert.equal(looksLikeUrl("funny cats"), false);
    assert.equal(looksLikeUrl("youtube"), false);
    assert.equal(looksLikeUrl("youtube.com"), true);
    assert.equal(searchUrl("cats", "edge"), "https://www.bing.com/search?q=cats");
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
