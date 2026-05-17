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
};

const CLOSE_MAP = {
  chrome: 'chrome.exe',
  'google chrome': 'chrome.exe',
  firefox: 'firefox.exe',
  edge: 'msedge.exe',
  'microsoft edge': 'msedge.exe',
  youtube: 'chrome.exe',
  google: 'chrome.exe',
  gmail: 'chrome.exe',
  github: 'chrome.exe',
  twitter: 'chrome.exe',
  x: 'chrome.exe',
  instagram: 'chrome.exe',
  facebook: 'chrome.exe',
  linkedin: 'chrome.exe',
  reddit: 'chrome.exe',
  chatgpt: 'chrome.exe',
  netflix: 'chrome.exe',
  amazon: 'chrome.exe',
  notepad: 'notepad.exe',
  paint: 'mspaint.exe',
  word: 'WINWORD.EXE',
  excel: 'EXCEL.EXE',
  powerpoint: 'POWERPNT.EXE',
  vscode: 'Code.exe',
  'visual studio code': 'Code.exe',
  'vs code': 'Code.exe',
  cmd: 'cmd.exe',
  powershell: 'powershell.exe',
  terminal: 'WindowsTerminal.exe',
  'file explorer': 'explorer.exe',
  explorer: 'explorer.exe',
  'task manager': 'Taskmgr.exe',
  discord: 'Discord.exe',
  telegram: 'Telegram.exe',
  whatsapp: 'WhatsApp.exe',
  vlc: 'vlc.exe',
  obs: 'obs64.exe',
  spotify: 'Spotify.exe',
  calculator: 'CalculatorApp.exe',
  'snipping tool': 'SnippingTool.exe',
  camera: 'WindowsCamera.exe',
  photos: 'Microsoft.Photos.exe',
  settings: 'SystemSettings.exe',
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
    'sort_downloads',
    'empty_recycle_bin',
  ]),
  productivity: new Set(['create_note']),
  network: new Set(['ping', 'wifi_enable', 'wifi_disable']),
  workspace: new Set(['focus_mode', 'coding_mode']),
  message: new Set(['send']),
};

const RISKY_ACTIONS = new Set([
  'power:sleep',
  'power:restart',
  'power:shutdown',
  'network:wifi_enable',
  'network:wifi_disable',
  'files:delete',
  'files:empty_recycle_bin',
  'files:sort_downloads',
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
  if (trimmed.includes('..')) return false;
  if (/[\\/:*?"<>|]/.test(trimmed)) return false;
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
  return /^[a-z0-9.-]+\.(com|org|in|net|io|ai|dev|app)(\/.*)?$/i.test(trimmed);
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
  if (payload.module === 'files') return `${payload.action.replace(/_/g, ' ')}${value ? ` ${value}` : ''}`;
  return `${payload.module} ${payload.action}`;
}

function normalizePayload(input) {
  if (!isPlainObject(input)) {
    return { ok: false, error: 'Payload must be an object.' };
  }

  const moduleName = normalizeSimpleText(input.module, 40).toLowerCase();
  const action = normalizeSimpleText(input.action, 60).toLowerCase();
  if (!VALID_ACTIONS[moduleName] || !VALID_ACTIONS[moduleName].has(action)) {
    return { ok: false, error: `Unsupported command: ${moduleName}.${action}` };
  }

  let value = input.value ?? null;

  if (moduleName === 'apps') {
    if (action === 'automate') {
      if (!isPlainObject(value) || !normalizeSimpleText(value.app, 80) || !Array.isArray(value.sequence)) {
        return { ok: false, error: 'Invalid app automation payload.' };
      }
      value = {
        app: normalizeSimpleText(value.app, 80),
        sequence: value.sequence.slice(0, 20).map((step) => normalizeSimpleText(String(step), 300)),
      };
    } else {
      value = normalizeSimpleText(value, 160).toLowerCase();
      if (!value) return { ok: false, error: 'App target required.' };
    }
  } else if (moduleName === 'system') {
    if (action === 'volume_set' || action === 'brightness_set') {
      value = clampNumber(value, 0, 100);
      if (value === null) return { ok: false, error: 'Value must be a number from 0 to 100.' };
    } else if (action === 'brightness_adjust') {
      value = clampNumber(value, -100, 100);
      if (value === null || value === 0) return { ok: false, error: 'Brightness adjustment must be a non-zero number.' };
    } else {
      value = null;
    }
  } else if (moduleName === 'power' || moduleName === 'media' || moduleName === 'workspace') {
    value = null;
  } else if (moduleName === 'network') {
    if (action === 'ping') {
      value = normalizeSimpleText(value || 'google.com', 253);
      if (!isSafeHost(value)) return { ok: false, error: 'Ping target must be a valid host name.' };
    } else {
      value = null;
    }
  } else if (moduleName === 'files') {
    if (action === 'create_folder' || action === 'create_file' || action === 'delete') {
      value = normalizeSimpleText(value, 120);
      if (!isSafeDesktopName(value)) return { ok: false, error: 'Use a simple Desktop file or folder name.' };
    } else {
      value = null;
    }
  } else if (moduleName === 'productivity') {
    value = normalizeSimpleText(value, 1000);
    if (!value) return { ok: false, error: 'Note content required.' };
  } else if (moduleName === 'message') {
    if (!isPlainObject(value)) return { ok: false, error: 'Message payload must be an object.' };
    value = {
      app: normalizeSimpleText(value.app, 40).toLowerCase(),
      contact: normalizeSimpleText(value.contact, 120),
      message: normalizeSimpleText(value.message, 1000),
    };
    if (!['whatsapp', 'telegram'].includes(value.app)) {
      return { ok: false, error: 'Messaging supports WhatsApp and Telegram only.' };
    }
    if (!value.contact || !value.message) {
      return { ok: false, error: 'Message contact and text are required.' };
    }
  }

  const payload = { module: moduleName, action, value };
  return { ok: true, payload, requiresConfirmation: requiresConfirmation(payload) };
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
};
