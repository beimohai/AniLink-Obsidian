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
assert.match(pkg.releaseDate, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(manifest.isDesktopOnly, false);
assert.match(manifest.description, /[.。]$/);
assert.ok(manifest.description.length <= 250);
const source = fs.readFileSync("main.js", "utf8");
assert.ok(source.includes("const ANI_RELEASE_DATE = " + JSON.stringify(pkg.releaseDate)));
for (const name of ["README.md", "README_EN.md"]) {
  const text = fs.readFileSync(name, "utf8");
  assert.ok(text.includes("**" + manifest.version + "**"), "Missing current version in " + name);
  assert.ok(text.includes("**" + pkg.releaseDate + "**"), "Missing release date in " + name);
}
assert.ok(fs.readFileSync("CHANGELOG.md", "utf8").includes("## " + manifest.version + " — " + pkg.releaseDate));
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
