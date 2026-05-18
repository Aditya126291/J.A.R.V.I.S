/**
 * Unit tests for the bounded conversation history in ai_router.js
 * (Task 4.1: addToHistory / getHistory / clearHistory).
 *
 * These cover the example-level behavior of Requirements 5.1-5.5. The
 * universal length-bound property is exercised separately by task 4.2.
 */

const aiRouter = require('../modules/ai_router');

const { addToHistory, getHistory, clearHistory } = aiRouter;

describe('addToHistory / getHistory / clearHistory', () => {
  beforeEach(() => {
    clearHistory();
  });

  it('exports addToHistory, getHistory, and clearHistory', () => {
    expect(typeof addToHistory).toBe('function');
    expect(typeof getHistory).toBe('function');
    expect(typeof clearHistory).toBe('function');
  });

  it('appends an entry with role, content, and a numeric ts (Req 5.3)', () => {
    const before = Date.now();
    addToHistory('user', 'hello jarvis');
    const after = Date.now();

    const entries = getHistory();
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.role).toBe('user');
    expect(entry.content).toBe('hello jarvis');
    expect(typeof entry.ts).toBe('number');
    expect(entry.ts).toBeGreaterThanOrEqual(before);
    expect(entry.ts).toBeLessThanOrEqual(after);
  });

  it('stores model entries verbatim, including raw XML (Req 5.5)', () => {
    const rawXml =
      '<thought>plan the move</thought><speak>Done, sir.</speak><action>[{"module":"system","action":"volume_set","value":42}]</action>';
    addToHistory('model', rawXml);

    const [entry] = getHistory();
    expect(entry.role).toBe('model');
    expect(entry.content).toBe(rawXml);
    expect(entry.content).toContain('<thought>');
    expect(entry.content).toContain('<action>');
  });

  it('rejects empty content without modifying state (Req 5.4)', () => {
    addToHistory('user', '');
    addToHistory('user', '   ');
    addToHistory('user', '\t\n');
    addToHistory('model', '');
    expect(getHistory()).toHaveLength(0);
  });

  it('drops the oldest entry once the buffer reaches 20 (Req 5.1, 5.2)', () => {
    for (let i = 0; i < 25; i++) {
      addToHistory(i % 2 === 0 ? 'user' : 'model', `entry-${i}`);
    }

    const entries = getHistory();
    expect(entries).toHaveLength(20);
    // The first five (entry-0 .. entry-4) should have been dropped.
    expect(entries[0].content).toBe('entry-5');
    expect(entries[entries.length - 1].content).toBe('entry-24');
  });

  it('keeps length <= 20 after every call (Req 5.1)', () => {
    for (let i = 0; i < 100; i++) {
      addToHistory('user', `msg-${i}`);
      expect(getHistory().length).toBeLessThanOrEqual(20);
    }
  });

  it('clearHistory empties the buffer', () => {
    addToHistory('user', 'one');
    addToHistory('model', '<speak>two</speak>');
    expect(getHistory()).toHaveLength(2);

    clearHistory();
    expect(getHistory()).toHaveLength(0);
  });

  it('getHistory returns a defensive copy (mutating it does not affect state)', () => {
    addToHistory('user', 'first');
    const snapshot = getHistory();
    snapshot.push({ role: 'user', content: 'leak', ts: Date.now() });
    snapshot[0].content = 'mutated';

    const fresh = getHistory();
    expect(fresh).toHaveLength(1);
    expect(fresh[0].content).toBe('first');
  });

  it('treats legacy "assistant" role as "model" but rejects unknown roles', () => {
    addToHistory('assistant', '<speak>hi</speak>');
    addToHistory('system', 'should be rejected');
    addToHistory('', 'also rejected');

    const entries = getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0].role).toBe('model');
    expect(entries[0].content).toBe('<speak>hi</speak>');
  });
});
