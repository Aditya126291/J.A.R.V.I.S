/**
 * J.A.R.V.I.S. Gemini Health & Dynamic Routing Negotiation Module
 * Provides lightweight health checks using the low-overhead `:countTokens` API
 * to dynamically confirm model compatibility, key validity, and negotiate fallback routes.
 *
 * Canonical health shape (`HealthResult`, per design.md "Health Monitor"):
 *   { ok: boolean, latencyMs: number, error?: string, statusCode?: number }
 *
 * Both the REST branch and the Live WS branch of `pingModel` return this shape
 * directly. `toHealthResult` is retained as a defensive normalizer for any caller
 * that still produces the legacy `{success, status, errorCode, message}` shape;
 * for canonical inputs it is a no-op.
 */

/**
 * Normalize any internal ping response into the canonical HealthResult shape.
 * @param {object} r
 * @returns {{ok: boolean, latencyMs: number, error?: string, statusCode?: number}}
 */
function toHealthResult(r) {
  if (r && typeof r.ok === 'boolean') return r; // already canonical
  if (!r) return { ok: false, latencyMs: 0, error: 'unknown_error' };
  const out = {
    ok: r.success === true,
    latencyMs: typeof r.latencyMs === 'number' ? r.latencyMs : 0,
  };
  if (typeof r.status === 'number' && r.status > 0) out.statusCode = r.status;
  if (!out.ok) out.error = r.errorCode ? String(r.errorCode).toLowerCase() : 'unknown_error';
  return out;
}

function isLiveGeminiModel(model) {
  const m = String(model || '');
  return /live/i.test(m) || /native-audio/i.test(m);
}

/**
 * Pings the Gemini Live WebSocket endpoint and resolves with a canonical
 * `HealthResult`. Settles within 5000 ms via a `setTimeout` that resolves
 * (rather than throws) with `{ ok: false, latencyMs: 5000, error: "timeout" }`.
 *
 * On `setupComplete` the promise resolves with `{ ok: true, latencyMs, statusCode: 200 }`.
 * Error codes are lowercase: `timeout`, `websocket_unavailable`, `connection_error`,
 * `send_error`, `parse_error`, `closed`, `api_error` (or the upstream `error.status`
 * lowercased).
 *
 * Per design.md "Health Monitor": the Live branch returns the canonical
 * HealthResult shape directly; the `pingModel` dispatcher forwards the result
 * without invoking `toHealthResult`.
 *
 * @param {string} apiKey - The Gemini API key to test.
 * @param {string} model - The Live model identifier (e.g. "gemini-2.5-flash-native-audio-latest").
 * @returns {Promise<{ok: boolean, latencyMs: number, error?: string, statusCode?: number}>}
 */
function pingLiveModel(apiKey, model) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;

    // Defensive guard: the public `pingModel` dispatcher already pre-checks
    // `apiKey` before routing here, but `pingLiveModel` is also exported and
    // may be called directly. Per Requirement 8.5 the Live branch must never
    // throw; a missing key resolves to a canonical HealthResult.
    if (!apiKey) {
      resolve({ ok: false, latencyMs: 0, error: 'missing_api_key' });
      return;
    }

    if (typeof WebSocket !== 'function') {
      resolve({ ok: false, latencyMs: 0, error: 'websocket_unavailable' });
      return;
    }

    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
    let socket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      resolve({ ok: false, latencyMs: elapsed(), error: 'connection_error' });
      return;
    }
    let finished = false;

    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch (e) {}
      resolve(result);
    };

    // Strict 5000 ms ceiling (Requirement 8.5). On timeout we report a
    // fixed latencyMs of 5000 — this is the budget consumed, not the
    // measured wall-clock — so callers see a single canonical timeout shape.
    const timeout = setTimeout(() => {
      finish({ ok: false, latencyMs: 5000, error: 'timeout' });
    }, 5000);

    socket.addEventListener('open', () => {
      try {
        const isNativeAudio = /native-audio/i.test(model);
        const responseModalities = isNativeAudio ? ['AUDIO'] : ['TEXT'];
        socket.send(
          JSON.stringify({
            setup: {
              model: `models/${model}`,
              generationConfig: {
                temperature: 0.25,
                maxOutputTokens: 10,
                responseModalities: responseModalities,
                ...(isNativeAudio && {
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: {
                        voiceName: 'Puck'
                      }
                    }
                  }
                })
              },
            },
          })
        );
      } catch (e) {
        finish({ ok: false, latencyMs: elapsed(), error: 'send_error' });
      }
    });

    socket.addEventListener('message', (event) => {
      let payloadText = '';
      try {
        if (typeof event.data === 'string') {
          payloadText = event.data;
        } else if (event.data && typeof event.data.text === 'function') {
          event.data.text().then((txt) => {
            handleMsgText(txt);
          }).catch(() => {
            finish({ ok: false, latencyMs: elapsed(), error: 'parse_error' });
          });
          return;
        } else {
          payloadText = Buffer.from(event.data).toString('utf8');
        }
        handleMsgText(payloadText);
      } catch (e) {
        // Continue waiting for a parseable frame.
      }
    });

    function handleMsgText(text) {
      try {
        const msg = JSON.parse(text);
        if (msg.error) {
          const code = msg.error.status
            ? String(msg.error.status).toLowerCase()
            : 'api_error';
          finish({ ok: false, latencyMs: elapsed(), error: code });
        } else if (msg.setupComplete) {
          finish({ ok: true, latencyMs: elapsed(), statusCode: 200 });
        }
      } catch (e) {
        // Ignore non-JSON or unrelated frames; keep waiting.
      }
    }

    socket.addEventListener('error', () => {
      finish({ ok: false, latencyMs: elapsed(), error: 'connection_error' });
    });

    socket.addEventListener('close', () => {
      if (!finished) {
        finish({ ok: false, latencyMs: elapsed(), error: 'closed' });
      }
    });
  });
}

/**
 * Pings a Gemini REST or Live model and returns a structured HealthResult.
 *
 * REST path:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:countTokens?key={apiKey}
 *   body: { contents: [{ parts: [{ text: "ping" }] }] }
 *
 * Settles within 6000 ms. Never throws — missing apiKey, network errors,
 * timeouts, and HTTP failures all resolve to a `HealthResult` with `ok: false`.
 *
 * @param {string} apiKey - The Gemini API key to test.
 * @param {string} model - The model identifier (e.g. "gemini-2.5-flash").
 * @returns {Promise<{ok: boolean, latencyMs: number, error?: string, statusCode?: number}>}
 */
async function pingModel(apiKey, model) {
  if (!apiKey) {
    return { ok: false, latencyMs: 0, error: 'missing_api_key' };
  }

  if (isLiveGeminiModel(model)) {
    console.log(`[HEALTH CHECK] Live model detected. Performing WebSocket handshake for: "${model}"...`);
    // Live WS ping returns the canonical HealthResult shape directly.
    return pingLiveModel(apiKey, model);
  }

  const cleanModel = String(model || '').replace(/^models\//, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:countTokens?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000); // 6 second strict timeout per design
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }] }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latencyMs = Date.now() - startedAt;

    if (response.ok) {
      return { ok: true, latencyMs, statusCode: response.status };
    }

    // Try to extract a structured error code from the response body, but
    // never throw — body parse failures degrade to a generic api_error.
    let errorCode = 'api_error';
    try {
      const data = await response.json();
      if (data && data.error && data.error.status) {
        errorCode = String(data.error.status).toLowerCase();
      }
    } catch (_) {
      // body wasn't JSON; keep the generic api_error code
    }

    return {
      ok: false,
      latencyMs,
      error: errorCode,
      statusCode: response.status,
    };
  } catch (e) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - startedAt;
    const isTimeout = e && e.name === 'AbortError';
    return {
      ok: false,
      latencyMs,
      error: isTimeout ? 'timeout' : 'network_error',
    };
  }
}

/**
 * Negotiates a working model for a given key by trying a list of fallback candidates.
 * @param {string} apiKey - The Gemini API key to test.
 * @param {string} preferredModel - The model the user prefers to run.
 * @param {Array<string>} [candidates] - Optional list of fallback candidates to test if preferred fails.
 * @returns {Promise<{model: string, success: boolean, message: string}>}
 */
async function negotiateModel(apiKey, preferredModel, candidates = []) {
  console.log(`[HEALTH CHECK] Testing preferred model: "${preferredModel}"...`);
  const prefCheck = await pingModel(apiKey, preferredModel);

  if (prefCheck.ok) {
    console.log(`[HEALTH CHECK] Preferred model "${preferredModel}" is healthy.`);
    return { model: preferredModel, success: true, message: 'Preferred model operational' };
  }

  console.warn(`[HEALTH CHECK] Preferred model "${preferredModel}" failed check: [${prefCheck.error || 'unknown'}] status=${prefCheck.statusCode || 0}`);

  // Default list of fallback candidates sorted by preference
  const fallbackCandidates = candidates.length > 0 ? candidates : [
    'gemini-2.5-flash-native-audio-latest',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-3.1-flash-lite',
    'gemini-flash-latest'
  ];

  for (const candidate of fallbackCandidates) {
    if (candidate === preferredModel) continue; // Already tested

    console.log(`[HEALTH CHECK] Trying fallback candidate: "${candidate}"...`);
    const candidateCheck = await pingModel(apiKey, candidate);
    if (candidateCheck.ok) {
      console.log(`[HEALTH CHECK] Successfully negotiated operational model: "${candidate}"`);
      return {
        model: candidate,
        success: true,
        message: `Negotiated operational model "${candidate}" after "${preferredModel}" failed.`
      };
    }
  }

  console.error('[HEALTH CHECK] All tested Gemini models failed to authenticate or respond.');
  return {
    model: preferredModel,
    success: false,
    message: `All models failed check. Last error: [${prefCheck.error || 'unknown'}] status=${prefCheck.statusCode || 0}`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Health_Table state machine
// ─────────────────────────────────────────────────────────────────────────────
// Per design.md "Fallback State Machine" and Requirements 3.3–3.6.
//
// Five states: Unknown, Healthy, Degraded, Unhealthy, Cooldown.
// Transitions (driven by `markSuccess` / `markFailure`):
//   Unknown   → Healthy on success, Unhealthy on failure
//   Healthy   → Degraded on failure, Healthy on success
//   Degraded  → Unhealthy on failure, Healthy on success (recover)
//   Unhealthy → Cooldown on any signal (sets cooldownUntil)
//   Cooldown  → Unknown when `now >= cooldownUntil` (re-ping required)
//
// `getProviderState` returns the externally-observable state, applying two
// time-based downgrades so callers always re-validate stale data:
//   - Healthy/Degraded snapshot older than 10 s → Unknown (Requirement 3.6)
//   - Cooldown whose timer has elapsed         → Unknown
//
// The internal `state` field is updated only by markSuccess/markFailure;
// `getProviderState` is a pure view that does not mutate.

const PROVIDER_IDS = ['gemini_live', 'gemini_rest', 'ollama_local', 'emergency'];
const STALE_THRESHOLD_MS = 10000;
const COOLDOWN_BASE_MS = 30000;
const COOLDOWN_CEILING_MS = 300000;

const HealthState = Object.freeze({
  Unknown: 'Unknown',
  Healthy: 'Healthy',
  Degraded: 'Degraded',
  Unhealthy: 'Unhealthy',
  Cooldown: 'Cooldown',
});

function makeInitialRecord() {
  return {
    healthy: false,
    lastChecked: 0,
    lastLatencyMs: 0,
    consecutiveFailures: 0,
    cooldownUntil: 0,
    state: HealthState.Unknown,
  };
}

// All four providers start in `Unknown` at module load.
const healthTable = Object.create(null);
for (const id of PROVIDER_IDS) {
  healthTable[id] = makeInitialRecord();
}

/**
 * Exponential cooldown growth used by the Fallback State Machine.
 *
 * - `failures === 0` → `0`.
 * - `failures >= 1` → `min(30000 * 2^(failures-1), 300000)` ms.
 *
 * Sequence: 30 s, 60 s, 120 s, 240 s, then capped at 300 s (5 min).
 *
 * @param {number} consecutiveFailures
 * @returns {number} cooldown duration in milliseconds (>= 0)
 */
function getCooldownMs(consecutiveFailures) {
  if (
    typeof consecutiveFailures !== 'number' ||
    !Number.isFinite(consecutiveFailures) ||
    consecutiveFailures < 1
  ) {
    return 0;
  }
  const n = Math.floor(consecutiveFailures);
  const computed = COOLDOWN_BASE_MS * Math.pow(2, n - 1);
  return Math.min(computed, COOLDOWN_CEILING_MS);
}

/**
 * Compute the externally-observable state of a record at time `now`, applying
 * the two time-based downgrades. Pure — never mutates the record.
 *
 * @param {{state: string, lastChecked: number, cooldownUntil: number}} record
 * @param {number} now epoch ms
 * @returns {string} one of HealthState.*
 */
function effectiveState(record, now) {
  if (
    (record.state === HealthState.Healthy || record.state === HealthState.Degraded) &&
    record.lastChecked > 0 &&
    now - record.lastChecked > STALE_THRESHOLD_MS
  ) {
    return HealthState.Unknown;
  }
  if (record.state === HealthState.Cooldown && now >= record.cooldownUntil) {
    return HealthState.Unknown;
  }
  return record.state;
}

/**
 * Apply a state transition to `record`. Mutates `record`.
 *
 * - Healthy resets `consecutiveFailures` and `cooldownUntil` to 0.
 * - Cooldown advances `cooldownUntil` monotonically to
 *   `max(prev, now + getCooldownMs(consecutiveFailures))`.
 * - Other states only update `state`.
 *
 * @param {object} record
 * @param {string} next next state name (one of HealthState.*)
 * @param {number} now epoch ms
 */
function applyTransition(record, next, now) {
  record.state = next;
  if (next === HealthState.Healthy) {
    record.consecutiveFailures = 0;
    record.cooldownUntil = 0;
  } else if (next === HealthState.Cooldown) {
    const target = now + getCooldownMs(record.consecutiveFailures);
    record.cooldownUntil = Math.max(record.cooldownUntil || 0, target);
  }
}

/**
 * Record a successful probe or chat response for `providerId`.
 *
 * Per Requirement 3.3: transitions toward Healthy and resets
 * `consecutiveFailures` to 0 (when the resulting state is Healthy).
 *
 * Effective-state transitions:
 *   Unknown   → Healthy
 *   Healthy   → Healthy
 *   Degraded  → Healthy (recover)
 *   Unhealthy → Cooldown ("From Unhealthy: any → Cooldown")
 *   Cooldown  → Cooldown (active timer; a stray success does not break it)
 *
 * Note: when the cooldown timer has already elapsed, the effective state is
 * `Unknown`, so success transitions to Healthy and the cooldown is cleared.
 *
 * @param {string} providerId
 * @param {{ok?: boolean, latencyMs?: number}} [healthResult]
 */
function markSuccess(providerId, healthResult) {
  const record = healthTable[providerId];
  if (!record) {
    console.warn(`[HEALTH] markSuccess called for unknown providerId: ${providerId}`);
    return;
  }
  const now = Date.now();
  const latency =
    healthResult && typeof healthResult.latencyMs === 'number' ? healthResult.latencyMs : 0;

  record.healthy = true;
  record.lastChecked = now;
  record.lastLatencyMs = latency;

  const eff = effectiveState(record, now);
  let next;
  switch (eff) {
    case HealthState.Unknown:
    case HealthState.Healthy:
    case HealthState.Degraded:
      next = HealthState.Healthy;
      break;
    case HealthState.Unhealthy:
      // Single success on Unhealthy is not enough evidence; force Cooldown
      // so the router re-validates after the timer elapses.
      next = HealthState.Cooldown;
      break;
    case HealthState.Cooldown:
      next = HealthState.Cooldown;
      break;
    default:
      next = HealthState.Healthy;
  }
  applyTransition(record, next, now);
}

/**
 * Record a failed probe or chat response for `providerId`.
 *
 * Per Requirement 3.4: increments `consecutiveFailures`, transitions per the
 * Fallback State Machine, and (when transitioning to Cooldown) sets
 * `cooldownUntil` via `getCooldownMs` — monotonically advanced so it never
 * goes backwards within a failure streak.
 *
 * Effective-state transitions:
 *   Unknown   → Unhealthy
 *   Healthy   → Degraded
 *   Degraded  → Unhealthy
 *   Unhealthy → Cooldown (sets cooldownUntil)
 *   Cooldown  → Cooldown (extends cooldownUntil)
 *
 * `lastLatencyMs` is preserved across failures (per design.md: "last
 * successful ping RTT").
 *
 * @param {string} providerId
 * @param {{ok?: boolean, latencyMs?: number, error?: string, statusCode?: number}} [healthResult]
 */
function markFailure(providerId, healthResult) {
  const record = healthTable[providerId];
  if (!record) {
    console.warn(`[HEALTH] markFailure called for unknown providerId: ${providerId}`);
    return;
  }
  // Reference healthResult for symmetry with markSuccess; failures intentionally
  // do not overwrite lastLatencyMs (it tracks last successful RTT).
  void healthResult;
  const now = Date.now();

  record.healthy = false;
  record.lastChecked = now;
  record.consecutiveFailures += 1;

  const eff = effectiveState(record, now);
  let next;
  switch (eff) {
    case HealthState.Unknown:
      next = HealthState.Unhealthy;
      break;
    case HealthState.Healthy:
      next = HealthState.Degraded;
      break;
    case HealthState.Degraded:
      next = HealthState.Unhealthy;
      break;
    case HealthState.Unhealthy:
    case HealthState.Cooldown:
      next = HealthState.Cooldown;
      break;
    default:
      next = HealthState.Unhealthy;
  }
  applyTransition(record, next, now);
}

/**
 * Returns the externally-observable state for a provider, applying the
 * staleness and cooldown-elapsed downgrades. Callers should re-ping when
 * the result is `'Unknown'`.
 *
 * Unknown provider ids return `'Unknown'` defensively (no throw).
 *
 * @param {string} providerId
 * @returns {'Unknown'|'Healthy'|'Degraded'|'Unhealthy'|'Cooldown'}
 */
function getProviderState(providerId) {
  const record = healthTable[providerId];
  if (!record) return HealthState.Unknown;
  return effectiveState(record, Date.now());
}

/**
 * Returns a defensive (shallow) copy of the Health_Table, keyed by providerId.
 * Mutations on the returned object never affect internal state.
 *
 * Each record carries:
 *   { healthy, lastChecked, lastLatencyMs, consecutiveFailures, cooldownUntil, state }
 *
 * @returns {Record<string, {healthy: boolean, lastChecked: number, lastLatencyMs: number, consecutiveFailures: number, cooldownUntil: number, state: string}>}
 */
function getHealthTable() {
  const out = {};
  for (const id of PROVIDER_IDS) {
    out[id] = { ...healthTable[id] };
  }
  return out;
}

module.exports = {
  pingModel,
  pingLiveModel,
  negotiateModel,
  toHealthResult,
  // Health_Table state machine (task 5.3)
  getHealthTable,
  markSuccess,
  markFailure,
  getProviderState,
  getCooldownMs,
};
