import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CNAME_TARGET, byodHints, byodSetupMessage, parseByodDomain } from "../server/byod.js";

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

describe("byod setup copy", () => {
  it("explains the train 404 when an A record is pointing at Railway", () => {
    const records = byodHints()["incog.ignorelist.com"];
    const message = byodSetupMessage({
      domain: "incog.ignorelist.com",
      attached: true,
      verified: false,
      train404: true,
      records,
    });
    assert.match(message, /train 404/);
    assert.match(message, /3j6hiavn\.up\.railway\.app/);
    assert.match(message, /_railway-verify\.incog/);
    assert.match(message, /Dynu/);
  });
});
