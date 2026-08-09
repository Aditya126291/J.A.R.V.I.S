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

const MEMORIES_FILE = 'memories.json';
const ARTIFACTS_FILE = 'artifacts.json';

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
    console.error(`[MEMORY] Failed writing ${fileKey}:`, err.message);
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
  const normalizedContent = String(content || '').trim();
  const duplicate = memories.find((memory) => memory.content.toLowerCase() === normalizedContent.toLowerCase());
  if (duplicate) return duplicate;
  const record = {
    id: `mem_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    kind: kind || 'explicit_memory',
    content: normalizedContent,
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

function addArtifact({ name, sourcePath = '', text = '', tags = [], summary = '' } = {}) {
  const artifacts = loadJson(ARTIFACTS_FILE, []);
  const record = {
    id: `artifact_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    name: String(name || sourcePath || 'Untitled artifact').trim(),
    sourcePath: String(sourcePath || '').trim(),
    text: String(text || '').trim().slice(0, 12000),
    summary: String(summary || '').trim(),
    tags: Array.isArray(tags) ? tags.map(String).filter(Boolean) : [],
    createdAt: new Date().toISOString(),
  };
  artifacts.unshift(record);
  saveJson(ARTIFACTS_FILE, artifacts.slice(0, 1000));
  return record;
}

function listArtifacts(query = '') {
  const artifacts = loadJson(ARTIFACTS_FILE, []);
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return artifacts;
  return artifacts.filter((artifact) => `${artifact.name} ${artifact.summary} ${artifact.text} ${(artifact.tags || []).join(' ')}`.toLowerCase().includes(needle));
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

  const selected = matched.slice(0, 3);
  return selected.map((m) => `- ${m.content}`).join('\n');
}

module.exports = {
  addMemory,
  deleteMemory,
  listMemories,
  extractAndSaveMemories,
  recallRelevantMemory,
  addArtifact,
  listArtifacts,
};
