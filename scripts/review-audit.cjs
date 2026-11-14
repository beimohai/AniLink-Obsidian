"use strict";
const fs = require("fs"),
  vm = require("vm"),
  assert = require("node:assert/strict");
const manifest = JSON.parse(fs.readFileSync("manifest.json")),
  pkg = JSON.parse(fs.readFileSync("package.json")),
  versions = JSON.parse(fs.readFileSync("versions.json"));
assert.equal(manifest.id, "anilink");
assert.equal(manifest.version, pkg.version);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.equal(manifest.isDesktopOnly, true);
assert.match(manifest.description, /[.。]$/);
assert.ok(manifest.description.length <= 250);
const source = fs.readFileSync("main.js", "utf8");
new vm.Script(source);
new vm.Script(fs.readFileSync("core.js", "utf8"));
for (const pattern of [
  /\.innerHTML\s*=/,
  /\.outerHTML\s*=/,
  /insertAdjacentHTML\s*\(/,
  /\.style\.[a-z]+\s*=/,
  /detachLeavesOfType\s*\(/,
  /window\.app\b/,
  /\b(?:eval|new Function)\s*\(/,
])
  assert.ok(!pattern.test(source), "Forbidden source pattern: " + pattern);
for (const name of [
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/INSTALL.md",
  "docs/WORKFLOW.md",
  "docs/TESTING.md",
])
  assert.ok(fs.existsSync(name), "Missing " + name);
assert.ok(source.includes("registerInterval("));
assert.ok(source.includes("requestUrl"));
console.log(
  "Manifest, syntax, lifecycle conventions and documentation audit passed.",
);
