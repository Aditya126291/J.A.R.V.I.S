'use strict';

/**
 * J.A.R.V.I.S. /tts proxy module.
 *
 * Exposes `registerTtsRoute(app)` which mounts `GET /tts` on the supplied
 * Express app. The handler:
 *
 *   - Accepts `{ text, voice?, engine?, lang? }` via the query string.
 *   - Rejects missing / non-string `text`            → HTTP 400 `{ error: "text_required" }`.
 *   - Rejects `text.length > 200`                    → HTTP 400 `{ error: "text_too_long", maxLength: 200 }`.
 *     (The 200-char cap matches the design contract for /tts and the
 *     `splitSpeech` chunk boundary on the frontend.)
 *   - Picks a primary engine from the caller's `engine` parameter
 *     (`"edge"` or `"google"`, default `"edge"`); the other engine becomes
 *     the alternate.
 *   - Tries the primary; on any thrown error OR an empty buffer, retries
 *     with the alternate exactly once.
 *   - Sets `Content-Type: audio/mpeg` and `Cache-Control: public, max-age=86400`
 *     BEFORE writing any bytes, then streams the buffer in 4096-byte chunks
 *     so the first byte goes out as soon as a buffer is ready.
 *   - On both-engine failure, emits a structured `[jarvis-command-log]` server
 *     log line and responds HTTP 502 `{ error: "synthesis_failed" }`.
 *   - Caches buffers in an LRU-ish 80-entry Map keyed by `${voice}:${text}`,
 *     populated only after a fully successful render+stream.
 *
 * Validates: Requirements 8.4, 9.1, 9.2, 9.3, 9.5
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const googleTTS = require('google-tts-api');
const { EdgeTTS } = require('node-edge-tts');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TEXT_LENGTH = 200;
const MAX_VOICE_LENGTH = 80;
const MAX_TTS_CACHE = 80;
const STREAM_CHUNK_SIZE = 4096;
const EDGE_TIMEOUT_MS = 8000;
const GOOGLE_TIMEOUT_MS = 6000;

const ENGINE_EDGE = 'edge';
const ENGINE_GOOGLE = 'google';

// Default disk cache lives next to the module so a clean checkout
// auto-creates it. Override via `opts.diskCache` for tests.
const DEFAULT_DISK_CACHE_DIR = path.resolve(__dirname, '..', 'cache', 'tts');
const DEFAULT_DISK_CACHE_MAX_FILES = 500;
const DEFAULT_DISK_CACHE_MAX_BYTES = 200 * 1024 * 1024; // 200 MB

// ---------------------------------------------------------------------------
// Tiny LRU-ish cache (insertion order; oldest evicted on overflow)
// ---------------------------------------------------------------------------

function createCache(maxEntries = MAX_TTS_CACHE) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return null;
      // Refresh recency: re-insert so most-recently-used moves to the end.
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    has(key) {
      return map.has(key);
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      while (map.size >= maxEntries) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
      map.set(key, value);
    },
    clear() {
      map.clear();
    },
    size() {
      return map.size;
    },
  };
}

const defaultCache = createCache();

// ---------------------------------------------------------------------------
// Disk cache (persistent layer)
//
// Stores rendered MP3 buffers under `backend/cache/tts/` so the cache
// survives backend restarts. Filenames are sha256(cacheKey).mp3 — the raw
// `${voice}:${text}` is never written to disk in cleartext (safer if the
// cache directory ends up in a backup or a shared deploy).
//
// Eviction policy: on write, if the directory is over `maxFiles` or
// `maxBytes`, delete oldest-by-mtime entries until both limits are met.
// Read paths never block on eviction; eviction is a fire-and-forget
// best-effort sweep.
// ---------------------------------------------------------------------------

function hashCacheKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

function createDiskCache(opts = {}) {
  const dir = opts.dir || DEFAULT_DISK_CACHE_DIR;
  const maxFiles = Number.isInteger(opts.maxFiles) ? opts.maxFiles : DEFAULT_DISK_CACHE_MAX_FILES;
  const maxBytes = Number.isInteger(opts.maxBytes) ? opts.maxBytes : DEFAULT_DISK_CACHE_MAX_BYTES;
  let ensured = false;

  function ensureDir() {
    if (ensured) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      ensured = true;
    } catch (err) {
      // Directory creation is best-effort; if it fails the cache simply
      // becomes a no-op and the in-memory layer carries the load.
      ensured = false;
    }
  }

  function pathFor(key) {
    return path.join(dir, `${hashCacheKey(key)}.mp3`);
  }

  function get(key) {
    ensureDir();
    if (!ensured) return null;
    const p = pathFor(key);
    try {
      const buf = fs.readFileSync(p);
      // Refresh mtime so this entry is treated as most-recently-used by the
      // eviction sweep. Failures are non-fatal — the file is still valid.
      try { fs.utimesSync(p, new Date(), new Date()); } catch (_) {}
      return buf && buf.length ? buf : null;
    } catch (err) {
      return null;
    }
  }

  function set(key, buffer) {
    if (!buffer || !buffer.length) return;
    ensureDir();
    if (!ensured) return;
    const p = pathFor(key);
    try {
      // Atomic write via temp + rename so a partial write never serves
      // truncated audio.
      const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, p);
    } catch (err) {
      return;
    }
    // Best-effort sweep on a microtask so set() returns immediately.
    setImmediate(() => {
      try { evict(); } catch (_) { /* ignore */ }
    });
  }

  function evict() {
    if (!ensured) return;
    let entries;
    try {
      entries = fs.readdirSync(dir)
        .filter((name) => name.endsWith('.mp3'))
        .map((name) => {
          const full = path.join(dir, name);
          let stat;
          try { stat = fs.statSync(full); } catch (_) { return null; }
          return { full, size: stat.size, mtime: stat.mtimeMs };
        })
        .filter(Boolean);
    } catch (_) {
      return;
    }
    let totalBytes = entries.reduce((acc, e) => acc + e.size, 0);
    if (entries.length <= maxFiles && totalBytes <= maxBytes) return;
    // Oldest first: evict by ascending mtime until both limits are met.
    entries.sort((a, b) => a.mtime - b.mtime);
    for (const e of entries) {
      if (entries.length <= maxFiles && totalBytes <= maxBytes) break;
      try {
        fs.unlinkSync(e.full);
        totalBytes -= e.size;
        // We don't splice from the array, but the loop's break condition
        // counts on the size shrink to terminate; track count via a tally.
      } catch (_) { /* ignore */ }
      // Approximate file count: each loop iteration is one file; once we
      // pass maxFiles deletions we stop.
      if ((--entries.length) <= maxFiles && totalBytes <= maxBytes) break;
    }
  }

  function clear() {
    ensureDir();
    if (!ensured) return;
    try {
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith('.mp3') || name.endsWith('.tmp')) {
          try { fs.unlinkSync(path.join(dir, name)); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  return { get, set, clear, _evict: evict, _dir: dir };
}

const defaultDiskCache = createDiskCache();

/**
 * Two-tier cache: RAM (LRU) → disk (persistent). On read, RAM hits return
 * immediately; misses fall through to disk and warm RAM. Writes go to both
 * tiers. The disk layer survives restarts so common voice assets stream at
 * ~zero latency on cold start.
 */
function createTwoTierCache(ramCache, diskCache) {
  return {
    get(key) {
      const fromRam = ramCache.get(key);
      if (fromRam) return fromRam;
      const fromDisk = diskCache.get(key);
      if (fromDisk) {
        // Promote disk hits into RAM so subsequent reads stay fast.
        ramCache.set(key, fromDisk);
        return fromDisk;
      }
      return null;
    },
    set(key, value) {
      ramCache.set(key, value);
      diskCache.set(key, value);
    },
    clear() {
      if (typeof ramCache.clear === 'function') ramCache.clear();
      if (typeof diskCache.clear === 'function') diskCache.clear();
    },
  };
}

const defaultTwoTierCache = createTwoTierCache(defaultCache, defaultDiskCache);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a voice name from a `lang` hint and an optional `override`.
 * `override` always wins (clamped to 80 chars to avoid header abuse).
 */
function pickVoice(lang, override) {
  if (override) return String(override).slice(0, MAX_VOICE_LENGTH);
  const l = String(lang || '').toLowerCase();
  if (l.includes('hi') || l.includes('in')) return 'en-IN-PrabhatNeural';
  return 'en-GB-RyanNeural';
}

/**
 * Map the caller-provided `engine` query parameter to a canonical engine id.
 * Anything other than an explicit google selection defaults to edge.
 */
function pickEngine(engineParam) {
  if (engineParam == null) return ENGINE_EDGE;
  const raw = String(engineParam).toLowerCase().trim();
  if (raw === ENGINE_GOOGLE || raw === 'google-tts-api') return ENGINE_GOOGLE;
  return ENGINE_EDGE;
}

/** Pick the alternate engine for the retry path. */
function alternateEngine(primary) {
  return primary === ENGINE_EDGE ? ENGINE_GOOGLE : ENGINE_EDGE;
}

/**
 * Translate our internal lang/voice hint into the `lang` argument google-tts
 * expects. Hindi-flavoured locales fall through to `en-IN`.
 */
function googleLangFor(lang) {
  return lang && String(lang).toLowerCase().includes('hi') ? 'en-IN' : 'en-GB';
}

function setAudioHeaders(res) {
  if (res.headersSent) return;
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
}

function writeChunked(res, buffer) {
  for (let i = 0; i < buffer.length; i += STREAM_CHUNK_SIZE) {
    res.write(buffer.slice(i, i + STREAM_CHUNK_SIZE));
  }
}

// ---------------------------------------------------------------------------
// Engine renderers (each returns a Promise<Buffer>; throws/rejects on failure)
// ---------------------------------------------------------------------------

/**
 * Render `text` via Microsoft Edge TTS and resolve with the full MP3 buffer.
 * Throws BEFORE any byte hits the wire so the caller can fall back cleanly.
 */
async function renderEdgeTts(text, voice) {
  const cleanedText = String(text || '')
    .replace(/[,;:]+/g, ' ')
    .replace(/!+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim() || text;

  const tts = new EdgeTTS({
    voice,
    lang: voice.split('-').slice(0, 2).join('-'),
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    rate: '+35%',
    volume: '+0%',
    pitch: '+0Hz',
    timeout: EDGE_TIMEOUT_MS,
  });

  let buffer;
  if (typeof tts.toRaw === 'function') {
    buffer = await tts.toRaw(cleanedText);
  } else if (typeof tts.ttsPromise === 'function' && tts.ttsPromise.length <= 1) {
    buffer = await tts.ttsPromise(cleanedText);
  } else if (typeof tts.synthesize === 'function') {
    buffer = await tts.synthesize(cleanedText);
  } else {
    // Last-ditch fallback for older library versions: render to a temp file.
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const tmp = path.join(
      os.tmpdir(),
      `jarvis-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`
    );
    if (typeof tts.ttsPromise === 'function') {
      await tts.ttsPromise(text, tmp);
    } else if (typeof tts.toFile === 'function') {
      await tts.toFile(text, tmp);
    } else {
      throw new Error('node-edge-tts API not recognized');
    }
    buffer = fs.readFileSync(tmp);
    fs.unlink(tmp, () => {});
  }

  if (!buffer || !buffer.length) {
    throw new Error('edge-tts returned empty buffer');
  }
  return buffer;
}

/**
 * Render `text` via google-tts-api and resolve with the full MP3 buffer.
 * Buffers the whole response (acceptable given the 200-char cap upstream).
 */
function renderGoogleTts(text, lang) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = googleTTS.getAudioUrl(text, {
        lang: googleLangFor(lang),
        slow: false,
        host: 'https://translate.google.com',
      });
    } catch (err) {
      reject(err);
      return;
    }

    const req = https.get(url, (gres) => {
      if (gres.statusCode && gres.statusCode >= 400) {
        gres.resume();
        reject(new Error(`google-tts http ${gres.statusCode}`));
        return;
      }
      const chunks = [];
      gres.on('data', (c) => chunks.push(c));
      gres.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (!buf.length) {
          reject(new Error('google-tts returned empty buffer'));
          return;
        }
        resolve(buf);
      });
      gres.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(GOOGLE_TIMEOUT_MS, () => {
      req.destroy(new Error('google-tts request timeout'));
    });
  });
}

// ---------------------------------------------------------------------------
// Failure logging
// ---------------------------------------------------------------------------

function errorMessage(err) {
  if (!err) return null;
  return String(err && (err.message || err.code || err.name) || err).slice(0, 300);
}

function emitBothEnginesFailedLog(logger, ctx) {
  const out = logger && typeof logger.error === 'function' ? logger : console;
  // Per Requirement 9.5: log enough to diagnose the outage but never the
  // request text itself (treated as PII).
  out.error(
    '[jarvis-command-log]',
    JSON.stringify({
      event: 'tts_failed',
      text_len: ctx.textLen,
      primary: ctx.primary,
      alternate: ctx.alternate,
      primary_error: errorMessage(ctx.primaryError),
      alternate_error: errorMessage(ctx.alternateError),
    })
  );
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

/**
 * Build an Express request handler for `GET /tts`.
 *
 * Options (all optional, primarily for tests):
 *   - cache:           cache-like object with `get`/`set` used for byte reuse.
 *   - logger:          object with `warn`/`error` methods (defaults to console).
 *   - textLimit:       override `MAX_TEXT_LENGTH` (defaults to 200).
 *   - renderEdgeTts:   injectable edge-tts renderer (returns Promise<Buffer>).
 *   - renderGoogleTts: injectable google-tts renderer (returns Promise<Buffer>).
 *
 * @returns {(req: object, res: object) => Promise<void>}
 */
function createTtsHandler(opts = {}) {
  const cache = opts.cache || defaultTwoTierCache;
  const logger = opts.logger || console;
  const limit = Number.isInteger(opts.textLimit) ? opts.textLimit : MAX_TEXT_LENGTH;
  const renderers = {
    [ENGINE_EDGE]: opts.renderEdgeTts || renderEdgeTts,
    [ENGINE_GOOGLE]: opts.renderGoogleTts || renderGoogleTts,
  };

  return async function ttsHandler(req, res) {
    const query = req.query || {};
    const rawText = query.text;

    // ---- Input contract --------------------------------------------------
    if (typeof rawText !== 'string') {
      return res.status(400).json({ error: 'text_required' });
    }
    const cleanText = rawText.trim();
    if (!cleanText) {
      return res.status(400).json({ error: 'text_required' });
    }
    if (cleanText.length > limit) {
      return res.status(400).json({ error: 'text_too_long', maxLength: limit });
    }

    const lang = typeof query.lang === 'string' ? query.lang : undefined;
    const voiceOverride = typeof query.voice === 'string' ? query.voice : undefined;
    const voice = pickVoice(lang, voiceOverride);

    const primary = pickEngine(query.engine);
    const alternate = alternateEngine(primary);

    // ---- Cache lookup ----------------------------------------------------
    const cacheKey = `${voice}:${cleanText}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      setAudioHeaders(res);
      res.end(cached);
      return;
    }

    // ---- Primary engine --------------------------------------------------
    const tryRender = async (engineId) => {
      const fn = renderers[engineId];
      const buf = engineId === ENGINE_EDGE ? await fn(cleanText, voice) : await fn(cleanText, lang);
      if (!buf || !buf.length) {
        throw new Error(`${engineId} returned empty buffer`);
      }
      return buf;
    };

    let buffer = null;
    let primaryError = null;
    try {
      buffer = await tryRender(primary);
    } catch (err) {
      primaryError = err;
      if (logger && typeof logger.warn === 'function') {
        logger.warn(`[TTS] ${primary} failed, retrying with ${alternate}: ${errorMessage(err)}`);
      }
    }

    // ---- Alternate engine (single retry) ---------------------------------
    let alternateError = null;
    if (!buffer) {
      try {
        buffer = await tryRender(alternate);
      } catch (err) {
        alternateError = err;
      }
    }

    // ---- Both engines failed --------------------------------------------
    if (!buffer) {
      emitBothEnginesFailedLog(logger, {
        textLen: cleanText.length,
        primary,
        alternate,
        primaryError,
        alternateError,
      });
      if (!res.headersSent) {
        return res.status(502).json({ error: 'synthesis_failed' });
      }
      try { res.end(); } catch (_) { /* client gone */ }
      return;
    }

    // ---- Stream success --------------------------------------------------
    // Headers FIRST so the first byte is `audio/mpeg`-tagged.
    setAudioHeaders(res);
    writeChunked(res, buffer);
    res.end();

    // Populate cache only after a fully successful render+stream.
    cache.set(cacheKey, buffer);
  };
}

/**
 * Mount `GET /tts` on the supplied Express app.
 *
 * Pass-through for `createTtsHandler` opts (mostly used by tests to inject
 * fake engines / caches / loggers).
 */
function registerTtsRoute(app, opts) {
  app.get('/tts', createTtsHandler(opts));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  registerTtsRoute,
  createTtsHandler,
  pickVoice,
  pickEngine,
  // Exposed for tests / integration tooling.
  _internals: {
    createCache,
    defaultCache,
    createDiskCache,
    defaultDiskCache,
    createTwoTierCache,
    defaultTwoTierCache,
    hashCacheKey,
    googleLangFor,
    alternateEngine,
    renderEdgeTts,
    renderGoogleTts,
    MAX_TEXT_LENGTH,
    MAX_VOICE_LENGTH,
    MAX_TTS_CACHE,
    STREAM_CHUNK_SIZE,
    ENGINE_EDGE,
    ENGINE_GOOGLE,
    DEFAULT_DISK_CACHE_DIR,
    DEFAULT_DISK_CACHE_MAX_FILES,
    DEFAULT_DISK_CACHE_MAX_BYTES,
  },
};
