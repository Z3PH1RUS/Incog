import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CNAME_TARGET, parseByodDomain } from "../server/byod.js";

describe("parseByodDomain", () => {
  it("accepts a hostname and strips scheme or path", () => {
    assert.equal(parseByodDomain("proxy.example.com"), "proxy.example.com");
    assert.equal(parseByodDomain("https://PROXY.Example.com/foo"), "proxy.example.com");
  });

  it("rejects the Incog host and junk", () => {
    assert.throws(() => parseByodDomain("youtube"));
    assert.throws(() => parseByodDomain(CNAME_TARGET));
    assert.throws(() => parseByodDomain("https://not a domain"));
  });
});
