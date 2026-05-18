/**
 * Reusable fast-check arbitraries for the JARVIS voice pipeline test suites.
 *
 * These arbitraries mirror the domain types described in `design.md`:
 *   - ActionPayload (module / action / value / target / confirmed)
 *   - ProviderHealth (healthy / lastChecked / lastLatencyMs /
 *                     consecutiveFailures / cooldownUntil)
 *   - Raw model XML output (well-formed and malformed variants of
 *     <thought>, <speak>, and <action> blocks)
 *   - Speech text fixtures with sentence-boundary diversity
 *
 * Every arbitrary lives in a single module so backend property tests
 * (and, by relative import, any cross-cutting integration test on the
 * frontend) can share the same generators.
 */

const fc = require('fast-check');

// ---------------------------------------------------------------------------
// ActionPayload
// ---------------------------------------------------------------------------

// Modules whitelisted by the command registry. Mirrors the Risky_Action_Set
// and the schema described in design.md / requirements.md so generated
// payloads can exercise both the safe and the gated paths.
const MODULES = [
  'system',
  'apps',
  'files',
  'network',
  'power',
  'message',
  'productivity',
  'workspace',
  'media',
];

// Per-module action vocabularies. Every (module, action) pair the registry is
// expected to recognize is reachable from these tables, including the closed
// Risky_Action_Set: power:shutdown, power:restart, files:delete, files:format,
// network:wifi_disable, message:send.
const ACTIONS_BY_MODULE = {
  system: [
    'volume_set',
    'volume_mute',
    'volume_unmute',
    'brightness_set',
    'brightness_adjust',
    'bluetooth_enable',
    'bluetooth_disable',
  ],
  apps: ['open', 'close', 'automate'],
  files: [
    'create_folder',
    'create_file',
    'delete',
    'format',
    'sort_downloads',
    'empty_recycle_bin',
  ],
  network: ['ping', 'wifi_enable', 'wifi_disable'],
  power: ['sleep', 'restart', 'shutdown'],
  message: ['send'],
  productivity: ['create_note'],
  workspace: ['focus_mode', 'coding_mode'],
  media: ['play_pause', 'next', 'prev', 'volume_set'],
};

const moduleArb = fc.constantFrom(...MODULES);

const actionForModuleArb = (moduleName) =>
  fc.constantFrom(...ACTIONS_BY_MODULE[moduleName]);

// A value generator broad enough to exercise clamping (numbers outside [0,100]
// included), boolean flags, and free-form strings. `null` and `undefined` are
// folded in so totality of normalizePayload can be asserted.
const valueArb = fc.oneof(
  fc.integer({ min: -1000, max: 1000 }),
  fc.float({ noNaN: true, min: -1000, max: 1000 }),
  fc.boolean(),
  fc.string({ maxLength: 64 }),
  fc.constant(null),
  fc.constant(undefined),
);

// Filesystem targets: a mix of safe leaf names, traversal attempts, absolute
// paths, and mixed separators — useful for path-sandbox properties.
const safeFileNameArb = fc
  .stringMatching(/^[A-Za-z0-9 _\-.]{1,40}$/)
  .filter((s) => s.trim().length > 0 && !s.includes('..'));

const adversarialPathArb = fc.constantFrom(
  '..',
  '../etc/passwd',
  '..\\Windows\\System32',
  '/etc/passwd',
  'C:\\Windows\\System32',
  './../../secret.txt',
  'foo/bar',
  'foo\\bar',
  '\u0000name',
  '',
);

const targetArb = fc.oneof(
  safeFileNameArb,
  adversarialPathArb,
  fc.constant(undefined),
);

/**
 * Generic ActionPayload arbitrary. Module and action are chosen from the
 * registry vocabulary, but `value` and `target` are intentionally noisy so
 * tests can probe normalizePayload's tolerance to junk input.
 */
const actionPayloadArb = moduleArb.chain((module) =>
  fc.record(
    {
      module: fc.constant(module),
      action: actionForModuleArb(module),
      value: valueArb,
      target: targetArb,
      confirmed: fc.option(fc.boolean(), { nil: undefined }),
    },
    { requiredKeys: ['module', 'action'] },
  ),
);

/**
 * ActionPayload constrained to a specific module. Useful for clamping and
 * sandbox properties (e.g. only generate `module: "files"` payloads when
 * exercising the path sandbox).
 */
const actionPayloadForModuleArb = (moduleName) =>
  fc.record(
    {
      module: fc.constant(moduleName),
      action: actionForModuleArb(moduleName),
      value: valueArb,
      target: targetArb,
      confirmed: fc.option(fc.boolean(), { nil: undefined }),
    },
    { requiredKeys: ['module', 'action'] },
  );

// ---------------------------------------------------------------------------
// ProviderHealth
// ---------------------------------------------------------------------------

const PROVIDER_IDS = [
  'gemini_live',
  'gemini_rest',
  'ollama_local',
  'emergency',
];

const providerIdArb = fc.constantFrom(...PROVIDER_IDS);

/**
 * ProviderHealth arbitrary. Timestamps are kept on the same epoch-millisecond
 * scale the router uses; `cooldownUntil` is allowed to fall on either side of
 * "now" so cooldown gating can be tested in both branches.
 */
const providerHealthArb = fc.record({
  healthy: fc.boolean(),
  lastChecked: fc.integer({ min: 0, max: 4_102_444_800_000 }), // up to year ~2100
  lastLatencyMs: fc.integer({ min: 0, max: 30_000 }),
  consecutiveFailures: fc.nat({ max: 25 }),
  cooldownUntil: fc.integer({ min: 0, max: 4_102_444_800_000 }),
});

/**
 * Health table arbitrary: a snapshot keyed by every ProviderId. This matches
 * the `Health_Table` shape consumed by `selectProvider`.
 */
const healthTableArb = fc.record({
  gemini_live: providerHealthArb,
  gemini_rest: providerHealthArb,
  ollama_local: providerHealthArb,
  emergency: providerHealthArb,
});

// ---------------------------------------------------------------------------
// Raw model XML
// ---------------------------------------------------------------------------

// Inner content for tag bodies. Keeps the corpus deterministic enough to
// shrink usefully while still exercising whitespace, punctuation, and unicode.
const innerTextArb = fc.string({ maxLength: 120 });

const speakInnerArb = fc.oneof(
  fc.constant('Hello, sir.'),
  fc.constant('Right away.'),
  fc.constant('Acknowledged. Executing now.'),
  innerTextArb,
);

const thoughtInnerArb = fc.oneof(
  fc.constant('Considering the request carefully.'),
  fc.constant('User probably wants the volume lowered, not muted.'),
  innerTextArb,
);

// A small action-JSON fragment generator: well-formed objects, well-formed
// arrays, and intentionally malformed JSON (trailing commas, smart quotes).
const actionInnerArb = fc.oneof(
  fc.constant('[]'),
  fc.constant('[{"module":"system","action":"volume_set","value":50}]'),
  fc.constant(
    '[{"module":"power","action":"shutdown","value":null,"confirmed":false}]',
  ),
  fc.constant(
    '[{"module":"files","action":"create_folder","value":"notes"}]',
  ),
  // Trailing comma — recovered via extractJsonCandidates.
  fc.constant('[{"module":"apps","action":"open","value":"github",}]'),
  // Smart quotes — recovered via extractJsonCandidates.
  fc.constant(
    '[{\u201Cmodule\u201D:\u201Capps\u201D,\u201Caction\u201D:\u201Copen\u201D,\u201Cvalue\u201D:\u201Cgmail\u201D}]',
  ),
  // Garbage — must be skipped without throwing.
  fc.constant('not even close to json'),
);

const wrapTag = (name, inner, { mixedCase = false } = {}) => {
  const tag = mixedCase
    ? name
        .split('')
        .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c))
        .join('')
    : name;
  return `<${tag}>${inner}</${tag}>`;
};

const thoughtBlockArb = fc
  .tuple(thoughtInnerArb, fc.boolean())
  .map(([inner, mixedCase]) => wrapTag('thought', inner, { mixedCase }));

const speakBlockArb = fc
  .tuple(speakInnerArb, fc.boolean())
  .map(([inner, mixedCase]) => wrapTag('speak', inner, { mixedCase }));

const actionBlockArb = fc
  .tuple(actionInnerArb, fc.boolean())
  .map(([inner, mixedCase]) => wrapTag('action', inner, { mixedCase }));

/**
 * Well-formed raw model XML: zero or more thought blocks, optional speak
 * block, and zero or more action blocks, joined by arbitrary whitespace. This
 * is the "happy path" generator for parser totality tests.
 */
const wellFormedModelXmlArb = fc
  .tuple(
    fc.array(thoughtBlockArb, { maxLength: 3 }),
    fc.option(speakBlockArb, { nil: '' }),
    fc.array(actionBlockArb, { maxLength: 3 }),
  )
  .map(([thoughts, speak, actions]) => {
    const parts = [...thoughts, speak, ...actions].filter(Boolean);
    // Random whitespace between blocks to stress the regexes.
    return parts.join('\n');
  });

/**
 * Malformed model XML: unclosed tags, mismatched casing, leftover prose,
 * empty strings, and arbitrary unicode. The XML parser must remain total on
 * every member of this corpus.
 */
const malformedModelXmlArb = fc.oneof(
  fc.constant(''),
  fc.constant('   \n\t  '),
  fc.constant('plain prose with no tags at all'),
  fc.constant('<speak>missing close'),
  fc.constant('no open</speak>'),
  fc.constant('<THOUGHT>upper case</thought><speak>hi</SPEAK>'),
  fc.constant('<thought>nested<thought>inner</thought></thought><speak>hi</speak>'),
  fc.constant('<action>{"module":"system"'), // unterminated action JSON
  fc.constant('<speak></speak><action>[]</action>'),
  fc.string({ maxLength: 200 }),
);

/**
 * Combined raw model XML arbitrary: 70% well-formed, 30% adversarial. Use
 * this as the default generator for parser totality and thought-stripping
 * properties.
 */
const rawModelXmlArb = fc.oneof(
  { weight: 7, arbitrary: wellFormedModelXmlArb },
  { weight: 3, arbitrary: malformedModelXmlArb },
);

// ---------------------------------------------------------------------------
// Speech text fixtures
// ---------------------------------------------------------------------------

// Single-sentence words. Kept small and printable so the generated fixtures
// stay readable in fast-check shrink output.
const sentenceWordArb = fc
  .stringMatching(/^[A-Za-z]{1,12}$/)
  .filter((w) => w.length > 0);

const sentenceArb = fc
  .array(sentenceWordArb, { minLength: 1, maxLength: 12 })
  .chain((words) =>
    fc
      .constantFrom('.', '!', '?')
      .map((punct) => words.join(' ') + punct),
  );

/**
 * Multi-sentence speech fixtures with sentence-boundary diversity. Sentences
 * are joined by a randomized whitespace separator (single space, double
 * space, or newline) so splitSpeech's whitespace-normalization invariants
 * are exercised.
 */
const speechTextArb = fc
  .array(sentenceArb, { minLength: 0, maxLength: 6 })
  .chain((sentences) =>
    fc
      .constantFrom(' ', '  ', '\n', ' \n ')
      .map((sep) => sentences.join(sep)),
  );

/**
 * Speech text constrained to non-empty input. Useful for properties that
 * assume at least one chunk will be produced.
 */
const nonEmptySpeechTextArb = speechTextArb.filter(
  (s) => s.replace(/\s+/g, ' ').trim().length > 0,
);

/**
 * Long speech text: forces splitSpeech to perform multiple cuts. Used for
 * chunk-ordering and length-bound properties.
 */
const longSpeechTextArb = fc
  .array(sentenceArb, { minLength: 6, maxLength: 20 })
  .map((sentences) => sentences.join(' '));

module.exports = {
  // ActionPayload
  MODULES,
  ACTIONS_BY_MODULE,
  moduleArb,
  actionForModuleArb,
  valueArb,
  safeFileNameArb,
  adversarialPathArb,
  targetArb,
  actionPayloadArb,
  actionPayloadForModuleArb,

  // ProviderHealth
  PROVIDER_IDS,
  providerIdArb,
  providerHealthArb,
  healthTableArb,

  // Raw model XML
  thoughtBlockArb,
  speakBlockArb,
  actionBlockArb,
  wellFormedModelXmlArb,
  malformedModelXmlArb,
  rawModelXmlArb,

  // Speech text
  sentenceArb,
  speechTextArb,
  nonEmptySpeechTextArb,
  longSpeechTextArb,
};
