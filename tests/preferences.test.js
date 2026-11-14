const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core");
const fs = require("node:fs");
const vm = require("node:vm");

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
