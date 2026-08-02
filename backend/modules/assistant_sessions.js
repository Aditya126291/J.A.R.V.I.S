const { randomUUID } = require('crypto');

const MAX_MESSAGES = 120;
const MAX_SUBSCRIBERS = 8;
const sessions = new Map();

function normalizeSessionId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{1,96}$/.test(id) ? id : 'desktop-global';
}

function getSession(sessionId) {
  const id = normalizeSessionId(sessionId);
  if (!sessions.has(id)) {
    sessions.set(id, { id, messages: [], subscribers: new Set(), pendingActions: null, createdAt: Date.now(), updatedAt: Date.now() });
  }
  return sessions.get(id);
}

function addMessage(sessionId, role, text, meta = {}) {
  const session = getSession(sessionId);
  const message = { id: randomUUID(), role: role === 'user' ? 'USER' : 'J.A.R.V.I.S', text: String(text || '').trim(), at: Date.now(), ...meta };
  if (!message.text) return null;
  session.messages.push(message);
  if (session.messages.length > MAX_MESSAGES) session.messages.splice(0, session.messages.length - MAX_MESSAGES);
  session.updatedAt = Date.now();
  return message;
}

function snapshot(sessionId) {
  const session = getSession(sessionId);
  return { sessionId: session.id, messages: session.messages.slice(), pendingConfirmation: Boolean(session.pendingActions), updatedAt: session.updatedAt };
}

function send(res, type, data) {
  if (res.writableEnded) return;
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
}

function publish(sessionId, type, data) {
  const session = getSession(sessionId);
  for (const res of session.subscribers) send(res, type, data);
}

function subscribe(sessionId, res) {
  const session = getSession(sessionId);
  if (session.subscribers.size >= MAX_SUBSCRIBERS) {
    const [oldest] = session.subscribers;
    if (oldest) { try { oldest.end(); } catch (_) {} session.subscribers.delete(oldest); }
  }
  session.subscribers.add(res);
  send(res, 'snapshot', snapshot(session.id));
  return () => session.subscribers.delete(res);
}

function setPendingActions(sessionId, actions) {
  const session = getSession(sessionId);
  session.pendingActions = Array.isArray(actions) && actions.length ? actions : null;
  session.updatedAt = Date.now();
}

function takePendingActions(sessionId) {
  const session = getSession(sessionId);
  const actions = session.pendingActions;
  session.pendingActions = null;
  session.updatedAt = Date.now();
  return actions;
}

function hasPendingActions(sessionId) {
  return Boolean(getSession(sessionId).pendingActions);
}

module.exports = { normalizeSessionId, addMessage, snapshot, publish, subscribe, setPendingActions, takePendingActions, hasPendingActions };
