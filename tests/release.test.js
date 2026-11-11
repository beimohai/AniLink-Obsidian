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
