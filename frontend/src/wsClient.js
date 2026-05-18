// frontend/src/wsClient.js
//
// Streaming WebSocket client for the JARVIS voice pipeline.
//
// Task 13.1 contract:
//   const client = createWsClient({
//     url: 'ws://localhost:5000/ws',
//     onMessage: (msg) => {},        // parsed JSON or raw string
//     onStateChange: (state) => {},  // 'connecting' | 'open' | 'reconnecting' | 'closed'
//   });
//   client.send(payload);  // queues if not open
//   client.close();
//
// Behaviour:
//   - State machine: connecting | open | reconnecting | closed
//   - Exponential backoff with full jitter:
//       delay = Math.random() * Math.min(30000, 250 * 2^attempt)  ms
//   - `attempt` resets to 0 on every successful open
//   - On open: state='open', attempt=0, flush pendingQueue
//   - On non-clean close: state='reconnecting', schedule reconnect, attempt++
//   - On manual close(): state='closed', no further reconnect
//   - send() while not open: enqueue (cap at 100 to bound memory)
//   - On message: try JSON.parse, fall back to raw string, hand to onMessage
//
// Task 13.2 (turn resume on reconnect):
//   - Every outbound `{ type: 'prompt', turnId, message }` is captured into
//     `lastUnfinishedTurnId` / `lastPromptText`.
//   - The matching inbound `{ type: 'done', turnId }` clears them.
//   - On a *reconnect* `open` (i.e., not the initial connect — tracked via
//     `everConnected`), if a turn is still in flight, we send
//     `{ type: 'cancel', turnId: <old> }` followed by
//     `{ type: 'prompt', turnId: <new>, message: <lastPromptText> }` and
//     update `lastUnfinishedTurnId` to the new id.
//
// `WebSocketImpl`, `randomFn`, and `generateTurnId` are injectable so the
// factory can be driven by fake transports / deterministic RNGs in unit tests.

const STATES = Object.freeze({
  CONNECTING: 'connecting',
  OPEN: 'open',
  RECONNECTING: 'reconnecting',
  CLOSED: 'closed',
});

const MAX_BACKOFF_MS = 30000;
const BASE_BACKOFF_MS = 250;
const PENDING_QUEUE_CAP = 100;

/**
 * Compute the next backoff delay in ms using full jitter:
 *   delay = randomFn() * min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2^attempt)
 * Always returns a finite, non-negative number.
 *
 * Exported for unit testing of the backoff math.
 *
 * @param {number} attempt
 * @param {() => number} [randomFn]
 * @returns {number}
 */
export function computeBackoffDelay(attempt, randomFn = Math.random) {
  const safeAttempt = Number.isFinite(attempt) && attempt >= 0 ? attempt : 0;
  const cap = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, safeAttempt));
  let r = randomFn();
  if (!Number.isFinite(r) || r < 0) r = 0;
  if (r > 1) r = 1;
  const delay = r * cap;
  return delay < 0 ? 0 : delay;
}

/**
 * Encode a payload for the wire. Strings are sent as-is; everything else is
 * JSON-stringified. Returns `null` if encoding fails.
 *
 * @param {*} payload
 * @returns {string|null}
 */
function encodePayload(payload) {
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload);
  } catch (_) {
    return null;
  }
}

/**
 * Default turnId generator. Uses `crypto.randomUUID` when available, and
 * falls back to a `${Date.now()}-${random}` pattern so the function is safe
 * in environments without the Web Crypto API (e.g., older test runners).
 *
 * @returns {string}
 */
function defaultGenerateTurnId() {
  try {
    const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch (_) { /* ignore and fall through */ }
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now()}-${rand}`;
}

/**
 * Best-effort decode of an outbound payload to inspect its shape so we can
 * track turn state. Strings are JSON-parsed when they look like JSON;
 * everything else passes through. Returns `null` if no object can be
 * recovered.
 *
 * @param {*} payload
 * @returns {object|null}
 */
function decodePayloadShape(payload) {
  if (payload && typeof payload === 'object') return payload;
  if (typeof payload !== 'string') return null;
  const trimmed = payload.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

/**
 * Create a streaming WebSocket client with auto-reconnect.
 *
 * @param {Object}   options
 * @param {string}   options.url               ws:// or wss:// URL
 * @param {Function} [options.onMessage]       called with parsed JSON or raw string per inbound frame
 * @param {Function} [options.onStateChange]   called with the new state on every transition
 * @param {Function} [options.randomFn]        RNG returning [0, 1); injectable for tests
 * @param {Function} [options.WebSocketImpl]   WebSocket constructor; defaults to globalThis.WebSocket
 * @param {Function} [options.setTimeoutFn]    timer function; injectable for tests
 * @param {Function} [options.clearTimeoutFn]  timer cancel function; injectable for tests
 * @param {Function} [options.generateTurnId]  () => string; used to mint a new turnId on reconnect resume
 * @returns {{
 *   send: (payload: any) => boolean,
 *   close: () => void,
 *   getState: () => 'connecting'|'open'|'reconnecting'|'closed',
 *   getAttempt: () => number,
 *   getQueueSize: () => number,
 *   getLastUnfinishedTurnId: () => string|null,
 *   getLastPromptText: () => string|null,
 * }}
 */
export function createWsClient(options = {}) {
  const {
    url,
    onMessage,
    onStateChange,
    randomFn = Math.random,
    WebSocketImpl = (typeof globalThis !== 'undefined' ? globalThis.WebSocket : undefined),
    setTimeoutFn = (typeof globalThis !== 'undefined' ? globalThis.setTimeout : setTimeout),
    clearTimeoutFn = (typeof globalThis !== 'undefined' ? globalThis.clearTimeout : clearTimeout),
    generateTurnId = defaultGenerateTurnId,
  } = options;

  if (!url || typeof url !== 'string') {
    throw new Error('createWsClient: `url` is required and must be a string');
  }
  if (typeof WebSocketImpl !== 'function') {
    throw new Error('createWsClient: no WebSocket implementation available');
  }

  const onMessageCb = typeof onMessage === 'function' ? onMessage : null;
  const onStateChangeCb = typeof onStateChange === 'function' ? onStateChange : null;

  let socket = null;
  let state = STATES.CONNECTING;
  let attempt = 0;
  let reconnectTimerId = null;
  let explicitlyClosed = false;
  // Turn-resume state (Task 13.2):
  //   `lastUnfinishedTurnId` and `lastPromptText` track the most recent
  //   prompt the consumer issued that has not yet been acked by a `done`
  //   event. `everConnected` flips to true on the first successful `open`
  //   so the *initial* connect never triggers a cancel/replay — only
  //   subsequent reconnects do.
  let lastUnfinishedTurnId = null;
  let lastPromptText = null;
  let everConnected = false;
  /** @type {string[]} encoded frames waiting for the socket to open */
  const pendingQueue = [];

  function safeGenerateTurnId() {
    try {
      const id = generateTurnId();
      if (typeof id === 'string' && id.length > 0) return id;
    } catch (_) { /* fall through to default */ }
    return defaultGenerateTurnId();
  }

  function setState(next) {
    if (state === next) return;
    state = next;
    if (onStateChangeCb) {
      try { onStateChangeCb(next); } catch (_) { /* never let callbacks crash the client */ }
    }
  }

  function flushQueue() {
    if (!socket || state !== STATES.OPEN) return;
    while (pendingQueue.length > 0) {
      const frame = pendingQueue.shift();
      try {
        socket.send(frame);
      } catch (_) {
        // If a flush mid-stream fails, push the frame back and abort; the
        // socket will close shortly and trigger a reconnect.
        pendingQueue.unshift(frame);
        return;
      }
    }
  }

  function scheduleReconnect() {
    if (explicitlyClosed) return;
    if (reconnectTimerId !== null) {
      clearTimeoutFn(reconnectTimerId);
      reconnectTimerId = null;
    }
    const delay = computeBackoffDelay(attempt, randomFn);
    reconnectTimerId = setTimeoutFn(() => {
      reconnectTimerId = null;
      if (explicitlyClosed) return;
      openSocket();
    }, delay);
  }

  function handleNonCleanClose() {
    if (explicitlyClosed) return;
    setState(STATES.RECONNECTING);
    attempt += 1;
    scheduleReconnect();
  }

  function openSocket() {
    let ws;
    try {
      ws = new WebSocketImpl(url);
    } catch (_) {
      // Constructor itself failed (bad URL, blocked transport, etc.).
      handleNonCleanClose();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      if (explicitlyClosed) {
        try { ws.close(); } catch (_) { /* ignore */ }
        return;
      }
      const isReconnect = everConnected;
      everConnected = true;
      attempt = 0;
      setState(STATES.OPEN);
      // Task 13.2: only on a *reconnect* (not the initial open) and only if
      // a prompt is still in flight, send `cancel` for the old turnId then
      // re-issue the same prompt under a new turnId. The two frames are
      // sent directly through the socket here — `state` is already OPEN, so
      // routing them through `send()` would also work, but going direct
      // keeps the cancel/replay pair adjacent in the wire stream and avoids
      // re-entering the prompt-capture path.
      if (isReconnect && lastUnfinishedTurnId !== null && typeof lastPromptText === 'string') {
        const oldTurnId = lastUnfinishedTurnId;
        const newTurnId = safeGenerateTurnId();
        const cancelFrame = encodePayload({ type: 'cancel', turnId: oldTurnId });
        const promptFrame = encodePayload({ type: 'prompt', turnId: newTurnId, message: lastPromptText });
        try {
          if (cancelFrame !== null) ws.send(cancelFrame);
          if (promptFrame !== null) ws.send(promptFrame);
          // Update the in-flight turnId so a subsequent reconnect cancels
          // the *replayed* turn rather than the original one.
          lastUnfinishedTurnId = newTurnId;
        } catch (_) {
          // If the resume send fails the socket is about to close again;
          // the next reconnect will retry from `lastUnfinishedTurnId`,
          // which we deliberately leave pointing at the previous id so we
          // do not lose the in-flight turn.
        }
      }
      flushQueue();
    };

    ws.onmessage = (event) => {
      const data = event && event.data;
      let msg;
      let parsedString = false;
      if (typeof data !== 'string') {
        // Non-string frames (Blob/ArrayBuffer) are forwarded as-is so the
        // consumer can decide how to handle them. They cannot be `done`
        // events for our turn-tracking purposes.
        msg = data;
      } else {
        try {
          msg = JSON.parse(data);
          parsedString = true;
        } catch (_) {
          msg = data; // fall back to raw string per task contract
        }
      }
      // Task 13.2: clear in-flight turn state on the matching `done` event
      // so a reconnect after the turn finishes does not replay a stale
      // prompt. We only inspect parsed JSON objects; raw-string frames are
      // never treated as `done` events.
      if (parsedString && msg && typeof msg === 'object' && msg.type === 'done') {
        if (lastUnfinishedTurnId !== null && msg.turnId === lastUnfinishedTurnId) {
          lastUnfinishedTurnId = null;
          lastPromptText = null;
        }
      }
      if (!onMessageCb) return;
      try { onMessageCb(msg); } catch (_) { /* never let consumer crashes kill the client */ }
    };

    ws.onerror = () => {
      // The browser fires `error` then `close`. We let `close` drive the
      // state transition so we don't double-schedule a reconnect.
    };

    ws.onclose = () => {
      socket = null;
      if (explicitlyClosed) return;
      handleNonCleanClose();
    };
  }

  // Kick off the first connect synchronously. State starts at 'connecting'
  // and onStateChange fires for that initial transition so the NavBar can
  // render the indicator without waiting for a roundtrip.
  if (onStateChangeCb) {
    try { onStateChangeCb(STATES.CONNECTING); } catch (_) { /* ignore */ }
  }
  openSocket();

  return {
    /**
     * Send a payload. Strings are sent verbatim; everything else is JSON
     * stringified. While the socket is not `open`, the encoded frame is
     * queued (FIFO, bounded at 100 entries) and flushed on the next open.
     *
     * Side effect (Task 13.2): inspecting the payload's shape, we capture
     * `{ type: 'prompt', turnId, message }` into `lastUnfinishedTurnId` /
     * `lastPromptText` so a subsequent reconnect can replay the turn.
     * Outbound `{ type: 'cancel', turnId }` for the same turnId clears the
     * in-flight state so user-initiated cancels do not get replayed.
     *
     * @param {*} payload
     * @returns {boolean} true if the frame was sent or queued; false if it
     *                    was dropped (encode failure or queue full)
     */
    send(payload) {
      const frame = encodePayload(payload);
      if (frame === null) return false;

      // Capture turn intent *before* we attempt to send. This way a frame
      // that gets queued (socket not yet open) is still tracked, and a
      // subsequent reconnect-while-pending can replay it correctly.
      const shape = decodePayloadShape(payload);
      if (shape && typeof shape === 'object') {
        if (shape.type === 'prompt' && typeof shape.turnId === 'string' && typeof shape.message === 'string') {
          lastUnfinishedTurnId = shape.turnId;
          lastPromptText = shape.message;
        } else if (shape.type === 'cancel' && typeof shape.turnId === 'string' && shape.turnId === lastUnfinishedTurnId) {
          lastUnfinishedTurnId = null;
          lastPromptText = null;
        }
      }

      if (socket && state === STATES.OPEN) {
        try {
          socket.send(frame);
          return true;
        } catch (_) {
          // Send failed mid-stream; fall through to queueing so the frame
          // is retried after the socket reconnects.
        }
      }

      if (pendingQueue.length >= PENDING_QUEUE_CAP) {
        // Drop the oldest queued frame to bound memory while still honoring
        // the most recent intent. Returning false signals back-pressure.
        pendingQueue.shift();
        pendingQueue.push(frame);
        return false;
      }
      pendingQueue.push(frame);
      return true;
    },

    /**
     * Close the client permanently. Cancels any pending reconnect timer,
     * suppresses further reconnects, and transitions to the terminal
     * `closed` state.
     */
    close() {
      explicitlyClosed = true;
      if (reconnectTimerId !== null) {
        clearTimeoutFn(reconnectTimerId);
        reconnectTimerId = null;
      }
      if (socket) {
        try { socket.close(); } catch (_) { /* ignore */ }
        socket = null;
      }
      setState(STATES.CLOSED);
    },

    getState() { return state; },
    getAttempt() { return attempt; },
    getQueueSize() { return pendingQueue.length; },
    /** Most recent in-flight prompt's turnId, or null if none is in flight. */
    getLastUnfinishedTurnId() { return lastUnfinishedTurnId; },
    /** Most recent in-flight prompt's message text, or null if none is in flight. */
    getLastPromptText() { return lastPromptText; },
  };
}

export const WS_STATES = STATES;
