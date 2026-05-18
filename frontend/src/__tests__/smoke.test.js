/**
 * Smoke test that verifies the frontend test runner (jest via react-scripts)
 * picks up files in src/__tests__ and that fast-check is available as a dev
 * dependency. Real property tests for splitSpeech, the echo guard, and the
 * TTS queue land in sibling files added by later tasks.
 */

import fc from 'fast-check';

test('runs jest with fast-check', () => {
  fc.assert(
    fc.property(fc.integer(), (n) => Number.isInteger(n)),
    { numRuns: 25 },
  );
  expect(true).toBe(true);
});
