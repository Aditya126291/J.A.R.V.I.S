'use strict';

/**
 * J.A.R.V.I.S. quota meter.
 *
 * Tracks how many requests we've sent to each provider in the last minute
 * and the last 24 hours. Exposes `record(providerId)` for sites that hit a
 * provider, `snapshot()` for status reporting, and `wouldExceed(id, pct)` /
 * `bothNearLimit(ids, pct)` so the router can pre-emptively route to a
 * different backend before we eat a 429.
 *
 * Limits are configurable per provider; defaults match Google's free-tier
 * Gemini caps (RPM = requests per minute, RPD = requests per day):
 *
 *   gemini_primary  / gemini-2.5-flash       → 15 RPM, 1500 RPD
 *   gemini_fallback / gemini-2.5-flash-lite  → 30 RPM, 1500 RPD
 *   ollama_local                             → unlimited (no metering)
 *
 * The 60s window is a sliding count of timestamps; the 24h window is the
 * sum of timestamps that fall within the last 86400 seconds. Both buffers
 * are pruned on every read so we never grow unbounded.
 *
 * On disk: a tiny JSON file under `<root>/.kiro/quota.json` so a backend
 * restart inside the rate-limit window doesn't reset the meter (and lets
 * us start a healthy provider already aware of recent spend).
 *
 * Total: every public function returns a defined value, never throws.
 */

const fs = require('fs');
const path = require('path');

// Default limits per provider id. The router can override at runtime via
// `setLimits(id, { rpm, rpd })`.
const DEFAULT_LIMITS = {
  gemini_primary:   { rpm: 15, rpd: 1500 },
  gemini_fallback:  { rpm: 30, rpd: 1500 },
  ollama_local:     { rpm: Infinity, rpd: Infinity },
  emergency:        { rpm: Infinity, rpd: Infinity },
};

const MINUTE_MS = 60 * 1000;
const DAY_MS    = 24 * 60 * 60 * 1000;

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');
const CACHE_DIR  = path.join(WORKSPACE_ROOT, '.kiro');
const CACHE_FILE = path.join(CACHE_DIR, 'quota.json');

// timestamps[providerId] -> sorted array of unix-ms request timestamps
const timestamps = Object.create(null);
// limits[providerId] -> { rpm, rpd }
const limits = Object.assign(Object.create(null), DEFAULT_LIMITS);

// ---------------------------------------------------------------------------
// Disk persistence (best-effort).
// ---------------------------------------------------------------------------

function ensureDir() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignore */ }
}

function loadFromDisk() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    const cutoff = Date.now() - DAY_MS;
    for (const [id, arr] of Object.entries(parsed)) {
      if (!Array.isArray(arr)) continue;
      // Drop entries older than 24h on load to keep the buffer clean.
      timestamps[id] = arr.filter((t) => typeof t === 'number' && t >= cutoff).sort((a, b) => a - b);
    }
  } catch { /* missing or malformed = start fresh */ }
}

let pendingFlush = null;
function scheduleFlush() {
  // Coalesce writes — many `record` calls in a burst should produce one
  // disk write a moment later. Use unref so the flush never blocks process
  // shutdown.
  if (pendingFlush) return;
  pendingFlush = setTimeout(() => {
    pendingFlush = null;
    try {
      ensureDir();
      const out = {};
      for (const [id, arr] of Object.entries(timestamps)) {
        out[id] = arr;
      }
      const tmp = `${CACHE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(out), 'utf8');
      fs.renameSync(tmp, CACHE_FILE);
    } catch { /* best-effort */ }
  }, 800);
  if (pendingFlush.unref) pendingFlush.unref();
}

// Initial load. Safe to call multiple times — loadFromDisk overwrites
// in-memory entries.
loadFromDisk();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function prune(id, now = Date.now()) {
  const arr = timestamps[id];
  if (!arr || arr.length === 0) return arr || [];
  const cutoff = now - DAY_MS;
  // Find the first index whose timestamp is >= cutoff.
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < cutoff) lo = mid + 1; else hi = mid;
  }
  if (lo > 0) timestamps[id] = arr.slice(lo);
  return timestamps[id];
}

function countWithin(id, windowMs, now = Date.now()) {
  const arr = prune(id, now);
  if (!arr || arr.length === 0) return 0;
  const cutoff = now - windowMs;
  // Binary search for the lower bound of the window.
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < cutoff) lo = mid + 1; else hi = mid;
  }
  return arr.length - lo;
}

/**
 * Record a single request against the provider's quota. Call this before
 * the network round-trip (so we count requests we *intended* to send,
 * not just successful ones — that's the right behavior for rate limiting,
 * which throttles attempts).
 */
function record(providerId, now = Date.now()) {
  if (!providerId || typeof providerId !== 'string') return;
  if (!timestamps[providerId]) timestamps[providerId] = [];
  timestamps[providerId].push(now);
  scheduleFlush();
}

/** Override default limits (e.g. when billing is enabled and quotas lift). */
function setLimits(providerId, partial) {
  if (!providerId || !partial || typeof partial !== 'object') return;
  const cur = limits[providerId] || { rpm: Infinity, rpd: Infinity };
  limits[providerId] = {
    rpm: Number.isFinite(partial.rpm) ? partial.rpm : cur.rpm,
    rpd: Number.isFinite(partial.rpd) ? partial.rpd : cur.rpd,
  };
}

function getLimits(providerId) {
  return limits[providerId] || { rpm: Infinity, rpd: Infinity };
}

/**
 * Per-provider snapshot for `/api/ai-status` and the HUD.
 */
function snapshot(now = Date.now()) {
  const out = {};
  // Always include known providers even if they haven't been used yet so
  // the status payload shape is stable for the frontend.
  const keys = new Set([...Object.keys(DEFAULT_LIMITS), ...Object.keys(timestamps)]);
  for (const id of keys) {
    const min = countWithin(id, MINUTE_MS, now);
    const day = countWithin(id, DAY_MS, now);
    const lim = getLimits(id);
    out[id] = {
      rpm_used: min,
      rpm_limit: lim.rpm,
      rpm_pct: lim.rpm === Infinity ? 0 : Math.min(1, min / lim.rpm),
      rpd_used: day,
      rpd_limit: lim.rpd,
      rpd_pct: lim.rpd === Infinity ? 0 : Math.min(1, day / lim.rpd),
    };
  }
  return out;
}

/**
 * Would sending one more request push this provider past `pct` of either
 * its RPM or its RPD limit? Default `pct` = 0.8 (80%), matching the
 * "throttle before failure" trigger we use in the router.
 */
function wouldExceed(providerId, pct = 0.8, now = Date.now()) {
  const lim = getLimits(providerId);
  if (lim.rpm === Infinity && lim.rpd === Infinity) return false;
  const min = countWithin(providerId, MINUTE_MS, now);
  const day = countWithin(providerId, DAY_MS, now);
  if (lim.rpm !== Infinity && (min + 1) > lim.rpm * pct) return true;
  if (lim.rpd !== Infinity && (day + 1) > lim.rpd * pct) return true;
  return false;
}

/**
 * True iff every providerId in `ids` is at/over `pct` saturation.
 * Used by the router to decide "switch the whole flow to Ollama".
 */
function allNearLimit(ids, pct = 0.8, now = Date.now()) {
  if (!Array.isArray(ids) || ids.length === 0) return false;
  return ids.every((id) => wouldExceed(id, pct, now));
}

/** Reset state — exported for tests / a manual `/api/quota/reset`. */
function reset(providerId) {
  if (providerId) {
    delete timestamps[providerId];
  } else {
    for (const k of Object.keys(timestamps)) delete timestamps[k];
  }
  scheduleFlush();
}

module.exports = {
  record,
  snapshot,
  wouldExceed,
  allNearLimit,
  setLimits,
  getLimits,
  reset,
  // Exposed for tests / diagnostics.
  _internals: {
    DEFAULT_LIMITS,
    MINUTE_MS,
    DAY_MS,
    CACHE_FILE,
    countWithin,
  },
};
