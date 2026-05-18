'use strict';

/**
 * XML Tag Parser for JARVIS model output.
 *
 * Implements the total `parseModelOutput(raw)` function described in
 * .kiro/specs/jarvis-voice-pipeline/design.md (XML Parser section) and
 * pinned by Requirements 4.1 through 4.8.
 *
 * Contract (every input string yields a valid result object):
 *   {
 *     speak:            string,    // always defined; may be ""
 *     actions:          object[],  // always an array; may be empty
 *     thoughtsStripped: boolean,   // true iff >=1 <thought> block was removed
 *     malformed:        boolean    // see Requirement 4.5
 *   }
 *
 * Guarantees:
 *   - Total: never throws on malformed, empty, unicode, or arbitrary input.
 *   - Tag matching is case-insensitive (Requirements 4.3, 4.4, 4.6).
 *   - `<thought>` block inner content never reaches `speak` (Requirement 4.2).
 *   - JSON recovery is tolerant of trailing commas, smart quotes, code
 *     fences, and missing braces (Requirements 4.6, 4.7).
 */

// Regex helpers. The `\b` boundary before the tag name keeps us from
// matching arbitrary tags that happen to start with the same prefix
// (e.g. `<speakers>` would not match `<speak>`). The `[^>]*` inside the
// open tag allows attributes. Lazy `[\s\S]*?` makes paired blocks work
// across newlines while still preferring the closest closing tag.
const THOUGHT_RE = /<thought\b[^>]*>[\s\S]*?<\/thought>/gi;
const THOUGHT_INNER_RE = /<thought\b[^>]*>([\s\S]*?)<\/thought>/gi;
const SPEAK_RE = /<speak\b[^>]*>([\s\S]*?)<\/speak>/i;
const ACTION_RE_GLOBAL = /<action\b[^>]*>([\s\S]*?)<\/action>/gi;
const ACTION_RE_STRIP = /<action\b[^>]*>[\s\S]*?<\/action>/gi;

/**
 * Remove every `<thought>...</thought>` block (case-insensitive). Iterates
 * until a fixed point so naively-nested or repeated blocks are all gone.
 *
 * @param {string} raw
 * @returns {string}
 */
function stripThoughtBlocks(raw) {
  let prev;
  let cleaned = raw;
  do {
    prev = cleaned;
    cleaned = cleaned.replace(THOUGHT_RE, '');
  } while (cleaned !== prev);
  return cleaned;
}

/**
 * Best-effort scan for top-level JSON candidates inside a string. Returns
 * brace-balanced substrings that could be valid JSON, sorted longest-first
 * so the largest match wins when parsing.
 *
 * Honors string state so braces inside string literals do not open or
 * close JSON candidates. Tracks both `{}` and `[]` so top-level arrays
 * are recovered as well as objects.
 *
 * Total: returns `[]` for non-string or empty inputs rather than throwing.
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractJsonCandidates(text) {
  if (typeof text !== 'string' || text.length === 0) return [];

  const candidates = [];
  const openers = { '{': '}', '[': ']' };
  let stack = [];
  let startIdx = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = false; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }

    if (ch === '{' || ch === '[') {
      if (stack.length === 0) startIdx = i;
      stack.push(openers[ch]);
    } else if (ch === '}' || ch === ']') {
      const expected = stack[stack.length - 1];
      if (expected === ch) {
        stack.pop();
        if (stack.length === 0 && startIdx !== -1) {
          candidates.push(text.substring(startIdx, i + 1));
          startIdx = -1;
        }
      } else {
        // Mismatched close - reset and keep scanning for the next opener.
        stack = [];
        startIdx = -1;
      }
    }
  }

  // Longest first: gives the biggest valid JSON the first shot at parsing.
  return candidates.sort((a, b) => b.length - a.length);
}

/**
 * Strip ```json / ``` fences off the head and tail of a string, if any.
 *
 * @param {string} str
 * @returns {string}
 */
function stripJsonFences(str) {
  let out = String(str || '').trim();
  out = out.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '');
  out = out.replace(/\n?```\s*$/, '');
  return out.trim();
}

/**
 * Replace common smart quotes and dashes with ASCII equivalents so they
 * do not break `JSON.parse`. We only normalize characters that JSON
 * itself would otherwise reject.
 *
 * @param {string} str
 * @returns {string}
 */
function normalizeSmartCharacters(str) {
  return String(str || '')
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"') // smart double quotes
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'") // smart single quotes
    .replace(/[\u2013\u2014\u2212]/g, '-');                  // en/em dash, minus
}

/**
 * Convert obvious single-quoted JSON literals to double-quoted form.
 * Best-effort and conservative: only touches sequences that look like
 * keys (`'foo':`) or values that follow `:`, `,`, `[`, `{`. Apostrophes
 * inside double-quoted strings are left alone.
 *
 * @param {string} str
 * @returns {string}
 */
function quoteSingleQuotedStrings(str) {
  return String(str || '')
    .replace(
      /([:,\[\{]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'/g,
      (_, prefix, inner) => `${prefix}"${inner.replace(/"/g, '\\"')}"`
    )
    .replace(
      /([\{,]\s*)'([^'\\]*)'(\s*:)/g,
      (_, prefix, key, suffix) => `${prefix}"${key.replace(/"/g, '\\"')}"${suffix}`
    );
}

/**
 * Apply the cheap, idempotent JSON repairs we know real model output
 * needs: fences, comments, trailing commas, single quotes, smart
 * punctuation. Order matters: fences first so comments inside fences
 * are still scrubbed, trailing commas last so we don't re-introduce them.
 *
 * @param {string} str
 * @returns {string}
 */
function cleanJsonString(str) {
  let cleaned = stripJsonFences(str);
  // Block and line comments. The leading `(^|[^\\:])` keeps `http://` URLs alive.
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  cleaned = cleaned.replace(/(^|[^\\:])\/\/.*$/gm, '$1');
  // Smart quotes / dashes -> ASCII.
  cleaned = normalizeSmartCharacters(cleaned);
  // Single-quoted -> double-quoted strings.
  cleaned = quoteSingleQuotedStrings(cleaned);
  // Trailing commas before `]` or `}`.
  cleaned = cleaned.replace(/,(\s*[\]}])/g, '$1');
  return cleaned.trim();
}

/**
 * Append the closing brackets/braces needed to balance a string that
 * was truncated mid-array or mid-object (e.g. by a model token cap).
 * Honors string state so braces inside literals are not counted.
 *
 * @param {string} str
 * @returns {string}
 */
function balanceBraces(str) {
  const stack = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = inString ? str + '"' : str;
  while (stack.length) out += stack.pop();
  return out;
}

/**
 * Try `JSON.parse`; never throw.
 *
 * @param {string} str
 * @returns {unknown|null}
 */
function tryParseJson(str) {
  if (typeof str !== 'string') return null;
  try {
    return JSON.parse(str);
  } catch (_) {
    return null;
  }
}

/**
 * Run the full repair ladder on a single action body. Returns either a
 * parsed value (object/array/primitive) or `null` if no candidate parsed.
 *
 * @param {string} body
 * @returns {unknown|null}
 */
function parseActionBody(body) {
  if (typeof body !== 'string') return null;
  const cleaned = cleanJsonString(body);
  if (cleaned.length === 0) return null;

  // 1. Cheapest path: cleaned body parses straight away.
  const direct = tryParseJson(cleaned);
  if (direct !== null) return direct;

  // 2. Brace-balanced extraction over the cleaned body.
  for (const candidate of extractJsonCandidates(cleaned)) {
    const cleanedCandidate = cleanJsonString(candidate);
    const parsed = tryParseJson(cleanedCandidate);
    if (parsed !== null) return parsed;
  }

  // 3. Brace-balanced extraction over the *raw* body (in case cleaning
  //    chewed up something we needed).
  for (const candidate of extractJsonCandidates(body)) {
    const parsed = tryParseJson(cleanJsonString(candidate));
    if (parsed !== null) return parsed;
  }

  // 4. Last resort: balance dangling braces and retry.
  const balanced = balanceBraces(cleaned);
  if (balanced && balanced !== cleaned) {
    const parsed = tryParseJson(balanced);
    if (parsed !== null) return parsed;
    for (const candidate of extractJsonCandidates(balanced)) {
      const c = tryParseJson(cleanJsonString(candidate));
      if (c !== null) return c;
    }
  }

  return null;
}

/**
 * Flatten a parsed action payload into an array of plain objects. Models
 * sometimes emit a bare object, sometimes an array, sometimes nested
 * arrays. Anything that is not a plain object is dropped silently per
 * Requirement 4.7.
 *
 * @param {unknown} value
 * @returns {object[]}
 */
function flattenToActionObjects(value) {
  const out = [];
  const stack = [value];
  while (stack.length) {
    const node = stack.shift();
    if (node === null || node === undefined) continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    if (typeof node === 'object') out.push(node);
    // Primitives are silently dropped: they cannot satisfy ActionPayload.
  }
  return out;
}

/**
 * Parse a single model response. Total over all string inputs.
 *
 * @param {unknown} raw
 * @returns {{ speak: string, actions: object[], thoughtsStripped: boolean, malformed: boolean }}
 */
function parseModelOutput(raw) {
  const result = {
    speak: '',
    actions: [],
    thoughtsStripped: false,
    malformed: false,
  };

  // Totality: coerce non-strings to empty without throwing.
  if (typeof raw !== 'string' || raw.length === 0) return result;

  // Requirement 4.8: detect whether any thought block was actually present
  // *before* we mutate the input. Using the inner-capture regex keeps the
  // detection consistent with stripThoughtBlocks.
  THOUGHT_INNER_RE.lastIndex = 0;
  result.thoughtsStripped = THOUGHT_INNER_RE.test(raw);
  THOUGHT_INNER_RE.lastIndex = 0;

  // 1. Strip <thought> blocks first so their content can never reach speak
  //    (Requirement 4.2).
  const cleaned = stripThoughtBlocks(raw);

  // 2. Extract <speak>. The first match wins (Requirement 4.3).
  const speakMatch = cleaned.match(SPEAK_RE);
  if (speakMatch) {
    result.speak = (speakMatch[1] || '').trim();
  } else {
    // Requirement 4.4: fall back to non-thought, non-action residue.
    const residue = cleaned.replace(ACTION_RE_STRIP, '').trim();
    result.speak = residue;
    // Requirement 4.5: malformed iff cleaned text had content but residue
    // collapsed to empty (i.e. the input was nothing but action blocks /
    // unparseable noise with no speak surface).
    if (residue.length === 0 && cleaned.trim().length > 0) {
      result.malformed = true;
    }
  }

  // 3. Iterate every <action> block (Requirement 4.6) and recover JSON
  //    via the tolerant parser. Failing blocks are silently dropped per
  //    Requirement 4.7.
  ACTION_RE_GLOBAL.lastIndex = 0;
  let actionMatch;
  while ((actionMatch = ACTION_RE_GLOBAL.exec(cleaned)) !== null) {
    const body = actionMatch[1];
    const parsed = parseActionBody(body);
    if (parsed === null) continue;
    for (const obj of flattenToActionObjects(parsed)) {
      result.actions.push(obj);
    }
  }
  ACTION_RE_GLOBAL.lastIndex = 0;

  return result;
}

module.exports = {
  parseModelOutput,
  extractJsonCandidates,
  // Exported for unit testing of the repair ladder in isolation. Not
  // part of the public contract described in design.md.
  _internals: {
    stripThoughtBlocks,
    cleanJsonString,
    balanceBraces,
    tryParseJson,
    parseActionBody,
    flattenToActionObjects,
  },
};
