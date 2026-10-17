// ESLint flat config.
// The four pure layers (engine, cards, ai, session) must stay free of React,
// Expo, Node APIs and ambient entropy so games are deterministic and
// replayable. These rules are one of three guards; the others are
// tsconfig.engine.json (no DOM/node types) and tests/architecture.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Every file type, not just .ts: a .js or .tsx file in a pure layer must not
// slip past these rules (the architecture test also rejects non-.ts files).
const EXT = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}';
const PURE = ['engine', 'cards', 'ai', 'session'].map((layer) => `src/${layer}/**/*.${EXT}`);

const FRAMEWORK_IMPORTS = [
  { group: ['react', 'react-*', 'react/*'], message: 'Pure layers cannot depend on React.' },
  { group: ['react-native', 'react-native-*', '@react-native*/*'], message: 'Pure layers cannot depend on React Native.' },
  { group: ['expo', 'expo-*', '@expo/*'], message: 'Pure layers cannot depend on Expo.' },
  { group: ['node:*', 'fs', 'path', 'crypto', 'os', 'child_process'], message: 'Pure layers cannot use Node APIs.' },
  { group: ['**/ui', '**/ui/**'], message: 'Pure layers cannot import UI code.' },
];

export default defineConfig(
  {
    ignores: ['node_modules/', 'dist/', '.expo/', 'coverage/', 'e2e/artifacts/', 'docs/_private/', 'assets/', 'local-cards/'],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.engine.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: false }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: PURE,
    rules: {
      'no-restricted-imports': ['error', { patterns: FRAMEWORK_IMPORTS }],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG in src/engine/core/rng.ts.' },
        { object: 'Date', property: 'now', message: 'Pure layers must not read the clock.' },
        { object: 'performance', property: 'now', message: 'Pure layers must not read the clock.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'Pure layers must not read the clock.' },
        { selector: "CallExpression[callee.name='Date']", message: 'Pure layers must not read the clock.' },
        { selector: "VariableDeclarator[init.name=/^(Math|Date|Intl)$/]", message: 'Do not alias Math, Date or Intl; it hides clock and entropy reads.' },
      ],
      'no-restricted-globals': [
        'error',
        'window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location',
        'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'requestAnimationFrame',
        'crypto', 'process', 'fetch', 'console', 'performance', 'Intl',
        'globalThis', 'global', 'self', 'eval', 'Function',
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // A single `/// <reference lib="dom" />` would give every pure file DOM types.
      '@typescript-eslint/triple-slash-reference': ['error', { lib: 'never', path: 'never', types: 'never' }],
    },
  },
  {
    // The engine has zero dependencies, not even zod.
    files: [`src/engine/**/*.${EXT}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...FRAMEWORK_IMPORTS,
            { regex: '^[^.]', message: 'The engine imports nothing outside itself (relative paths only).' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/ui/**/*.tsx', 'src/ui/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
