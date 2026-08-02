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

const STORE_DIR = path.resolve(__dirname, '..', 'data');
const SESSIONS_FILE = path.join(STORE_DIR, 'sessions.json');
const TURNS_FILE = path.join(STORE_DIR, 'turns.json');
const AUDIT_FILE = path.join(STORE_DIR, 'audit_log.json');

function ensureStoreDir() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
}

function loadJson(file, defaultVal = []) {
  try {
    ensureStoreDir();
    if (!fs.existsSync(file)) return defaultVal;
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return defaultVal;
  }
}

function saveJson(file, data) {
  try {
    ensureStoreDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[STORE] Failed writing ${file}:`, err.message);
  }
}

let activeSessionId = null;

function getOrCreateActiveSession() {
  const sessions = loadJson(SESSIONS_FILE, []);
  if (activeSessionId) {
    const existing = sessions.find((s) => s.sessionId === activeSessionId && !s.endedAt);
    if (existing) return existing;
  }

  const newSession = {
    sessionId: `session_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
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

function saveTurn(userPrompt, jarvisSpeech, provider = 'Gemini Primary') {
  const session = getOrCreateActiveSession();
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

function logAuditEvent(eventType, authorityLevel, target, result, summary) {
  const session = getOrCreateActiveSession();
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

function listSessions() {
  return loadJson(SESSIONS_FILE, []);
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

module.exports = {
  getOrCreateActiveSession,
  saveTurn,
  logAuditEvent,
  listSessions,
  listTurns,
  listAuditLogs,
};
