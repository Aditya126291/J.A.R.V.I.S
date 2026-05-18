/**
 * Vitest config for the JARVIS backend test suite.
 *
 * `globals: true` exposes `describe`, `it`, `expect`, `beforeEach`, `afterEach`
 * etc. on the global scope so CommonJS test files (the rest of the backend is
 * CJS) don't need to `require('vitest')`. ESM test files can still use
 * `import` from 'vitest' if they prefer.
 *
 * Node environment matches the backend runtime; no DOM is needed because the
 * frontend has its own jest setup under react-scripts.
 */

const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{js,mjs,cjs}'],
  },
});
