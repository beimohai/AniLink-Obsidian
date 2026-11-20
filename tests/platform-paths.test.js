"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const C = require("../core");

test("local media paths reject the other desktop platform's root notation", () => {
  assert.equal(C.isLocalPath("D:\\Anime", path.win32), true);
  assert.equal(C.isLocalPath("\\\\server\\Anime", path.win32), true);
  assert.equal(C.isLocalPath("/Volumes/Anime", path.win32), false);
  assert.equal(C.isLocalPath("/Volumes/Anime", path.posix), true);
  assert.equal(C.isLocalPath("D:\\Anime", path.posix), false);
  assert.equal(C.isLocalPath("../Anime", path.posix), false);
});
