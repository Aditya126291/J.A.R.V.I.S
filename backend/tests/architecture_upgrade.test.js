const fs = require('fs');
const os = require('os');
const path = require('path');

describe('architecture upgrade modules', () => {
  let dataDir;
  let security;
  let store;
  let memory;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-architecture-'));
    process.env.JARVIS_DATA_DIR = dataDir;
    vi.resetModules();
    security = require('../modules/security');
    store = require('../modules/conversation_store');
    memory = require('../modules/memory');
  });

  afterEach(() => {
    delete process.env.JARVIS_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('classifies the authority matrix according to the security plan', () => {
    expect(security.classifyAuthority({ module: 'apps', action: 'open', value: 'notepad' }).level).toBe('A1');
    expect(security.classifyAuthority({ module: 'web', action: 'search', value: 'weather' }).level).toBe('A2');
    expect(security.classifyAuthority({ module: 'system', action: 'volume_set', value: 40 }).level).toBe('A3');
    expect(security.classifyAuthority({ module: 'message', action: 'send', value: {} }).level).toBe('A4');
    expect(security.classifyAuthority({ module: 'apps', action: 'close', value: 'notepad' }).level).toBe('A6');
    expect(security.classifyAuthority({ module: 'power', action: 'shutdown', value: null }).level).toBe('A7');
  });

  test('creates previews for sensitive authority levels', () => {
    const preview = security.generateDryRunPreview({ module: 'power', action: 'shutdown', value: null });
    expect(preview.authorityLevel).toBe('A7');
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.requiresPin).toBe(true);
  });

  test('persists, searches, and compacts conversation turns', () => {
    const session = store.createSession('session_test');
    store.saveTurn('Remember my Python preference', 'I will remember that.', 'test', session.sessionId);
    expect(store.searchTurns('python')).toHaveLength(1);
    expect(store.listTurns(session.sessionId)).toHaveLength(1);

    const sessionsFile = path.join(dataDir, 'sessions.json');
    const sessions = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    sessions[0].startedAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(sessionsFile, JSON.stringify(sessions));
    store.compactExpiredSessions();

    expect(store.listTurns(session.sessionId)).toHaveLength(0);
    expect(store.listSessions()[0].compactedAt).toBeTruthy();
  });

  test('persists recalled memories and artifact records', () => {
    memory.extractAndSaveMemories('Remember that my favorite programming language is Python.');
    expect(memory.recallRelevantMemory('What is my favorite programming language?')).toContain('Python');

    memory.addArtifact({ name: 'dashboard screenshot', text: 'Security matrix A0 A7', tags: ['screenshot', 'security'] });
    expect(memory.listArtifacts('security')).toHaveLength(1);
  });
});
