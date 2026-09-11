import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isBlockedIp,
  normalizeTargetUrl,
  UrlValidationError,
} from "../server/ssrf.js";

function rejects(input, status) {
  assert.throws(
    () => normalizeTargetUrl(input),
    (error) => error instanceof UrlValidationError && (!status || error.status === status),
  );
}

describe("normalizeTargetUrl", () => {
  it("accepts a public https URL", () => {
    const url = normalizeTargetUrl("https://example.com/path?q=1");
    assert.equal(url.href, "https://example.com/path?q=1");
  });

  it("rejects missing and malformed values", () => {
    rejects("");
    rejects("not a url");
    rejects("example.com");
  });

  it("blocks dangerous schemes", () => {
    rejects("file:///etc/passwd");
    rejects("javascript:alert(1)");
    rejects("ftp://example.com");
    rejects("data:text/html,hi");
  });

  it("blocks localhost hostnames", () => {
    rejects("http://localhost/", 403);
    rejects("http://localhost.localdomain/", 403);
    rejects("https://app.localhost/", 403);
  });

  it("blocks cloud metadata hostnames", () => {
    rejects("http://metadata.google.internal/", 403);
    rejects("http://metadata.goog/latest/meta-data", 403);
  });

  it("blocks loopback and link-local literals", () => {
    rejects("http://127.0.0.1/", 403);
    rejects("http://[::1]/", 403);
    rejects("http://169.254.169.254/latest/meta-data", 403);
    rejects("http://0.0.0.0/", 403);
  });

  it("blocks private and CGNAT ranges", () => {
    rejects("http://10.0.0.8/", 403);
    rejects("http://192.168.1.1/", 403);
    rejects("http://172.16.0.2/", 403);
    rejects("http://100.64.0.1/", 403);
  });

  it("blocks unique-local IPv6", () => {
    rejects("http://[fd00:ec2::254]/", 403);
    rejects("http://[fe80::1]/", 403);
  });

  it("rejects credentials in URLs", () => {
    rejects("https://user:pass@example.com/");
  });
});

describe("isBlockedIp", () => {
  it("flags loopback, private, and metadata addresses", () => {
    assert.equal(isBlockedIp("127.0.0.1"), true);
    assert.equal(isBlockedIp("10.1.2.3"), true);
    assert.equal(isBlockedIp("192.168.0.10"), true);
    assert.equal(isBlockedIp("169.254.169.254"), true);
    assert.equal(isBlockedIp("::1"), true);
    assert.equal(isBlockedIp("::ffff:127.0.0.1"), true);
  });

  it("allows ordinary public addresses", () => {
    assert.equal(isBlockedIp("93.184.216.34"), false);
    assert.equal(isBlockedIp("1.1.1.1"), false);
    assert.equal(isBlockedIp("8.8.8.8"), false);
  });
});
