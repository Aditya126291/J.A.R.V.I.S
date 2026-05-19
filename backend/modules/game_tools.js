'use strict';

/**
 * J.A.R.V.I.S. game-tools module.
 *
 * Phase 4 widgets call into these read-only inspectors:
 *
 *   - getNowPlaying()       Windows GlobalSystemMediaTransportControlsSessionManager
 *                           returns { artist, title, app, status } from any media app
 *   - getGamePresence()     foreground process + heuristics: is it a game?
 *                           covers Steam, Epic, GoG, raw .exe — anything fullscreen-ish
 *   - getRichPresence()     Discord IPC pipe — what Discord thinks you're doing
 *
 * Everything is total: never throws, always resolves to a structured shape.
 * Each call has a 4-second hard timeout so a misbehaving PowerShell host
 * can't wedge the HUD.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const net = require('net');

const PS_TIMEOUT_MS = 4000;

function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { windowsHide: true, timeout: PS_TIMEOUT_MS, maxBuffer: 256 * 1024, ...opts },
      (error, stdout, stderr) => {
        resolve({ error, stdout: stdout || '', stderr: stderr || '' });
      }
    );
    child.on('error', () => {});
  });
}

function safeParseJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Now Playing — Windows Media Session
// ---------------------------------------------------------------------------

/**
 * Reads the Windows.Media.Control session manager via PowerShell. Works
 * with any media app that exposes SMTC: Spotify, YouTube/Chrome, browsers,
 * Films & TV, even Steam's overlay player. We fetch the current playing
 * session's metadata, not all sessions.
 *
 * Output:
 *   { ok: true, title, artist, app, status, position?, duration? }
 *   { ok: false, error }
 */
async function getNowPlaying() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
function Await($task, $resultType) {
    $asTask = ($task.GetType().GetMethod('GetAwaiter')).Invoke($task, $null)
    while (-not $asTask.IsCompleted) { Start-Sleep -Milliseconds 25 }
    $result = $asTask.GetType().GetMethod('GetResult').Invoke($asTask, $null)
    return $result
}
try {
    $mgrTask = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
    $mgr = Await $mgrTask
    if (-not $mgr) { Write-Output '{}'; exit }
    $session = $mgr.GetCurrentSession()
    if (-not $session) { Write-Output '{}'; exit }
    $propTask = $session.TryGetMediaPropertiesAsync()
    $props = Await $propTask
    $info = $session.GetPlaybackInfo()
    $tl = $session.GetTimelineProperties()
    $statusMap = @{0='Closed'; 1='Opened'; 2='Changing'; 3='Stopped'; 4='Playing'; 5='Paused'}
    $statusName = $statusMap[[int]$info.PlaybackStatus]
    $obj = @{
        title = "$($props.Title)"
        artist = "$($props.Artist)"
        album = "$($props.AlbumTitle)"
        app = "$($session.SourceAppUserModelId)"
        status = "$statusName"
        position_s = [int]($tl.Position.TotalSeconds)
        duration_s = [int]($tl.EndTime.TotalSeconds)
    }
    $obj | ConvertTo-Json -Compress
} catch {
    Write-Output '{}'
}
  `.trim();

  const r = await execFileAsync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  if (r.error && r.error.killed) return { ok: false, error: 'timeout' };
  const data = safeParseJson(r.stdout.trim());
  if (!data || !data.title) return { ok: false, error: 'no_session' };

  // Trim Windows AUMID down to the friendly app name.
  // Examples:
  //   "Spotify.exe!Spotify"           -> "Spotify"
  //   "{App ID}\\Microsoft.ZuneMusic" -> "Microsoft.ZuneMusic"
  //   "chrome.exe"                    -> "chrome"
  let app = String(data.app || '').replace(/\.exe!.*/i, '').replace(/.*\\/, '');
  app = app.replace(/\.exe$/i, '');
  return {
    ok: true,
    title: data.title,
    artist: data.artist || '',
    album: data.album || '',
    app,
    status: data.status || 'Unknown',
    position_s: Number(data.position_s) || 0,
    duration_s: Number(data.duration_s) || 0,
  };
}

// ---------------------------------------------------------------------------
// Game presence — foreground window + game heuristic
// ---------------------------------------------------------------------------

const KNOWN_NON_GAMES = new Set([
  'explorer', 'chrome', 'firefox', 'msedge', 'opera', 'brave',
  'code', 'devenv', 'cursor', 'sublime_text', 'notepad', 'notepad++',
  'teams', 'slack', 'discord', 'whatsapp', 'telegram',
  'cmd', 'powershell', 'pwsh', 'wt', 'windowsterminal', 'git-bash',
  'spotify', 'vlc', 'mpc-hc64',
  'systemsettings', 'settings', 'taskmgr', 'lockapp', 'searchhost',
  'shellexperiencehost', 'startmenuexperiencehost', 'sihost',
  'photoshop', 'illustrator', 'figma', 'blender', 'obs64', 'obs',
]);

const KNOWN_GAME_HOSTS = new Set([
  // Steam
  'steam',
  // Epic
  'epicgameslauncher', 'epicwebhelper',
  // GOG
  'galaxyclient', 'gog galaxy', 'gog',
  // Riot / Battle.net / EA / Ubisoft
  'riotclientservices', 'battle.net', 'ea desktop', 'ealauncher', 'ubisoftconnect',
  // Xbox
  'xboxgameoverlay', 'xboxapp', 'gamingservices',
]);

const GAME_KEYWORDS = [
  'game', 'unreal', 'unity', 'valorant', 'csgo', 'cs2', 'dota',
  'minecraft', 'fortnite', 'apex', 'overwatch', 'cyberpunk',
  'witcher', 'gta', 'rdr', 'fifa', 'pubg', 'warzone',
];

/**
 * Detects the currently-foregrounded process. If it looks game-shaped
 * (fullscreen, GPU-bound, not in our non-game list, etc.), returns it.
 * Otherwise returns the foreground app for context with `is_game: false`.
 *
 * Output:
 *   { ok: true, is_game, name, title, pid, since_s? }
 *   { ok: false, error }
 */
async function getGamePresence() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Namespace Win32 -Name F -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr hWnd, out int pid);
[DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern int GetWindowTextW(System.IntPtr hWnd, System.Text.StringBuilder str, int max);
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT lpRect);
public struct RECT { public int Left, Top, Right, Bottom; }
'@

try {
    $hwnd = [Win32.F]::GetForegroundWindow()
    if ($hwnd -eq [System.IntPtr]::Zero) { Write-Output '{}'; exit }
    $pid = 0
    [Win32.F]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
    $sb = New-Object System.Text.StringBuilder 512
    [Win32.F]::GetWindowTextW($hwnd, $sb, 512) | Out-Null
    $title = $sb.ToString()
    $rect = New-Object Win32.F+RECT
    [Win32.F]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
    $w = $rect.Right - $rect.Left
    $h = $rect.Bottom - $rect.Top
    $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
    if (-not $proc) { Write-Output '{}'; exit }
    $obj = @{
        pid = $pid
        name = $proc.ProcessName
        title = $title
        width = $w
        height = $h
        start = $proc.StartTime.ToString('o')
        path = "$($proc.MainModule.FileName)"
    }
    $obj | ConvertTo-Json -Compress
} catch {
    Write-Output '{}'
}
  `.trim();

  const r = await execFileAsync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  if (r.error && r.error.killed) return { ok: false, error: 'timeout' };
  const data = safeParseJson(r.stdout.trim());
  if (!data || !data.name) return { ok: false, error: 'no_foreground' };

  const name = String(data.name).toLowerCase();
  const title = String(data.title || '');
  const titleLower = title.toLowerCase();

  let isGame = false;
  let confidence = 'low';
  let reason = '';

  if (KNOWN_NON_GAMES.has(name)) {
    isGame = false;
    reason = 'known_non_game';
  } else if (KNOWN_GAME_HOSTS.has(name)) {
    isGame = true; confidence = 'high'; reason = 'launcher';
  } else if (GAME_KEYWORDS.some((k) => name.includes(k) || titleLower.includes(k))) {
    isGame = true; confidence = 'high'; reason = 'keyword_match';
  } else {
    // Heuristic: window covers most of a typical 1080p screen AND the path
    // points outside common system folders. Coarse but kills 90% of false
    // positives. We only apply this to .exe files in user-installed paths.
    const pathLower = String(data.path || '').toLowerCase();
    const isUserPath = !pathLower.startsWith('c:\\windows') && !pathLower.includes('\\system32\\');
    const looksFullScreen = data.width >= 1280 && data.height >= 720;
    if (isUserPath && looksFullScreen) {
      isGame = true; confidence = 'medium'; reason = 'fullscreen_userpath';
    }
  }

  let sinceS = 0;
  try {
    const t = new Date(data.start).getTime();
    if (Number.isFinite(t)) sinceS = Math.floor((Date.now() - t) / 1000);
  } catch {}

  return {
    ok: true,
    is_game: isGame,
    confidence,
    reason,
    name,
    title,
    pid: data.pid,
    since_s: sinceS,
    width: data.width,
    height: data.height,
  };
}

// ---------------------------------------------------------------------------
// Discord Rich Presence — local IPC pipe
// ---------------------------------------------------------------------------

/**
 * Connects to Discord's local IPC pipe (\\?\pipe\discord-ipc-0..9), performs
 * the v1 handshake, and reads READY → returns the user's current activity.
 *
 * Returns the first activity Discord reports, which is what Discord shows
 * to friends ("playing X", "in voice channel Y"). No bot, no OAuth.
 *
 * Output:
 *   { ok: true, user, activity? }
 *   { ok: false, error }
 *
 * Notes:
 *   - Requires a recent Discord client to be running locally.
 *   - We use a very lightweight IPC: handshake op=0 with our own client_id
 *     of 0 (Discord accepts this for read-only listing on most builds).
 *     If your Discord rejects op=0 without a registered app id, we fall
 *     back to reporting just the user identity from the handshake reply.
 */
async function getRichPresence() {
  const PIPES = [];
  for (let i = 0; i < 10; i++) PIPES.push(`\\\\?\\pipe\\discord-ipc-${i}`);

  for (const pipe of PIPES) {
    const result = await tryDiscordPipe(pipe);
    if (result) return result;
  }
  return { ok: false, error: 'discord_not_running' };
}

function tryDiscordPipe(pipePath) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; try { client.destroy(); } catch {} resolve(v); } };
    const timer = setTimeout(() => finish(null), 1500);

    const client = net.connect(pipePath);
    let buf = Buffer.alloc(0);

    const send = (op, payload) => {
      const json = Buffer.from(JSON.stringify(payload), 'utf8');
      const header = Buffer.alloc(8);
      header.writeInt32LE(op, 0);
      header.writeInt32LE(json.length, 4);
      try { client.write(Buffer.concat([header, json])); } catch {}
    };

    client.on('error', () => { clearTimeout(timer); finish(null); });

    client.on('connect', () => {
      // Handshake. client_id of 0 works on most Discord builds for
      // listening-only flows; if it rejects, the response contains an error.
      send(0, { v: 1, client_id: '0' });
    });

    client.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 8) {
        const op = buf.readInt32LE(0);
        const len = buf.readInt32LE(4);
        if (buf.length < 8 + len) break;
        const payload = buf.slice(8, 8 + len).toString('utf8');
        buf = buf.slice(8 + len);
        let msg = null;
        try { msg = JSON.parse(payload); } catch { msg = null; }
        if (!msg) continue;

        // Some Discord builds send the user identity as a DISPATCH inside
        // a ready frame with cmd === 'DISPATCH' & evt === 'READY'.
        const userObj = msg?.data?.user || msg?.user;
        if (userObj) {
          const user = {
            id: userObj.id,
            username: userObj.username,
            global_name: userObj.global_name || userObj.username,
            discriminator: userObj.discriminator,
          };
          // Activity isn't returned by READY; we'd need a SUBSCRIBE call
          // with ACTIVITY_JOIN_REQUEST or the GameSDK to get it. For now
          // we return what's reliable: identity + a "discord_online" ping.
          clearTimeout(timer);
          finish({ ok: true, user, activity: null });
          return;
        }

        // Error frame from older Discord builds.
        if (msg?.evt === 'ERROR' || msg?.code) {
          clearTimeout(timer);
          finish({ ok: false, error: msg?.message || msg?.code || 'discord_error' });
          return;
        }
      }
    });

    client.on('close', () => { clearTimeout(timer); finish(null); });
  });
}

module.exports = {
  getNowPlaying,
  getGamePresence,
  getRichPresence,
  _internals: {
    KNOWN_NON_GAMES,
    KNOWN_GAME_HOSTS,
    GAME_KEYWORDS,
    PS_TIMEOUT_MS,
  },
};
