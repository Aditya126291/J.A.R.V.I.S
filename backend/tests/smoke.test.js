/**
 * Smoke test that verifies the test runner and shared arbitraries are wired
 * up. Real property tests for the voice pipeline live in sibling files added
 * by later tasks.
 */

const fc = require('fast-check');

const {
  actionPayloadArb,
  providerHealthArb,
  rawModelXmlArb,
  speechTextArb,
} = require('./helpers/arbitraries');

describe('test infrastructure smoke', () => {
  it('runs vitest with fast-check', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => Number.isInteger(n)),
      { numRuns: 25 },
    );
    expect(true).toBe(true);
  });

  it('exposes the four core arbitraries from arbitraries.js', () => {
    fc.assert(
      fc.property(actionPayloadArb, (a) => {
        return typeof a.module === 'string' && typeof a.action === 'string';
      }),
      { numRuns: 25 },
    );

    fc.assert(
      fc.property(providerHealthArb, (h) => {
        return (
          typeof h.healthy === 'boolean' &&
          typeof h.lastChecked === 'number' &&
          typeof h.lastLatencyMs === 'number' &&
          typeof h.consecutiveFailures === 'number' &&
          typeof h.cooldownUntil === 'number'
        );
      }),
      { numRuns: 25 },
    );

    fc.assert(
      fc.property(rawModelXmlArb, (raw) => typeof raw === 'string'),
      { numRuns: 25 },
    );

    fc.assert(
      fc.property(speechTextArb, (s) => typeof s === 'string'),
      { numRuns: 25 },
    );
  });
});
