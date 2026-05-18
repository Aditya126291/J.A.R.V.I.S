/**
 * Unit tests for the REST branch of `pingModel` in `backend/modules/gemini_health.js`.
 *
 * Validates Requirement 8.5: the call settles within the 6000 ms budget and
 * returns a structured `HealthResult` ({ ok, latencyMs, error?, statusCode? })
 * for every outcome — missing apiKey, HTTP success, HTTP failure, and abort.
 *
 * Network is stubbed by replacing `globalThis.fetch`; no real Gemini call is made.
 *
 * Written as ESM (.mjs) because vitest 2.x requires `import` rather than CJS
 * `require('vitest')`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pingModel } = require('../modules/gemini_health');

const REST_MODEL = 'gemini-2.5-flash';

let originalFetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function fakeResponse({ ok, status, body }) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

describe('pingModel (REST branch)', () => {
  it('returns ok=false with error="missing_api_key" when apiKey is empty (no throw, no network call)', async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return fakeResponse({ ok: true, status: 200, body: {} });
    };

    const result = await pingModel('', REST_MODEL);

    expect(called).toBe(false);
    expect(result).toEqual({ ok: false, latencyMs: 0, error: 'missing_api_key' });
  });

  it('returns ok=true with statusCode and numeric latencyMs on HTTP 200', async () => {
    globalThis.fetch = async () => {
      // Simulate non-zero RTT so latencyMs is observably >= 0.
      await new Promise((r) => setTimeout(r, 5));
      return fakeResponse({ ok: true, status: 200, body: { totalTokens: 1 } });
    };

    const result = await pingModel('test-key', REST_MODEL);

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('hits the documented :countTokens endpoint with body { contents: [{ parts: [{ text: "ping" }] }] }', async () => {
    let capturedUrl = '';
    let capturedInit = null;
    globalThis.fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return fakeResponse({ ok: true, status: 200, body: {} });
    };

    await pingModel('abc123', REST_MODEL);

    expect(capturedUrl).toContain(
      `https://generativelanguage.googleapis.com/v1beta/models/${REST_MODEL}:countTokens`,
    );
    expect(capturedUrl).toContain('key=abc123');
    expect(capturedInit.method).toBe('POST');
    expect(capturedInit.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(capturedInit.body)).toEqual({
      contents: [{ parts: [{ text: 'ping' }] }],
    });
    // 6000 ms abort timeout requires an AbortSignal to be wired up.
    expect(capturedInit.signal).toBeDefined();
  });

  it('returns ok=false with statusCode and lowercase error on HTTP failure (no throw)', async () => {
    globalThis.fetch = async () =>
      fakeResponse({
        ok: false,
        status: 403,
        body: { error: { status: 'PERMISSION_DENIED', message: 'nope' } },
      });

    const result = await pingModel('test-key', REST_MODEL);

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.error).toBe('permission_denied');
    expect(typeof result.latencyMs).toBe('number');
  });

  it('returns ok=false with error="api_error" when failure body is not JSON', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    });

    const result = await pingModel('test-key', REST_MODEL);

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.error).toBe('api_error');
  });

  it('returns ok=false with error="network_error" when fetch rejects (no throw)', async () => {
    globalThis.fetch = async () => {
      throw new Error('connection refused');
    };

    const result = await pingModel('test-key', REST_MODEL);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('network_error');
    expect(result.statusCode).toBeUndefined();
    expect(typeof result.latencyMs).toBe('number');
  });

  it('returns ok=false with error="timeout" when the request is aborted', async () => {
    globalThis.fetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });

    const result = await pingModel('test-key', REST_MODEL);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('timeout');
  }, 8000);

  it('settles within the 6000 ms budget even when the network never responds', async () => {
    globalThis.fetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        // Never resolve except via the AbortController firing at 6000 ms.
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });

    const startedAt = Date.now();
    const result = await pingModel('test-key', REST_MODEL);
    const elapsed = Date.now() - startedAt;

    expect(result.ok).toBe(false);
    expect(result.error).toBe('timeout');
    // Allow generous slack for slow CI; the contract is "within ~6s".
    expect(elapsed).toBeLessThan(7000);
  }, 10000);
});
