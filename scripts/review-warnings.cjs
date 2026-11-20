"use strict";
const fs = require('node:fs');
const { ESLint } = require('eslint');

(async () => {
  const eslint = new ESLint({ overrideConfigFile: 'eslint.review.config.mjs' });
  const results = await eslint.lintFiles(['main.js', 'core.js']);
  const counts = {};
  let errors = 0;
  for (const result of results) {
    errors += result.errorCount;
    for (const message of result.messages)
      counts[message.ruleId || 'parser'] = (counts[message.ruleId || 'parser'] || 0) + 1;
  }
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/warnings-review.json', JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({
    errors,
    rules: counts,
    cssImportant: (fs.readFileSync('styles.css', 'utf8').match(/!important/g) || []).length,
    report: 'test-results/warnings-review.json',
  }, null, 2));
  if (errors) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
