"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("login scheduler refreshes AniLink feeds and records its completed idle exit", { skip: process.platform !== "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anilink-scheduler-test-"));
  const quote = (value) => "'" + value.replace(/'/g, "''") + "'";
  try {
    fs.writeFileSync(path.join(root, "data.json"), JSON.stringify({ state: { settings: { qbUrl: "http://127.0.0.1:8080", qbUser: "other-device", idleMinutes: 120 } } }));
    fs.writeFileSync(path.join(root, "device.json"), JSON.stringify({ settings: { qbUser: "local-device", idleMinutes: 1 } }));
    fs.writeFileSync(path.join(root, "scheduler.json"), JSON.stringify({ dataFile: path.join(root, "data.json"), deviceSettingsFile: path.join(root, "device.json"), exe: "test-qbittorrent.exe" }));
    // Isolate the test's mutex from a real login scheduler already running.
    const schedulerSource = fs.readFileSync(path.resolve("scripts/download-scheduler.ps1"), "utf8");
    const mutexName = "Local\\AniLinkDownloadScheduler";
    assert.ok(schedulerSource.includes(mutexName));
    const schedulerPath = path.join(root, "download-scheduler.ps1");
    fs.writeFileSync(schedulerPath, schedulerSource.replace(mutexName, mutexName + "Test-" + path.basename(root)));
    fs.writeFileSync(path.join(root, "run.ps1"), `
$global:anilinkTestClock = [datetime]'2026-11-20T09:00:00'
$global:anilinkTestRequests = @()
function Get-Date { $global:anilinkTestClock = $global:anilinkTestClock.AddMinutes(2); return $global:anilinkTestClock }
function Get-CimInstance { [pscustomobject]@{ExecutablePath='test-qbittorrent.exe'} }
function Invoke-RestMethod {
 param($Uri, $WebSession, $TimeoutSec)
 if ($Uri -like '*/rss/items') { return [pscustomobject]@{'AniLink-42'=[pscustomobject]@{url='https://example.test/rss'}; Other=[pscustomobject]@{url='https://example.test/other'}} }
 if ($Uri -like '*/torrents/info') { return @() }
 throw "Unexpected REST request: $Uri"
}
function Invoke-WebRequest {
 param($Uri, $Method, $Body, $SessionVariable, $WebSession, $TimeoutSec, [switch]$UseBasicParsing)
 $global:anilinkTestRequests += [pscustomobject]@{uri=$Uri;itemPath=$Body.itemPath;username=$Body.username}
}
function Start-Sleep { throw 'Scheduler did not complete its idle exit' }
& ${quote(schedulerPath)} -Once -ManageRunning -ConfigPath ${quote(path.join(root, "scheduler.json"))}
ConvertTo-Json -InputObject @($global:anilinkTestRequests) -Compress
`);
    const result = spawnSync("powershell.exe", ["-NoProfile", "-File", path.join(root, "run.ps1")], { encoding: "utf8", timeout: 20000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const requests = JSON.parse(result.stdout.trim());
    assert.equal(requests.find((request) => request.uri.endsWith("/auth/login")).username, "local-device");
    assert.deepEqual(requests.filter((request) => request.uri.endsWith("/rss/refreshItem")).map((request) => request.itemPath), ["AniLink-42"]);
    assert.ok(requests.some((request) => request.uri.endsWith("/app/shutdown")));
    const status = JSON.parse(fs.readFileSync(path.join(root, "scheduler-status.json"), "utf8").replace(/^\uFEFF/, ""));
    assert.equal(status.state, "idle-exit");
    assert.equal(status.ownsDownloader, false);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
