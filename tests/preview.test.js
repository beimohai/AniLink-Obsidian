"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

function fixture() {
  class Dashboard {}
  let clock = 0, id = 0, retries = 0;
  const timers = new Map(), events = [];
  const window = {
    setTimeout: (callback, delay) => { timers.set(++id, { callback, at: clock + delay }); return id; },
    clearTimeout: (key) => timers.delete(key),
  };
  vm.runInNewContext(fs.readFileSync("src/preview.js", "utf8"), {
    Dashboard, window, C: { record: (state, message) => events.push(message) }, Notice: class {},
  });
  const guest = () => {
    const value = new EventEmitter(), classes = new Set();
    value.dataset = {};
    value.tagName = "WEBVIEW";
    value.isConnected = true;
    value.url = "https://fankuhub.com/anime/fixture";
    value.getURL = () => value.url;
    value.classList = { add: (key) => classes.add(key), remove: (key) => classes.delete(key), contains: (key) => classes.has(key) };
    value.addEventListener = value.on.bind(value);
    value.removeEventListener = value.off.bind(value);
    return value;
  };
  const view = new Dashboard();
  view.p = { state: {}, persist: () => {} };
  view.register = () => {};
  const page = { guest: guest(), loading: {}, url: "https://fankuhub.com/anime/fixture" };
  let active = true;
  const bind = () => view.bindInformationPreview(page, () => active, async () => { retries++; });
  const tick = (duration) => {
    clock += duration;
    for (const [key, timer] of [...timers]) if (timer.at <= clock && timers.has(key)) {
      timers.delete(key);
      timer.callback();
    }
  };
  bind();
  return { page, events, bind, tick, guest, setActive: (value) => { active = value; }, retries: () => retries };
}

test("preview waits for a real page to finish rather than treating stopped or blank loading as ready", () => {
  const h = fixture();
  h.page.guest.url = "";
  for (const name of ["dom-ready", "did-stop-loading", "did-finish-load"]) h.page.guest.emit(name);
  assert.equal(h.page.ready, undefined);
  assert.equal(h.page.loading.hidden, false);
  h.page.guest.url = h.page.url;
  h.page.guest.emit("did-finish-load");
  assert.equal(h.page.ready, true);
  assert.equal(h.page.loading.hidden, true);
  assert.equal(h.page.guest.classList.contains("al-preview-unavailable"), false);
  h.tick(30000);
  assert.equal(h.events.length, 0);
});

test("late failure and completion events from a replaced guest cannot change its replacement", () => {
  const h = fixture(), previous = h.page.guest;
  h.page.guest = h.guest();
  h.bind();
  previous.emit("render-process-gone", { reason: "launch-failed" });
  previous.emit("did-finish-load");
  h.tick(500);
  assert.equal(h.page.failed, undefined);
  assert.equal(h.page.ready, undefined);
  assert.equal(h.page.loading.hidden, false);
  assert.equal(h.events.length, 0);
  assert.equal(h.retries(), 0);
});

test("renderer failure retries after a delay once and keeps the failed guest covered", () => {
  const h = fixture();
  h.page.guest.emit("render-process-gone", { reason: "launch-failed" });
  h.page.guest.emit("render-process-gone", { reason: "launch-failed" });
  assert.equal(h.retries(), 0);
  assert.equal(h.page.guest.classList.contains("al-preview-unavailable"), true);
  assert.equal(h.page.loading.hidden, false);
  h.tick(500);
  assert.equal(h.retries(), 1);
  h.page.dispose();
  h.page.guest = h.guest();
  h.page.failed = false;
  h.bind();
  h.page.guest.emit("render-process-gone", { reason: "launch-failed" });
  h.tick(500);
  assert.equal(h.retries(), 1);
});

test("switching away cancels delayed recovery and subframe errors leave the main preview intact", () => {
  const h = fixture();
  h.page.guest.emit("did-fail-load", { errorCode: -105, isMainFrame: false });
  assert.equal(h.page.failed, undefined);
  h.page.guest.emit("render-process-gone", { reason: "launch-failed" });
  h.setActive(false);
  h.tick(500);
  assert.equal(h.retries(), 0);
});
