import React, { useCallback, useEffect, useRef, useState } from 'react';
import './blob.css';

/**
 * AIVoiceBlob — Iron Man / JARVIS holographic core.
 *
 * Pure SVG composition (no Three.js) so the HUD stays glassy at high FPS:
 *   - 4 concentric rings, each rotating at its own speed and direction
 *   - Engraved tick marks + segmented arcs ("Stark engineering" silhouette)
 *   - Inner glyph cluster (hexagon + crosshair + dots) that pulses with the AI
 *   - A radial scan sweep that rotates once every ~5s
 *   - Audio-reactive outer ring scale: lerps to mic / synthetic volume so it
 *     "breathes" while you talk and while JARVIS speaks
 *
 * Behavior preserved from the previous Three.js blob:
 *   - Reads the microphone (best-effort; silent failure if denied)
 *   - Honors `window.simulatedBlobVolumeTarget` from the TTS pipeline so it
 *     pulses when JARVIS is speaking
 *   - `blobConfig.isDraggingMode` lets the user reposition the blob; we
 *     dispatch position updates to `setBlobConfig` exactly as before
 *   - `blobConfig.size` and `blobConfig.sensitivity` still control the base
 *     scale and the audio response amount
 *
 * The accent color now follows the active theme automatically — every
 * stroke uses `currentColor`, and the wrapper sets `color` from the
 * `--accent` CSS variable. Switching dev↔gamer mode tints the entire blob.
 */

const RING_DEFS = [
  // Each ring has: radius, rotation seconds, dir (1 / -1), segment dasharray.
  { r: 230, sec: 60,  dir:  1, dash: '1 4',                stroke: 1.0, opacity: 0.55 },
  { r: 196, sec: 32,  dir: -1, dash: '12 6 4 6',           stroke: 1.2, opacity: 0.85 },
  { r: 158, sec: 22,  dir:  1, dash: '50 14',              stroke: 1.4, opacity: 0.95 },
  { r: 116, sec: 14,  dir: -1, dash: '6 6',                stroke: 1.0, opacity: 0.7 },
];

// Tick marks around the outermost ring (24 ticks).
const TICKS = Array.from({ length: 24 }, (_, i) => (i * 360) / 24);

const AIVoiceBlob = ({ blobConfig = {}, setBlobConfig }) => {
  const wrapRef = useRef(null);
  const innerRef = useRef(null);
  const outerRingRef = useRef(null);
  const sweepRef = useRef(null);
  const reqRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const lerpRef = useRef(0); // smoothed volume 0..1
  const configRef = useRef(blobConfig);

  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => { configRef.current = blobConfig; }, [blobConfig]);

  // ---- Microphone (best effort) ----
  const startMicrophone = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.85;
      audioContext.createMediaStreamSource(stream).connect(analyser);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) {
      // Silent — the synthetic volume from Terminal still pulses the blob.
    }
  }, []);

  useEffect(() => {
    // The recognizer owns microphone capture during a Right Alt session.
    // Keeping a second stream open here made Chrome show a recording state
    // even while JARVIS was idle.
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, [startMicrophone]);

  // ---- Animation loop ----
  // Reads volume, lerps, and writes to two transforms only:
  //   1. inner cluster scale (subtle pulse)
  //   2. outer ring scale (bigger, more dramatic — the "breathing")
  // Everything else (ring rotations, sweep, tick fade) is pure CSS animation
  // running on the compositor — so the rAF cost is essentially nil.
  useEffect(() => {
    const tick = () => {
      reqRef.current = requestAnimationFrame(tick);

      let raw = 0;
      const analyser = analyserRef.current;
      const data = dataArrayRef.current;
      if (analyser && data) {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        raw = sum / data.length / 255; // 0..1
      }
      // TTS-driven simulated volume (0..255 scale to keep parity with old blob).
      const sim = Number(window.simulatedBlobVolumeTarget) || 0;
      if (sim > 0) {
        const t = Date.now() / 150;
        const sineSim = (sim + Math.sin(t) * 15) / 255;
        if (sineSim > raw) raw = sineSim;
      }

      const sensitivity = Math.max(0.1, Number(configRef.current.sensitivity) || 0.8);
      const target = Math.min(1, Math.pow(raw, 1.4) * sensitivity * 1.6);
      // Smooth lerp toward target, slower decay than rise for a satisfying
      // "fade out" between phrases.
      const cur = lerpRef.current;
      const lerpRate = target > cur ? 0.18 : 0.07;
      lerpRef.current = cur + (target - cur) * lerpRate;
      const v = lerpRef.current;

      const sizeBase = Number(configRef.current.size) || 1.0;
      // Outer ring breathes; inner cluster reacts faster but smaller.
      if (outerRingRef.current) {
        const outerScale = sizeBase * (1 + v * 0.08);
        outerRingRef.current.style.transform = `scale(${outerScale.toFixed(3)})`;
      }
      if (innerRef.current) {
        const innerScale = sizeBase * (1 + v * 0.18);
        innerRef.current.style.transform = `translate(-50%, -50%) scale(${innerScale.toFixed(3)})`;
      }
    };
    reqRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(reqRef.current);
  }, []);

  // ---- Drag-to-reposition ----
  useEffect(() => {
    if (!isDragging) return undefined;
    const move = (e) => {
      setBlobConfig((prev) => ({
        ...prev,
        position: {
          x: e.clientX - dragOffset.current.x,
          y: e.clientY - dragOffset.current.y,
        },
      }));
    };
    const up = () => setIsDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [isDragging, setBlobConfig]);

  const onMouseDown = (e) => {
    if (!blobConfig.isDraggingMode) return;
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - (blobConfig.position?.x || 0),
      y: e.clientY - (blobConfig.position?.y || 0),
    };
  };

  const x = blobConfig.position?.x ?? window.innerWidth / 2;
  const y = blobConfig.position?.y ?? window.innerHeight / 2;

  return (
    <div
      ref={wrapRef}
      className={`jarvis-blob ${blobConfig.isDraggingMode ? 'is-dragging-mode' : ''}`}
      onMouseDown={onMouseDown}
      style={{ left: x, top: y }}
    >
      {/* Outer breathing ring — its scale is driven by the audio-reactive
          ref above; rotation comes from CSS so the GPU does the work. */}
      <div ref={outerRingRef} className="blob-outer">
        <svg viewBox="-260 -260 520 520" className="blob-svg blob-rotate-cw-slow" aria-hidden="true">
          {/* Tick ring — 24 fine ticks every 15° */}
          <g className="blob-ticks">
            {TICKS.map((deg, i) => (
              <line
                key={i}
                x1="0" y1="-244"
                x2="0" y2={i % 6 === 0 ? -228 : -236}
                transform={`rotate(${deg})`}
                strokeWidth={i % 6 === 0 ? 1.6 : 0.9}
              />
            ))}
          </g>

          {/* Concentric rings with their own rotations (CSS classes below). */}
          {RING_DEFS.map((ring, i) => (
            <g key={i} className={`blob-ring-spin-${i}`}>
              <circle
                cx="0" cy="0" r={ring.r}
                fill="none"
                strokeWidth={ring.stroke}
                strokeDasharray={ring.dash}
                style={{ opacity: ring.opacity }}
              />
            </g>
          ))}

          {/* Notch markers at cardinal points on ring 2 — adds detail at
              0°/90°/180°/270° without cluttering the silhouette. */}
          <g className="blob-notches">
            {[0, 90, 180, 270].map((deg) => (
              <g key={deg} transform={`rotate(${deg})`}>
                <path d="M -8 -198 L 0 -210 L 8 -198 Z" />
              </g>
            ))}
          </g>

          {/* Radial scanning sweep — fades from accent at the leading edge
              to transparent at the trailing edge. Rotates via CSS. */}
          <g ref={sweepRef} className="blob-sweep">
            <defs>
              <linearGradient id="blob-sweep-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%"   stopColor="currentColor" stopOpacity="0" />
                <stop offset="80%"  stopColor="currentColor" stopOpacity="0.0" />
                <stop offset="98%"  stopColor="currentColor" stopOpacity="0.55" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0.85" />
              </linearGradient>
            </defs>
            <path
              d="M 0 0 L 230 0 A 230 230 0 0 0 187 -132 Z"
              fill="url(#blob-sweep-grad)"
              opacity="0.35"
            />
          </g>

          {/* Crosshair guides — corner cuts that the rings rotate against. */}
          <g className="blob-crosshair">
            <line x1="-260" y1="0" x2="-244" y2="0" />
            <line x1="244"  y1="0" x2="260"  y2="0" />
            <line x1="0" y1="-260" x2="0" y2="-244" />
            <line x1="0" y1="244"  x2="0" y2="260" />
          </g>
        </svg>
      </div>

      {/* Inner cluster — pulses with audio. Hexagon + crosshair + dots,
          like the JARVIS sigil at the center of the MCU HUD. */}
      <div ref={innerRef} className="blob-inner">
        <svg viewBox="-100 -100 200 200" className="blob-svg" aria-hidden="true">
          {/* Soft glow disc behind the sigil — matches the accent. */}
          <defs>
            <radialGradient id="blob-core-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%"  stopColor="currentColor" stopOpacity="0.55" />
              <stop offset="60%" stopColor="currentColor" stopOpacity="0.08" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="0" cy="0" r="92" fill="url(#blob-core-glow)" />

          {/* Hex border + cross. */}
          <g className="blob-rotate-ccw-slow">
            <polygon
              points="0,-58 50,-29 50,29 0,58 -50,29 -50,-29"
              fill="none"
              strokeWidth="1.4"
            />
          </g>
          <g className="blob-rotate-cw-medium">
            <polygon
              points="0,-44 38,-22 38,22 0,44 -38,22 -38,-22"
              fill="none"
              strokeWidth="1"
              opacity="0.65"
            />
          </g>

          {/* Crosshair lines + center dot. */}
          <g className="blob-crosshair">
            <line x1="-72" y1="0" x2="-22" y2="0" strokeWidth="1.2" />
            <line x1="22"  y1="0" x2="72"  y2="0" strokeWidth="1.2" />
            <line x1="0" y1="-72" x2="0" y2="-22" strokeWidth="1.2" />
            <line x1="0" y1="22"  x2="0" y2="72"  strokeWidth="1.2" />
          </g>
          <circle cx="0" cy="0" r="3" fill="currentColor" />

          {/* Orbiting dot pair on a fast invisible track. */}
          <g className="blob-rotate-cw-fast">
            <circle cx="68" cy="0" r="2.4" fill="currentColor" />
            <circle cx="-68" cy="0" r="1.8" fill="currentColor" opacity="0.6" />
          </g>
        </svg>
      </div>
    </div>
  );
};

export default AIVoiceBlob;
