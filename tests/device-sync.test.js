"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  M = require("../src/sync-model"),
  C = require("../core");
const A = "a".repeat(32),
  B = "b".repeat(32);
const make = () => {
  const state = C.defaults();
  state.shows = [
    C.newShow({ id: 1, name: "示例", eps: 2 }, [
      { id: 10, type: 0, sort: 1 },
      { id: 11, type: 0, sort: 2 },
    ]),
  ];
  return state;
};
const copy = (s) => JSON.parse(JSON.stringify(s));
test("cross-device projection excludes credentials, paths, files and subscription execution", () => {
  const s = make();
  s.settings.bgmToken = "SECRET";
  s.shows[0].subscription = {
    feed: "https://x/?token=SECRET",
    enabled: true,
    savePath: "D:/SECRET",
  };
  s.shows[0].episodes[0].files = [{ path: "D:/SECRET" }];
  s.shows[0].episodes[0].danmaku = {
    cid: 123,
    offset: 2,
    ownedPaths: ["D:/SECRET"],
  };
  const p = JSON.stringify(M.project(s));
  assert.ok(!p.includes("SECRET"));
  assert.ok(!p.includes("ownedPaths"));
  assert.ok(p.includes('"cid":123'));
});
test("independent offline episode edits and review merge identically in either order", () => {
  const a = make(),
    b = copy(a),
    base = M.project(a),
    r = M.capture({}, {}, base, A);
  a.shows[0].episodes[0].watched = true;
  b.shows[0].episodes[1].watched = true;
  b.shows[0].rate = 9;
  const ra = M.capture(r, base, M.project(a), A),
    rb = M.capture(r, base, M.project(b), B),
    ab = M.merge(ra, rb);
  assert.deepEqual(ab, M.merge(rb, ra));
  M.apply(a, ab, C.newShow);
  assert.ok(a.shows[0].episodes.every((e) => e.watched));
  assert.equal(a.shows[0].rate, 9);
});
test("explicit unseen and deterministic concurrent status edits converge without reverting other fields", () => {
  const a = make(),
    base = M.project(a),
    r = M.capture({}, {}, base, A);
  a.shows[0].episodes[0].watched = true;
  const watched = M.capture(r, base, M.project(a), A),
    before = M.project(a);
  a.shows[0].episodes[0].watched = false;
  const unseen = M.capture(watched, before, M.project(a), B);
  M.apply(a, M.merge(watched, unseen), C.newShow);
  assert.equal(a.shows[0].episodes[0].watched, false);
  const x = { n: 100, device: A, value: 3 },
    y = { n: 100, device: B, value: 5 };
  assert.equal(
    M.merge({ "s:1:status": x }, { "s:1:status": y })["s:1:status"].value,
    5,
  );
});
test("remote adoption preserves local files, local subscription and deletion tombstones", () => {
  const a = make(),
    b = make(),
    base = M.project(a);
  a.shows[0].episodes[0].files = [{ path: "D:/keep.mkv" }];
  a.shows[0].subscription.enabled = true;
  b.hiddenShows = [1];
  b.shows[0].episodes[0].watched = true;
  const r = M.capture({}, {}, M.project(b), B);
  M.apply(a, r, C.newShow);
  assert.equal(a.shows[0].episodes[0].files[0].path, "D:/keep.mkv");
  assert.equal(a.shows[0].subscription.enabled, true);
  assert.deepEqual(a.hiddenShows, [1]);
  assert.notDeepEqual(base, M.project(a));
  const fresh = C.defaults();
  M.apply(fresh, r, C.newShow);
  assert.equal(fresh.shows[0].subscription.enabled, false);
  assert.equal(fresh.shows[0].episodes[0].files.length, 0);
});
test("invalid and executable fields in shared documents are rejected", () => {
  const r = { n: 1, device: A, value: { id: 1, playerExe: "bad.exe" } };
  assert.deepEqual(M.merge({ "s:1:meta": r, __proto__: r }), {});
  assert.deepEqual(
    M.merge({ "s:1:status": { n: 1, device: A, value: 99 } }),
    {},
  );
});
test("subscription rules skip non-contiguous watched episodes", () => {
  const state = make(),
    s = state.shows[0];
  s.subscription = {
    feed: "https://example.test/rss", keyword: "Anime",
    start: 1,
    end: 2,
    enabled: true,
  };
  s.episodes[0].watched = true;
  const rule = C.buildRule(s),
    regex = new RegExp(rule.mustContain, "i");
  assert.equal(regex.test("Anime - 01 [1080p]"), false);
  assert.equal(regex.test("Anime - 02 [1080p]"), true);
  s.episodes[1].watched = true;
  assert.equal(
    new RegExp(C.buildRule(s).mustContain, "i").test("Anime - 02 [1080p]"),
    false,
  );
});

