/**
 * Unit tests for requiresConfirmation in backend/modules/command_registry.js
 * (Task 3.2).
 *
 * The function is the gate for the closed Risky_Action_Set defined in
 * design.md / requirements.md (Glossary):
 *
 *   { power:shutdown, power:restart, files:delete, files:format,
 *     network:wifi_disable, message:send }
 *
 * Validates: Requirements 6.6.
 *
 * These cover example-level behavior. The universal gating property
 * (`requiresConfirmation(n) && n.confirmed !== true ⟹ n ∉ validateActions.ok`)
 * is exercised separately by the optional property test in task 3.5.
 */

const { requiresConfirmation } = require('../modules/command_registry');

const RISKY_PAIRS = [
  ['power', 'shutdown'],
  ['power', 'restart'],
  ['files', 'delete'],
  ['files', 'format'],
  ['network', 'wifi_disable'],
  ['message', 'send'],
];

// Pairs that previously appeared in a broader set but are explicitly
// EXCLUDED from the closed Risky_Action_Set per Requirement 6.6.
const NON_RISKY_PAIRS = [
  ['power', 'sleep'],
  ['network', 'wifi_enable'],
  ['files', 'sort_downloads'],
  ['files', 'empty_recycle_bin'],
  ['files', 'create_folder'],
  ['files', 'create_file'],
  ['system', 'volume_set'],
  ['system', 'brightness_set'],
  ['system', 'bluetooth_disable'],
  ['apps', 'open'],
  ['apps', 'close'],
  ['media', 'play_pause'],
  ['workspace', 'focus_mode'],
  ['productivity', 'create_note'],
  ['network', 'ping'],
];

describe('requiresConfirmation (Req 6.6)', () => {
  it('returns true for every member of the closed Risky_Action_Set', () => {
    for (const [module, action] of RISKY_PAIRS) {
      expect(requiresConfirmation({ module, action })).toBe(true);
    }
  });

  it('returns false for actions outside the closed Risky_Action_Set', () => {
    for (const [module, action] of NON_RISKY_PAIRS) {
      expect(requiresConfirmation({ module, action })).toBe(false);
    }
  });

  it('ignores the `confirmed` flag (gating is the caller`s responsibility)', () => {
    // requiresConfirmation only reports membership in the risky set; whether
    // the action is actually allowed to proceed is decided by the caller
    // (validateActions / the request handler), not by this predicate.
    expect(
      requiresConfirmation({ module: 'power', action: 'shutdown', confirmed: true }),
    ).toBe(true);
    expect(
      requiresConfirmation({ module: 'power', action: 'shutdown', confirmed: false }),
    ).toBe(true);
  });

  it('returns a strict boolean for every input', () => {
    const inputs = [
      { module: 'power', action: 'shutdown' },
      { module: 'apps', action: 'open' },
      { module: '', action: '' },
      { module: 'files', action: 'delete' },
      { module: 'unknown', action: 'unknown' },
    ];
    for (const input of inputs) {
      const result = requiresConfirmation(input);
      expect(typeof result).toBe('boolean');
    }
  });

  it('returns false (never throws) for null / undefined / non-object input', () => {
    expect(requiresConfirmation(null)).toBe(false);
    expect(requiresConfirmation(undefined)).toBe(false);
    expect(requiresConfirmation(0)).toBe(false);
    expect(requiresConfirmation('')).toBe(false);
    expect(requiresConfirmation(false)).toBe(false);
  });

  it('returns false when module or action is missing', () => {
    expect(requiresConfirmation({})).toBe(false);
    expect(requiresConfirmation({ module: 'power' })).toBe(false);
    expect(requiresConfirmation({ action: 'shutdown' })).toBe(false);
  });

  it('is case-sensitive (matches the canonical lowercase identifiers)', () => {
    // normalizePayload lowercases module/action before the gate runs, so the
    // raw predicate is only required to recognize the canonical form.
    expect(
      requiresConfirmation({ module: 'POWER', action: 'SHUTDOWN' }),
    ).toBe(false);
    expect(
      requiresConfirmation({ module: 'power', action: 'SHUTDOWN' }),
    ).toBe(false);
  });

  it('does not match concatenated or look-alike action keys', () => {
    expect(
      requiresConfirmation({ module: 'power:shutdown', action: '' }),
    ).toBe(false);
    expect(
      requiresConfirmation({ module: 'power', action: 'shutdown ' }),
    ).toBe(false);
    expect(
      requiresConfirmation({ module: 'powers', action: 'shutdown' }),
    ).toBe(false);
  });

  it('is pure: repeated calls with the same payload return the same result', () => {
    const payload = { module: 'message', action: 'send', value: { app: 'whatsapp' } };
    const first = requiresConfirmation(payload);
    const second = requiresConfirmation(payload);
    const third = requiresConfirmation({ ...payload });
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(third).toBe(true);
  });
});
