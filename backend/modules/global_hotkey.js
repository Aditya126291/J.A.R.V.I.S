// backend/modules/global_hotkey.js
// Global hotkey watcher for J.A.R.V.I.S.
// Uses a Python script (hotkey_watcher.py) with direct ctypes Win32 API calls
// to capture Right Alt / F9 / Right Ctrl globally across the entire OS,
// and broadcasts events to connected clients via Server-Sent Events (SSE).

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class GlobalHotkeyManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.isShuttingDown = false;
    this.sseClients = new Set();
    this.pyScriptPath = path.join(__dirname, '..', 'scripts', 'hotkey_watcher.py');
  }

  init() {
    if (process.platform !== 'win32') {
      console.log('[GLOBAL-HOTKEY] Global hotkey listener is only supported on Windows.');
      return;
    }
    this.isShuttingDown = false;
    this.startWatcher();
  }

  startWatcher() {
    if (this.process) return;

    if (!fs.existsSync(this.pyScriptPath)) {
      console.error('[GLOBAL-HOTKEY] hotkey_watcher.py not found at:', this.pyScriptPath);
      return;
    }

    try {
      // Spawn Python with unbuffered output (-u) for real-time stdout
      this.process = spawn('python', ['-u', this.pyScriptPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let buffer = '';

      this.process.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop(); // keep incomplete line remainder

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === 'INITIALIZED') {
            console.log('[GLOBAL-HOTKEY] Python Win32 hotkey listener active (Right Alt / F9 / Right Ctrl).');
          } else if (trimmed === 'KEYDOWN:AltRight') {
            this.broadcastHotkey({ key: 'AltRight', state: 'down' });
          } else if (trimmed === 'KEYUP:AltRight') {
            this.broadcastHotkey({ key: 'AltRight', state: 'up' });
          }
        }
      });

      this.process.stderr.on('data', (err) => {
        const msg = err.toString().trim();
        if (msg) {
          console.warn('[GLOBAL-HOTKEY WARN]', msg);
        }
      });

      this.process.on('exit', (code) => {
        this.process = null;
        if (!this.isShuttingDown) {
          console.log(`[GLOBAL-HOTKEY] Watcher exited with code ${code}. Restarting in 2s...`);
          setTimeout(() => this.startWatcher(), 2000);
        }
      });

      this.process.on('error', (err) => {
        console.error('[GLOBAL-HOTKEY ERROR]', err.message);
      });
    } catch (e) {
      console.error('[GLOBAL-HOTKEY LAUNCH ERROR]', e.message);
    }
  }

  broadcastHotkey(payload) {
    const eventData = JSON.stringify({ type: 'hotkey', ...payload, timestamp: Date.now() });
    this.emit('hotkey', payload);
    console.log(`[GLOBAL-HOTKEY] Key ${payload.key} (${payload.state}) -> sent to ${this.sseClients.size} frontend client(s)`);

    for (const client of this.sseClients) {
      try {
        if (!client.writableEnded) {
          client.write(`data: ${eventData}\n\n`);
          if (typeof client.flush === 'function') client.flush();
        }
      } catch (e) {
        this.sseClients.delete(client);
      }
    }
  }

  registerSseClient(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Send initial handshake
    res.write(`data: ${JSON.stringify({ type: 'connected', service: 'global_hotkey', hotkey: 'AltRight' })}\n\n`);
    this.sseClients.add(res);
    console.log(`[GLOBAL-HOTKEY] Frontend connected to hotkey stream. Total active listeners: ${this.sseClients.size}`);

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': hb\n\n');
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      this.sseClients.delete(res);
      console.log(`[GLOBAL-HOTKEY] Frontend disconnected from hotkey stream. Remaining listeners: ${this.sseClients.size}`);
    });
  }

  launchAppWindow(url = 'http://localhost:3000') {
    const chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];

    for (const exe of chromePaths) {
      if (fs.existsSync(exe)) {
        try {
          spawn(exe, [`--app=${url}`, '--window-size=1280,820'], {
            detached: true,
            stdio: 'ignore',
          }).unref();
          console.log(`[GLOBAL-HOTKEY] Launched dedicated desktop window via ${exe}`);
          return { success: true, exe };
        } catch (e) {
          console.warn('[GLOBAL-HOTKEY] Launch error:', e.message);
        }
      }
    }
    return { success: false, error: 'No Chromium browser found' };
  }

  stop() {
    this.isShuttingDown = true;
    if (this.process) {
      try {
        this.process.kill();
      } catch (_) {}
      this.process = null;
    }
    for (const client of this.sseClients) {
      try {
        client.end();
      } catch (_) {}
    }
    this.sseClients.clear();
  }
}

const globalHotkeyManager = new GlobalHotkeyManager();
module.exports = globalHotkeyManager;
