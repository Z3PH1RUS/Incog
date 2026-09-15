import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sw = readFileSync(path.join(root, "public/sw.js"), "utf8");
const app = readFileSync(path.join(root, "public/app.js"), "utf8");

describe("scramjet service worker routing", () => {
  it("never falls through /scramjet/ navigations to the Express 404", () => {
    assert.match(sw, /pathnameOf\(request\)\.startsWith\("\/scramjet\/"\)/);
    assert.match(sw, /if \(isScramjetPrefix\(event\.request\)\)/);
    assert.match(sw, /return await scramjet\.fetch\(event\)/);
    assert.match(sw, /ensureScramjetConfig/);
    assert.doesNotMatch(
      sw,
      /if \(isScramjetRequest\(event\.request\)\)[\s\S]*if \(scramjet\.route\(event\)\)[\s\S]*return fetch\(event\.request\)/,
    );
  });

  it("does not create an empty \$scramjet IndexedDB before init", () => {
    assert.match(app, /function openExistingIdb/);
    assert.match(app, /event\.oldVersion === 0/);
    assert.match(app, /event\.target\.transaction\.abort\(\)/);
    assert.doesNotMatch(app, /indexedDB\.open\(name, version\)/);
    assert.doesNotMatch(app, /request\.onupgradeneeded = \(\) => \{\}/);
  });

  it("waits for the service worker to control the page before engines start", () => {
    assert.match(app, /navigator\.serviceWorker\.controller/);
    assert.match(app, /controllerchange/);
  });
});
