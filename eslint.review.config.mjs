import base from './eslint.config.mjs';
import obsidianmd from 'eslint-plugin-obsidianmd';

const typescriptRules = obsidianmd.configs.recommended.find(
  (config) => config.plugins?.['@typescript-eslint'],
).plugins['@typescript-eslint'];

// Keep review warnings visible independently of the release's error checks.
export default [...base, {
  files: ['main.js', 'core.js'],
  plugins: { '@typescript-eslint': typescriptRules },
  rules: {
    '@typescript-eslint/no-unsafe-assignment': 'warn',
    '@typescript-eslint/no-unsafe-call': 'warn',
    '@typescript-eslint/no-unsafe-return': 'warn',
    '@typescript-eslint/no-unsafe-argument': 'warn',
    '@typescript-eslint/no-unsafe-member-access': 'warn',
    '@typescript-eslint/no-require-imports': 'warn',
    'obsidianmd/no-nodejs-modules': 'warn',
    'obsidianmd/settings-tab/prefer-setting-definitions': 'warn',
  },
}];
