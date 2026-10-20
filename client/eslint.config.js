// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = defineConfig([
  // Spartan helm code is vendored (copied from the registry): not linted.
  { ignores: ['src/app/spartan/**'] },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // `_name` marks a value left out on purpose (rest destructuring, unused callback args).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      // Existing outputs named like DOM events (close, select…) and aliased inputs: renaming them
      // changes the component API used by templates. Listed in the P2-3992 doc; warn until renamed.
      '@angular-eslint/no-output-native': 'warn',
      '@angular-eslint/no-input-rename': 'warn',
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: ['qa', 'app'],
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: ['qa', 'app'],
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    // Ratchet (no request lost, Yeck 28-sep-2026): every call to the API goes through HttpClient,
    // so the request-safety and auth interceptors always run. Raw fetch/XHR/HttpBackend skip them.
    files: ['src/app/**/*.ts'],
    ignores: ['src/app/**/*.spec.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Use HttpClient: raw fetch skips the request-safety and auth interceptors.' },
        { name: 'XMLHttpRequest', message: 'Use HttpClient: raw XHR skips the request-safety and auth interceptors.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@angular/common/http',
              importNames: ['HttpBackend', 'HttpXhrBackend', 'FetchBackend'],
              message: 'Use HttpClient: a backend skips the request-safety and auth interceptors.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      // Our form controls are components: a <label> wrapping them is associated.
      '@angular-eslint/template/label-has-associated-control': [
        'error',
        { controlComponents: ['qa-switch', 'qa-select', 'qa-segmented', 'qa-date-picker', 'qa-multi-select'] },
      ],
    },
  },
]);
