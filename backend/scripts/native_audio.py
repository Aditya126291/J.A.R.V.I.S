"""
J.A.R.V.I.S Native Hardware Audio Engine
Handles 16kHz PCM hardware mic recording and speaker playback on Windows.
Runs as a persistent background process communicating via stdin/stdout JSON.
"""

import sys
import json
import io
import wave
import base64
import threading
import numpy as np
import sounddevice as sd

# Audio recording configuration
SAMPLE_RATE = 16000
CHANNELS = 1
DTYPE = 'int16'

_recording = False
_audio_frames = []
_stream = None
_lock = threading.Lock()

def generate_chime_samples(chime_type='start'):
    """Generate futuristic harmonic chime audio samples."""
    fs = 24000
    if chime_type == 'start':
        # Rising harmonic tone (E5 -> C6 with E6 overtone)
        dur = 0.20
        t = np.linspace(0, dur, int(fs * dur), False)
        freq1 = np.linspace(659.25, 1046.5, len(t))
        freq2 = 1318.5
        env = np.exp(-t * 18.0)
        signal = (np.sin(2 * np.pi * freq1 * t) * 0.4 + np.sin(2 * np.pi * freq2 * t) * 0.2) * env
    else:
        # Descending completion tone (C6 -> G5)
        dur = 0.16
        t = np.linspace(0, dur, int(fs * dur), False)
        freq = np.linspace(1046.5, 783.99, len(t))
        env = np.exp(-t * 22.0)
        signal = (np.sin(2 * np.pi * freq * t) * 0.4) * env

    return (signal * 0.25).astype(np.float32), fs

def play_chime_sync(chime_type='start'):
    try:
        samples, fs = generate_chime_samples(chime_type)
        sd.play(samples, fs)
        sd.wait()
    except Exception as e:
        pass

def audio_callback(indata, frames, time_info, status):
    global _audio_frames
    with _lock:
        if _recording:
            _audio_frames.append(indata.copy())

def start_recording():
    global _recording, _audio_frames, _stream
    with _lock:
        _audio_frames = []
        _recording = True
    
    # Play subtle activation chime asynchronously in background thread
    threading.Thread(target=play_chime_sync, args=('start',), daemon=True).start()

    if _stream is None:
        _stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype=DTYPE,
            callback=audio_callback
        )
        _stream.start()

def stop_recording():
    global _recording, _audio_frames, _stream
    with _lock:
        _recording = False
        captured = list(_audio_frames)
        _audio_frames = []

    # Play completion chime asynchronously in background
    threading.Thread(target=play_chime_sync, args=('stop',), daemon=True).start()

    if captured:
        audio_data = np.concatenate(captured, axis=0)
    else:
        audio_data = np.zeros((0, CHANNELS), dtype=DTYPE)

    # Encode to in-memory WAV
    wav_io = io.BytesIO()
    with wave.open(wav_io, 'wb') as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2) # 16-bit
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio_data.tobytes())

    wav_bytes = wav_io.getvalue()
    b64_str = base64.b64encode(wav_bytes).decode('utf-8')
    duration_sec = len(audio_data) / SAMPLE_RATE

    return {
        "success": True,
        "audio_base64": b64_str,
        "duration": duration_sec,
        "sample_rate": SAMPLE_RATE,
        "samples": len(audio_data)
    }

def play_audio_base64(b64_data):
    try:
        raw_bytes = base64.b64decode(b64_data)
        wav_io = io.BytesIO(raw_bytes)
        with wave.open(wav_io, 'rb') as wf:
            fs = wf.getframerate()
            nchannels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            data = wf.readframes(wf.getnframes())

            if sampwidth == 2:
                samples = np.frombuffer(data, dtype=np.int16)
            elif sampwidth == 4:
                samples = np.frombuffer(data, dtype=np.int32)
            else:
                samples = np.frombuffer(data, dtype=np.uint8)

            if nchannels > 1:
                samples = samples.reshape(-1, nchannels)

            sd.play(samples, fs)
            sd.wait()
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

def main():
    print(json.dumps({"status": "READY"}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd_data = json.loads(line)
            action = cmd_data.get("cmd")

            if action == "start_record":
                start_recording()
                print(json.dumps({"status": "RECORDING_STARTED"}), flush=True)

            elif action == "stop_record":
                res = stop_recording()
                print(json.dumps(res), flush=True)

            elif action == "play_chime":
                chime_type = cmd_data.get("type", "start")
                threading.Thread(target=play_chime_sync, args=(chime_type,), daemon=True).start()
                print(json.dumps({"status": "CHIME_TRIGGERED"}), flush=True)

            elif action == "play_audio":
                b64 = cmd_data.get("base64", "")
                threading.Thread(target=play_audio_base64, args=(b64,), daemon=True).start()
                print(json.dumps({"status": "PLAYBACK_STARTED"}), flush=True)

            elif action == "ping":
                print(json.dumps({"status": "PONG"}), flush=True)

            elif action == "exit":
                break

        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}), flush=True)

if __name__ == '__main__':
    main()
