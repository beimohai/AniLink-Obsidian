const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const C = require("../core");

test("mobile loads and saves Bangumi edits without Node or Electron imports", async () => {
  const storage = new Map([["anilink-mobile-device", "fixture-mobile-device"]]);
  let saved;
  class Plugin {
    constructor() {
      this.app = {
        loadLocalStorage: (key) => storage.get("vault-" + key),
        saveLocalStorage: (key, value) => storage.set("vault-" + key, value),
      };
    }
    async loadData() { return { storage: "vault", records: {}, state: C.defaults() }; }
    async saveData(value) { saved = value; }
    registerView() {}
    addRibbonIcon() {}
    addCommand() {}
    addSettingTab() {}
  }
  const sandbox = {
    module: { exports: {} }, console, URL, URLSearchParams,
    window: { localStorage: { getItem: (key) => storage.get(key), setItem: () => { throw Error("New identity writes must use the Obsidian API"); } } },
    require(id) {
      assert.equal(id, "obsidian", "Mobile attempted to import a desktop module");
      return { Plugin, ItemView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, Notice: class {}, Platform: { isMobile: true, isDesktop: false }, requestUrl() { throw Error("Unexpected network"); } };
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../main.js"), "utf8"), sandbox);
  const plugin = new sandbox.module.exports();
  assert.equal(plugin.constructor.name, "MobileAniLink");
  await plugin.onload();
  assert.equal(plugin.mobileDeviceId, "fixture-mobile-device");
  assert.equal(storage.get("vault-anilink-mobile-device"), "fixture-mobile-device");
  storage.delete("anilink-mobile-device");
  const reloaded = new sandbox.module.exports();
  await reloaded.onload();
  assert.equal(reloaded.mobileDeviceId, plugin.mobileDeviceId);
  plugin.state.shows.push(C.newShow({ id: 253, name: "Test" }));
  plugin.state.shows[0].rate = 8;
  await plugin.persistMobile();
  assert.equal(saved.state.shows[0].rate, 8);
  assert.ok(Object.keys(saved.records).length);
});
