const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../core');

function mobileFixture(settings = {}) {
  const storage = new Map();
  const initial = C.defaults();
  Object.assign(initial.settings, settings);
  const intervals = [];
  class Plugin {
    constructor() {
      this.app = { loadLocalStorage: (key) => storage.get(key), saveLocalStorage: (key, value) => storage.set(key, value), workspace: { getLeavesOfType: () => [] } };
    }
    async loadData() { return { storage: 'vault', records: {}, state: initial }; }
    async saveData(value) { this.saved = value; }
    registerView(type, factory) { this.viewFactory = factory; }
    addRibbonIcon() {}
    addCommand() {}
    addSettingTab(tab) { this.settingsTab = tab; }
    registerInterval() {}
    register() {}
  }
  const sandbox = {
    module: { exports: {} }, console, URL, URLSearchParams,
    window: { setInterval: (fn) => { intervals.push(fn); return 1; }, clearTimeout() {}, setTimeout: () => 1, localStorage: { getItem: () => null } },
    require(id) {
      assert.equal(id, 'obsidian', 'Mobile attempted to import a desktop module');
      return { Plugin, ItemView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, Notice: class {}, Platform: { isMobile: true, isDesktop: false }, requestUrl() { throw Error('Unexpected network'); } };
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../main.js'), 'utf8') + '\nmodule.exports.sharedSettings = Connections;module.exports.sharedDashboard = Dashboard;', sandbox);
  return { plugin: new sandbox.module.exports(), initial, intervals, exported: sandbox.module.exports };
}

test('mobile registers the shared settings and dashboard', async () => {
  const { plugin, exported } = mobileFixture();
  await plugin.onload();
  assert.ok(plugin.settingsTab instanceof exported.sharedSettings);
  assert.ok(plugin.viewFactory({}) instanceof exported.sharedDashboard);
});

test('mobile watched changes are queued offline and retain desktop subscription settings', async () => {
  const { plugin } = mobileFixture();
  await plugin.onload();
  const show = C.newShow({ id: 253, name: 'Test' });
  show.status = 3;
  show.subscription = { enabled: true, feed: 'https://example.com/rss' };
  const episode = { id: 123, sort: 1, type: 0, watched: false, files: [{ path: 'D:/desktop/video.mkv', progress: 1 }] };
  show.episodes = [episode];
  plugin.state.shows.push(show);
  await plugin.markWatched(show, episode, true);
  await Promise.all(plugin.backgroundTasks.values());
  assert.equal(episode.watched, true);
  assert.equal(plugin.state.queue[0].kind, 'episode');
  await plugin.changeStatus(show, 2);
  await Promise.all(plugin.backgroundTasks.values());
  assert.equal(show.subscription.enabled, true);
  assert.equal(show.subscription.feed, 'https://example.com/rss');
  assert.equal(episode.files.length, 1);
  assert.equal(plugin.state.queue.length, 2);
});

test('mobile remote URL joins paths safely and rejects desktop protocols', async () => {
  const { plugin } = mobileFixture();
  await plugin.onload();
  const settings = { remoteAddress: 'https://example.com/dav', remoteProtocol: 'webdav' };
  assert.equal(plugin.mobileRemoteUrl(settings, '/番剧/第1集.mkv').href, 'https://example.com/dav/%E7%95%AA%E5%89%A7/%E7%AC%AC1%E9%9B%86.mkv');
  assert.throws(() => plugin.mobileRemoteUrl(settings, '../secret'), /远程目录无效/);
  assert.throws(() => plugin.mobileRemoteUrl({ ...settings, remoteProtocol: 'smb' }), /WebDAV/);
});

test('mobile episode pull preserves pending offline watched edits', async () => {
  const { plugin } = mobileFixture();
  await plugin.onload();
  const show = C.newShow({ id: 253, name: 'Test' });
  show.episodes = [{ id: 1, watched: true }, { id: 2, watched: false }];
  plugin.state.queue.push({ kind: 'episode', episodeId: 1 });
  plugin.updateEpisodes = async () => {};
  plugin.bgm = () => ({ pages: async () => [{ episode: { id: 1 }, type: 0 }, { episode: { id: 2 }, type: 2 }] });
  await plugin.loadMobileEpisodes(show);
  assert.equal(show.episodes[0].watched, true);
  assert.equal(show.episodes[1].watched, true);
});

test('mobile identities and captured records are accepted by the merge model', async () => {
  const { plugin } = mobileFixture();
  await plugin.onload();
  assert.match(plugin.mobileDeviceId, /^[a-f0-9]{32}$/);
  plugin.state.shows.push(C.newShow({ id: 15, name: 'Mobile' }));
  await plugin.persist();
  const model = require('../src/sync-model');
  assert.deepEqual(model.merge(plugin.saved.records), JSON.parse(JSON.stringify(plugin.saved.records)));
});

test('failed mobile saves retain the previous baseline and retry the edits', async () => {
  const { plugin } = mobileFixture();
  await plugin.onload();
  plugin.state.shows.push(C.newShow({ id: 15, name: 'Mobile' }));
  const before = JSON.stringify(plugin.mobileBaseline);
  plugin.saveData = async () => { throw Error('disk unavailable'); };
  await assert.rejects(plugin.persist(), /disk unavailable/);
  assert.equal(JSON.stringify(plugin.mobileBaseline), before);
  plugin.saveData = async (value) => { plugin.saved = value; };
  await plugin.persist();
  assert.equal(plugin.saved.state.shows[0].id, 15);
  assert.ok(Object.keys(plugin.saved.records).length);
});


test('unchanged external mobile records do not cause a save feedback loop', async () => {
  const { plugin } = mobileFixture();
  await plugin.onload();
  plugin.state.shows.push(C.newShow({ id: 15, name: 'Mobile' }));
  await plugin.persist();
  plugin.loadData = async () => plugin.saved;
  let writes = 0;
  plugin.saveData = async () => { writes++; };
  await plugin.onExternalSettingsChange();
  assert.equal(writes, 0);
});
