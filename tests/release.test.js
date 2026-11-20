const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const cp = require('node:child_process');
test('bundled audio helper is byte-identical to the maintained Python source', () => {
 const source = fs.readFileSync('main.js', 'utf8');
 const line = source.split('\n').find(line => line.startsWith('AniLink.prototype.bundledAudioScript = '));
 const sandbox = { AniLink: function(){} };
 vm.runInNewContext(line, sandbox);
 assert.equal(sandbox.AniLink.prototype.bundledAudioScript, fs.readFileSync('scripts/align-audio.py','utf8').replace(/\r\n?/g,'\n'));
 assert.doesNotMatch(source, /\.plugins\.(?:disablePlugin|enablePlugin)\(/);
});
test('repeated build produces identical bytes', () => {
 const before = fs.readFileSync('main.js');
 cp.execFileSync(process.execPath, ['build.js']);
 assert.deepEqual(fs.readFileSync('main.js'), before);
});


test('factory settings contain preferences and exclude personal configuration', () => {
 const C = require('../core');
 const a = C.defaults();
 const b = C.defaults();
 for (const key of ['qbUser', 'qbPassword', 'qbExe', 'downloadRoot', 'libraryRoot', 'bgmToken', 'playerExe']) assert.equal(a.settings[key], '');
 assert.equal(a.settings.qbUrl, 'http://127.0.0.1:8080');
 assert.equal(a.settings.biliUploaders, '4262884,5306996,690151424,154244413,442715778,3546957240862932');
 assert.deepEqual(a.settings.biliFilterRules, []);
 assert.equal(a.settings.idleMinutes, 5);
 assert.equal(a.settings.openFirstShow, true);
 assert.equal(a.settings.rssUpgradeUnwatched, true);
 assert.equal(a.settings.autoRefresh, false);
 assert.equal(a.settings.downloadNotifications, false);
 assert.equal(a.settings.browserMode, 'obsidian');
 a.settings.searchStatuses.push(1);
 a.settings.biliFilterRules.push({ filter: 'private' });
 assert.deepEqual(b.settings.searchStatuses, [3]);
 assert.deepEqual(b.settings.biliFilterRules, []);
});


test('standard release embeds both maintained Windows scheduler scripts', () => {
 const source = fs.readFileSync('main.js', 'utf8');
 const line = source.split('\n').find(line => line.startsWith('AniLink.prototype.bundledSchedulerScripts = '));
 const sandbox = { AniLink: function(){} };
 vm.runInNewContext(line, sandbox);
 for (const [name, content] of Object.entries(sandbox.AniLink.prototype.bundledSchedulerScripts))
   assert.equal(content, fs.readFileSync('scripts/' + name, 'utf8').replace(/\r\n?/g, '\n'));
 assert.equal(Object.keys(sandbox.AniLink.prototype.bundledSchedulerScripts).length, 2);
});

test('build output is identical with LF and CRLF source inputs', (t) => {
 const os = require('node:os');
 const path = require('node:path');
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anilink-repro-'));
 t.after(() => {
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'anilink-repro-'));
  fs.rmSync(root, { recursive: true, force: true });
 });
 for (const name of ['src', 'scripts', 'assets/branding']) fs.cpSync(name, path.join(root, name), { recursive: true });
 for (const name of ['build.js', 'core.js', 'package.json']) fs.copyFileSync(name, path.join(root, name));
 for (const name of ['assets/branding/anilink-icon-white.svg', 'scripts/focus-player.ps1']) {
  const file = path.join(root, name);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n'));
 }
 cp.execFileSync(process.execPath, ['build.js'], { cwd: root });
 const lf = fs.readFileSync(path.join(root, 'main.js'));
 for (const name of ['assets/branding/anilink-icon-white.svg', 'scripts/focus-player.ps1']) {
  const file = path.join(root, name);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
 }
 cp.execFileSync(process.execPath, ['build.js'], { cwd: root });
 assert.deepEqual(fs.readFileSync(path.join(root, 'main.js')), lf);
 assert.deepEqual(fs.readFileSync('main.js'), lf);
});

test('downloader launch remains visible and scheduler recovers abandoned ownership', () => {
 const ux = fs.readFileSync('src/ux.js', 'utf8');
 const open = ux.slice(ux.indexOf('AniLink.prototype.openDownloader ='), ux.indexOf('AniLink.prototype.prepareSchedulerScripts ='));
 assert.match(open, /windowsHide: false/);
 const scheduler = fs.readFileSync('scripts/download-scheduler.ps1', 'utf8');
 assert.match(scheduler, /Start-Process -FilePath \$config.exe -ArgumentList \$args -WindowStyle Minimized/);
 assert.match(scheduler, /AbandonedMutexException/);
 const installer = fs.readFileSync('scripts/install-scheduler.ps1', 'utf8');
 assert.match(installer, /-Once/);
});

test('release years before the episode separator are not episode ranges', () => {
 const C = require('../core');
 const filename = '[Nekomoe kissaten&LoliHouse] Ranma ½ 2024 - 31 [WebRip 1080p HEVC-10bit AAC ASSx2].mkv';
 assert.equal(C.parseEpisode(filename), 31);
 const show = { subscription: { numbering: 'absolute' }, episodes: [{ id: 7, type: 0, sort: 31, ep: 7 }] };
 assert.equal(C.resolveEpisode(show, filename).id, 7);
 assert.equal(C.parseEpisode('Ranma 2024 - 25-36 [1080p].mkv'), null);
 assert.equal(C.parseEpisode('Anime [01-12] [1080p].mkv'), null);
});
