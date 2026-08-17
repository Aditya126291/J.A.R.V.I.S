const os = require('os');
const path = require('path');

const HOME_DIR = os.homedir();
const DESKTOP_DIR = path.join(HOME_DIR, 'OneDrive', 'Desktop');
const DOWNLOADS_DIR = path.join(HOME_DIR, 'Downloads');

const APP_MAP = {
  youtube: 'https://youtube.com',
  google: 'https://google.com',
  gmail: 'https://mail.google.com',
  github: 'https://github.com',
  twitter: 'https://twitter.com',
  x: 'https://twitter.com',
  instagram: 'https://instagram.com',
  facebook: 'https://facebook.com',
  linkedin: 'https://linkedin.com',
  reddit: 'https://reddit.com',
  chatgpt: 'https://chat.openai.com',
  netflix: 'https://netflix.com',
  spotify: 'spotify:',
  amazon: 'https://amazon.in',
  whatsapp: 'whatsapp:',
  calculator: 'calculator:',
  calendar: 'outlookcal:',
  camera: 'microsoft.windows.camera:',
  clock: 'ms-clock:',
  maps: 'bingmaps:',
  store: 'ms-windows-store:',
  xbox: 'xbox:',
  photos: 'ms-photos:',
  weather: 'bingweather:',
  mail: 'mailto:',
  settings: 'ms-settings:',
  notepad: 'notepad',
  paint: 'mspaint',
  word: 'winword',
  excel: 'excel',
  powerpoint: 'powerpnt',
  chrome: 'chrome',
  firefox: 'firefox',
  edge: 'msedge',
  vscode: 'code',
  'visual studio code': 'code',
  'vs code': 'code',
  cmd: 'cmd',
  terminal: 'wt',
  powershell: 'powershell',
  'file explorer': 'explorer',
  explorer: 'explorer',
  'task manager': 'taskmgr',
  'control panel': 'control',
  'snipping tool': 'snippingtool',
  discord: 'discord',
  telegram: 'telegram',
  vlc: 'vlc',
  obs: 'obs64',
  cursor: 'cursor',
  ibm: 'https://ibm.com',
  notion: 'https://notion.so',
  figma: 'https://figma.com',
  canva: 'https://canva.com',
};

const CLOSE_MAP = {
  cursor: ['Cursor.exe'],
  chrome: ['chrome.exe'],
  'google chrome': ['chrome.exe'],
  firefox: ['firefox.exe'],
  edge: ['msedge.exe'],
  'microsoft edge': ['msedge.exe'],
  brave: ['brave.exe'],
  opera: ['opera.exe'],
  notepad: ['notepad.exe'],
  paint: ['mspaint.exe', 'PaintDotNet.exe', 'PaintApp.exe'],
  word: ['WINWORD.EXE', 'word.exe'],
  excel: ['EXCEL.EXE', 'excel.exe'],
  powerpoint: ['POWERPNT.EXE', 'powerpnt.exe'],
  vscode: ['Code.exe'],
  'visual studio code': ['Code.exe'],
  'vs code': ['Code.exe'],
  cmd: ['cmd.exe'],
  powershell: ['powershell.exe', 'pwsh.exe'],
  terminal: ['WindowsTerminal.exe', 'wt.exe'],
  'file explorer': ['explorer.exe'],
  explorer: ['explorer.exe'],
  'task manager': ['Taskmgr.exe'],
  discord: ['Discord.exe', 'DiscordPTB.exe', 'DiscordCanary.exe'],
  telegram: ['Telegram.exe'],
  whatsapp: ['WhatsApp.Root.exe', 'WhatsApp.exe', 'WhatsAppDesktop.exe'],
  'whatsapp web': ['WhatsApp.Root.exe', 'WhatsApp.exe', 'WhatsAppDesktop.exe'],
  vlc: ['vlc.exe'],
  obs: ['obs64.exe', 'obs32.exe', 'obs.exe'],
  spotify: ['Spotify.exe'],
  calculator: ['CalculatorApp.exe', 'Calculator.exe', 'calc.exe'],
  'snipping tool': ['SnippingTool.exe', 'ScreenClippingHost.exe'],
  camera: ['WindowsCamera.exe', 'Camera.exe'],
  photos: ['Microsoft.Photos.exe', 'Photos.exe', 'PhotosApp.exe'],
  settings: ['SystemSettings.exe'],
  steam: ['steam.exe', 'steamwebhelper.exe'],
};

const WEBSITE_TARGETS = new Set([
  'youtube',
  'google',
  'gmail',
  'github',
  'twitter',
  'x',
  'instagram',
  'facebook',
  'linkedin',
  'reddit',
  'chatgpt',
  'netflix',
  'amazon',
  'spotify',
  'whatsapp web',
  'telegram web',
]);

const TITLE_KEYWORDS = {
  youtube: 'YouTube',
  google: 'Google',
  gmail: 'Gmail',
  github: 'GitHub',
  twitter: 'Twitter',
  x: 'X ',
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  reddit: 'Reddit',
  chatgpt: 'ChatGPT',
  netflix: 'Netflix',
  amazon: 'Amazon',
  spotify: 'Spotify',
  whatsapp: 'WhatsApp',
  'whatsapp web': 'WhatsApp',
  telegram: 'Telegram',
  'telegram web': 'Telegram',
};

const VALID_ACTIONS = {
  apps: new Set(['open', 'close', 'automate']),
  system: new Set([
    'volume_set',
    'volume_mute',
    'volume_unmute',
    'brightness_set',
    'brightness_adjust',
    'bluetooth_enable',
    'bluetooth_disable',
  ]),
  power: new Set(['sleep', 'restart', 'shutdown']),
  media: new Set(['play_pause', 'next', 'prev']),
  files: new Set([
    'create_folder',
    'create_file',
    'delete',
    'format',
    'sort_downloads',
    'empty_recycle_bin',
  ]),
  productivity: new Set(['create_note']),
  network: new Set(['ping', 'wifi_enable', 'wifi_disable']),
  workspace: new Set(['focus_mode', 'coding_mode']),
  message: new Set(['send']),
  // Live-data tools (keyless). All non-risky: read-only fetches, no
  // destructive side effects, no confirmation gate.
  web: new Set(['search', 'fetch', 'weather', 'wiki', 'time', 'crypto', 'news']),
  // UI control tokens — emitted by the smart router for voice-driven HUD
  // commands ("set weather to tokyo", "start a focus timer", etc.). The
  // frontend Terminal intercepts these before they hit /api/execute and
  // dispatches them on the local jarvis-ui event bus instead. Backend
  // handler is intentionally absent.
  ui: new Set([
    'mode.dev', 'mode.gamer', 'mode.toggle',
    'pomodoro.start', 'pomodoro.stop',
    'weather.set_location', 'weather.refresh',
    'news.refresh', 'news.set_topic',
    'pulse.expand', 'pulse.collapse', 'pulse.toggle',
  ]),
};

// Closed Risky_Action_Set per design.md / requirements.md (Glossary).
// `requiresConfirmation(payload)` returns true iff `module:action` is in this
// set. The set is closed: any addition or removal must be matched by the
// corresponding update in design.md, requirements.md (Glossary), and the
// Risky_Action_Set test fixtures. The predicate is intentionally decoupled
// from `VALID_ACTIONS` so the gate stays correct even if the action whitelist
// drifts (Requirement 6.6).
const RISKY_ACTIONS = new Set([
  'power:shutdown',
  'power:restart',
  'files:delete',
  'files:format',
  'network:wifi_disable',
  'message:send',
]);

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function psQuote(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function escapeRegex(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clampNumber(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeSimpleText(value, maxLength = 120) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function isSafeDesktopName(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return false;
  // Reject null bytes (filesystem boundary attacks).
  if (trimmed.includes('\0')) return false;
  // Reject path traversal markers and any segment separators / drive markers.
  if (trimmed.includes('..')) return false;
  if (/[\\/:*?"<>|]/.test(trimmed)) return false;
  // Reject Windows reserved device names (CON, PRN, AUX, NUL, COM1..9, LPT1..9).
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(trimmed)) return false;
  // After all the rejections above, the value must be a single basename.
  return path.basename(trimmed) === trimmed;
}

function safeDesktopPath(name) {
  if (!isSafeDesktopName(name)) {
    throw new Error('Use a simple Desktop file or folder name without path characters.');
  }

  const resolved = path.resolve(DESKTOP_DIR, name.trim());
  const desktopRoot = path.resolve(DESKTOP_DIR) + path.sep;
  if (!resolved.startsWith(desktopRoot)) {
    throw new Error('File action must stay inside the Desktop folder.');
  }
  return resolved;
}

// Non-throwing variant used by `normalizePayload` to satisfy Requirement 6.5
// (no exceptions for any input).
function trySafeDesktopPath(name) {
  try {
    return safeDesktopPath(name);
  } catch (e) {
    return null;
  }
}

function isSafeUrlLike(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }
  return /^[a-z0-9.-]+\.[a-z]{2,10}(\/.*)?$/i.test(trimmed);
}

function normalizeUrl(value) {
  const trimmed = String(value).trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isSafeProcessName(value) {
  return /^[a-zA-Z0-9_. -]{2,80}\.exe$/.test(String(value || ''));
}

function isSafeLaunchName(value) {
  return /^[a-zA-Z0-9_. -]{2,80}$/.test(String(value || ''));
}

function isSafeHost(value) {
  return /^[a-zA-Z0-9.-]{1,253}$/.test(String(value || ''));
}

function requiresConfirmation(payload) {
  if (!payload) return false;
  return RISKY_ACTIONS.has(`${payload.module}:${payload.action}`);
}

function summarizeAction(payload) {
  if (!payload) return 'Unknown action';
  const value = payload.value;
  if (payload.module === 'apps') return `${payload.action} ${value}`;
  if (payload.module === 'system') {
    if (payload.action === 'brightness_adjust') return `adjust brightness by ${value}`;
    if (payload.action.endsWith('_set')) return `${payload.action.replace('_', ' ')} to ${value}`;
    return payload.action.replace(/_/g, ' ');
  }
  if (payload.module === 'message' && isPlainObject(value)) {
    return `send ${value.app || 'message'} message to ${value.contact || 'contact'}`;
  }
  if (payload.module === 'ui') {
    const a = payload.action;
    const v = payload.value || '';
    if (a === 'mode.dev')              return 'switch to developer mode';
    if (a === 'mode.gamer')            return 'switch to gamer mode';
    if (a === 'mode.toggle')           return 'toggle UI mode';
    if (a === 'pomodoro.start')        return v ? `start a ${v}-minute focus timer` : 'start a focus timer';
    if (a === 'pomodoro.stop')         return 'stop the focus timer';
    if (a === 'weather.set_location')  return `change the weather widget to ${v}`;
    if (a === 'weather.refresh')       return 'refresh the weather';
    if (a === 'news.refresh')          return 'refresh the news';
    if (a === 'news.set_topic')        return `change news topic to ${v}`;
    if (a === 'pulse.expand')          return 'expand the system pulse';
    if (a === 'pulse.collapse')        return 'collapse the system pulse';
    if (a === 'pulse.toggle')          return 'toggle the system pulse';
    return `UI ${a}`;
  }
  if (payload.module === 'web') {
    if (payload.action === 'weather') return `look up the weather in ${value || 'a location'}`;
    if (payload.action === 'wiki')    return `look up '${value}' on Wikipedia`;
    if (payload.action === 'time')    return `look up the time in ${value || 'a location'}`;
    if (payload.action === 'crypto')  return `look up the price of ${value}`;
    if (payload.action === 'news')    return `look up the latest news about ${value}`;
    if (payload.action === 'search')  return `search the web for '${value}'`;
    if (payload.action === 'fetch')   return `read the page at ${value}`;
    return `web ${payload.action}`;
  }
  if (payload.module === 'files') {
    // `files:format` is in the closed Risky_Action_Set (Glossary in
    // requirements.md). normalizePayload currently strips its `value` and
    // `target` (the action does not yet have a sandboxed schema), so the
    // generic branch below would emit a bare "format" with no object. Give
    // the confirmation modal a clean human description regardless of which
    // field carried the format target on the raw payload.
    if (payload.action === 'format') {
      const fmtTarget =
        (typeof payload.target === 'string' && payload.target) ||
        (typeof value === 'string' && value) ||
        null;
      return fmtTarget ? `format ${fmtTarget}` : 'format drive';
    }
    return `${payload.action.replace(/_/g, ' ')}${value ? ` ${value}` : ''}`;
  }
  return `${payload.module} ${payload.action}`;
}

// Per design.md "Action validation pipeline":
//   validateActions(actions: ActionPayload[]):
//     { ok: NormalizedAction[], pending: PendingEntry[], rejected: RejectedEntry[] }
//
// Postconditions (Requirements 6.2, 6.7, 6.11):
//   - The three output lists partition the input multiset: every input lands
//     in exactly one of ok / pending / rejected, with no duplication and no
//     loss (Requirement 6.11).
//   - A normalized payload `n` for which `requiresConfirmation(n) === true`
//     and `n.confirmed !== true` is placed in `pending` and is NOT placed in
//     `ok` (Requirement 6.2).
//   - Each `pending` entry carries an `id` (`${index}-${module}-${action}`),
//     the normalized `payload`, and a `summary` from `summarizeAction` so the
//     frontend modal can render and correlate confirmations (Requirement 6.7).
//   - Each `rejected` entry carries the original input `payload` and a short
//     `reason` string (`unknown_module` when the module is missing or not in
//     VALID_ACTIONS, `invalid_payload` otherwise) so callers can surface a
//     useful diagnostic without re-running schema checks.
function validateActions(actions) {
  const ok = [];
  const pending = [];
  const rejected = [];

  if (!Array.isArray(actions)) {
    return { ok, pending, rejected };
  }

  actions.forEach((rawPayload, index) => {
    const normalized = normalizePayload(rawPayload);
    if (normalized === null) {
      // Distinguish the "module isn't in our vocabulary" case from any other
      // schema failure so the frontend can render a clearer error. We mirror
      // the same lowercase / trim normalization normalizePayload uses so the
      // detection lines up with the actual rejection rule.
      let reason = 'invalid_payload';
      if (isPlainObject(rawPayload)) {
        const moduleName = normalizeSimpleText(rawPayload.module, 40).toLowerCase();
        if (!moduleName || !VALID_ACTIONS[moduleName]) {
          reason = 'unknown_module';
        }
      }
      rejected.push({ payload: rawPayload, reason });
      return;
    }

    // Risky payloads without `confirmed === true` short-circuit to `pending`.
    // This is the gate that produces the HTTP 409 / requiresConfirmation
    // event (Requirement 6.7); the frontend re-issues the same payload with
    // `confirmed: true` to move it into `ok` on the next call.
    if (requiresConfirmation(normalized) && normalized.confirmed !== true) {
      pending.push({
        id: `${index}-${normalized.module}-${normalized.action}`,
        payload: normalized,
        summary: summarizeAction(normalized),
      });
      return;
    }

    ok.push(normalized);
  });

  return { ok, pending, rejected };
}

// Per design.md "Command Registry / Validator":
//   normalizePayload(input: unknown): NormalizedAction | null
//
// Postconditions (Requirements 6.1, 6.3, 6.4, 6.5):
//   - Returns `null` (never throws) for any input that fails schema validation.
//   - For `module ∈ {system, media}` with numeric `value`: 0 <= result.value <= 100.
//   - For `module === "files"` with a `target`: result.target is an absolute
//     path under Desktop_Root, or `null` if the name is not a safe basename.
//   - Rejects path traversal (`..`, `/`, `\`), absolute paths, null bytes,
//     and any path that resolves outside Desktop_Root.
function normalizePayload(input) {
  try {
    if (!isPlainObject(input)) return null;

    const moduleName = normalizeSimpleText(input.module, 40).toLowerCase();
    const action = normalizeSimpleText(input.action, 60).toLowerCase();
    if (!VALID_ACTIONS[moduleName] || !VALID_ACTIONS[moduleName].has(action)) {
      return null;
    }

    let value = input.value ?? null;
    let target = input.target ?? null;
    const confirmed = input.confirmed === true;

    if (moduleName === 'apps') {
      if (action === 'automate') {
        if (!isPlainObject(value) || !normalizeSimpleText(value.app, 80) || !Array.isArray(value.sequence)) {
          return null;
        }
        value = {
          app: normalizeSimpleText(value.app, 80),
          sequence: value.sequence.slice(0, 20).map((step) => normalizeSimpleText(String(step), 300)),
        };
      } else {
        value = normalizeSimpleText(value, 160).toLowerCase();
        if (!value) return null;
      }
    } else if (moduleName === 'system') {
      if (action === 'volume_set' || action === 'brightness_set') {
        // Requirement 6.1: clamp numeric value to [0, 100].
        value = clampNumber(value, 0, 100);
        if (value === null) return null;
      } else if (action === 'brightness_adjust') {
        // Adjust deltas may be negative, but the absolute magnitude is bounded
        // by the same [0, 100] device range; the executor re-clamps the
        // resulting brightness in `system.js`.
        value = clampNumber(value, -100, 100);
        if (value === null || value === 0) return null;
      } else {
        value = null;
      }
    } else if (moduleName === 'media') {
      // No media action currently carries a numeric `value`, but if one ever
      // does, Requirement 6.1 mandates the [0, 100] clamp.
      if (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) {
        const clamped = clampNumber(value, 0, 100);
        value = clamped; // null is acceptable here -- media actions ignore value
      } else {
        value = null;
      }
    } else if (moduleName === 'power' || moduleName === 'workspace') {
      value = null;
    } else if (moduleName === 'network') {
      if (action === 'ping') {
        value = normalizeSimpleText(value || 'google.com', 253);
        if (!isSafeHost(value)) return null;
      } else {
        value = null;
      }
    } else if (moduleName === 'files') {
      if (action === 'create_folder' || action === 'create_file' || action === 'delete') {
        // The `target` is the path-like field per design.md. Callers that
        // still send the name in `value` are accepted for backward compat.
        const rawName = target != null ? target : value;
        const candidate = normalizeSimpleText(rawName, 120);
        // Requirement 6.4: reject `..`, `/`, `\`, absolute paths, null bytes.
        if (!isSafeDesktopName(candidate)) return null;
        const resolved = trySafeDesktopPath(candidate);
        if (!resolved) return null;
        value = candidate; // keep the raw name in `value` for legacy callers
        target = resolved; // sandboxed absolute path under Desktop_Root
      } else {
        value = null;
        target = null;
      }
    } else if (moduleName === 'productivity') {
      value = normalizeSimpleText(value, 1000);
      if (!value) return null;
    } else if (moduleName === 'web') {
      // All web tools accept a single free-form string argument: a query,
      // location name, symbol, topic, or URL. We trim/cap aggressively so a
      // malformed model emission can't blow up the upstream HTTP call.
      // - search/wiki/news/weather/time/crypto: 200-char query cap
      // - fetch: must look like a URL (http(s)://...) and is capped at 600
      const cap = action === 'fetch' ? 600 : 200;
      value = normalizeSimpleText(value, cap);
      if (!value) return null;
      if (action === 'fetch' && !/^https?:\/\//i.test(value)) return null;
    } else if (moduleName === 'ui') {
      // UI control actions. `value` is optional and free-form: a string for
      // text inputs (city for weather.set_location, topic for news), or a
      // bounded integer for time/duration (minutes for pomodoro.start).
      // The frontend widget validates further.
      if (typeof value === 'number' && Number.isFinite(value)) {
        // Cap at 24h-worth of minutes to keep things sane.
        value = Math.max(0, Math.min(1440, Math.round(value)));
      } else if (value !== null && value !== undefined) {
        const trimmed = normalizeSimpleText(value, 120);
        value = trimmed === '' ? null : trimmed;
      }
    } else if (moduleName === 'message') {
      if (!isPlainObject(value)) return null;
      value = {
        app: normalizeSimpleText(value.app, 40).toLowerCase(),
        contact: normalizeSimpleText(value.contact, 120),
        message: normalizeSimpleText(value.message, 1000),
      };
      if (!['whatsapp', 'telegram'].includes(value.app)) return null;
      if (!value.contact || !value.message) return null;
    }
    const payload = { module: moduleName, action, value };
    if (target !== null) payload.target = target;
    if (confirmed) payload.confirmed = true;
    return payload;
  } catch (e) {
    // Requirement 6.5: never throw, regardless of input shape.
    return null;
  }
}

module.exports = {
  APP_MAP,
  CLOSE_MAP,
  WEBSITE_TARGETS,
  TITLE_KEYWORDS,
  DESKTOP_DIR,
  DOWNLOADS_DIR,
  psQuote,
  escapeRegex,
  clampNumber,
  normalizePayload,
  normalizeSimpleText,
  normalizeUrl,
  isSafeUrlLike,
  isSafeProcessName,
  isSafeLaunchName,
  isSafeHost,
  safeDesktopPath,
  requiresConfirmation,
  summarizeAction,
  validateActions,
};
