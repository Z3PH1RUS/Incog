import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CNAME_TARGET, byodHints, byodSetupMessage, isDynuHost, parseByodDomain } from "../server/byod.js";

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
  it("gives Dynu DNS Record steps for incog.dynu.net", () => {
    assert.equal(isDynuHost("incog.dynu.net"), true);
    const records = byodHints()["incog.dynu.net"];
    const message = byodSetupMessage({
      domain: "incog.dynu.net",
      attached: true,
      verified: false,
      dynu: true,
      records,
    });
    assert.match(message, /Dynu/);
    assert.match(message, /qom0vyax\.up\.railway\.app/);
    assert.match(message, /_railway-verify/);
    assert.match(message, /Delete the A/);
  });
});
