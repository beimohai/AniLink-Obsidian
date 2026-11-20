"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const C = require("../core");

test("desktop remote scanning reconciles missing files without changing local media", async () => {
  class AniLink {}
  const source = fs.readFileSync("src/remote.js", "utf8");
  const start = source.indexOf("AniLink.prototype.scanRemoteVideos =");
  const end = source.indexOf("AniLink.prototype.cacheRemoteVideo =", start);
  vm.runInNewContext(source.slice(start, end), { AniLink, C, path });
  const p = new AniLink();
  p.state = C.defaults();
  Object.assign(p.state.settings, { remoteEnabled: true, remoteDirectory: "/anime" });
  const local = { path: "local.mkv", localExists: true };
  const missing = { remotePath: "/anime/gone.mkv", localExists: true };
  const present = { remotePath: "/anime/unlabelled.mkv", localExists: true };
  p.state.shows = [{ title: "Example", episodes: [{ files: [local, missing, present] }] }];
  p.remoteTarget = (directory) => directory;
  p.remoteCommand = async () => JSON.stringify([{ Name: "unlabelled.mkv", Path: "unlabelled.mkv" }]);
  await p.scanRemoteVideos();
  assert.equal(local.localExists, true);
  assert.equal(missing.localExists, false);
  assert.equal(present.localExists, true);
  missing.localExists = true;
  p.remoteCommand = async () => { throw Error("offline"); };
  await assert.rejects(p.scanRemoteVideos(), /offline/);
  assert.equal(missing.localExists, true);
});
