"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const vm = require("vm");
const C = require("../core");
test("verified Bilibili translation matches the correct cour and rejects other seasons", () => {
  const show = { id: 634210, title: "魔法姐妹露露特莉莉 第2部分", name: "魔法の姉妹ルルットリリィ 第2クール" };
  assert.ok(C.biliTitleMatches(show, "『魔法的姐妹露露和莉莉 第二季』第5话"));
  assert.equal(C.parseEpisode("『魔法的姐妹露露和莉莉 第二季』第5话"), 5);
  assert.equal(C.biliTitleMatches(show, "『魔法的姐妹露露和莉莉 第一季』第5话"), false);
  assert.equal(C.biliTitleMatches(show, "『魔法的姐妹露露和莉莉 第二季』第5话 解说"), false);
  assert.equal(C.biliTitleMatches({ ...show, id: 501796, title: "魔法姐妹露露特莉莉", name: "魔法の姉妹ルルットリリィ" }, "『魔法的姐妹露露和莉莉 第二季』第5话"), false);
});
test("optional danmaku failure still launches local media", async () => {
  const source = fs.readFileSync("src/ux.js", "utf8");
  const start = source.indexOf("AniLink.prototype.play = async function (show, episode, file)");
  const end = source.indexOf("AniLink.prototype.suspendSearch", start);
  let launched = 0;
  const Plugin = function () {};
  vm.runInNewContext(source.slice(start, end), {
    AniLink: Plugin,
    C,
    fs: { access: async () => {} },
    launchLocalMedia: async () => { launched++; },
  });
  const p = new Plugin();
  p.state = C.defaults();
  p.prepareUploaderDanmaku = async () => { throw Error("没有匹配来源"); };
  await p.play({}, {}, { path: "D:/Anime/episode.mkv" });
  assert.equal(launched, 1);
});
function fixture() {
  return C.newShow(
    { id: 42, name: "Star Rail", name_cn: "星海列车", eps: 12 },
    Array.from({ length: 12 }, (_, i) => ({
      id: 100 + i,
      sort: i + 1,
      name: `Story ${i + 1}`,
      type: 0,
    })),
  );
}
function harness() {
  const state = {
    rules: {},
    feeds: {},
    tasks: [],
    files: {},
    collections: {},
    episodes: {},
    requests: [],
    failBgm: false,
  };
  const transport = async (req) => {
    const u = new URL(req.url);
    state.requests.push(req);
    const ok = (data = "", headers = {}) => ({
      status: 200,
      text: typeof data === "string" ? data : JSON.stringify(data),
      headers,
    });
    if (u.hostname === "api.bgm.tv") {
      if (state.failBgm) return { status: 503, text: "", headers: {} };
      if (u.pathname.includes("/collections/-/episodes/")) {
        state.episodes[u.pathname.split("/").pop()] = JSON.parse(req.body);
        return { status: 204, text: "" };
      }
      if (u.pathname.includes("/collections/")) {
        const id = u.pathname.split("/").pop();
        state.collections[id] = {
          ...state.collections[id],
          ...JSON.parse(req.body),
        };
        return { status: 204, text: "" };
      }
    }
    const p = new URLSearchParams(req.body),
      route = u.pathname.replace("/api/v2/", "");
    switch (route) {
      case "app/version":
        return ok("v5.3.0");
      case "auth/login":
        return ok("Ok.", { "set-cookie": "SID=test; HttpOnly; Path=/" });
      case "app/preferences":
        return ok({
          rss_processing_enabled: true,
          rss_auto_downloading_enabled: true,
        });
      case "rss/items":
        return ok(
          u.searchParams.get("withData")
            ? Object.fromEntries(
                Object.entries(state.feeds).map(([k, v]) => [
                  k,
                  { url: v, articles: [] },
                ]),
              )
            : state.feeds,
        );
      case "rss/addFeed":
        state.feeds[p.get("path")] = p.get("url");
        return ok();
      case "rss/refreshItem":
        return ok();
      case "torrents/categories":
        return ok({});
      case "torrents/createCategory":
        return ok();
      case "rss/setRule":
        state.rules[p.get("ruleName")] = JSON.parse(p.get("ruleDef"));
        return ok();
      case "rss/rules":
        return ok(state.rules);
      case "rss/removeRule":
        delete state.rules[p.get("ruleName")];
        return ok();
      case "rss/removeItem":
        delete state.feeds[p.get("path")];
        return ok();
      case "torrents/info":
        return ok(state.tasks);
      case "torrents/files":
        return ok(state.files[u.searchParams.get("hash")]);
      case "torrents/delete":
        state.tasks = state.tasks.filter((t) => t.hash !== p.get("hashes"));
        delete state.files[p.get("hashes")];
        return ok();
      default:
        throw Error("Unhandled request " + req.method + " " + req.url);
    }
  };
  return { state, http: new C.Http(transport) };
}
function plugin(http) {
  const sandbox = {
    require: (id) =>
      id === "obsidian"
        ? {
            Plugin: class {
              register() {}
            },
            ItemView: class {},
            Modal: class {},
            Notice: class {},
            PluginSettingTab: class {},
            Setting: class {},
            requestUrl: () => {
              throw Error("No live network in tests");
            },
          }
        : id === "electron"
          ? { shell: {} }
          : require(id),
    module: { exports: {} },
    console,
    window: { setTimeout, clearTimeout, setInterval, clearInterval },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    Date,
    DOMParser: undefined,
  };
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../main"), "utf8"),
    sandbox,
  );
  const p = new sandbox.module.exports();
  p.state = C.defaults();
  p.state.settings.bgmToken = "mock-token";
  p.http = http;
  p.saveChain = Promise.resolve();
  p.saveData = async () => {};
  p.health = {};
  p.redraw = () => {};
  p.scanLocalVideos = async () => {};
  return p;
}
test("foreground status clicks persist while a remote request is still pending", async () => {
  const p = plugin(harness().http),
    s = fixture();
  p.state.shows = [s];
  let release;
  p.sync = () =>
    new Promise((r) => {
      release = r;
    });
  await p.run(() => p.changeStatus(s, 3));
  assert.equal(p.busy, false);
  assert.equal(s.status, 3);
  assert.equal(p.state.queue.length, 1);
  await p.run(() => p.changeStatus(s, 1));
  assert.equal(p.busy, false);
  assert.equal(s.status, 1);
  assert.equal(p.state.queue[0].payload.type, 1);
  release();
  await Promise.all([...p.backgroundTasks.values()]);
});
test("release parsing refuses batches, detects common subtitle naming and revisions", () => {
  for (const [title, num] of [
    ["[组] Star Rail - 01 [1080p].mkv", 1],
    ["[Group][Star Rail][12v2][1080p].mp4", 12],
    ["Star.Rail.S02E03.1080p.mkv", 3],
    ["星海列车 第4话.mkv", 4],
    ["[Group] Star Rail EP05.mkv", 5],
  ])
    assert.equal(C.parseEpisode(title), num, title);
  for (const name of [
    "Star Rail [01-12].mkv",
    "Star Rail Complete.mkv",
    "Star Rail 1080p.mkv",
  ])
    assert.equal(C.parseEpisode(name), null, name);
});
test("RSS query strings, literal subtitle names, ranges and deletion exclusions work in actual rule regex", () => {
  const s = fixture();
  s.subscription = {
    feed: "https://example.test/rss?group=12&token=abc",
    keyword: "Star Rail",
    group: "A+B",
    quality: "1080",
    start: 3,
    end: 12,
    enabled: true,
  };
  const rule = C.buildRule(s);
  assert.equal(rule.episodeFilter, "");
  assert.equal(rule.affectedFeeds[0], s.subscription.feed);
  const yes = (t) =>
    new RegExp(rule.mustContain, "i").test(t) &&
    !new RegExp(rule.mustNotContain, "i").test(t);
  assert.ok(yes("[A+B] Star Rail - 03 [1080p]"));
  assert.ok(yes("[A+B] Star Rail [12v2] [1080p]"));
  assert.ok(!yes("[A+B] Star Rail - 02 [1080p]"));
  assert.ok(!yes("[A+B] Star Rail - 13 [1080p]"));
  assert.ok(!yes("[AAB] Star Rail - 03 [1080p]"));
  assert.ok(!yes("[A+B] Star Rail [01-12] [1080p]"));
  s.blockedTitles = ["[A+B] Star Rail - 03 [1080p]"];
  assert.ok(
    new RegExp(C.buildRule(s).mustNotContain, "i").test(s.blockedTitles[0]),
  );
  assert.throws(() => C.buildRule(s, { ...s.subscription, start: 4, end: 2 }));
  assert.throws(() =>
    C.buildRule(s, { ...s.subscription, feed: "file:///secret" }),
  );
});
test("NAS path mapping respects directory boundary and never marks absent specials as regular episodes", () => {
  assert.equal(
    C.localPath("/downloads/anime/a.mkv", {
      remoteRoot: "/downloads/anime",
      localRoot: "D:\\Anime",
    }),
    require("path").join("D:\\Anime", "a.mkv"),
  );
  assert.equal(
    C.localPath("/downloads/anime2/a.mkv", {
      remoteRoot: "/downloads/anime",
      localRoot: "D:\\Anime",
    }),
    "/downloads/anime2/a.mkv",
  );
  const s = fixture();
  C.mergeFiles(
    s,
    [{ hash: "pack", name: "season", save_path: "D:\\Anime" }],
    [
      [
        { index: 0, name: "Star Rail - 01.mkv", progress: 1 },
        { index: 1, name: "Special.mkv", progress: 1 },
      ],
    ],
    {},
  );
  assert.equal(s.episodes[0].files[0].path, "D:\\Anime\\Star Rail - 01.mkv");
  assert.equal(s.unmatched.length, 1);
});
test("complete 12-week quarter: subscribe, download, watch, outage retry, delete, finish and review", async () => {
  const h = harness(),
    p = plugin(h.http),
    s = fixture();
  p.state.shows.push(s);
  s.subscription = {
    ...s.subscription,
    feed: "https://example.test/rss?show=42",
    keyword: "Star Rail",
    quality: "1080",
    start: 1,
    end: 12,
    enabled: true,
  };
  await p.qb().install(s);
  assert.ok(h.state.rules["AniLink-42"].enabled);
  assert.equal(h.state.feeds["AniLink-42"], s.subscription.feed);
  await p.changeStatus(s, 3);
  assert.equal(h.state.collections["42"].type, 3);
  for (let week = 1; week <= 12; week++) {
    const title = `[Group] Star Rail - ${String(week).padStart(2, "0")} [1080p].mkv`,
      hash = "week" + week;
    h.state.tasks.push({
      hash,
      name: title,
      save_path: "D:\\Anime",
      progress: 1,
    });
    h.state.files[hash] = [{ index: 0, name: title, progress: 1 }];
    // Refresh intentionally does not interrogate qBittorrent. The downloader
    // workflow supplies task metadata when an explicit download operation runs;
    // this scenario then verifies the remaining watch/sync/cleanup lifecycle.
    C.mergeFiles(
      s,
      h.state.tasks.filter((task) => task.hash === hash),
      [h.state.files[hash]],
      p.state.settings,
    );
    await p.refresh(false);
    const e = s.episodes[week - 1];
    assert.equal(e.files.length, 1);
    assert.equal(e.files[0].progress, 1);
    assert.ok(!e.watched);
    if (week === 4) h.state.failBgm = true;
    await p.markWatched(s, e, true);
    if (week === 4) {
      assert.equal(p.state.queue.length, 1);
      assert.equal(p.state.queue[0].attempts, 1);
      h.state.failBgm = false;
      await p.sync();
      assert.equal(p.state.queue.length, 0);
    }
    assert.equal(h.state.episodes[e.id].type, 2);
    s.blockedTitles.push(title);
    await p.qb().setRule(s);
    await p.qb().delete(hash);
    e.files = [];
    await p.refresh(false);
    assert.equal(e.files.length, 0);
    assert.ok(e.watched);
  }
  await p.changeStatus(s, 2);
  await Promise.all([...p.backgroundTasks.values()]);
  assert.ok(!s.subscription.enabled);
  assert.ok(!h.state.rules["AniLink-42"].enabled);
  assert.equal(h.state.collections["42"].type, 2);
  C.queueJob(p.state, {
    key: "collection:42",
    kind: "collection",
    showId: 42,
    payload: { rate: 8, comment: "一季度追番结束。", private: true },
  });
  await p.sync();
  assert.equal(h.state.collections["42"].rate, 8);
  assert.equal(h.state.collections["42"].comment, "一季度追番结束。");
  assert.equal(h.state.collections["42"].private, true);
  await p.qb().removeSubscription(s);
  assert.equal(Object.keys(h.state.rules).length, 0);
  assert.equal(Object.keys(h.state.feeds).length, 0);
  assert.equal(s.episodes.filter((e) => e.watched).length, 12);
  assert.ok(h.state.requests.every((r) => !r.url.includes("mock-token")));
  assert.ok(
    h.state.requests
      .filter(
        (r) => r.url.includes("/api/v2/") && !r.url.includes("auth/login"),
      )
      .every((r) => r.headers.Cookie === "SID=test"),
  );
});
test("offline changes coalesce, persist, and undo watched status syncs type 0", async () => {
  const h = harness(),
    p = plugin(h.http),
    s = fixture();
  p.state.shows = [s];
  p.state.settings.bgmToken = "";
  await p.markWatched(s, s.episodes[0], true);
  await p.markWatched(s, s.episodes[0], false);
  assert.equal(p.state.queue.length, 2);
  assert.equal(p.state.queue.find((j) => j.kind === "episode").payload.type, 0);
  p.state.settings.bgmToken = "mock-token";
  await p.sync();
  assert.equal(h.state.episodes["100"].type, 0);
  assert.equal(p.state.queue.length, 0);
});
test("search paginates and preserves official sort/filter parameters", async () => {
  let request;
  const bgm = new C.Bangumi(
    new C.Http(async (r) => {
      request = r;
      return { status: 200, text: '{"data":[],"total":0}' };
    }),
    "",
  );
  await bgm.search("冰之城墙", 20, "score");
  assert.match(request.url, /offset=20/);
  assert.deepEqual(JSON.parse(request.body), {
    keyword: "冰之城墙",
    sort: "score",
    filter: { type: [2] },
  });
});
test("qBittorrent 5.3 login accepts HTTP 204 and forwards its session cookie", async () => {
  const calls = [];
  const http = new C.Http(async (r) => {
    calls.push(r);
    if (r.url.endsWith("/auth/login"))
      return {
        status: 204,
        text: "",
        headers: { "set-cookie": "SID=new-version; HttpOnly; Path=/" },
      };
    assert.equal(r.headers.Cookie, "SID=new-version");
    return { status: 200, text: "v5.3.0", headers: {} };
  });
  const qb = new C.QBittorrent(http, {
    qbUrl: "http://127.0.0.1:8080",
    qbUser: "test",
    qbPassword: "test",
  });
  assert.equal(await qb.call("app/version"), "v5.3.0");
  assert.equal(calls.length, 2);
});
test("second season maps local ep to stable Bangumi IDs and refuses ambiguity or wrong season", () => {
  const s = C.newShow(
    { id: 665390, name_cn: "冰之城墙 第二季", name: "氷の城壁 第2期" },
    Array.from({ length: 12 }, (_, i) => ({
      id: 1748923 + i,
      sort: 15 + i,
      ep: i + 1,
      type: 0,
    })),
  );
  assert.equal(C.resolveEpisode(s, "Ice.S02E06.1080p.mkv").id, 1748928);
  assert.equal(C.resolveEpisode(s, "Ice - 20 [1080p]").id, 1748928);
  assert.equal(C.resolveEpisode(s, "Ice.S01E06.1080p.mkv"), null);
  assert.equal(C.parseEpisode("Ice.S02E06.1080p"), 6);
  const overlap = C.newShow(
    { id: 1, name: "Show" },
    Array.from({ length: 12 }, (_, i) => ({
      id: 10 + i,
      sort: 8 + i,
      type: 0,
    })),
  );
  assert.equal(C.resolveEpisode(overlap, "Show - 08.mkv"), null);
  overlap.subscription.numbering = "absolute";
  assert.equal(C.resolveEpisode(overlap, "Show - 08.mkv").id, 10);
  s.episodes = s.episodes.filter((e) => e.ep !== 3);
  assert.equal(C.resolveEpisode(s, "Ice.S02E06.mkv").id, 1748928);
});
test("version rules distinguish simplified, dual subtitles, codec and subtitle format", () => {
  const sub = {
    feed: "https://example.test/rss",
    quality: "1080",
    start: 1,
    end: 12,
    profile: { language: "简中", codec: "HEVC", subtitle: "内封" },
  };
  assert.ok(
    C.previewMatch("[Group] Show - 01 [1080p HEVC][简日内封字幕]", sub),
  );
  for (const title of [
    "[Group] Show - 01 [1080p HEVC][简繁内封字幕]",
    "[Group] Show - 01 [1080p AVC][简日内封字幕]",
    "[Group] Show - 01 [1080p HEVC][简日内嵌字幕]",
  ])
    assert.ok(!C.previewMatch(title, sub), title);
  assert.equal(C.releaseTags("[1080p HEVC][简繁日内封字幕]").language, "简繁");
});
test("adding want-to-watch persists an offline sync job and syncs when token arrives", async () => {
  const h = harness(),
    p = plugin(h.http);
  p.state.settings.bgmToken = "";
  p.focusShow = () => {};
  p.bgm = () => ({
    call: async () => ({ id: 81, name: "New Show", eps: 1 }),
    episodes: async () => [{ id: 800, sort: 1, ep: 1, type: 0 }],
    send: async (job) => {
      h.state.collections[job.showId] = job.payload;
    },
  });
  const s = await p.addWish({ id: 81 });
  assert.equal(s.status, 1);
  assert.equal(p.state.queue[0].payload.type, 1);
  assert.equal(s.episodes[0].ep, 1);
  p.state.settings.bgmToken = "mock-token";
  await p.sync();
  assert.equal(h.state.collections[81].type, 1);
  assert.equal(p.state.queue.length, 0);
  assert.equal(await p.addWish({ id: 81 }), s);
  assert.equal(p.state.shows.length, 1);
});
test("metadata refresh retains watched files and episode IDs when upstream is empty or incomplete", async () => {
  const h = harness(),
    p = plugin(h.http),
    s = fixture();
  s.episodes[0].watched = true;
  s.episodes[0].files = [{ path: "D:\\Anime\\one.mkv" }];
  let rows = [];
  p.bgm = () => ({
    call: async () => ({ total_episodes: 12 }),
    episodes: async () => rows,
  });
  await p.updateEpisodes(s);
  assert.equal(s.episodes.length, 12);
  assert.equal(s.episodes[0].watched, true);
  rows = [{ id: 100, sort: 1, ep: 1, type: 0, name: "Revised" }];
  await p.updateEpisodes(s);
  assert.equal(s.episodes.length, 12);
  assert.equal(s.episodes[0].title, "Revised");
  assert.equal(s.episodes[0].files[0].path, "D:\\Anime\\one.mkv");
});
test("cancel want-to-watch pauses the rule and removes pending writes without inventing a DELETE API", async () => {
  const h = harness(),
    p = plugin(h.http),
    s = fixture();
  p.state.shows = [s];
  p.state.settings.bgmToken = "";
  C.queueJob(p.state, {
    key: "collection:42",
    showId: 42,
    kind: "collection",
    payload: { type: 1 },
  });
  p.confirm = (_t, _d, fn) => fn();
  p.redraw = () => {};
  await p.cancelWish(s);
  assert.equal(s.status, 0);
  assert.equal(p.state.queue.length, 0);
  assert.equal(s.cancelRemotePending, false);
  assert.equal(h.state.requests.length, 0);
});
test("opening an existing search result selects the show and exposes removal without quarter discovery", () => {
  const p = plugin(harness().http),
    view = {
      selected: null,
      filter: "wish",
      tab: "review",
      render() {
        this.rendered = true;
      },
    };
  p.app = { workspace: { getLeavesOfType: () => [{ view }] } };
  p.focusShow({ id: 665390 });
  assert.equal(view.selected, 665390);
  assert.equal(view.filter, "wish");
  assert.equal(view.tab, "episodes");
  assert.equal(view.rendered, true);
  assert.equal(typeof p.removeShow, "function");
  assert.equal(p.seasonModal, undefined);
});

test("manual mark-through marks only earlier normal episodes and queues them without watching future or specials", async () => {
  const p = plugin(harness().http),
    s = fixture();
  p.state.settings.bgmToken = "";
  s.status = 3;
  p.state.shows = [s];
  s.episodes.push({ id: 999, sort: 1, type: 1, watched: false, files: [] });
  await p.markThrough(s, s.episodes[3]);
  assert.equal(s.episodes.filter((e) => e.watched).length, 4);
  assert.equal(s.episodes[4].watched, false);
  assert.equal(s.episodes.at(-1).watched, false);
  assert.equal(p.state.queue.filter((j) => j.kind === "episode").length, 4);
});

test("background refresh does not block foreground actions and deduplicates concurrent polls", async () => {
  const p = plugin(harness().http);
  let finish,
    started = 0,
    clicked = false;
  const background = p.run(() => {
    started++;
    return new Promise((r) => {
      finish = r;
    });
  }, true);
  await Promise.resolve();
  await p.run(async () => {
    clicked = true;
  });
  assert.equal(clicked, true);
  assert.equal(p.busy, false);
  const duplicate = p.run(async () => {
    started++;
  }, true);
  assert.equal(duplicate, background);
  assert.equal(started, 1);
  finish();
  await background;
  assert.equal(p.backgroundTasks.size, 0);
});
test("background failure and foreground failure both release their own task state", async () => {
  const p = plugin(harness().http);
  await p.run(async () => {
    throw Error("network failed");
  }, true);
  assert.equal(p.backgroundTasks.size, 0);
  assert.equal(p.busy, undefined);
  await p.run(async () => {
    throw Error("action failed");
  });
  assert.equal(p.busy, false);
  let ok = false;
  await p.run(async () => {
    ok = true;
  });
  assert.ok(ok);
});
test("account sync retains progress on partial failures and never overwrites a concurrent local edit", async () => {
  const p = plugin(harness().http),
    s = fixture();
  p.state.shows = [s];
  s.status = 3;
  s.episodes[0].watched = true;
  const row = {
    subject_id: 42,
    type: 2,
    rate: 9,
    comment: "remote",
    subject: { id: 42, name: "Star Rail" },
  };
  p.bgm = () => ({
    call: async () => ({ username: "test" }),
    pages: async (endpoint) => {
      if (endpoint.includes("subject_type")) return [row];
      s.localRevision = (s.localRevision || 0) + 1;
      throw Error("offline");
    },
  });
  await p.syncBangumi();
  assert.equal(s.status, 3);
  assert.equal(s.episodes[0].watched, true);
  assert.equal(p.accountPromise, null);
  assert.equal(p.busy, undefined);
});
test("cleanup refuses a pack containing an unwatched episode", async () => {
  const h = harness(),
    p = plugin(h.http),
    s = fixture();
  p.state.settings.bgmToken = "";
  p.state.shows = [s];
  s.status = 3;
  for (const [i, e] of s.episodes.slice(0, 2).entries())
    e.files = [
      {
        hash: "pack",
        index: i,
        episodeId: e.id,
        progress: 1,
        taskTitle: "pack",
      },
    ];
  h.state.tasks = [{ hash: "pack" }];
  await p.markThrough(s, s.episodes[0]);
  assert.equal(h.state.tasks.length, 1);
  assert.equal(s.episodes[0].files.length, 1);
  assert.equal(s.episodes[1].watched, false);
});
test("cleanup deletes a watched single-episode task and retains its watch record", async () => {
  const h = harness(),
    p = plugin(h.http),
    s = fixture();
  p.state.settings.bgmToken = "";
  p.state.shows = [s];
  s.status = 3;
  s.episodes[0].files = [
    { hash: "one", index: 0, episodeId: 100, progress: 1, taskTitle: "one" },
  ];
  h.state.tasks = [{ hash: "one" }];
  h.state.files.one = [{ index: 0, name: "Show - 01.mkv", progress: 1 }];
  await p.markThrough(s, s.episodes[0]);
  assert.equal(h.state.tasks.length, 0);
  assert.equal(s.episodes[0].files.length, 0);
  assert.equal(s.episodes[0].watched, true);
});

test("status push succeeds even when pausing the downloader fails and preserves review fields", async () => {
  const h = harness(),
    p = plugin(h.http),
    s = fixture();
  p.state.shows = [s];
  s.rate = 9;
  s.comment = "existing review";
  s.private = true;
  s.subscription.enabled = true;
  p.updateSubscriptionRule = async () => {
    throw Error("downloader offline");
  };
  await p.changeStatus(s, 5);
  await Promise.all([...p.backgroundTasks.values()]);
  assert.equal(s.status, 5);
  assert.equal(h.state.collections[42].type, 5);
  assert.equal(h.state.collections[42].rate, 9);
  assert.equal(h.state.collections[42].comment, "existing review");
  assert.equal(h.state.collections[42].private, true);
  assert.match(s.ruleError, /offline/);
  assert.equal(p.state.queue.length, 0);
});
test("checking remote collections keeps local intent, records conflicts and never fetches every episode", async () => {
  const p = plugin(harness().http),
    s = fixture();
  s.status = 3;
  p.state.shows = [s];
  p.bgm = () => ({
    call: async () => ({ username: "me" }),
    pages: async (route) => {
      assert.match(route, /subject_type=2/);
      return [
        { subject_id: 42, type: 2, rate: 8, subject: { id: 42, name: "show" } },
      ];
    },
  });
  await p.syncBangumi();
  assert.equal(s.status, 3);
  assert.equal(s.remoteConflict.status, 2);
  assert.equal(s.episodes.length, 12);
  await p.resolveConflict(s, true);
  assert.equal(s.status, 2);
  assert.equal(s.rate, 8);
  assert.equal(s.remoteConflict, null);
});
test("manual account check respects removed shelf entries and imports only missing subjects", async () => {
  const p = plugin(harness().http);
  p.state.hiddenShows = [7];
  p.bgm = () => ({
    call: async () => ({ username: "me" }),
    pages: async () => [
      { subject_id: 7, type: 1, subject: { id: 7, name: "hidden" } },
      { subject_id: 8, type: 3, subject: { id: 8, name: "new" } },
    ],
  });
  assert.equal(await p.syncBangumi(), 1);
  assert.equal(p.state.shows.length, 1);
  assert.equal(p.state.shows[0].id, 8);
  assert.equal(p.state.shows[0].status, 3);
});
test("a newer edit arriving during a push is drained without losing its queue revision", async () => {
  const h = harness(),
    p = plugin(h.http),
    s = fixture();
  p.state.shows = [s];
  let sends = [];
  p.bgm = () => ({
    send: async (job) => {
      sends.push(job.payload.type);
      if (sends.length === 1)
        C.queueJob(p.state, {
          key: "collection:42",
          kind: "collection",
          showId: 42,
          payload: { type: 5 },
        });
    },
  });
  C.queueJob(p.state, {
    key: "collection:42",
    kind: "collection",
    showId: 42,
    payload: { type: 3 },
  });
  await p.sync();
  assert.deepEqual(sends, [3, 5]);
  assert.equal(p.state.queue.length, 0);
});
test("disabled cleanup preserves watched files and download tasks", async () => {
  const h = harness(),
    p = plugin(h.http),
    s = fixture();
  p.state.shows = [s];
  p.state.settings.cleanupAfterWatch = false;
  s.status = 3;
  s.episodes[0].files = [
    { hash: "keep", index: 0, episodeId: 100, progress: 1, taskTitle: "keep" },
  ];
  h.state.tasks = [{ hash: "keep" }];
  await p.markThrough(s, s.episodes[0]);
  assert.equal(h.state.tasks.length, 1);
  assert.equal(s.episodes[0].watched, true);
  assert.equal(s.episodes[0].files.length, 1);
});
test("download ordering timestamp comes from completed local release, not the broadcast date", () => {
  const s = fixture();
  s.date = "2099-01-01";
  C.mergeFiles(
    s,
    [
      {
        hash: "h",
        name: "Show - 01.mkv",
        save_path: "D:\\Anime",
        completion_on: 100,
      },
    ],
    [[{ index: 0, name: "Show - 01.mkv", progress: 1 }]],
    {},
  );
  assert.equal(s.episodes[0].files[0].completedAt, 100000);
  C.mergeFiles(
    s,
    [
      {
        hash: "h",
        name: "Show - 01.mkv",
        save_path: "D:\\Anime",
        completion_on: 200,
      },
    ],
    [[{ index: 0, name: "Show - 01.mkv", progress: 1 }]],
    {},
  );
  assert.equal(s.episodes[0].files[0].completedAt, 100000);
});

test("cleanup preserves torrents containing videos absent from local metadata", async () => {
  const h = harness(),
    p = plugin(h.http),
    s = fixture();
  p.state.shows = [s];
  s.status = 3;
  s.episodes[0].files = [
    {
      hash: "unknown",
      index: 0,
      episodeId: 100,
      progress: 1,
      taskTitle: "unknown",
    },
  ];
  h.state.tasks = [{ hash: "unknown" }];
  h.state.files.unknown = [
    { index: 0, name: "Show - 01.mkv", progress: 1 },
    { index: 1, name: "Bonus.mkv", progress: 1 },
  ];
  await p.markThrough(s, s.episodes[0]);
  assert.equal(h.state.tasks.length, 1);
  assert.equal(s.episodes[0].files.length, 1);
  assert.equal(s.episodes[0].watched, true);
});
test("single subject inspection refuses an edit that arrived during remote reads", async () => {
  const p = plugin(harness().http),
    s = fixture();
  p.state.shows = [s];
  p.bgm = () => ({
    call: async (route) =>
      route === "/v0/me" ? { username: "me" } : { type: 2, rate: 9 },
    pages: async () => {
      s.localRevision = 1;
      return [];
    },
  });
  await assert.rejects(p.inspectRemoteShow(s), /本地记录已变化/);
  assert.equal(s.status, 1);
  assert.equal(s.remoteConflict, undefined);
});
test("explicit remote adoption merges episode records without deleting local files", async () => {
  const p = plugin(harness().http),
    s = fixture();
  p.state.shows = [s];
  s.episodes[0].files = [{ path: "keep.mkv" }];
  s.remoteConflict = {
    status: 3,
    rate: 7,
    comment: "remote",
    private: false,
    episodeStates: { 100: true, 101: false },
  };
  await p.resolveConflict(s, true);
  assert.equal(s.episodes[0].watched, true);
  assert.equal(s.episodes[1].watched, false);
  assert.equal(s.episodes[0].files[0].path, "keep.mkv");
  assert.equal(s.rate, 7);
  assert.equal(s.episodeStates, undefined);
});
test("declared regular episode count is distinct from total including specials", async () => {
  const p = plugin(harness().http),
    s = fixture();
  p.bgm = () => ({
    call: async () => ({ eps: 12, total_episodes: 14 }),
    episodes: async () => [
      ...s.episodes.map((e) => ({ ...e, name: e.title })),
      { id: 999, sort: 1, type: 1 },
      { id: 998, sort: 2, type: 1 },
    ],
  });
  await p.updateEpisodes(s);
  assert.equal(s.total, 12);
  assert.equal(s.episodes.length, 14);
});
test("unloading closes owned modals without detaching workspace leaves", () => {
  const p = plugin(harness().http);
  let closed = 0;
  p.panels = new Set([
    {
      close() {
        closed++;
      },
    },
  ]);
  p.app = {
    workspace: {
      detachLeavesOfType() {
        throw Error("must not detach");
      },
    },
  };
  p.onunload();
  assert.equal(p.disposed, true);
  assert.equal(closed, 1);
});
test("season label before episode separator is not mistaken for an episode range", () => {
  assert.equal(
    C.parseEpisode("[Tsukigakirei] Ao no Hako Season 2 - 05 [1080P].mp4"),
    5,
  );
  assert.equal(C.parseEpisode("Ao no Hako Season 2 - 01-12 [1080P].mkv"), null);
  const show = C.newShow(
    { id: 548156, name_cn: "青之箱 第二季" },
    Array.from({ length: 12 }, (_, i) => ({
      id: 500 + i,
      type: 0,
      sort: 26 + i,
      ep: 1 + i,
    })),
  );
  show.subscription.numbering = "local";
  assert.equal(
    C.resolveEpisode(show, "Ao no Hako Season 2 - 05 [1080P].mp4")?.id,
    504,
  );
});

test("release profiles merge resolution casing and keep different subtitle formats separate", () => {
  const a = C.releaseTags("[Group] Anime - 01 [1080p avc][简日内嵌]");
  const b = C.releaseTags("[Group] Anime - 02 [1080P AVC][简日内嵌]");
  assert.deepEqual(a, b);
  assert.notDeepEqual(
    a,
    C.releaseTags("[Group] Anime - 03 [1080P AVC][简日内封]"),
  );
});
test("Mikan fallback includes original title and a short title without losing subject verification", () => {
  const names = C.sourceQueries(
    {
      title: "魔法姐妹露露特莉莉 第2部分",
      name: "魔法の姉妹ルルットリリィ 第2クール",
    },
    "魔法姐妹露露特莉莉 第2部分",
  );
  assert.ok(names.includes("魔法の姉妹ルルットリリィ"));
  assert.ok(names.includes("露露特莉莉"));
});
test("subscription waits for downloader readiness before creating its feed and rule", async () => {
  const h = harness(),
    p = plugin(h.http),
    s = fixture();
  s.rssError = "net::ERR_CONNECTION_REFUSED";
  let ready = false;
  p.ensureDownloader = async () => {
    ready = true;
  };
  const install = p.qb().install;
  const client = p.qb();
  client.install = async function (...args) {
    assert.equal(ready, true);
    return install.apply(this, args);
  };
  p.qb = () => client;
  await p.installSubscription(s, {
    ...s.subscription,
    feed: "https://example.test/rss",
    keyword: "Star",
    start: 1,
    end: 12,
    enabled: false,
  });
  assert.ok(h.state.rules["AniLink-42"]);
  assert.equal(s.rssError, undefined);
});

test("concurrent local downloader starts wait for one startup before retrying Web UI", async () => {
  const h = harness(),
    p = plugin(h.http);
  let started = false,
    starts = 0;
  p.state.settings.qbUrl = "http://127.0.0.1:8080";
  p.qb = () => ({
    call: async () => {
      if (!started) throw Error("net::ERR_CONNECTION_REFUSED");
      return "v5.3.0";
    },
  });
  p.openDownloader = async () => {
    starts++;
    started = true;
  };
  await Promise.all([p.ensureDownloader(), p.ensureDownloader()]);
  assert.equal(starts, 1);
});

test("season prefix before episode separator is not rejected as a batch in download rules", () => {
 const title = "[LoliHouse] 青之芦苇 第二季 / Ao Ashi S2 - 06 [WebRip 1080p HEVC-10bit AAC][简繁内封字幕]";
 const profile = C.releaseTags(title);
 assert.ok(C.previewMatch(title, {feed:"https://example.test/rss",profile,quality:profile.quality,language:profile.language,start:1,end:12}));
 assert.ok(C.sourceQueries({title:"赛博朋克：边缘行者 2"}, "").includes("边缘行者"));
});
