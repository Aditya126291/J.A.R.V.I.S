/**
 * Unit tests for the Live WebSocket branch of `pingModel` in
 * `backend/modules/gemini_health.js`.
 *
 * Validates Requirement 8.5: the call settles within the 5000 ms budget and
 * returns a structured `HealthResult` ({ ok, latencyMs, error?, statusCode? })
 * for every outcome — `setupComplete`, API error frame, transport error,
 * close-before-setup, and timeout.
 *
 * The `WebSocket` global is replaced with a deterministic fake so no real
 * network connection is made.  The dispatch from `pingModel` to
 * `pingLiveModel` is also exercised so we confirm the Live result is
 * returned directly (no `toHealthResult` wrapping).
 *
 * Written as ESM (.mjs) to match the other gemini_health test file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pingModel, pingLiveModel } = require('../modules/gemini_health');

const LIVE_MODEL = 'gemini-2.5-flash-native-audio-latest';
const NATIVE_AUDIO_MODEL = 'gemini-2.5-flash-native-audio-latest';
const LIVE_TEXT_MODEL = 'gemini-3.1-flash-live-preview';

let originalWebSocket;
let createdSockets;

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.listeners = { open: [], message: [], error: [], close: [] };
    this.sent = [];
    this.closed = false;
    createdSockets.push(this);
  }

  addEventListener(type, fn) {
    if (this.listeners[type]) this.listeners[type].push(fn);
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }

  // Test helpers
  fireOpen() {
    this.readyState = 1;
    for (const fn of this.listeners.open) fn({});
  }

  fireMessage(data) {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    for (const fn of this.listeners.message) fn({ data: str });
  }

  fireError() {
    for (const fn of this.listeners.error) fn(new Error('ws error'));
  }

  fireClose() {
    this.readyState = 3;
    for (const fn of this.listeners.close) fn({});
  }
}

beforeEach(() => {
  originalWebSocket = globalThis.WebSocket;
  createdSockets = [];
  globalThis.WebSocket = FakeWebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

describe('pingLiveModel (Live WebSocket branch)', () => {
  it('opens wss://generativelanguage.googleapis.com with the api key in the query string', async () => {
    const promise = pingLiveModel('abc123', LIVE_MODEL);

    // Wait one microtask so the WebSocket constructor has run.
    await Promise.resolve();
    const socket = createdSockets[0];

    expect(socket).toBeDefined();
    expect(socket.url).toContain('wss://generativelanguage.googleapis.com/');
    expect(socket.url).toContain(
      '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent',
    );
    expect(socket.url).toContain('key=abc123');

    // Drain the promise so the test does not leak the 5000 ms timer.
    socket.fireOpen();
    socket.fireMessage({ setupComplete: {} });
    await promise;
  });

  it('sends a setup frame with model and minimal generationConfig on open', async () => {
    const promise = pingLiveModel('test-key', LIVE_TEXT_MODEL);
    await Promise.resolve();
    const socket = createdSockets[0];

    socket.fireOpen();
    expect(socket.sent.length).toBe(1);
    const frame = JSON.parse(socket.sent[0]);
    expect(frame.setup).toBeDefined();
    expect(frame.setup.model).toBe(`models/${LIVE_TEXT_MODEL}`);
    expect(frame.setup.generationConfig).toBeDefined();
    expect(Array.isArray(frame.setup.generationConfig.responseModalities)).toBe(true);
    expect(frame.setup.generationConfig.responseModalities).toContain('TEXT');
    expect(typeof frame.setup.generationConfig.maxOutputTokens).toBe('number');

    socket.fireMessage({ setupComplete: {} });
    await promise;
  });

  it('sends responseModalities=["AUDIO"] for native-audio models', async () => {
    const promise = pingLiveModel('test-key', NATIVE_AUDIO_MODEL);
    await Promise.resolve();
    const socket = createdSockets[0];

    socket.fireOpen();
    const frame = JSON.parse(socket.sent[0]);
    expect(frame.setup.generationConfig.responseModalities).toEqual(['AUDIO']);

    socket.fireMessage({ setupComplete: {} });
    await promise;
  });

  it('returns ok=true with statusCode=200 when setupComplete arrives', async () => {
    const promise = pingLiveModel('test-key', LIVE_MODEL);
    await Promise.resolve();
    const socket = createdSockets[0];

    socket.fireOpen();
    socket.fireMessage({ setupComplete: {} });

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
    expect(socket.closed).toBe(true);
  });

  it('returns ok=false with lowercase upstream error code when the server emits an error frame', async () => {
    const promise = pingLiveModel('test-key', LIVE_MODEL);
    await Promise.resolve();
    const socket = createdSockets[0];

    socket.fireOpen();
    socket.fireMessage({ error: { status: 'PERMISSION_DENIED', message: 'nope' } });

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('permission_denied');
    expect(typeof result.latencyMs).toBe('number');
  });

  it('returns ok=false with error="connection_error" on transport-level error', async () => {
    const promise = pingLiveModel('test-key', LIVE_MODEL);
    await Promise.resolve();
    const socket = createdSockets[0];

    socket.fireError();

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('connection_error');
  });

  it('returns ok=false with error="closed" when the socket closes before setupComplete', async () => {
    const promise = pingLiveModel('test-key', LIVE_MODEL);
    await Promise.resolve();
    const socket = createdSockets[0];

    socket.fireOpen();
    socket.fireClose();

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('closed');
  });

  it('returns { ok: false, latencyMs: 5000, error: "timeout" } when no setupComplete arrives within 5 s', async () => {
    const startedAt = Date.now();
    const promise = pingLiveModel('test-key', LIVE_MODEL);
    await Promise.resolve();
    const socket = createdSockets[0];

    // Open the socket but never deliver setupComplete; the strict 5 s
    // setTimeout in the implementation should resolve the promise.
    socket.fireOpen();

    const result = await promise;
    const elapsed = Date.now() - startedAt;
    expect(result).toEqual({ ok: false, latencyMs: 5000, error: 'timeout' });
    // Allow generous slack for slow CI; the contract is "within ~5s".
    expect(elapsed).toBeLessThan(7000);
    expect(socket.closed).toBe(true);
  }, 10000);

  it('returns ok=false with error="websocket_unavailable" when WebSocket is not defined', async () => {
    globalThis.WebSocket = undefined;
    const result = await pingLiveModel('test-key', LIVE_MODEL);
    expect(result).toEqual({ ok: false, latencyMs: 0, error: 'websocket_unavailable' });
  });

  it('never throws even when the WebSocket constructor itself raises', async () => {
    globalThis.WebSocket = function () {
      throw new Error('synchronous boom');
    };
    const result = await pingLiveModel('test-key', LIVE_MODEL);
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(typeof result.latencyMs).toBe('number');
  });
});

describe('pingModel dispatcher → Live branch', () => {
  it('dispatches Live model identifiers to the Live WS path and forwards the canonical HealthResult directly', async () => {
    const promise = pingModel('test-key', LIVE_MODEL);
    await Promise.resolve();
    const socket = createdSockets[0];

    expect(socket).toBeDefined();
    expect(socket.url).toContain('wss://generativelanguage.googleapis.com');

    socket.fireOpen();
    socket.fireMessage({ setupComplete: {} });

    const result = await promise;
    // Canonical HealthResult shape, returned directly (no toHealthResult
    // wrapping that would re-derive `ok` from a `success` field).
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(typeof result.latencyMs).toBe('number');
    expect(result.error).toBeUndefined();
    // Defensive: legacy keys must not have leaked through.
    expect(result.success).toBeUndefined();
    expect(result.errorCode).toBeUndefined();
  });

  it('still rejects an empty apiKey before opening any socket (REST and Live share this guard)', async () => {
    const result = await pingModel('', LIVE_MODEL);
    expect(result).toEqual({ ok: false, latencyMs: 0, error: 'missing_api_key' });
    expect(createdSockets.length).toBe(0);
  });
});
