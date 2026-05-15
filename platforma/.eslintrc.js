'use strict';

module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2021,
  },
  rules: {
    // Error prevention
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': 'off', // We use Winston, but allow console in tests
    'no-process-exit': 'off', // Services call process.exit on fatal errors

    // Code style
    'eqeqeq': ['error', 'always'],
    'curly': ['error', 'all'],
    'no-var': 'error',
    'prefer-const': 'error',
    'prefer-arrow-callback': 'error',

    // Async patterns
    'no-return-await': 'error',
    'require-await': 'off',
  },
  ignorePatterns: ['node_modules/', 'coverage/', 'data/'],
};
