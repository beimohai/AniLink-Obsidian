"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const vm = require("node:vm");
const C = require("../core");
const M = require("../src/sync-model");
async function fixture(t, saved, legacy) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "anilink-storage-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const vault = path.join(root, "vault");
  const id = crypto
    .createHash("sha256")
    .update(vault)
    .digest("hex")
    .slice(0, 24);
  const folder = path.join(root, "AniLink");
  await fs.mkdir(folder);
  const oldFile = path.join(folder, id + ".json");
  if (legacy) await fs.writeFile(oldFile, JSON.stringify(legacy));
  let document = saved;
  class AniLink {
    async loadData() {
      return structuredClone(document);
    }
    async saveData(value) {
      document = structuredClone(value);
    }
    async onload() {
      this.state = await this.loadData();
      this.saveChain = Promise.resolve();
    }
    persist() {
      const snapshot = structuredClone(this.state);
      this.saveChain = this.saveChain.then(() => this.saveData(snapshot));
      return this.saveChain;
    }
    registerInterval() {}
    background() {}
    redraw() {}
  }
  const context = {
    AniLink,
    Connections: class {},
    fs,
    path,
    C,
    process: { env: { LOCALAPPDATA: root } },
    require: (name) => (name === "./sync-model" ? M : require(name)),
    window: {
      setInterval() {
        return 0;
      },
    },
  };
  vm.runInNewContext(await fs.readFile("src/device-sync.js", "utf8"), context);
  const p = new AniLink();
  p.app = { vault: { adapter: { getBasePath: () => vault } } };
  p.manifest = { dir: ".obsidian/plugins/anilink" };
  return {
    p,
    oldFile,
    get: () => document,
    set: (value) => {
      document = value;
    },
  };
}
function state() {
  const s = C.defaults();
  s.shows = [
    C.newShow({ id: 42, name: "Example" }, [{ id: 100, type: 0, sort: 1 }]),
  ];
  s.settings.bgmToken = "fixture-token";
  return JSON.parse(JSON.stringify(s));
}
test("legacy full state migrates into plugin data without deleting recovery source", async (t) => {
  const original = state();
  const f = await fixture(
    t,
    { version: 2, deviceStorage: 1 },
    { state: original, deviceId: "a".repeat(32) },
  );
  await f.p.onload();
  assert.equal(f.get().storage, "vault");
  assert.deepEqual(f.get().state, original);
  assert.ok(Object.keys(f.get().records).length > 0);
  assert.ok(await fs.stat(f.oldFile));
});
test("copied plugin data wins over stale machine data and keeps a separate device identity", async (t) => {
  const expected = state();
  const f = await fixture(
    t,
    { storage: "vault", state: expected },
    { state: C.defaults(), deviceId: "a".repeat(32) },
  );
  await f.p.onload();
  assert.deepEqual(f.p.state, expected);
  assert.notEqual(f.p.deviceId, "a".repeat(32));
  const reopened = new f.p.constructor();
  reopened.app = f.p.app;
  reopened.manifest = f.p.manifest;
  await reopened.onload();
  assert.equal(f.get().state.shows.length, 1);
  assert.equal(reopened.deviceId, f.p.deviceId);
});
test("invalid vault data stops loading and preserves the original document", async (t) => {
  const f = await fixture(t, { storage: "vault", state: { shows: "invalid" } });
  await assert.rejects(f.p.onload(), /格式无效/);
  assert.equal(f.get().state.shows, "invalid");
});
test("external progress merge retains a concurrent local rating", async (t) => {
  const f = await fixture(t, { storage: "vault", state: state() });
  await f.p.onload();
  const incoming = structuredClone(f.get());
  incoming.state.shows[0].episodes[0].watched = true;
  incoming.records = M.capture(
    incoming.records,
    M.project(f.p.state),
    M.project(incoming.state),
    "b".repeat(32),
  );
  f.p.state.shows[0].rate = 8;
  f.set(incoming);
  await f.p.onExternalSettingsChange();
  assert.equal(f.p.state.shows[0].rate, 8);
  assert.equal(f.p.state.shows[0].episodes[0].watched, true);
});
