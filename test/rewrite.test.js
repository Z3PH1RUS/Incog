import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rewriteCss, rewriteHtml, toProxyPath } from "../server/rewrite.js";

describe("toProxyPath", () => {
  it("rewrites absolute and relative http(s) URLs", () => {
    assert.equal(
      toProxyPath("/about", "https://example.com/"),
      "/proxy?url=https%3A%2F%2Fexample.com%2Fabout",
    );
    assert.equal(
      toProxyPath("https://other.test/x", "https://example.com/"),
      "/proxy?url=https%3A%2F%2Fother.test%2Fx",
    );
  });

  it("leaves harmless schemes alone", () => {
    assert.equal(toProxyPath("#top", "https://example.com/"), "#top");
    assert.equal(toProxyPath("mailto:hi@example.com", "https://example.com/"), "mailto:hi@example.com");
    assert.equal(toProxyPath("data:text/plain,hi", "https://example.com/"), "data:text/plain,hi");
  });
});

describe("rewriteHtml", () => {
  it("rewrites links, assets, and form actions", () => {
    const html = rewriteHtml(
      `<html><head><base href="https://evil.test/"></head><body>
        <a href="/next">n</a>
        <img src="/logo.png">
        <form action="/search"></form>
      </body></html>`,
      "https://example.com/",
    );
    assert.match(html, /\/proxy\?url=https%3A%2F%2Fexample.com%2Fnext/);
    assert.match(html, /\/proxy\?url=https%3A%2F%2Fexample.com%2Flogo.png/);
    assert.match(html, /\/proxy\?url=https%3A%2F%2Fexample.com%2Fsearch/);
    assert.doesNotMatch(html, /<base/i);
  });
});

describe("rewriteCss", () => {
  it("rewrites url() references", () => {
    const css = rewriteCss(
      "body{background:url('/bg.png')}",
      "https://example.com/style.css",
    );
    assert.match(css, /\/proxy\?url=https%3A%2F%2Fexample.com%2Fbg.png/);
  });
});
