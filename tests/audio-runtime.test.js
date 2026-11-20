"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

test("audio checks, dependency installation and alignment use the available platform interpreter", async () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    class AniLink {}
    const calls = [];
    const source = fs.readFileSync("src/ux.js", "utf8");
    const start = source.indexOf("AniLink.prototype.calibrationPython =");
    const end = source.indexOf("AniLink.prototype.ensureDownloader =", start);
    vm.runInNewContext(source.slice(start, end), {
      AniLink, process: { platform }, path,
      fs: { writeFile: async () => {} },
      execFile: (program, args, options, callback) => {
        calls.push({ program, args });
        callback(program === "python" ? Error("not installed") : null, JSON.stringify({ offsetSeconds: 0 }), "");
      },
    });
    const p = new AniLink();
    p.app = { vault: { adapter: { getBasePath: () => path.resolve("test-vault") } } };
    p.manifest = { dir: ".obsidian/plugins/anilink" };
    p.bundledAudioScript = "fixture";
    assert.equal((await p.calibrationDependencies()).numpy, true);
    await p.installCalibrationNumpy();
    assert.equal((await p.alignSourceAudio("source.mp4", "target.mp4")).offsetSeconds, 0);
    assert.equal(calls.find((call) => call.args.includes("pip")).program, "python3");
    assert.equal(calls.find((call) => call.args.includes("source.mp4")).program, "python3");
  }
});
