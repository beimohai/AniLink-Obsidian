"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const C = require("../core");

function plugin(pages) {
  class AniLink {}
  const source = fs.readFileSync(require.resolve("../src/integration.js"), "utf8");
  const start = source.indexOf("AniLink.prototype.findSources =");
  const end = source.indexOf("AniLink.prototype.subscriptionModal =", start);
  vm.runInNewContext(source.slice(start, end), { AniLink, C, URL });
  const p = new AniLink();
  p.state = C.defaults();
  p.mikanDocument = async (url) => {
    if (url.includes("/Home/Search")) return { querySelectorAll: () => Object.keys(pages).map((id) => ({ getAttribute: () => "/Home/Bangumi/" + id })) };
    const page = pages[url.split("/").pop()];
    if (page instanceof Error) throw page;
    return page;
  };
  return p;
}

function page(subjectId) {
  return { querySelectorAll: (selector) => selector === "a[href]"
    ? [{ getAttribute: () => "https://bgm.tv/subject/" + subjectId }]
    : [{ getAttribute: () => "https://mikanani.me/RSS/Bangumi?bangumiId=3900&subgroupid=370", closest: () => ({ querySelector: () => ({ textContent: "LoliHouse" }) }) }],
  };
}

test("a failed candidate page does not discard a verified RSS search result", async () => {
  for (const pages of [
    { 1: Error("net::ERR_CONNECTION_RESET"), 2: page(552589) },
    { 1: page(552589), 2: Error("net::ERR_CONNECTION_RESET") },
  ]) {
    const p = plugin(pages);
    const matches = await p.findSources({ id: 552589 }, "迦楠");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].groups[0].name, "LoliHouse");
    assert.ok(p.state.events.some((event) => event.message.includes("ERR_CONNECTION_RESET")));
  }
});

test("candidate failures never allow a different Bangumi subject through RSS search", async () => {
  const p = plugin({ 1: Error("ECONNREFUSED"), 2: page(123) });
  await assert.rejects(p.findSources({ id: 552589 }, "迦楠"), /蜜柑条目核验失败.*ECONNREFUSED/);
});

test("missing candidate pages leave an empty search result rather than a connection error", async () => {
  const p = plugin({ 1: Error("请求失败 HTTP 404"), 2: page(123) });
  assert.equal((await p.findSources({ id: 552589 }, "迦楠")).length, 0);
});
