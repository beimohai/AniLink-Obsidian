const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core");
const fs = require("node:fs");
const vm = require("node:vm");

test("RSS auto refresh refreshes only active AniLink feeds", async () => {
  class AniLink {}
  const source = fs.readFileSync(require.resolve("../src/preferences-runtime.js"), "utf8");
  const start = source.indexOf("AniLink.prototype.refreshRssSubscriptions =");
  const end = source.indexOf("AniLink.prototype.focusLocalPlayer =", start);
  vm.runInNewContext(source.slice(start, end), { AniLink, C });
  const p = new AniLink();
  p.state = { shows: [{ id: 1, subscription: { enabled: true, feed: "https://example.test/feed" } }, { id: 2, subscription: { enabled: false, feed: "https://example.test/paused" } }] };
  const calls = [];
  p.qb = () => ({ call: async (endpoint, params) => calls.push([endpoint, params.itemPath]) });
  await p.refreshRssSubscriptions();
  assert.deepEqual(calls, [["rss/refreshItem", "AniLink-1"]]);
});

test("multi-select source filters use OR inside facets and AND across facets", () => {
  const tags = { language: "简繁", quality: "1080p", codec: "HEVC", subtitle: "内封" };
  assert.equal(C.matchesSourceSearch(tags, { language: ["简中", "简繁"], quality: ["720", "1080"], codec: ["HEVC"] }), true);
  assert.equal(C.matchesSourceSearch(tags, { language: ["简中"], quality: ["1080"] }), false);
  assert.equal(C.matchesSourceSearch(tags, { language: "简繁", codec: "HEVC" }), true);
  assert.equal(C.matchesSourceSearch(tags, { language: [], codec: [] }), true);
});

test("Cyberpunk season 2 matches Chinese season titles and numbered Bilibili parts", () => {
  const show = { id: 513878, title: "赛博朋克：边缘行者 2", name: "Cyberpunk: Edgerunners 2" };
  assert.ok(C.biliTitleMatches(show, "【赛博朋克边缘行者第二季】全10集 中字双语（未删减版）"));
  assert.equal(C.biliTitleMatches(show, "【赛博朋克边缘行者 第一季】全10集"), false);
  assert.equal(C.biliPageEpisode({ part: "1 4K中日", page: 1 }, "全10集"), 1);
  assert.equal(C.biliPageEpisode({ part: "2 4K中日", page: 2 }, "全10集"), 2);
  assert.equal(C.biliPageEpisode({ part: "2026 预告", page: 1 }, "全10集"), null);
});

test("FX LoliHouse ASSx2 releases share the unique compatible profile and download rule", () => {
  const title = (episode, suffix) => `[LoliHouse] FX战士久留美 / FX Senshi Kurumi-chan - ${episode} [WebRip 1080p HEVC-10bit AAC${suffix}]`;
  const rows = [1, 2].map((episode) => ({ title: title(String(episode).padStart(2, "0"), " ASSx2") }));
  rows.push(...["03", "04", "05", "06", "06v2"].map((episode) => ({ title: title(episode, "][简繁内封字幕") })));
  const profiles = C.releaseProfiles(rows);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].rows.length, 7);
  assert.equal(profiles[0].tags.language, "简繁");
  const sub = { feed: "https://example.test/rss", quality: "1080p", language: "简繁", start: 1, end: 12, profile: profiles[0].tags };
  assert.ok(rows.every((row) => C.previewMatch(row.title, sub)));
  assert.equal(C.previewMatch(title("07", "][简中内嵌字幕"), sub), false);
  assert.equal(C.previewMatch(title("07", " ASSx2"), sub), false);
});

test("incomplete releases stay separate when subtitle versions are ambiguous", () => {
  const rows = ["[Group] Show - 01 [1080p HEVC ASSx2]", "[Group] Show - 02 [1080p HEVC][简繁内封]", "[Group] Show - 02 [1080p HEVC][简中内嵌]"].map((title) => ({ title }));
  assert.equal(C.releaseProfiles(rows).length, 3);
});

test("Bangumi mirror routes API calls and retains authentication", async () => {
  let call;
  const client = new C.Bangumi({ json: async (...args) => { call = args; return { id: 1 }; } }, "fixture-token", "https://api.bangumi.lat");
  await client.call("/v0/me");
  assert.equal(call[0], "https://api.bangumi.lat/v0/me");
  assert.equal(call[3].Authorization, "Bearer fixture-token");
});

test("AniClip applies timed video cuts only to the verified episode CID", async () => {
  class AniLink {}
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/aniclip.js"), "utf8"), { AniLink, C });
  const plugin = new AniLink();
  const cut = { type: "v_l", ss: "22:55", t: "00:03", source: "https://b23.tv/ep674238" };
  plugin.http = { json: async (url) => url.includes("timeline/")
    ? { data: { "2022.7": { 1: { title: "奇幻世界舅舅", list: { 1: [cut, { ...cut, type: "v_c" }, { ...cut, t: "" }] } } } } }
    : { result: { episodes: [{ id: 674238, cid: 827258984 }] } } };
  const show = { title: "异世界舅舅", date: "2022-07-06" };
  const cuts = await plugin.officialCuts(show, 1, 827258984);
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].at, 1375);
  assert.equal(cuts[0].duration, 3);
  assert.equal((await plugin.officialCuts(show, 1, 1)).length, 0);
  assert.equal((await plugin.officialCuts(show, 2, 827258984)).length, 0);
});

test("episode ranges preserve gaps and remove duplicates", () => {
  assert.equal(C.episodeRanges([7, 2, 1, 3, 7, 9, 10]), "1-3、7、9-10");
  assert.equal(C.episodeRanges([]), "");
});

test("RSS rules exclude superseded releases and watched episodes", () => {
  const old = "[Group] Show - 01 [1080p]";
  const sub = { feed: "https://example.test/rss", quality: "1080", start: 1, end: 2, enabled: true, supersededTitles: [old], addPaused: true, ignoreDays: 3 };
  const rule = C.buildRule({ id: 1, episodes: [{ type: 0, sort: 2, watched: true }] }, sub);
  assert.equal(new RegExp(rule.mustNotContain, "i").test(old), true);
  assert.equal(new RegExp(rule.mustContain, "i").test("[Group] Show - 02v2 [1080p]"), false);
  assert.equal(rule.addPaused, true);
  assert.equal(rule.ignoreDays, 3);
});


test("portable anime folders reject device names, traversal, controls and UTF-8 overflow", () => {
  for (const title of ["CON", "CON .txt", "NUL.txt", "LPT1", "..", "a/b:c*?", "a\x00b", "名字. ", "番".repeat(200)]) {
    const name = C.folderName(title, 42);
    assert.ok(name.length);
    assert.doesNotMatch(name, /[<>:"/\\|?*\x00-\x1f]/);
    assert.doesNotMatch(name, /[. ]$/);
    assert.ok(Buffer.byteLength(name) <= 200);
    assert.notEqual(name, "..");
  }
  assert.equal(C.folderName("普通番剧", 42), "普通番剧");
  assert.notEqual(C.folderName("a:b", 1), C.folderName("a?b", 2));
});

test("revision toggle follows global setting while explicit per-feed overrides remain intact", () => {
  const sub = { revisionPolicy: "upgrade" };
  assert.equal(C.revisionPolicy({ rssUpgradeUnwatched: false }, sub), "standard");
  assert.equal(C.revisionPolicy({ rssUpgradeUnwatched: true }, sub), "upgrade");
  assert.equal(C.revisionPolicy({ rssUpgradeUnwatched: true }, { customized: true, revisionPolicy: "standard" }), "standard");
  assert.equal(C.revisionPolicy({ rssUpgradeUnwatched: true }, { customized: true }), "upgrade");
});

test("connection refused has a friendly message but auth errors remain distinguishable", () => {
  assert.equal(C.qbConnectionMessage(Error("net::ERR_CONNECTION_REFUSED")), "qBittorrent 未启动，请启动后重试。");
  assert.match(C.qbConnectionMessage(Error("HTTP 403")), /403/);
});

test("source filters recognise Japanese bilingual subtitles, raw sources and 4K", () => {
  for (const [title, language] of [["简日内嵌", "简日"], ["繁日内封", "繁日"], ["CHS_JPN", "简日"], ["CHT_JPN", "繁日"], ["双语", "双语"], ["RAW", "生肉"]]) {
    assert.equal(C.releaseTags(title).language, language);
    assert.ok(C.matchesSourceSearch(C.releaseTags(title), { language: [language] }));
  }
  assert.ok(C.matchesSourceSearch(C.releaseTags("[4K HEVC RAW]"), { quality: ["2160"], language: ["生肉"] }));
});


test("RSS rules match the same bilingual and raw releases selected in source search", () => {
  for (const title of ["[G] Show - 01 [CHS_JPN 1080p HEVC 内嵌]", "[G] Show - 01 [CHT_JPN 4K HEVC 内封]", "[G] Show - 01 [RAW 1080p AVC]"]) {
    const tags = C.releaseTags(title);
    const sub = { feed: "https://example.test/rss", keyword: "Show", quality: tags.quality, language: tags.language, profile: tags, start: 1, end: 2 };
    assert.ok(C.previewMatch(title, sub), title);
  }
});

test("upgrade rules exclude older unwatched versions and leave watched episodes untouched", async () => {
  class AniLink { async installSubscription() {} }
  const source = fs.readFileSync(require.resolve("../src/preferences-runtime.js"), "utf8");
  vm.runInNewContext(source.slice(source.indexOf("const settingsInstallSubscription ="), source.indexOf("const revisionRefresh =")), { AniLink, C });
  const p = new AniLink();
  p.state = { settings: { rssUpgradeUnwatched: true } };
  const show = C.newShow({ id: 1, name: "Show", eps: 2 }, [{ id: 10, sort: 1, type: 0 }, { id: 20, sort: 2, type: 0 }]);
  show.episodes[0].files = [{ hash: "old", name: "Show - 01.mkv" }];
  show.episodes[1].watched = true;
  const rows = ["Show - 01", "Show - 01v2", "Show - 02v2"].map((title) => ({ title }));
  p.readFeed = async () => rows;
  const sub = { feed: "https://example.test/rss", keyword: "Show", start: 1, end: 2, enabled: true };
  await p.installSubscription(show, sub);
  assert.deepEqual(Array.from(sub.supersededTitles), ["Show - 01"]);
  assert.equal(show.episodes[0].pendingRevision.title, "Show - 01v2");
  assert.equal(show.episodes[1].pendingRevision, undefined);
  p.state.settings.rssUpgradeUnwatched = false;
  await p.installSubscription(show, sub);
  assert.equal(sub.supersededTitles.length, 0);
  assert.equal(show.episodes[0].pendingRevision, undefined);
});


test("existing library folders are reused and missing folders get portable names", async () => {
  class AniLink {}
  const path = require("node:path");
  const source = fs.readFileSync(require.resolve("../src/preferences-runtime.js"), "utf8");
  let exists = true;
  vm.runInNewContext(source.slice(source.indexOf("AniLink.prototype.showFolder =")), {
    AniLink, C, path, fs: { stat: async () => { if (!exists) throw Error("ENOENT"); return { isDirectory: () => true }; } },
  });
  const p = new AniLink();
  const show = { id: 42, title: "Show: Name", subscription: {} };
  const root = path.resolve("library");
  assert.equal(await p.showFolder(show, root), path.join(root, "Show_ Name"));
  exists = false;
  assert.equal(await p.showFolder(show, root), path.join(root, "Show_ Name [42]"));
  show.subscription.savePath = path.resolve("custom");
  assert.equal(await p.showFolder(show, root), show.subscription.savePath);
});

test("RSS auto configuration uses configured downloader and keeps its existing download path", async () => {
  class AniLink {}
  const source = fs.readFileSync(require.resolve("../src/integration.js"), "utf8");
  const start = source.indexOf("AniLink.prototype.autoConfigure =");
  const end = source.indexOf("const advancedSettings", start);
  const path = require("node:path");
  const created = [];
  vm.runInNewContext(source.slice(start, end), { AniLink, C, path, process, require, fs: { mkdir: async (value) => created.push(value) } });
  const p = new AniLink();
  const root = path.resolve("configured-downloads");
  p.state = { settings: {} };
  p.ensureDownloader = async (options) => assert.equal(options.allowStart, true);
  const calls = [];
  p.qb = () => ({ call: async (endpoint) => { calls.push(endpoint); return { save_path: root }; } });
  p.persist = async () => {};
  p.checkConnections = async () => {};
  await p.autoConfigure(false);
  assert.equal(p.state.settings.downloadRoot, root);
  assert.deepEqual(created, [root]);
  assert.deepEqual(calls, ["app/preferences", "app/setPreferences"]);
  assert.equal(p.state.settings.playerExe, undefined);
});
