// backend/modules/global_hotkey.js
// Native in-process Windows global hotkey watcher & Push-to-Talk audio orchestrator for J.A.R.V.I.S.
// Uses uiohook-napi for global keyboard hooks + hardware_audio for native 16kHz mic recording & speaker output.

const { uIOhook, UiohookKey } = require('uiohook-napi');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

const hardwareAudio = require('./hardware_audio');
const aiRouter = require('./ai_router');

class GlobalHotkeyManager extends EventEmitter {
  constructor() {
    super();
    this.isHookRunning = false;
    this.sseClients = new Set();
    this.lastTriggerTime = 0;
    this.isAltDown = false;
  }

  init() {
    this.startWatcher();
  }

  startWatcher() {
    if (this.isHookRunning) return;

    try {
      uIOhook.on('keydown', (e) => {
        if (e.keycode === UiohookKey.Alt || e.keycode === UiohookKey.AltRight) {
          this.isAltDown = true;
        }

        // Trigger conditions:
        // 1. Right Alt (AltRight / AltGr) - keycode 3640
        // 2. F9 - keycode 67
        // 3. Right Ctrl - keycode 3613
        // 4. Alt + K (or Right Alt + K) - keycode 37 with Alt down
        const isRightAlt = e.keycode === UiohookKey.AltRight;
        const isF9 = e.keycode === UiohookKey.F9;
        const isRightCtrl = e.keycode === UiohookKey.CtrlRight;
        const isAltK = this.isAltDown && (e.keycode === UiohookKey.K || e.keycode === 37);

        if (isRightAlt || isF9 || isRightCtrl || isAltK) {
          const now = Date.now();
          if (now - this.lastTriggerTime < 350) return; // 350ms debounce
          this.lastTriggerTime = now;

          this.handleHotkeyPress();
        }
      });

      uIOhook.on('keyup', (e) => {
        if (e.keycode === UiohookKey.Alt || e.keycode === UiohookKey.AltRight) {
          this.isAltDown = false;
        }
      });

      uIOhook.start();
      this.isHookRunning = true;
      console.log('[GLOBAL-HOTKEY] Native in-process uiohook-napi hook active (Right Alt, Alt+K, F9, Right Ctrl).');
    } catch (err) {
      console.error('[GLOBAL-HOTKEY ERROR] Failed to start native hook:', err.message);
    }
  }

  async handleHotkeyPress() {
    this.focusJarvisWindow();

    if (!hardwareAudio.isRecording) {
      // 1. START RECORDING (Push-to-Talk Mode)
      hardwareAudio.startRecording(); // Native python plays subtle rising chime
      this.broadcastEvent({ type: 'audio_state', state: 'recording', hotkey: 'AltRight' });
    } else {
      // 2. STOP RECORDING & INGEST AUDIO DIRECTLY WITH GEMINI
      this.broadcastEvent({ type: 'audio_state', state: 'processing', hotkey: 'AltRight' });
      const recResult = await hardwareAudio.stopRecording(); // Native python plays subtle completion chime

      if (recResult && recResult.audio_base64 && recResult.duration >= 0.2) {
        console.log(`[GLOBAL-HOTKEY] Captured ${recResult.duration.toFixed(2)}s audio. Ingesting with Gemini...`);

        try {
          const aiResult = await aiRouter.chatAudio(recResult.audio_base64);

          // Broadcast user transcript & assistant speech to UI in parallel
          this.broadcastEvent({
            type: 'chat_result',
            userTranscript: aiResult.userTranscript,
            speech: aiResult.speech,
            actions: aiResult.actions,
            provider: aiResult.provider,
          });

          this.broadcastEvent({ type: 'audio_state', state: 'idle' });
        } catch (err) {
          console.error('[GLOBAL-HOTKEY PROCESSING ERROR]', err.message);
          this.broadcastEvent({ type: 'audio_state', state: 'idle', error: err.message });
        }
      } else {
        this.broadcastEvent({ type: 'audio_state', state: 'idle' });
      }
    }
  }

  focusJarvisWindow() {
    if (process.platform !== 'win32') return;
    try {
      const psScript = `
        $wshell = New-Object -ComObject WScript.Shell;
        $procs = Get-Process | Where-Object { $_.MainWindowTitle -match 'J.A.R.V.I.S|localhost:3000|React App|Control Center' };
        if ($procs) {
          $wshell.AppActivate($procs[0].Id);
        } else {
          $wshell.AppActivate('J.A.R.V.I.S');
        }
      `.replace(/\r?\n/g, ' ');
      exec(`powershell -NoProfile -NonInteractive -Command "${psScript}"`, () => {});
    } catch (_) {}
  }

  broadcastEvent(payload) {
    const eventData = JSON.stringify({ ...payload, timestamp: Date.now() });
    this.emit('event', payload);

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

  // Alias for backward compatibility
  broadcastHotkey(payload) {
    this.broadcastEvent({ type: 'hotkey', ...payload });
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
    if (this.isHookRunning) {
      try {
        uIOhook.stop();
      } catch (_) {}
      this.isHookRunning = false;
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
