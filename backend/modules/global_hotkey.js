// backend/modules/global_hotkey.js
// Native Windows global hotkey watcher for J.A.R.V.I.S.
// Captures AltRight (VK_RMENU) globally across the entire operating system
// and broadcasts events to connected clients via Server-Sent Events (SSE).

const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

class GlobalHotkeyManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.isShuttingDown = false;
    this.sseClients = new Set();
    this.scriptPath = path.join(__dirname, '..', 'scripts', 'hotkey_listener.ps1');
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

    try {
      this.process = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        this.scriptPath,
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let buffer = '';

      this.process.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop(); // keep remainder

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === 'INITIALIZED') {
            console.log('[GLOBAL-HOTKEY] Windows OS-level hotkey listener active (Right Alt / AltRight).');
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

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': hb\n\n');
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      this.sseClients.delete(res);
    });
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
