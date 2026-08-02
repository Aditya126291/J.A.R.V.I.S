'use strict';

/**
 * J.A.R.V.I.S. Long-Term Memory & Semantic Recall System
 *
 * Manages persistent user preferences, key decisions, artifact indexing,
 * and contextual memory injection into Gemini prompts.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MEMORY_DIR = path.resolve(__dirname, '..', 'data');
const MEMORIES_FILE = path.join(MEMORY_DIR, 'memories.json');
const ARTIFACTS_FILE = path.join(MEMORY_DIR, 'artifacts.json');

function ensureMemoryDir() {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

function loadJson(file, defaultVal = []) {
  try {
    ensureMemoryDir();
    if (!fs.existsSync(file)) return defaultVal;
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return defaultVal;
  }
}

function saveJson(file, data) {
  try {
    ensureMemoryDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[MEMORY] Failed writing ${file}:`, err.message);
  }
}

// Seed initial core memory if empty
function initializeDefaultMemories() {
  const existing = loadJson(MEMORIES_FILE, []);
  if (existing.length === 0) {
    const defaults = [
      {
        id: 'mem_user_name',
        kind: 'preference',
        key: 'user_name',
        content: 'The user is Aditya Kumar, developer and primary user of J.A.R.V.I.S.',
        source: 'system_init',
        tags: ['user', 'name', 'identity'],
        createdAt: new Date().toISOString(),
      },
      {
        id: 'mem_hotkey_pref',
        kind: 'preference',
        key: 'hotkey_trigger',
        content: 'J.A.R.V.I.S voice recording is strictly toggled via the Right Alt key (AltRight).',
        source: 'system_init',
        tags: ['hotkey', 'right_alt', 'voice'],
        createdAt: new Date().toISOString(),
      },
      {
        id: 'mem_assistant_identity',
        kind: 'explicit_memory',
        key: 'jarvis_persona',
        content: 'J.A.R.V.I.S. is a warm, loyal, highly intelligent, sub-second latency AI assistant.',
        source: 'system_init',
        tags: ['persona', 'identity'],
        createdAt: new Date().toISOString(),
      },
    ];
    saveJson(MEMORIES_FILE, defaults);
  }
}

initializeDefaultMemories();

/**
 * Automatically extract preferences or explicit memories from user prompt text
 */
function extractAndSaveMemories(userText) {
  if (!userText || typeof userText !== 'string') return null;
  const lower = userText.toLowerCase();

  // Pattern: "Remember that X" / "Remember X"
  const remMatch = userText.match(/\bremember\s+(?:that\s+)?(.+?)[.!?]*$/i);
  if (remMatch && remMatch[1].trim()) {
    return addMemory('explicit_memory', remMatch[1].trim(), ['user_extracted'], 'voice_command');
  }

  // Pattern: "My favorite X is Y" / "I prefer X"
  const prefMatch = userText.match(/\b(?:my\s+favorite|i\s+prefer|i\s+like)\s+(.+?)[.!?]*$/i);
  if (prefMatch && prefMatch[1].trim()) {
    return addMemory('preference', `User preference: ${prefMatch[0].trim()}`, ['preference', 'user_extracted'], 'voice_command');
  }

  return null;
}

function addMemory(kind, content, tags = [], source = 'manual') {
  const memories = loadJson(MEMORIES_FILE, []);
  const record = {
    id: `mem_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    kind: kind || 'explicit_memory',
    content,
    tags: Array.isArray(tags) ? tags : [],
    source,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  memories.unshift(record);
  saveJson(MEMORIES_FILE, memories);
  return record;
}

function deleteMemory(id) {
  const memories = loadJson(MEMORIES_FILE, []);
  const filtered = memories.filter((m) => m.id !== id);
  saveJson(MEMORIES_FILE, filtered);
  return filtered.length < memories.length;
}

function listMemories(query = '') {
  const memories = loadJson(MEMORIES_FILE, []);
  if (!query || !query.trim()) return memories;

  const q = query.toLowerCase().trim();
  return memories.filter((m) =>
    m.content.toLowerCase().includes(q) ||
    m.tags.some((t) => t.toLowerCase().includes(q))
  );
}

/**
 * Recall minimal relevant memories to inject into Gemini system prompt
 */
function recallRelevantMemory(userPrompt) {
  const memories = loadJson(MEMORIES_FILE, []);
  if (memories.length === 0) return '';

  const q = String(userPrompt || '').toLowerCase();
  const matched = memories.filter((m) => {
    const text = m.content.toLowerCase();
    const tags = m.tags.join(' ').toLowerCase();
    return q.split(/\s+/).some((word) => word.length > 2 && (text.includes(word) || tags.includes(word)));
  });

  const selected = matched.length > 0 ? matched.slice(0, 3) : memories.slice(0, 2);
  return selected.map((m) => `- ${m.content}`).join('\n');
}

module.exports = {
  addMemory,
  deleteMemory,
  listMemories,
  extractAndSaveMemories,
  recallRelevantMemory,
};
