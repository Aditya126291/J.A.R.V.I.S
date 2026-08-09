'use strict';

/**
 * J.A.R.V.I.S. Persistent Conversation & Audit Store
 *
 * Persists sessions, user/JARVIS interaction turns, and security audit events
 * across application restarts. Handles 14-day auto-compaction into session capsules.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSIONS_FILE = 'sessions.json';
const TURNS_FILE = 'turns.json';
const AUDIT_FILE = 'audit_log.json';

function getStoreDir() {
  return path.resolve(process.env.JARVIS_DATA_DIR || path.join(__dirname, '..', 'data'));
}

function getFilePath(filename) {
  const dir = getStoreDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, filename);
}

function loadJson(fileKey, defaultVal = []) {
  try {
    const file = getFilePath(fileKey);
    if (!fs.existsSync(file)) return defaultVal;
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return defaultVal;
  }
}

function saveJson(fileKey, data) {
  try {
    const file = getFilePath(fileKey);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[STORE] Failed writing ${fileKey}:`, err.message);
  }
}

let activeSessionId = null;
const COMPACTION_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function createSession(requestedId = null) {
  const sessions = loadJson(SESSIONS_FILE, []);
  const newSession = {
    sessionId: requestedId || `session_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    startedAt: new Date().toISOString(),
    endedAt: null,
    title: 'Voice & Command Console Session',
    summary: 'Active interactive session',
    turnCount: 0,
    pinned: false,
  };

  sessions.unshift(newSession);
  saveJson(SESSIONS_FILE, sessions.slice(0, 100)); // retain last 100 sessions
  activeSessionId = newSession.sessionId;
  return newSession;
}

function getOrCreateActiveSession(requestedId = null) {
  const sessions = loadJson(SESSIONS_FILE, []);
  const id = requestedId || activeSessionId;
  if (id) {
    const existing = sessions.find((s) => s.sessionId === id && !s.endedAt);
    if (existing) {
      activeSessionId = existing.sessionId;
      return existing;
    }
  }
  compactExpiredSessions();
  return createSession(requestedId);
}

function saveTurn(userPrompt, jarvisSpeech, provider = 'Gemini Primary', sessionId = null) {
  const session = getOrCreateActiveSession(sessionId);
  const turns = loadJson(TURNS_FILE, []);

  const turnRecord = {
    turnId: `turn_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    sessionId: session.sessionId,
    userPrompt,
    jarvisSpeech,
    provider,
    timestamp: new Date().toISOString(),
  };

  turns.unshift(turnRecord);
  saveJson(TURNS_FILE, turns.slice(0, 500)); // retain last 500 turns

  // Update session stats
  const sessions = loadJson(SESSIONS_FILE, []);
  const idx = sessions.findIndex((s) => s.sessionId === session.sessionId);
  if (idx >= 0) {
    sessions[idx].turnCount = (sessions[idx].turnCount || 0) + 1;
    sessions[idx].summary = `Last prompt: "${userPrompt.slice(0, 60)}${userPrompt.length > 60 ? '...' : ''}"`;
    saveJson(SESSIONS_FILE, sessions);
  }

  return turnRecord;
}

function logAuditEvent(eventType, authorityLevel, target, result, summary, sessionId = null) {
  const session = getOrCreateActiveSession(sessionId);
  const auditLogs = loadJson(AUDIT_FILE, []);

  const event = {
    eventId: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    sessionId: session.sessionId,
    timestamp: new Date().toISOString(),
    eventType,
    authorityLevel,
    target: target || 'system',
    result: result || 'success',
    summary,
  };

  auditLogs.unshift(event);
  saveJson(AUDIT_FILE, auditLogs.slice(0, 1000));
  return event;
}

function listSessions(query = '') {
  const sessions = loadJson(SESSIONS_FILE, []);
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter((session) => [session.sessionId, session.title, session.summary]
    .some((value) => String(value || '').toLowerCase().includes(needle)));
}

function listTurns(sessionId = null, limit = 50) {
  const turns = loadJson(TURNS_FILE, []);
  if (sessionId) {
    return turns.filter((t) => t.sessionId === sessionId).slice(0, limit);
  }
  return turns.slice(0, limit);
}

function listAuditLogs(limit = 50) {
  return loadJson(AUDIT_FILE, []).slice(0, limit);
}

function searchTurns(query, limit = 50) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  return loadJson(TURNS_FILE, [])
    .filter((turn) => `${turn.userPrompt || ''} ${turn.jarvisSpeech || ''}`.toLowerCase().includes(needle))
    .slice(0, limit);
}

function compactSession(sessionId) {
  const sessions = loadJson(SESSIONS_FILE, []);
  const index = sessions.findIndex((session) => session.sessionId === sessionId);
  if (index < 0) return null;
  const turns = loadJson(TURNS_FILE, []);
  const sessionTurns = turns.filter((turn) => turn.sessionId === sessionId);
  if (!sessionTurns.length) return sessions[index];

  const newest = sessionTurns[0];
  sessions[index] = {
    ...sessions[index],
    summary: `${sessionTurns.length} turns compacted. Last prompt: "${String(newest.userPrompt || '').slice(0, 100)}"`,
    compactedAt: new Date().toISOString(),
  };
  saveJson(SESSIONS_FILE, sessions);
  saveJson(TURNS_FILE, turns.filter((turn) => turn.sessionId !== sessionId));
  return sessions[index];
}

function compactExpiredSessions(now = Date.now()) {
  const sessions = loadJson(SESSIONS_FILE, []);
  sessions
    .filter((session) => !session.compactedAt && Date.parse(session.startedAt || '') > 0 && now - Date.parse(session.startedAt) >= COMPACTION_AGE_MS)
    .forEach((session) => compactSession(session.sessionId));
}

module.exports = {
  getOrCreateActiveSession,
  createSession,
  saveTurn,
  logAuditEvent,
  listSessions,
  listTurns,
  listAuditLogs,
  searchTurns,
  compactSession,
  compactExpiredSessions,
};
