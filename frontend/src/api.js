const API_BASE_URL = process.env.REACT_APP_JARVIS_API_URL || 'http://localhost:5000';
const SESSION_ID_KEY = 'jarvis.conversationSessionId';

const cache = new Map();

export function getConversationSessionId() {
  if (typeof window === 'undefined') return 'desktop-global';
  let id = window.localStorage.getItem(SESSION_ID_KEY);
  if (!id) {
    id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(SESSION_ID_KEY, id);
  }
  return id;
}

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
    body: JSON.stringify({ message, sessionId: getConversationSessionId() }),
  });
}

export function chatWithJarvisStream(message, callbacks = {}) {
  const { onMeta, onSpeechDelta, onActionReady, onDone, onError } = callbacks;
  const url = `${API_BASE_URL}/api/chat-stream?message=${encodeURIComponent(message)}&sessionId=${encodeURIComponent(getConversationSessionId())}`;
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

export function executeJarvisAction(payload, confirmed = false, securityPin = '') {
  return jsonRequest('/api/execute', {
    method: 'POST',
    body: JSON.stringify({ ...payload, confirmed, securityPin, sessionId: getConversationSessionId() }),
  });
}

export function getMemories(query = '') {
  return jsonRequest(`/api/memory?q=${encodeURIComponent(query)}`);
}

export function createMemory(memory) {
  return jsonRequest('/api/memory', { method: 'POST', body: JSON.stringify(memory) });
}

export function deleteMemory(id) {
  return jsonRequest(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function getSessions(query = '') {
  return jsonRequest(`/api/sessions?q=${encodeURIComponent(query)}`);
}

export function getTurns({ sessionId, query, limit = 50 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (sessionId) params.set('sessionId', sessionId);
  if (query) params.set('q', query);
  return jsonRequest(`/api/turns?${params.toString()}`);
}

export function getArtifacts(query = '') {
  return jsonRequest(`/api/artifacts?q=${encodeURIComponent(query)}`);
}

export function createArtifact(artifact) {
  return jsonRequest('/api/artifacts', { method: 'POST', body: JSON.stringify(artifact) });
}

export function getSecurityMatrix() {
  return cachedJson('/api/security-matrix', 5000);
}

export function getAuditLog() {
  return cachedJson('/api/audit-log', 1000);
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
  const clean = String(text || '')
    .replace(/[,;:]+/g, ' ')
    .replace(/!+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
  return `${API_BASE_URL}/tts?text=${encodeURIComponent(clean || text)}&lang=${encodeURIComponent(lang || 'en-IN')}`;
}

export { API_BASE_URL };


/**
 * Direct call into the keyless web tools (backend/modules/web.js).
 * Bypasses the LLM entirely so widgets that just need raw data don't
 * burn Gemini tokens. Returns the tool's native shape:
 *   { ok: true, ... }      on success
 *   { ok: false, error }   on failure (never throws for HTTP-level errors)
 */
export async function callWebTool(action, value) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'web', action, value, confirmed: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || `http_${res.status}` };
    }
    // /api/execute returns the tool result directly under top-level keys
    // (e.g. ok, location, current, items, etc.) so we can return as-is.
    return data;
  } catch (e) {
    return { ok: false, error: 'network_error' };
  }
}


// --- Dev-mode endpoints ----------------------------------------------------

export function getGitGlance(root) {
  const q = root ? `?root=${encodeURIComponent(root)}` : '';
  return jsonRequest(`/api/dev/git${q}`).catch(() => ({ ok: false, error: 'network_error' }));
}

export function getProjectInfo(root) {
  const q = root ? `?root=${encodeURIComponent(root)}` : '';
  return jsonRequest(`/api/dev/project${q}`).catch(() => ({ ok: false, error: 'network_error' }));
}

export function getBuildFeed(root) {
  const q = root ? `?root=${encodeURIComponent(root)}` : '';
  return jsonRequest(`/api/dev/build-feed${q}`).catch(() => ({ ok: false, error: 'network_error' }));
}

// One-click "open this app" helper used by the devtools quick-launch widget.
// Routes through the existing keyless `apps:open` action handler so we
// reuse the resolveOpenTarget logic and don't reinvent path/url normalisation.
export function openApp(target) {
  return executeJarvisAction({ module: 'apps', action: 'open', value: target }, true);
}


// --- Gamer-mode endpoints --------------------------------------------------

export function getNowPlaying() {
  return jsonRequest('/api/game/now-playing').catch(() => ({ ok: false, error: 'network_error' }));
}

export function getGamePresence() {
  return jsonRequest('/api/game/presence').catch(() => ({ ok: false, error: 'network_error' }));
}

export function getRichPresence() {
  return jsonRequest('/api/game/rich-presence').catch(() => ({ ok: false, error: 'network_error' }));
}


// --- Antigravity workspaces -----------------------------------------------

export function getAntigravityWorkspaces() {
  return jsonRequest('/api/dev/antigravity').catch(() => ({ ok: false, error: 'network_error' }));
}

export function openAntigravityWorkspace(targetPath, mode = 'reuse') {
  return fetch(`${API_BASE_URL}/api/dev/antigravity/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: targetPath, mode }),
  })
    .then((r) => r.json())
    .catch(() => ({ success: false, error: 'network_error' }));
}
