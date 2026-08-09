import React, { useState, useEffect, useRef, useCallback } from 'react';
import './Terminal.css';
import ConfirmDialog from './ConfirmDialog';
import { chatWithJarvis, chatWithJarvisStream, executeJarvisAction, focusBrowser, ttsUrl } from '../api';

/**
 * Splits a speech string into chunks of at most `maxLen` characters.
 *
 * Algorithm (per design.md "splitSpeech"):
 *   1. Normalize whitespace (`/\s+/g` → " ", trim). Empty input returns `[]`.
 *   2. Split on `[.?!]+` followed by whitespace (sentence boundaries). The
 *      punctuation stays with the preceding chunk; the whitespace is dropped
 *      because chunks are later rejoined with a single space.
 *   3. For any sentence longer than `maxLen`, fall back to word-boundary
 *      splits, greedily packing words up to `maxLen` characters per chunk.
 *   4. If a single word still exceeds `maxLen`, hard-cut it at `maxLen` as a
 *      last resort.
 *
 * Postconditions:
 *   - Property 9 (length bound): every chunk satisfies `chunk.length <= maxLen`.
 *   - Property 10 (content preservation):
 *       normalizeWs(splitSpeech(s).join(" ")) === normalizeWs(s)
 *     where normalizeWs(x) = x.replace(/\s+/g, " ").trim().
 *
 * Exported as a named function so it is unit-testable independently of the
 * TTS queue.
 *
 * @param {string} text   speech text to chunk
 * @param {number} [maxLen=180]  maximum chunk length (>= 1)
 * @returns {string[]}    ordered list of chunks
 */
export function splitSpeech(text, maxLen = 180) {
  const raw = typeof text === 'string' ? text : (text == null ? '' : String(text));
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const limit = Number.isFinite(maxLen) && maxLen >= 1 ? Math.floor(maxLen) : 180;

  // Step 1: split on sentence boundaries (`[.?!]+` followed by whitespace).
  // The punctuation stays attached to the sentence on its left; the trailing
  // whitespace is consumed and discarded.
  const sentences = [];
  const boundaryRe = /[.?!]+\s+/g;
  let lastIdx = 0;
  let m;
  while ((m = boundaryRe.exec(normalized)) !== null) {
    const punctLen = m[0].match(/^[.?!]+/)[0].length;
    const punctEnd = m.index + punctLen;
    const sentence = normalized.slice(lastIdx, punctEnd).trim();
    if (sentence) sentences.push(sentence);
    lastIdx = boundaryRe.lastIndex;
  }
  if (lastIdx < normalized.length) {
    const tail = normalized.slice(lastIdx).trim();
    if (tail) sentences.push(tail);
  }
  if (sentences.length === 0) sentences.push(normalized);

  // Step 2: enforce maxLen on every sentence; fall back to word-boundary
  // splits, then hard-cut as last resort.
  const chunks = [];
  for (const sentence of sentences) {
    if (sentence.length <= limit) {
      chunks.push(sentence);
      continue;
    }
    const words = sentence.split(/\s+/).filter(Boolean);
    let current = '';
    for (const word of words) {
      if (word.length > limit) {
        if (current) {
          chunks.push(current);
          current = '';
        }
        let remaining = word;
        while (remaining.length > limit) {
          chunks.push(remaining.slice(0, limit));
          remaining = remaining.slice(limit);
        }
        if (remaining) current = remaining;
      } else if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= limit) {
        current += ' ' + word;
      } else {
        chunks.push(current);
        current = word;
      }
    }
    if (current) chunks.push(current);
  }

  return chunks;
}

/**
 * Standalone, dependency-injected factory for the single-drainer TTS queue
 * described in design.md ("TTS_Queue / enqueueSpeech"). The React component
 * (`Terminal`) implements the same contract directly against its `useRef`
 * hooks and the live Web Audio context; this factory mirrors that logic so
 * the queue can be unit-tested with fake `audioContext` and fake
 * `fetchTtsAudio` (per task 11.3).
 *
 * Contract:
 *   - `enqueueSpeech(text, turnId)`: split via `splitSpeech(text, 180)`, then
 *     push each chunk with a monotonically-increasing per-turn `seq`. A
 *     single drainer reads jobs in submission order; chunks play in `seq`
 *     order regardless of `/tts` response timing.
 *   - `nextStartTime` is set to `max(audioContext.currentTime, nextStartTime)`
 *     before scheduling each chunk so a long pause does not silently drop
 *     audio.
 *   - When pending chunks for a turn exceed 8, the next chunk is merged into
 *     the previous one up to `maxLen` characters before scheduling
 *     (Requirement 2.7).
 *   - On `/tts` failure, advance `nextStartTime` by an estimated duration,
 *     queue a 200ms synthetic beep, and emit a `jarvis-command-log` event
 *     (Requirement 9.4, 9.5).
 *
 * @param {Object}   deps
 * @param {Object}   deps.audioContext  Web Audio context (or fake)
 * @param {Function} deps.fetchTtsAudio async (text, turnId, seq) => AudioBuffer
 * @param {Function} [deps.dispatchEvent] event sink; defaults to `window.dispatchEvent`
 * @param {Function} [deps.now]           clock; defaults to `Date.now`
 * @param {Function} [deps.setBlobVolume] amplitude sink; defaults to `(v) => { window.simulatedBlobVolumeTarget = v }`
 * @param {Function} [deps.setEchoProtectUntil] (epochMs) => void; armed on every chunk start
 * @param {Function} [deps.setIsSpeaking]  (bool) => void; mirror of internal speaking flag
 * @param {number}   [deps.maxLen=180]    chunk length cap
 */
export function createTtsQueue(deps) {
  const {
    audioContext,
    fetchTtsAudio,
    dispatchEvent: dispatchFn = (typeof window !== 'undefined' ? window.dispatchEvent.bind(window) : () => {}),
    now: nowFn = () => Date.now(),
    setBlobVolume = (v) => {
      if (typeof window !== 'undefined') window.simulatedBlobVolumeTarget = v;
    },
    setEchoProtectUntil = () => {},
    setIsSpeaking = () => {},
    maxLen = 180,
  } = deps || {};

  if (!audioContext) throw new Error('createTtsQueue: audioContext is required');
  if (typeof fetchTtsAudio !== 'function') {
    throw new Error('createTtsQueue: fetchTtsAudio function is required');
  }

  const queue = [];                  // FIFO of {turnId, seq, text, onStart}
  const playingSources = new Set();
  const turnSeq = new Map();         // turnId -> next seq
  let nextStartTime = 0;
  let isSpeaking = false;
  let drainerRunning = false;
  let fetchInflight = 0;
  const scheduledLog = [];           // {turnId, seq, startAt, duration}; testing aid

  function setSpeaking(v) {
    if (isSpeaking !== v) {
      isSpeaking = v;
      try { setIsSpeaking(v); } catch (e) {}
      try { setBlobVolume(v ? 120 : 0); } catch (e) {}
    }
  }

  function estimateChunkDuration(text) {
    const s = String(text || '');
    const seconds = s.length / 14;
    if (!Number.isFinite(seconds)) return 0.5;
    return Math.min(5, Math.max(0.5, seconds));
  }

  function buildSyntheticBeep(durationSec = 0.2) {
    const sr = audioContext.sampleRate || 44100;
    const len = Math.max(1, Math.floor(sr * durationSec));
    const buf = audioContext.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    const freq = 440;
    const amp = 0.05;
    for (let i = 0; i < len; i += 1) {
      data[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
    }
    return buf;
  }

  function scheduleBuffer(buffer, onStart, meta) {
    const src = audioContext.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = 1.35;
    if (typeof src.connect === 'function' && audioContext.destination) {
      try { src.connect(audioContext.destination); } catch (e) {}
    }
    const tNow = audioContext.currentTime;
    nextStartTime = Math.max(tNow, nextStartTime);
    const startAt = nextStartTime + 0.02;
    try { src.start(startAt); } catch (e) {}
    if (onStart) {
      const delayMs = Math.max(0, (startAt - tNow) * 1000 - 30);
      setTimeout(() => { try { onStart(); } catch (e) {} }, delayMs);
    }
    setSpeaking(true);
    const effectiveDur = buffer.duration / 1.35;
    try { setEchoProtectUntil(nowFn() + (effectiveDur * 1000) + 250); } catch (e) {}
    nextStartTime = startAt + effectiveDur;
    playingSources.add(src);
    if (meta) {
      scheduledLog.push({ ...meta, startAt, duration: buffer.duration });
    }
    src.onended = () => {
      playingSources.delete(src);
      try { src.disconnect(); } catch (e) {}
      if (
        playingSources.size === 0 &&
        queue.length === 0 &&
        fetchInflight === 0 &&
        !drainerRunning
      ) {
        setSpeaking(false);
        try { setEchoProtectUntil(nowFn() + 250); } catch (e) {}
      }
    };
    return buffer.duration;
  }

  async function drain() {
    if (drainerRunning) return;
    drainerRunning = true;
    try {
      while (queue.length > 0) {
        const job = queue.shift();
        const { text, onStart, turnId, seq } = job;
        fetchInflight += 1;
        let buffer = null;
        let failureReason = null;
        try {
          buffer = await fetchTtsAudio(text, turnId, seq);
        } catch (err) {
          failureReason = err && err.message ? err.message : 'tts_fetch_failed';
        } finally {
          fetchInflight = Math.max(0, fetchInflight - 1);
        }

        if (buffer) {
          scheduleBuffer(buffer, onStart, { turnId, seq, kind: 'tts' });
          continue;
        }

        // Failure: log, advance timing, schedule synthetic beep so cadence
        // stays aligned with the missing audio.
        try {
          dispatchFn(new CustomEvent('jarvis-command-log', {
            detail: {
              event: 'tts_chunk_failed',
              turnId,
              seq,
              reason: failureReason || 'unknown',
            },
          }));
        } catch (e) {}

        const tNow = audioContext.currentTime;
        const estDur = estimateChunkDuration(text);
        nextStartTime = Math.max(tNow, nextStartTime) + estDur;
        try {
          const beep = buildSyntheticBeep(0.2);
          scheduleBuffer(beep, onStart, { turnId, seq, kind: 'beep' });
        } catch (e) {}
      }
    } finally {
      drainerRunning = false;
      if (
        playingSources.size === 0 &&
        queue.length === 0 &&
        fetchInflight === 0
      ) {
        setSpeaking(false);
        try { setEchoProtectUntil(nowFn() + 250); } catch (e) {}
      }
    }
  }

  function enqueueSpeech(text, turnId, onFirstChunk) {
    const cleaned = typeof text === 'string' ? text : (text == null ? '' : String(text));
    const chunks = splitSpeech(cleaned, maxLen);
    if (chunks.length === 0) return;

    const tid = turnId || 'turn-default';
    let nextSeq = turnSeq.get(tid) || 0;
    let firstFiredForCall = false;
    const wrappedFirst = onFirstChunk
      ? () => {
          if (firstFiredForCall) return;
          firstFiredForCall = true;
          try { onFirstChunk(); } catch (e) {}
        }
      : null;

    let chunksPushedThisCall = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunkText = chunks[i];
      const pendingForTurn = queue.filter((j) => j.turnId === tid);
      if (pendingForTurn.length > 8) {
        let lastIdx = -1;
        for (let k = queue.length - 1; k >= 0; k -= 1) {
          if (queue[k].turnId === tid) { lastIdx = k; break; }
        }
        if (lastIdx >= 0) {
          const prev = queue[lastIdx];
          const merged = prev.text.length + 1 + chunkText.length <= maxLen
            ? prev.text + ' ' + chunkText
            : (prev.text.length < maxLen
                ? (prev.text + ' ' + chunkText).slice(0, maxLen)
                : prev.text);
          if (merged !== prev.text) {
            let chainedOnStart = prev.onStart;
            if (chunksPushedThisCall === 0 && wrappedFirst) {
              const prior = prev.onStart;
              chainedOnStart = () => {
                if (prior) { try { prior(); } catch (e) {} }
                wrappedFirst();
              };
            }
            queue[lastIdx] = { ...prev, text: merged, onStart: chainedOnStart };
            chunksPushedThisCall += 1;
            continue;
          }
        }
      }

      queue.push({
        turnId: tid,
        seq: nextSeq,
        text: chunkText,
        onStart: chunksPushedThisCall === 0 ? wrappedFirst : null,
      });
      nextSeq += 1;
      chunksPushedThisCall += 1;
    }
    turnSeq.set(tid, nextSeq);

    setSpeaking(true);
    drain();
  }

  return {
    enqueueSpeech,
    isSpeaking: () => isSpeaking,
    nextStartTime: () => nextStartTime,
    queueLength: () => queue.length,
    scheduledLog: () => scheduledLog.slice(),
    // Test-only accessors (do not call from production code).
    __internals: { queue, turnSeq, playingSources },
  };
}

/**
 * Echo-protect guard: pure predicate that returns `true` when a WebSpeech
 * transcript should be dropped because it likely originates from JARVIS's own
 * audio output bleeding into the microphone.
 *
 * The third argument is the *value* of `echoProtectUntilRef.current` at call
 * time, NOT the ref object itself. Keeping this function pure (no closure
 * over refs or timers) makes it trivially unit-testable.
 *
 * Behavior (per design.md "Echo-protect guard" pseudocode and requirements
 * 1.1, 1.2, 1.5):
 *   - Once `now >= echoProtectUntil`, the guard releases and returns `false`
 *     for every value of `isFinal` (Req 1.5).
 *   - Inside the protected window, every interim transcript is dropped
 *     (Req 1.1).
 *   - Inside the protected window, a final transcript is dropped only if
 *     more than 100 ms of protection remain; finals that arrive within the
 *     last 100 ms are passed through so we don't lose the user's last word
 *     (Req 1.2).
 *
 * @param {number}  now              epoch ms (`Date.now()` at call site)
 * @param {boolean} isFinal          whether the WebSpeech result is final
 * @param {number}  echoProtectUntil epoch-ms deadline of the protect window
 * @returns {boolean}                `true` if the transcript should be dropped
 */
export function shouldDropTranscript(now, isFinal, echoProtectUntil) {
  if (now >= echoProtectUntil) return false;
  if (!isFinal) return true;            // drop all interims while protected
  return (echoProtectUntil - now) > 100; // drop finals only if >100ms remain
}

function sanitizeSpokenText(text) {
  let s = String(text || '');
  const speakMatch = s.match(/<speak(?:\s[^>]*)?>([\s\S]*?)<\/speak>/i);
  if (speakMatch) s = speakMatch[1];

  const hidden = 'thought|thoughts|think|thinking|scratchpad|reasoning|analysis|plan|planning|monologue|inner|system|action|tool|tool_call|tool_use|cot';
  s = s.replace(new RegExp('<(' + hidden + ')\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>', 'gi'), ' ');
  s = s.replace(new RegExp('<(' + hidden + ')\\b[^>]*>[\\s\\S]*$', 'gi'), ' ');
  s = s.replace(/<\/?(?:speak|response|final|answer)\b[^>]*>/gi, ' ');

  const labels = '(?:thought|thoughts|thinking|reasoning|analysis|scratchpad|plan|planning|inner monologue|internal monologue|chain of thought|cot)';
  const closers = '(?:speak|response|final|final answer|answer|reply|output|result)';
  if (new RegExp('\\b' + closers + '\\s*[:\\-]', 'i').test(s)) {
    s = s.replace(new RegExp('\\b' + labels + '\\s*[:\\-][\\s\\S]*?(?=\\b' + closers + '\\s*[:\\-])', 'gi'), ' ');
    s = s.replace(new RegExp('^[\\s\\S]*?\\b' + closers + '\\s*[:\\-]\\s*', 'i'), '');
  } else {
    s = s.replace(new RegExp('\\b' + labels + '\\s*[:\\-][^.!?\\n]*[.!?\\n]?', 'gi'), ' ');
  }

  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/\{[^{}]*"module"\s*:[\s\S]*?\}/g, ' ');
  s = s.replace(/\[CMD:[\s\S]*?\](?=\s|$)/g, ' ');
  s = s.replace(/[*_`#>]+/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

function summarizePayload(payload) {
  if (!payload) return 'Unknown action';
  if (payload.module === 'apps') return `${payload.action} ${payload.value}`;
  if (payload.module === 'message' && payload.value) {
    return `send ${payload.value.app} message to ${payload.value.contact}`;
  }
  if (payload.module === 'system') {
    if (payload.action === 'brightness_adjust') return `brightness adjust ${payload.value > 0 ? '+' : ''}${payload.value}`;
    return payload.action.endsWith('_set')
      ? `${payload.action.replace('_', ' ')} to ${payload.value}`
      : payload.action.replace(/_/g, ' ');
  }
  return `${payload.module} ${payload.action}${payload.value ? ` ${payload.value}` : ''}`;
}

function successMessage(payload, data) {
  if (data?.message) return data.message;
  if (!payload) return 'Command completed.';
  if (payload.module === 'apps' && payload.action === 'close') return `${payload.value} has been terminated.`;
  if (payload.module === 'apps' && payload.action === 'open') return `${payload.value} is now open.`;
  if (payload.module === 'apps' && payload.action === 'automate') return `${payload.value.app} automation complete.`;
  if (payload.module === 'system') {
    if (payload.action === 'brightness_adjust') return 'Brightness adjusted.';
    return `System ${payload.action.replace(/_/g, ' ')} executed.`;
  }
  if (payload.module === 'message') return 'Message sent.';
  return `${summarizePayload(payload)} completed.`;
}

const Terminal = ({ blobConfig = {} }) => {
  const [chatHistory, setChatHistory] = useState([
    { role: 'J.A.R.V.I.S', text: "Hello Aditya. I'm online and ready for your commands." }
  ]);
  const [liveSpeech, setLiveSpeech] = useState('');
  const [fading, setFading] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [providerLabel, setProviderLabel] = useState('READY');
  const [textInput, setTextInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const isListeningRef = useRef(false);
  const rightAltHeldRef = useRef(false);

  const recognitionRef = useRef(null);
  const timeoutRef = useRef(null);
  const debounceTimer = useRef(null);
  const currentTranscriptRef = useRef('');
  const chatContainerRef = useRef(null);
  const isProcessingRef = useRef(false);
  const pendingActionRef = useRef(null);

  // Web Audio scheduler refs
  const audioCtxRef = useRef(null);
  const sourceQueueRef = useRef([]); // {buffer, onStart} — legacy, retained for compat
  const playingSourcesRef = useRef(new Set());
  const isJarvisSpeakingRef = useRef(false);
  const echoProtectUntilRef = useRef(0);
  const nextStartTimeRef = useRef(0);
  const fetchInflightRef = useRef(0);
  const streamControllerRef = useRef(null); // current SSE controller for barge-in
  const sentenceBufRef = useRef('');

  // Single-drainer TTS queue (per design.md "TTS_Queue / enqueueSpeech").
  // audioQueueRef holds pending {turnId, seq, text, onStart} jobs in submission
  // order. drainerRunningRef enforces the "only one in-flight drainer"
  // invariant so chunks are scheduled in seq order regardless of /tts
  // response timing. turnSeqRef tracks the next monotonically-increasing seq
  // per turnId.
  const audioQueueRef = useRef([]);
  const drainerRunningRef = useRef(false);
  const turnSeqRef = useRef(new Map());

  const activeColor = blobConfig.color || '#00ffe1';

  useEffect(() => {
    pendingActionRef.current = pendingAction;
    if (pendingAction) focusBrowser();
  }, [pendingAction]);

  const appendChat = useCallback((entry) => {
    setChatHistory((prev) => [...prev.slice(-7), entry]);
  }, []);

  const updateLastJarvis = useCallback((text) => {
    setChatHistory((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i].role === 'J.A.R.V.I.S') {
          next[i] = { ...next[i], text };
          return next;
        }
      }
      return [...next, { role: 'J.A.R.V.I.S', text }];
    });
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory, liveSpeech]);

  const resetFadeTimer = useCallback(() => {
    setFading(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setFading(true), 20000);
  }, []);

  const ensureAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtxRef.current = new Ctx({ latencyHint: 'interactive' });
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  const stopAllAudio = useCallback(() => {
    for (const src of playingSourcesRef.current) {
      try { src.stop(0); } catch (e) {}
      try { src.disconnect(); } catch (e) {}
    }
    playingSourcesRef.current.clear();
    sourceQueueRef.current = [];
    audioQueueRef.current = [];
    turnSeqRef.current = new Map();
    // Note: drainerRunningRef is NOT reset here. The drainer loop checks
    // audioQueueRef.length on each iteration and exits naturally when the
    // queue is empty, releasing the flag itself. Forcibly clearing it here
    // would let a second drainer start concurrently if a chunk is still
    // being awaited from /tts.
    nextStartTimeRef.current = 0;
    isJarvisSpeakingRef.current = false;
    window.simulatedBlobVolumeTarget = 0;
  }, []);

  const fetchAndDecode = useCallback(async (text, voice, lang) => {
    const url = ttsUrl(text, lang) + (voice ? `&voice=${encodeURIComponent(voice)}` : '');
    const ctx = ensureAudioCtx();
    if (!ctx) throw new Error('audio context unavailable');
    const r = await fetch(url);
    if (!r.ok) throw new Error('tts http ' + r.status);
    const ab = await r.arrayBuffer();
    return await ctx.decodeAudioData(ab);
  }, [ensureAudioCtx]);

  const scheduleAudioBuffer = useCallback((audioBuffer, onStart) => {
    const ctx = ensureAudioCtx();
    if (!ctx) return 0;
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    // Per design.md: nextStartTimeRef = max(audioContext.currentTime, nextStartTimeRef)
    // before scheduling. This ensures a long pause does not let the next chunk
    // start in the past (which would silently drop audio under Web Audio).
    nextStartTimeRef.current = Math.max(now, nextStartTimeRef.current);
    const startAt = nextStartTimeRef.current + 0.005;
    src.start(startAt);
    if (onStart) {
      const delay = Math.max(0, (startAt - now) * 1000 - 30);
      setTimeout(() => onStart(), delay);
    }
    isJarvisSpeakingRef.current = true;
    echoProtectUntilRef.current = Date.now() + (audioBuffer.duration * 1000) + 350;
    window.simulatedBlobVolumeTarget = 120;
    nextStartTimeRef.current = startAt + Math.max(0.03, audioBuffer.duration - 0.04);
    playingSourcesRef.current.add(src);
    src.onended = () => {
      playingSourcesRef.current.delete(src);
      try { src.disconnect(); } catch (e) {}
      if (
        playingSourcesRef.current.size === 0 &&
        audioQueueRef.current.length === 0 &&
        sourceQueueRef.current.length === 0 &&
        fetchInflightRef.current === 0 &&
        !drainerRunningRef.current
      ) {
        isJarvisSpeakingRef.current = false;
        window.simulatedBlobVolumeTarget = 0;
        echoProtectUntilRef.current = Date.now() + 250;
        resetFadeTimer();
      }
    };
    return audioBuffer.duration;
  }, [ensureAudioCtx, resetFadeTimer]);

  /**
   * Estimated speech duration (seconds) for a chunk of `text`. Used when
   * /tts fails so the drainer can advance `nextStartTimeRef` and keep the
   * cadence aligned with the missing audio. Roughly 14 chars/sec ≈ 170 wpm,
   * clamped to [0.5s, 5s] so a single failed chunk neither stalls the queue
   * nor opens a multi-second silent gap.
   */
  const estimateChunkDuration = useCallback((text) => {
    const s = String(text || '');
    const seconds = s.length / 14;
    if (!Number.isFinite(seconds)) return 0.5;
    return Math.min(5, Math.max(0.5, seconds));
  }, []);

  /**
   * Build a short synthetic beep buffer (200ms, 440Hz, ~0.05 amplitude) used
   * to keep playback timing aligned when a /tts chunk fails. The buffer
   * shares the same AudioContext so it can be scheduled via the normal
   * pathway. Returns null if no AudioContext is available.
   */
  const buildSyntheticBeep = useCallback((durationSec = 0.2) => {
    const ctx = ensureAudioCtx();
    if (!ctx) return null;
    const sr = ctx.sampleRate || 44100;
    const len = Math.max(1, Math.floor(sr * durationSec));
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    const freq = 440;
    const amp = 0.05;
    for (let i = 0; i < len; i += 1) {
      data[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
    }
    return buf;
  }, [ensureAudioCtx]);

  /**
   * Drains `audioQueueRef` strictly in submission order. Single-drainer
   * pattern: at most one drainer is in flight (`drainerRunningRef`), so even
   * if fetches for different chunks complete out of order, jobs are awaited
   * one at a time and scheduled in seq order.
   *
   * On TTS failure for a chunk, the drainer:
   *   1. emits a `jarvis-command-log` event with `event: "tts_chunk_failed"`,
   *   2. advances `nextStartTimeRef` by an estimated chunk duration,
   *   3. schedules a 200ms synthetic beep so the cadence stays aligned.
   * It does NOT skip the chunk silently — that would let a slow rebuild of
   * the playback timeline resurface earlier text out of order.
   */
  const drainAudioQueue = useCallback(async () => {
    if (drainerRunningRef.current) return;
    drainerRunningRef.current = true;
    try {
      while (audioQueueRef.current.length > 0) {
        const job = audioQueueRef.current.shift();
        const { text, onStart, turnId, seq } = job;
        fetchInflightRef.current += 1;
        let buffer = null;
        let failureReason = null;
        try {
          buffer = await fetchAndDecode(
            text,
            blobConfig.voice,
            blobConfig.language || 'en-IN'
          );
        } catch (err) {
          failureReason = err && err.message ? err.message : 'tts_fetch_failed';
        } finally {
          fetchInflightRef.current = Math.max(0, fetchInflightRef.current - 1);
        }

        if (buffer) {
          scheduleAudioBuffer(buffer, onStart);
          continue;
        }

        // Failure path: emit log, advance timing, queue a beep so subsequent
        // chunks of the same turn don't pile up at the same instant.
        try {
          window.dispatchEvent(
            new CustomEvent('jarvis-command-log', {
              detail: {
                event: 'tts_chunk_failed',
                turnId,
                seq,
                reason: failureReason || 'unknown',
              },
            })
          );
        } catch (e) { /* dispatch errors are non-fatal */ }

        const ctx = ensureAudioCtx();
        const estDur = estimateChunkDuration(text);
        if (ctx) {
          nextStartTimeRef.current = Math.max(ctx.currentTime, nextStartTimeRef.current) + estDur;
        } else {
          nextStartTimeRef.current = nextStartTimeRef.current + estDur;
        }
        const beep = buildSyntheticBeep(0.2);
        if (beep) scheduleAudioBuffer(beep, onStart);
      }
    } finally {
      drainerRunningRef.current = false;
      // If everything actually drained and nothing is playing, settle the
      // speaking flag now. The src.onended handler also covers this for
      // chunks that were still playing when the loop exited.
      if (
        playingSourcesRef.current.size === 0 &&
        audioQueueRef.current.length === 0 &&
        fetchInflightRef.current === 0
      ) {
        isJarvisSpeakingRef.current = false;
        window.simulatedBlobVolumeTarget = 0;
        echoProtectUntilRef.current = Math.max(echoProtectUntilRef.current, Date.now() + 250);
      }
    }
  }, [
    blobConfig.voice,
    blobConfig.language,
    fetchAndDecode,
    scheduleAudioBuffer,
    ensureAudioCtx,
    estimateChunkDuration,
    buildSyntheticBeep,
  ]);

  /**
   * Enqueue a speech utterance for a turn. Splits via `splitSpeech(text, 180)`,
   * then pushes each chunk onto the FIFO `audioQueueRef` with a monotonically
   * increasing per-turn `seq`. A single drainer reads jobs in submission
   * order, so the playback order equals the enqueue order regardless of
   * `/tts` response latency (Property 2 / Requirements 2.1, 2.5).
   *
   * Backpressure (Requirement 2.7): if more than 8 chunks are pending for the
   * same turn at the moment of enqueue, merge the next chunk into the
   * previous one up to `maxLen` characters. This keeps the fetch backlog
   * bounded without dropping audio.
   *
   * @param {string} text   utterance text
   * @param {string} turnId stable id for the turn
   * @param {Function} [onFirstChunk] called when the first scheduled chunk starts
   */
  const enqueueSpeech = useCallback((text, turnId, onFirstChunk) => {
    const cleaned = typeof text === 'string' ? text : (text == null ? '' : String(text));
    const maxLen = 180;
    const chunks = splitSpeech(cleaned, maxLen);
    if (chunks.length === 0) return;

    const tid = turnId || 'turn-default';
    let nextSeq = turnSeqRef.current.get(tid) || 0;
    let firstFiredForCall = false;
    const wrappedFirst = onFirstChunk
      ? () => {
          if (firstFiredForCall) return;
          firstFiredForCall = true;
          try { onFirstChunk(); } catch (e) { /* user cb errors are non-fatal */ }
        }
      : null;

    let chunksPushedThisCall = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunkText = chunks[i];
      // Backpressure merge: count pending chunks for THIS turn already in
      // the queue. If > 8, fold this chunk into the previous queued chunk
      // for the same turn (capped at maxLen). This shrinks queue depth
      // without losing words.
      const pendingForTurn = audioQueueRef.current.filter((j) => j.turnId === tid);
      if (pendingForTurn.length > 8) {
        // Find the last queued chunk for this turn and try to extend it.
        let lastIdx = -1;
        for (let k = audioQueueRef.current.length - 1; k >= 0; k -= 1) {
          if (audioQueueRef.current[k].turnId === tid) { lastIdx = k; break; }
        }
        if (lastIdx >= 0) {
          const prev = audioQueueRef.current[lastIdx];
          const merged = prev.text.length + 1 + chunkText.length <= maxLen
            ? prev.text + ' ' + chunkText
            : (prev.text.length < maxLen
                ? (prev.text + ' ' + chunkText).slice(0, maxLen)
                : prev.text);
          if (merged !== prev.text) {
            // If this is the first chunk of THIS call and the caller passed
            // an onFirstChunk, chain it onto the merged job's existing
            // onStart so the notification still fires when the merged chunk
            // begins playback.
            let chainedOnStart = prev.onStart;
            if (chunksPushedThisCall === 0 && wrappedFirst) {
              const prior = prev.onStart;
              chainedOnStart = () => {
                if (prior) { try { prior(); } catch (e) {} }
                wrappedFirst();
              };
            }
            audioQueueRef.current[lastIdx] = {
              ...prev,
              text: merged,
              onStart: chainedOnStart,
            };
            chunksPushedThisCall += 1;
            continue; // do not push a separate job; chunk merged
          }
          // If merge didn't change anything (prev already at maxLen), fall
          // through and push as a new job — better to grow the queue than
          // drop user-visible speech.
        }
      }

      const job = {
        turnId: tid,
        seq: nextSeq,
        text: chunkText,
        // Attach the onFirstChunk callback only to the first chunk pushed
        // in THIS call. Callers that span multiple enqueueSpeech invocations
        // (streaming sentence flusher) supply their own dedupe flag, so
        // wrappedFirst() is also idempotent.
        onStart: chunksPushedThisCall === 0 ? wrappedFirst : null,
      };
      nextSeq += 1;
      chunksPushedThisCall += 1;
      audioQueueRef.current.push(job);
    }
    turnSeqRef.current.set(tid, nextSeq);

    // Speaking flag flips on at enqueue time so the echo guard arms before
    // the first /tts byte arrives. The flag is cleared by the drainer / the
    // last source's onended handler.
    isJarvisSpeakingRef.current = true;

    drainAudioQueue();
  }, [drainAudioQueue]);

  /**
   * Legacy single-chunk enqueue retained for the streaming sentence flusher
   * and confirmation/error paths. Routes through `enqueueSpeech` so it
   * benefits from the single-drainer ordering and merge-backpressure.
   */
  const enqueueSpeechChunk = useCallback((text, onStart) => {
    if (!text || !String(text).trim()) return;
    enqueueSpeech(text, 'turn-default', onStart);
  }, [enqueueSpeech]);

  const flushPendingSentence = useCallback((force, onFirstChunk) => {
    let text = sentenceBufRef.current;
    if (!text) return;
    if (force) {
      sentenceBufRef.current = '';
      enqueueSpeechChunk(sanitizeSpokenText(text), onFirstChunk);
      return;
    }
    const m = text.match(/^([\s\S]*?[,;:.!?\n])(\s+|$)/);
    if (m) {
      const ready = m[1];
      sentenceBufRef.current = text.slice(ready.length).replace(/^\s+/, '');
      const cleaned = sanitizeSpokenText(ready);
      if (cleaned) enqueueSpeechChunk(cleaned, onFirstChunk);
    } else if (text.length >= 25) {
      sentenceBufRef.current = '';
      const cleaned = sanitizeSpokenText(text);
      if (cleaned) enqueueSpeechChunk(cleaned, onFirstChunk);
    }
  }, [enqueueSpeechChunk]);

  const ingestSpeechDelta = useCallback((delta, onFirstChunk) => {
    if (!delta) return;
    sentenceBufRef.current += (sentenceBufRef.current ? ' ' : '') + delta;
    flushPendingSentence(false, onFirstChunk);
  }, [flushPendingSentence]);

  const dispatchLog = useCallback((text, status = 'success') => {
    window.dispatchEvent(
      new CustomEvent('jarvis-command-log', {
        detail: {
          time: new Date().toLocaleTimeString('en-US', {
            hour12: false,
            hour: 'numeric',
            minute: 'numeric',
          }),
          text,
          status,
        },
      })
    );
  }, []);

  const executeCommand = useCallback(
    async (payloads, confirmed = false, skipSpeak = false) => {
      if (!Array.isArray(payloads) || payloads.length === 0) {
        enqueueSpeechChunk(sanitizeSpokenText('I encountered a command parsing error. Please try again.'));
        return;
      }

      for (const payload of payloads) {
        // UI-only actions never round-trip to the backend executor — they
        // exist purely to drive HUD widgets via the local event bus
        // (useUiBus). The smart router emits them after a normal speech ack.
        if (payload && payload.module === 'ui' && payload.action) {
          try {
            window.dispatchEvent(new CustomEvent('jarvis-ui', {
              detail: { action: payload.action, value: payload.value },
            }));
            dispatchLog(`UI: ${payload.action}`, 'success');
          } catch (e) {
            dispatchLog(`UI dispatch failed: ${e.message}`, 'error');
          }
          continue;
        }

        try {
          const data = await executeJarvisAction(payload, confirmed);

          if (data.requiresConfirmation) {
            setPendingAction({ payloads: [payload], speech: 'I need authorization before I do that.' });
            updateLastJarvis('Authorization required.');
            enqueueSpeechChunk(sanitizeSpokenText('I need authorization before I do that.'));
            dispatchLog(`Authorization required: ${summarizePayload(payload)}`, 'warning');
            continue;
          }

          if (data.success) {
            const msg = successMessage(payload, data);
            if (!skipSpeak) {
              enqueueSpeechChunk(sanitizeSpokenText(msg), () => appendChat({ role: 'J.A.R.V.I.S', text: msg }));
            } else {
              appendChat({ role: 'J.A.R.V.I.S', text: msg });
            }
            dispatchLog(msg, 'success');
          } else {
            const msg = `I could not execute that. ${data.error || ''}`.trim();
            enqueueSpeechChunk(sanitizeSpokenText(msg), () => appendChat({ role: 'J.A.R.V.I.S', text: msg }));
            dispatchLog(msg, 'error');
          }
        } catch (err) {
          const msg = `I could not execute that. ${err.message || ''}`.trim();
          enqueueSpeechChunk(sanitizeSpokenText(msg), () => appendChat({ role: 'J.A.R.V.I.S', text: msg }));
          dispatchLog(msg, 'error');
        }
      }
    },
    [appendChat, dispatchLog, enqueueSpeechChunk, updateLastJarvis]
  );

  const handleConfirm = useCallback(() => {
    const action = pendingActionRef.current;
    if (!action) return;
    setPendingAction(null);
    updateLastJarvis('Authorized. Executing command...');
    executeCommand(action.payloads, true);
  }, [executeCommand, updateLastJarvis]);

  const handleCancel = useCallback(() => {
    setPendingAction(null);
    const msg = 'Very well sir, request denied.';
    updateLastJarvis(msg);
    enqueueSpeechChunk(sanitizeSpokenText(msg));
  }, [enqueueSpeechChunk, updateLastJarvis]);

  const submitToJarvisRef = useRef(null);

  submitToJarvisRef.current = async (promptText) => {
    if (!promptText || isProcessingRef.current) return;
    isProcessingRef.current = true;
    appendChat({ role: 'USER', text: promptText });
    appendChat({ role: 'J.A.R.V.I.S', text: 'Thinking...' });
    resetFadeTimer();
    sentenceBufRef.current = '';

    let firstChunkFired = false;
    const onFirstChunk = () => {
      if (firstChunkFired) return;
      firstChunkFired = true;
    };

    let accumulatedSpeech = '';
    let collectedActions = null;
    let collectedNeedsConfirmation = false;

    try {
      const { controller, promise } = chatWithJarvisStream(promptText, {
        onMeta: (m) => {
          if (m.provider) setProviderLabel(String(m.provider).toUpperCase());
          if (m.providerSwitch) {
            const sw = m.providerSwitch;
            const switchMsg =
              sw.type === 'failover' ? `Switching to ${sw.to}.`
              : sw.type === 'restored' ? 'Primary model is back online.'
              : sw.type === 'total_failure' ? 'All AI providers are currently unavailable.'
              : `Switched to ${sw.to}.`;
            dispatchLog(switchMsg, sw.type === 'total_failure' ? 'error' : 'warning');
          }
        },
        onSpeechDelta: ({ text }) => {
          accumulatedSpeech += (accumulatedSpeech ? ' ' : '') + text;
          updateLastJarvis(sanitizeSpokenText(accumulatedSpeech));
          ingestSpeechDelta(text, onFirstChunk);
        },
        onActionReady: ({ actions, needsConfirmation }) => {
          collectedActions = actions || [];
          collectedNeedsConfirmation = !!needsConfirmation;
        },
        onDone: () => {
          flushPendingSentence(true, onFirstChunk);
        },
        onError: (e) => {
          dispatchLog(e.message || 'stream error', 'error');
        },
      });
      streamControllerRef.current = controller;
      await promise;

      if (collectedActions && collectedActions.length) {
        if (collectedNeedsConfirmation) {
          setPendingAction({ payloads: collectedActions, speech: accumulatedSpeech || 'Authorization required.' });
        } else {
          executeCommand(collectedActions, false, true /* skipSpeak — we already streamed it */);
        }
      }
      window.dispatchEvent(new CustomEvent('jarvis-api-status', { detail: 'connected' }));
    } catch (err) {
      // SSE failed → fallback to legacy JSON path
      try {
        const result = await chatWithJarvis(promptText);
        const speech = sanitizeSpokenText(result.speech || result.response || 'At your service, sir.') || 'At your service, sir.';
        const actions = Array.isArray(result.actions) ? result.actions : [];
        setProviderLabel((result.provider || 'unknown').toUpperCase());
        updateLastJarvis(speech);
        const chunks = (speech.match(/[^.!?]+[.!?]?/g) || [speech])
          .map((c) => c.trim()).filter(Boolean);
        let first = true;
        for (const c of chunks) {
          enqueueSpeechChunk(c, first ? onFirstChunk : null);
          first = false;
        }
        if (actions.length) {
          if (result.needsConfirmation) setPendingAction({ payloads: actions, speech });
          else executeCommand(actions, false, true);
        }
        window.dispatchEvent(new CustomEvent('jarvis-api-status', { detail: 'connected' }));
      } catch (err2) {
        window.dispatchEvent(new CustomEvent('jarvis-api-status', { detail: 'disconnected' }));
        const errorMsg = 'System error. Neural link severed.';
        updateLastJarvis(errorMsg);
        enqueueSpeechChunk(errorMsg);
        dispatchLog(err2.message || errorMsg, 'error');
      }
    } finally {
      streamControllerRef.current = null;
      isProcessingRef.current = false;
    }
  };

  const toggleListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (!isListeningRef.current) {
      isListeningRef.current = true;
      setIsListening(true);
      setLiveSpeech('');
      currentTranscriptRef.current = '';

      if (isJarvisSpeakingRef.current) {
        stopAllAudio();
        if (streamControllerRef.current) {
          try { streamControllerRef.current.abort(); } catch (e) {}
          streamControllerRef.current = null;
        }
      }

      try {
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch (e) {}
        }
        if (recognitionRef.current) {
          try { recognitionRef.current.start(); } catch (e) {}
        }
      } catch (err) {
        console.error('[MIC] Start error:', err);
      }
    } else {
      isListeningRef.current = false;
      setIsListening(false);

      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) {}
      }

      const promptText = (currentTranscriptRef.current || liveSpeech || '').trim();
      setLiveSpeech('');
      currentTranscriptRef.current = '';

      if (promptText && submitToJarvisRef.current) {
        submitToJarvisRef.current(promptText);
      }
    }
  }, [liveSpeech, stopAllAudio]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const isRightAlt = e.code === 'AltRight' || (e.key === 'Alt' && e.location === 2);
      if (!isRightAlt) return;

      e.preventDefault();
      if (e.repeat || rightAltHeldRef.current) return;

      // Key repeat must not turn one press into multiple start/stop cycles.
      rightAltHeldRef.current = true;
      toggleListening();
    };

    const handleKeyUp = (e) => {
      const isRightAlt = e.code === 'AltRight' || (e.key === 'Alt' && e.location === 2);
      if (!isRightAlt) return;

      e.preventDefault();
      rightAltHeldRef.current = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [toggleListening]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      appendChat({ role: 'J.A.R.V.I.S', text: 'Speech recognition is not available in this browser.' });
      return undefined;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = blobConfig.language || 'en-IN';
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      if (!isListeningRef.current) {
        setLiveSpeech('');
        currentTranscriptRef.current = '';
        return;
      }

      let finalTranscript = '';
      let interimTranscript = '';

      window.simulatedBlobVolumeTarget = 80;
      clearTimeout(window.blobSilenceTimer);
      window.blobSilenceTimer = setTimeout(() => {
        window.simulatedBlobVolumeTarget = 0;
      }, 450);

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
        else interimTranscript += event.results[i][0].transcript;
      }

      const displayText = finalTranscript || interimTranscript;
      if (!displayText.trim()) return;

      if (pendingActionRef.current && finalTranscript.trim()) {
        const heard = finalTranscript.toLowerCase().trim();
        const isYes =
          heard.includes('yes') ||
          heard.includes('yeah') ||
          heard.includes('yep') ||
          heard.includes('sure') ||
          heard.includes('do it') ||
          heard.includes('go ahead') ||
          heard.includes('haan') ||
          heard.includes('han') ||
          heard.includes('kar do') ||
          heard.includes('ok') ||
          heard.includes('okay');
        const isNo =
          heard.includes('no') ||
          heard.includes('nope') ||
          heard.includes('cancel') ||
          heard.includes('stop') ||
          heard.includes('nahi') ||
          heard.includes('mat') ||
          heard.includes('ruk') ||
          heard.includes("don't");

        if (isYes) handleConfirm();
        else if (isNo) handleCancel();
        return;
      }

      const isFinal = !!finalTranscript.trim();
      if (shouldDropTranscript(Date.now(), isFinal, echoProtectUntilRef.current)) {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        setLiveSpeech('');
        currentTranscriptRef.current = '';
        return;
      }

      setLiveSpeech(displayText);
      currentTranscriptRef.current = displayText;
      resetFadeTimer();
    };

    recognition.onend = () => {
      if (!isListeningRef.current) {
        setLiveSpeech('');
        currentTranscriptRef.current = '';
        return;
      }
      if (isListeningRef.current && recognitionRef.current && !pendingActionRef.current) {
        try {
          recognitionRef.current.start();
        } catch (e) {}
      }
    };

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      clearTimeout(window.blobSilenceTimer);
      stopAllAudio();
      if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch (e) {} audioCtxRef.current = null; }
      if (streamControllerRef.current) { try { streamControllerRef.current.abort(); } catch (e) {} streamControllerRef.current = null; }
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        try {
          recognitionRef.current.stop();
        } catch (e) {}
        recognitionRef.current = null;
      }
    };
  }, [
    appendChat,
    blobConfig.language,
    executeCommand,
    handleCancel,
    handleConfirm,
    resetFadeTimer,
    stopAllAudio,
  ]);

  const hideTerminal = false;

  return (
    <>
      {pendingAction && (
        <ConfirmDialog
          payloads={pendingAction.payloads}
          speech={pendingAction.speech}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          activeColor={activeColor}
        />
      )}

      <div
        className={`terminal-container ${hideTerminal ? 'fade-out' : 'fade-in'}`}
        style={{
          borderColor: `${activeColor}4a`,
          boxShadow: `0 10px 30px rgba(0, 0, 0, 0.5), inset 0 0 15px ${activeColor}33`,
        }}
      >
        <div className="terminal-header">
          <span className="dot red"></span>
          <span className="dot yellow"></span>
          <span className="dot green"></span>
          <span className="title" style={{ color: activeColor, textShadow: `0 0 5px ${activeColor}80` }}>
            J.A.R.V.I.S. - {providerLabel}
          </span>
          <button
            type="button"
            className={`listening-badge ${isListening ? 'active' : ''}`}
            onClick={toggleListening}
            title="Click or press Right Alt to toggle listening"
          >
            {isListening ? '🔴 LISTENING (Right Alt to Send)' : '🎙️ Right Alt to Speak'}
          </button>
        </div>

        <div className="terminal-content" ref={chatContainerRef}>
          {chatHistory.map((msg, idx) => (
            <div className={`chat-line ${msg.role === 'USER' ? 'user-line' : 'jarvis-line'}`} key={`${msg.role}-${idx}`}>
              <span className="prompt" style={{ color: msg.role === 'USER' ? '#ffffff' : activeColor }}>
                {msg.role}:
              </span>
              <span
                className="speech-text"
                style={{
                  color: msg.role === 'USER' ? 'rgba(255,255,255,0.82)' : activeColor,
                  textShadow: msg.role === 'J.A.R.V.I.S' ? `0 0 8px ${activeColor}99` : 'none',
                }}
              >
                {msg.text}
              </span>
            </div>
          ))}

          {liveSpeech && (
            <div className="chat-line user-line">
              <span className="prompt" style={{ color: '#ffffff' }}>USER:</span>
              <span className="speech-text" style={{ color: 'rgba(255,255,255,0.82)' }}>
                {liveSpeech}
                <span className="cursor" style={{ backgroundColor: activeColor, boxShadow: `0 0 10px ${activeColor}` }}></span>
              </span>
            </div>
          )}
        </div>

        <form
          className="terminal-input-bar"
          onSubmit={(e) => {
            e.preventDefault();
            const val = textInput.trim();
            if (val && submitToJarvisRef.current) {
              setTextInput('');
              submitToJarvisRef.current(val);
            }
          }}
        >
          <span className="prompt-symbol">&gt;</span>
          <input
            type="text"
            className="terminal-input"
            placeholder="Type a command or speak naturally..."
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
          />
          <button type="submit" className="terminal-send-btn">Send</button>
        </form>
      </div>
    </>
  );
};

export default Terminal;
