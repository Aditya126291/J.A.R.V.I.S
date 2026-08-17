// backend/modules/hardware_audio.js
// High-performance hardware audio interface for J.A.R.V.I.S.
// Communicates with native_audio.py for 16kHz PCM hardware mic capture & speaker output.

const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

class HardwareAudioManager extends EventEmitter {
  constructor() {
    super();
    this.pyProcess = null;
    this.isRecording = false;
    this.pendingStopResolve = null;
    this.pyScriptPath = path.join(__dirname, '..', 'scripts', 'native_audio.py');
    this.init();
  }

  init() {
    if (this.pyProcess) return;

    try {
      this.pyProcess = spawn('python', ['-u', this.pyScriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let buffer = '';

      this.pyProcess.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop(); // Keep remainder

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const data = JSON.parse(trimmed);
            if (data.status === 'READY') {
              console.log('[HARDWARE-AUDIO] Native microphone & speaker engine online.');
            } else if (data.status === 'RECORDING_STARTED') {
              this.isRecording = true;
              this.emit('recording_started');
            } else if (data.audio_base64 && this.pendingStopResolve) {
              this.isRecording = false;
              const resolve = this.pendingStopResolve;
              this.pendingStopResolve = null;
              resolve(data);
            }
          } catch (_) {}
        }
      });

      this.pyProcess.stderr.on('data', (err) => {
        const msg = err.toString().trim();
        if (msg) console.warn('[HARDWARE-AUDIO WARN]', msg);
      });

      this.pyProcess.on('exit', (code) => {
        this.pyProcess = null;
        this.isRecording = false;
        console.log(`[HARDWARE-AUDIO] Engine exited (${code}). Auto-restarting in 2s...`);
        setTimeout(() => this.init(), 2000);
      });

      this.pyProcess.on('error', (err) => {
        console.error('[HARDWARE-AUDIO ERROR]', err.message);
      });
    } catch (e) {
      console.error('[HARDWARE-AUDIO LAUNCH ERROR]', e.message);
    }
  }

  startRecording() {
    if (!this.pyProcess || this.isRecording) return;
    this.isRecording = true;
    this.sendCommand({ cmd: 'start_record' });
    console.log('[HARDWARE-AUDIO] Push-to-Talk recording started.');
  }

  stopRecording() {
    return new Promise((resolve) => {
      if (!this.pyProcess || !this.isRecording) {
        this.isRecording = false;
        resolve({ success: false, error: 'Not recording' });
        return;
      }

      this.pendingStopResolve = resolve;
      this.sendCommand({ cmd: 'stop_record' });
      console.log('[HARDWARE-AUDIO] Push-to-Talk recording stopped. Processing audio...');

      // Timeout fallback in 5 seconds
      setTimeout(() => {
        if (this.pendingStopResolve) {
          const cb = this.pendingStopResolve;
          this.pendingStopResolve = null;
          this.isRecording = false;
          cb({ success: false, error: 'Recording stop timeout' });
        }
      }, 5000);
    });
  }

  playChime(type = 'start') {
    this.sendCommand({ cmd: 'play_chime', type });
  }

  playAudio(base64Wav) {
    if (!base64Wav) return;
    this.sendCommand({ cmd: 'play_audio', base64: base64Wav });
  }

  sendCommand(cmdObj) {
    if (this.pyProcess && this.pyProcess.stdin && !this.pyProcess.stdin.destroyed) {
      try {
        this.pyProcess.stdin.write(JSON.stringify(cmdObj) + '\n');
      } catch (e) {
        console.warn('[HARDWARE-AUDIO] Send error:', e.message);
      }
    }
  }

  stop() {
    if (this.pyProcess) {
      try {
        this.sendCommand({ cmd: 'exit' });
        this.pyProcess.kill();
      } catch (_) {}
      this.pyProcess = null;
    }
  }
}

const hardwareAudio = new HardwareAudioManager();
module.exports = hardwareAudio;
