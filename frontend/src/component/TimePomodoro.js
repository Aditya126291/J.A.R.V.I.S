import React, { useCallback, useEffect, useRef, useState, memo } from 'react';
import './widgets.css';
import { useUiBus } from '../hooks/useUiBus';

/**
 * TimePomodoro — local clock + Pomodoro timer.
 *
 * Always-on. No backend dependency. The clock ticks every second; the
 * Pomodoro state machine cycles WORK (25m) → BREAK (5m) → WORK indefinitely
 * once the user clicks START. Stops cleanly on STOP. Settings are stored in
 * `jarvis.pomodoro` so a long break / focus session survives a reload.
 *
 * Why no voice integration yet: we'll wire `pom:start`/`pom:stop` actions
 * into the smart router in a later phase if you want voice control. For now
 * the buttons are the source of truth.
 */

const STORAGE_KEY = 'jarvis.pomodoro';
const WORK_MS = 25 * 60 * 1000;
const BREAK_MS = 5 * 60 * 1000;

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    if (!['idle', 'work', 'break'].includes(v.phase)) return null;
    return v;
  } catch { return null; }
}

function saveState(s) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

function fmtClockHHMM(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function fmtClockSS(d) {
  return String(d.getSeconds()).padStart(2, '0');
}

function fmtDate(d) {
  return d.toLocaleDateString(undefined, {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });
}

function fmtRemaining(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const TimePomodoro = ({ blobConfig }) => {
  const accent = blobConfig?.color || '#00ffe1';
  const [now, setNow] = useState(() => new Date());
  const [pomo, setPomo] = useState(() => loadState() || { phase: 'idle', endsAt: 0 });
  const tickRef = useRef(null);

  // Single ticking clock for both the time display and the pomodoro
  // countdown. 250ms keeps the seconds digit stable without burning CPU.
  useEffect(() => {
    tickRef.current = setInterval(() => setNow(new Date()), 250);
    return () => clearInterval(tickRef.current);
  }, []);

  // Auto-advance: when a phase's `endsAt` slips into the past, flip to the
  // next phase (work → break, break → work). Idle stays idle.
  useEffect(() => {
    if (pomo.phase === 'idle') return;
    if (now.getTime() < pomo.endsAt) return;
    const next = pomo.phase === 'work'
      ? { phase: 'break', endsAt: Date.now() + BREAK_MS }
      : { phase: 'work',  endsAt: Date.now() + WORK_MS };
    setPomo(next);
    saveState(next);
  }, [now, pomo]);

  const start = () => {
    const next = { phase: 'work', endsAt: Date.now() + WORK_MS };
    setPomo(next);
    saveState(next);
  };

  const stop = () => {
    const next = { phase: 'idle', endsAt: 0 };
    setPomo(next);
    saveState(next);
  };

  // Voice control:
  //   pomodoro.start          → begin a focus session (default 25m)
  //   pomodoro.start { value: 50 } → start with a custom minute count
  //   pomodoro.stop           → cancel
  const handleStart = useCallback((detail) => {
    const minutes = Number(detail?.value);
    const ms = Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : WORK_MS;
    const next = { phase: 'work', endsAt: Date.now() + ms };
    setPomo(next);
    saveState(next);
  }, []);
  useUiBus('pomodoro.start', handleStart);
  useUiBus('pomodoro.stop', useCallback(() => {
    const next = { phase: 'idle', endsAt: 0 };
    setPomo(next);
    saveState(next);
  }, []));

  const remainingMs = pomo.phase === 'idle' ? 0 : pomo.endsAt - now.getTime();
  const phaseTotal = pomo.phase === 'break' ? BREAK_MS : WORK_MS;
  const progress = pomo.phase === 'idle'
    ? 0
    : Math.max(0, Math.min(100, ((phaseTotal - remainingMs) / phaseTotal) * 100));

  const phaseLabel = pomo.phase === 'work'
    ? 'FOCUS'
    : pomo.phase === 'break'
      ? 'BREAK'
      : 'IDLE';
  const phaseColor = pomo.phase === 'break' ? '#ffcc00' : accent;

  return (
    <div
      className="hud-card"
      style={{ borderColor: `${accent}4a`, boxShadow: `inset 0 0 10px ${accent}33` }}
    >
      <div className="hud-card-header">
        <span className="hud-card-dot" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
        <span className="hud-card-title" style={{ color: accent, textShadow: `0 0 5px ${accent}80` }}>
          CHRONO
        </span>
      </div>

      <div className="timepom-grid">
        <span className="timepom-clock" style={{ color: accent }}>
          {fmtClockHHMM(now)}
          <span style={{ color: 'rgba(255,255,255,0.5)', marginLeft: '4px' }}>:{fmtClockSS(now)}</span>
        </span>
        <span className="hud-card-sub">{now.toTimeString().slice(9, 17)}</span>
        <span className="timepom-date">{fmtDate(now)}</span>

        <div className="timepom-pomo" style={{ borderTopColor: `${accent}26` }}>
          <span className="timepom-pomo-state" style={{ color: phaseColor }}>{phaseLabel}</span>
          <span className="timepom-pomo-time" style={{ color: phaseColor }}>
            {pomo.phase === 'idle' ? '25:00' : fmtRemaining(remainingMs)}
          </span>
          {pomo.phase === 'idle'
            ? <button className="timepom-pomo-btn" onClick={start}>START</button>
            : <button className="timepom-pomo-btn danger" onClick={stop}>STOP</button>}
        </div>

        <div className="timepom-progress">
          <div
            className="timepom-progress-fill"
            style={{ width: `${progress}%`, background: phaseColor, boxShadow: `0 0 6px ${phaseColor}` }}
          />
        </div>
      </div>
    </div>
  );
};

export default memo(TimePomodoro);
