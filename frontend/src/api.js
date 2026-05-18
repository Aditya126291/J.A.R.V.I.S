const API_BASE_URL = process.env.REACT_APP_JARVIS_API_URL || 'http://localhost:5000';

const cache = new Map();

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok && !data.requiresConfirmation) {
    throw new Error(data.error || `${response.status} ${response.statusText}`);
  }
  return data;
}

function cachedJson(path, ttlMs) {
  const now = Date.now();
  const existing = cache.get(path);
  if (existing && now - existing.time < ttlMs) return existing.promise;

  const promise = jsonRequest(path).catch((err) => {
    cache.delete(path);
    throw err;
  });
  cache.set(path, { time: now, promise });
  return promise;
}

export function chatWithJarvis(message) {
  return jsonRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export function chatWithJarvisStream(message, callbacks = {}) {
  const { onMeta, onSpeechDelta, onActionReady, onDone, onError } = callbacks;
  const url = `${API_BASE_URL}/api/chat-stream?message=${encodeURIComponent(message)}`;
  const controller = new AbortController();

  const promise = (async () => {
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (e) {
      if (e.name !== 'AbortError') onError && onError({ message: e.message, code: 'NETWORK' });
      throw e;
    }
    if (!response.ok || !response.body) {
      const err = new Error(`HTTP ${response.status}`);
      onError && onError({ message: err.message, code: 'HTTP' });
      throw err;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let final = null;

    while (true) {
      let chunk;
      try { chunk = await reader.read(); } catch (e) {
        if (e.name === 'AbortError') break;
        throw e;
      }
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      let sepIdx;
      while ((sepIdx = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, sepIdx);
        buf = buf.slice(sepIdx + 2);
        const line = raw.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let evt;
        try { evt = JSON.parse(payload); } catch (e) { continue; }
        switch (evt.type) {
          case 'meta': onMeta && onMeta(evt); break;
          case 'speech_delta': onSpeechDelta && onSpeechDelta(evt); break;
          case 'action_ready': onActionReady && onActionReady(evt); break;
          case 'done': final = evt; onDone && onDone(evt); break;
          case 'error': onError && onError(evt); break;
          default: break;
        }
      }
    }
    return final;
  })();

  return { controller, promise };
}

export function executeJarvisAction(payload, confirmed = false) {
  return jsonRequest('/api/execute', {
    method: 'POST',
    body: JSON.stringify({ ...payload, confirmed }),
  });
}

export function getAiStatus() {
  return cachedJson('/api/ai-status', 1200);
}

export function getSystemStats() {
  return cachedJson('/api/system-stats', 1500);
}

export function focusBrowser() {
  return jsonRequest('/focus-browser').catch(() => ({ success: false }));
}

export function ttsUrl(text, lang) {
  return `${API_BASE_URL}/tts?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang || 'en-IN')}`;
}

export { API_BASE_URL };
