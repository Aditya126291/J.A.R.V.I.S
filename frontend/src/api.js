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
