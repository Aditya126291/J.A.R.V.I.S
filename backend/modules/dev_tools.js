'use strict';

/**
 * J.A.R.V.I.S. dev-tools module.
 *
 * Lightweight read-only inspectors for a configurable project root:
 *
 *   - getGitGlance(root)        branch, ahead/behind, dirty count, last commit
 *   - getProjectInfo(root)      package name, version, scripts (npm/yarn/pnpm)
 *   - getBuildFeed(root)        recent test/build run history (file-based)
 *   - recordBuildEvent(...)     internal: append a build event for the feed
 *   - getAntigravityWorkspaces() most-recent workspaces from Antigravity's
 *                               %APPDATA%\Antigravity\User\globalStorage\storage.json
 *   - openInAntigravity(path)   launches Antigravity on a workspace folder
 *
 * Defaults to the JARVIS workspace root. Callers can override via the
 * `JARVIS_PROJECT_ROOT` env var or per-request `?root=` query param,
 * which the route validates against a small allow-list to avoid arbitrary
 * filesystem reads from the HUD.
 *
 * All functions are total: every call returns a structured result object,
 * never throws, never blocks indefinitely. Git/npm calls run with a
 * 5-second hard timeout via `execFile`.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Roots: which directories the HUD is allowed to inspect.
// ---------------------------------------------------------------------------

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..'); // .../J.A.R.V.I.S
const DEFAULT_ROOT = process.env.JARVIS_PROJECT_ROOT || WORKSPACE_ROOT;

// Allow the workspace itself and any sibling under it. We never let the HUD
// peek outside the workspace tree, even with `?root=`.
function resolveRoot(rawRoot) {
  if (!rawRoot) return DEFAULT_ROOT;
  const candidate = path.resolve(rawRoot);
  const ws = path.resolve(WORKSPACE_ROOT) + path.sep;
  if (candidate === path.resolve(WORKSPACE_ROOT) || candidate.startsWith(ws)) {
    return candidate;
  }
  // Out-of-tree request: fall back to the default.
  return DEFAULT_ROOT;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024, ...opts },
      (error, stdout, stderr) => {
        resolve({ error, stdout: stdout || '', stderr: stderr || '' });
      }
    );
    child.on('error', () => { /* ENOENT etc — already captured by callback */ });
  });
}

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Git glance
// ---------------------------------------------------------------------------

async function getGitGlance(rawRoot) {
  const root = resolveRoot(rawRoot);
  if (!fs.existsSync(path.join(root, '.git'))) {
    return { ok: false, error: 'not_a_git_repo', root };
  }

  const opts = { cwd: root };

  // Run lookups in parallel where possible.
  const [branchR, statusR, logR, upstreamR] = await Promise.all([
    execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts),
    execFileAsync('git', ['status', '--porcelain'], opts),
    execFileAsync('git', ['log', '-1', '--pretty=%h%x09%s%x09%cr'], opts),
    execFileAsync('git', ['rev-list', '--left-right', '--count', 'HEAD...@{u}'], opts),
  ]);

  if (branchR.error && branchR.stderr) {
    // Most likely "git: command not found" or detached/empty repo.
    return { ok: false, error: 'git_unavailable', detail: String(branchR.stderr).trim().slice(0, 200), root };
  }

  const branch = branchR.stdout.trim() || 'HEAD';
  const dirtyLines = statusR.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const dirty = dirtyLines.length;
  const dirtyBreakdown = { staged: 0, modified: 0, untracked: 0 };
  for (const line of dirtyLines) {
    if (line.startsWith('??')) dirtyBreakdown.untracked += 1;
    else if (line[0] !== ' ') dirtyBreakdown.staged += 1;
    else dirtyBreakdown.modified += 1;
  }

  let ahead = 0;
  let behind = 0;
  let upstreamPresent = false;
  if (!upstreamR.error && upstreamR.stdout) {
    const m = upstreamR.stdout.trim().match(/^(\d+)\s+(\d+)/);
    if (m) {
      ahead = Number(m[1]);
      behind = Number(m[2]);
      upstreamPresent = true;
    }
  }

  let lastCommit = null;
  if (!logR.error && logR.stdout) {
    const [hash, subject, when] = logR.stdout.trim().split('\t');
    if (hash) lastCommit = { hash, subject: subject || '', when: when || '' };
  }

  return {
    ok: true,
    root,
    branch,
    dirty,
    dirtyBreakdown,
    ahead,
    behind,
    upstream: upstreamPresent,
    lastCommit,
  };
}

// ---------------------------------------------------------------------------
// Project info (reads package.json — no network call).
// ---------------------------------------------------------------------------

async function getProjectInfo(rawRoot) {
  const root = resolveRoot(rawRoot);

  // Walk up to two levels to find a package.json (HUD often points at the
  // workspace root, but the actual app is under backend/ or frontend/).
  const candidates = [
    root,
    path.join(root, 'frontend'),
    path.join(root, 'backend'),
  ];
  const projects = [];
  for (const dir of candidates) {
    const pkg = safeReadJson(path.join(dir, 'package.json'));
    if (!pkg) continue;
    projects.push({
      dir: path.basename(dir) === path.basename(root) ? '.' : path.basename(dir),
      name: pkg.name || path.basename(dir),
      version: pkg.version || '0.0.0',
      scripts: pkg.scripts && typeof pkg.scripts === 'object'
        ? Object.keys(pkg.scripts).slice(0, 8)
        : [],
      hasTypeScript: Boolean(pkg.devDependencies?.typescript || pkg.dependencies?.typescript),
      framework: detectFramework(pkg),
    });
  }

  if (projects.length === 0) {
    return { ok: false, error: 'no_package_json', root };
  }

  return { ok: true, root, projects };
}

function detectFramework(pkg) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps.react) return 'react';
  if (deps.next) return 'next';
  if (deps.vue) return 'vue';
  if (deps.svelte) return 'svelte';
  if (deps.express) return 'express';
  if (deps.fastify) return 'fastify';
  return 'node';
}

// ---------------------------------------------------------------------------
// Build/test feed (file-backed circular log).
//
// The router (or any other module) calls `recordBuildEvent` whenever a
// test/build event happens. The feed file is JSON Lines under
// `<root>/.kiro/build-feed.log` so it survives a backend restart and is
// trivially tailable. Capped at 50 entries via head-truncation on append.
// ---------------------------------------------------------------------------

const FEED_BASENAME = path.join('.kiro', 'build-feed.log');
const FEED_MAX_ENTRIES = 50;

function feedPath(root) {
  return path.join(root, FEED_BASENAME);
}

function ensureFeedDir(p) {
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch {}
}

async function getBuildFeed(rawRoot) {
  const root = resolveRoot(rawRoot);
  const p = feedPath(root);
  if (!fs.existsSync(p)) return { ok: true, root, events: [] };
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const events = [];
    for (const line of lines.slice(-FEED_MAX_ENTRIES)) {
      try { events.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
    return { ok: true, root, events };
  } catch (e) {
    return { ok: false, root, error: e.message };
  }
}

function recordBuildEvent(rawRoot, event) {
  const root = resolveRoot(rawRoot);
  const p = feedPath(root);
  ensureFeedDir(p);
  const entry = {
    ts: Date.now(),
    type: event?.type || 'event',
    label: String(event?.label || '').slice(0, 120),
    status: event?.status || 'unknown', // pass | fail | running | unknown
    detail: String(event?.detail || '').slice(0, 400),
  };
  try {
    // Read → trim to last (FEED_MAX_ENTRIES-1) → append → write atomically.
    let lines = [];
    if (fs.existsSync(p)) {
      lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    }
    lines.push(JSON.stringify(entry));
    if (lines.length > FEED_MAX_ENTRIES) lines = lines.slice(lines.length - FEED_MAX_ENTRIES);
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, lines.join('\n') + '\n', 'utf8');
    fs.renameSync(tmp, p);
    return { ok: true, entry };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  getGitGlance,
  getProjectInfo,
  getBuildFeed,
  recordBuildEvent,
  // Antigravity helpers and the constants below are re-exported after their
  // definitions further down — see the trailing block at the bottom of the
  // file. Don't reference them here; `const` declarations don't hoist.
  // Exposed for tests / route wiring.
  _internals: {
    DEFAULT_ROOT,
    WORKSPACE_ROOT,
    resolveRoot,
    feedPath,
    FEED_MAX_ENTRIES,
  },
};


// ---------------------------------------------------------------------------
// Antigravity workspaces — read-only inspector + launcher
//
// Source files (per the user's environment):
//   - %APPDATA%\Antigravity\User\globalStorage\storage.json (preferred,
//     plain JSON; key path: profileAssociations.workspaces)
//   - %APPDATA%\Antigravity\User\globalStorage\state.vscdb (SQLite,
//     ItemTable key 'history.recentlyOpenedPathsList' — fallback only,
//     skipped here to avoid the sqlite3 native dependency)
//
// Launchers:
//   - %LOCALAPPDATA%\Programs\Antigravity\bin\antigravity.cmd  (preferred)
//   - %LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe       (fallback)
// ---------------------------------------------------------------------------

const ANTIGRAVITY_STORAGE_JSON =
  path.join(process.env.APPDATA || '', 'Antigravity', 'User', 'globalStorage', 'storage.json');

const ANTIGRAVITY_LAUNCHERS = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity', 'bin', 'antigravity.cmd'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity', 'Antigravity.exe'),
];

/**
 * Decode a `file:///` URI into a Windows-friendly absolute path.
 * Antigravity stores entries like `file:///c%3A/Users/.../J.A.R.V.I.S` —
 * we reverse the URL encoding and the leading slash so callers get
 * `C:\Users\...\J.A.R.V.I.S`.
 */
function fileUriToPath(uri) {
  if (typeof uri !== 'string') return null;
  if (!uri.startsWith('file://')) {
    // Some entries are bare paths; accept as-is.
    return uri;
  }
  let p = uri.replace(/^file:\/+/, '');
  try { p = decodeURIComponent(p); } catch { /* keep raw if decode fails */ }
  // On Windows the resulting path is `c:/Users/...`; normalise separators.
  if (/^[a-zA-Z]:/.test(p)) {
    return path.normalize(p.replace(/\//g, '\\'));
  }
  return path.normalize(p);
}

/**
 * Read Antigravity's recent workspaces list. Returns the entries in the
 * order they appear in `storage.json` (which roughly matches recency in the
 * VS Code-derived storage layer).
 *
 * Output:
 *   { ok: true, source, workspaces: [{ path, name, profile, exists }] }
 *   { ok: false, error }
 */
async function getAntigravityWorkspaces(opts = {}) {
  const limit = Number.isInteger(opts.limit) ? opts.limit : 12;
  const file = ANTIGRAVITY_STORAGE_JSON;
  if (!file || !fs.existsSync(file)) {
    return { ok: false, error: 'antigravity_not_installed' };
  }

  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { return { ok: false, error: 'storage_read_failed', detail: e.message }; }

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return { ok: false, error: 'storage_parse_failed' }; }

  const wsMap = parsed?.profileAssociations?.workspaces;
  if (!wsMap || typeof wsMap !== 'object') {
    return { ok: false, error: 'no_workspace_entries' };
  }

  const entries = [];
  for (const [uri, profile] of Object.entries(wsMap)) {
    const fsPath = fileUriToPath(uri);
    if (!fsPath) continue;
    let exists = false;
    try { exists = fs.existsSync(fsPath); } catch { exists = false; }
    entries.push({
      path: fsPath,
      name: path.basename(fsPath) || fsPath,
      profile: typeof profile === 'string' ? profile : '__default__profile__',
      exists,
    });
    if (entries.length >= limit) break;
  }

  if (entries.length === 0) {
    return { ok: false, error: 'no_workspace_entries' };
  }

  return { ok: true, source: 'storage.json', workspaces: entries };
}

/**
 * Resolve the best Antigravity launcher present on disk.
 */
function findAntigravityLauncher() {
  for (const candidate of ANTIGRAVITY_LAUNCHERS) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Launch Antigravity on a folder. Returns { success, error? }; never throws.
 * `mode` controls window reuse:
 *   - 'reuse' (default): opens the path in the active window (-r)
 *   - 'new': forces a new window (-n)
 *   - 'add': adds the folder to the current window (-a)
 *
 * Path safety: we resolve to an absolute Windows path and require it to
 * exist on disk before spawning. This keeps the HUD from ever pointing
 * Antigravity at an unresolved or maliciously crafted target.
 */
function openInAntigravity(targetPath, mode = 'reuse') {
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    return { success: false, error: 'path_required' };
  }
  const abs = path.resolve(targetPath);
  if (!fs.existsSync(abs)) {
    return { success: false, error: 'path_not_found', path: abs };
  }
  const launcher = findAntigravityLauncher();
  if (!launcher) {
    return { success: false, error: 'launcher_not_found' };
  }

  const flag = mode === 'new' ? '-n' : mode === 'add' ? '-a' : '-r';
  const args = [flag, abs];

  try {
    // detached + unref so the spawned editor outlives this Node process and
    // doesn't pipe stdout back at us (the .cmd shim writes a banner).
    const child = spawn(launcher, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: launcher.endsWith('.cmd'), // .cmd needs a shell on Windows
    });
    child.on('error', () => { /* swallow — surfaced via the success flag */ });
    child.unref();
    return { success: true, launcher, mode, path: abs };
  } catch (e) {
    return { success: false, error: 'spawn_failed', detail: e.message };
  }
}


// Re-export the Antigravity surface now that the consts and functions
// above are fully initialised. (Prepending these to the module.exports
// block at the top of the file would hit the TDZ on `const`.)
module.exports.getAntigravityWorkspaces = getAntigravityWorkspaces;
module.exports.openInAntigravity = openInAntigravity;
module.exports._internals.ANTIGRAVITY_STORAGE_JSON = ANTIGRAVITY_STORAGE_JSON;
module.exports._internals.ANTIGRAVITY_LAUNCHERS = ANTIGRAVITY_LAUNCHERS;
module.exports._internals.fileUriToPath = fileUriToPath;
module.exports._internals.findAntigravityLauncher = findAntigravityLauncher;
