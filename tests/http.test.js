"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core");

test("shared HTTP timeouts cover GET and WebDAV reads on every platform", async () => {
  for (const method of ["GET", "PROPFIND"]) {
    const http = new C.Http(() => new Promise(() => {}), 10);
    await assert.rejects(http.request("https://example.test/", method), /读取超时/);
  }
});

test("the read timeout does not interrupt a state-changing POST", async () => {
  const http = new C.Http(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { status: 200, text: "Ok." };
  }, 5);
  assert.equal((await http.request("https://example.test/collections", "POST")).text, "Ok.");
});
