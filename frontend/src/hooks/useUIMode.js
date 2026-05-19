import { useEffect, useState } from 'react';

/**
 * Persisted dev/gamer mode toggle.
 *
 * Modes:
 *   - "dev"   → developer-focused widgets render in the left rail
 *   - "gamer" → gamer-focused widgets render in the left rail
 *
 * Always-on widgets (SystemPulse, Time/Pomodoro, Weather) ignore this hook
 * and render unconditionally.
 *
 * Storage key: `jarvis.uiMode` in localStorage. Falls back to "dev" on any
 * read/write failure (private browsing, disabled storage, etc.) so the UI
 * is never empty.
 *
 * Voice control: subscribes to the `jarvis-ui` bus events `mode.dev`,
 * `mode.gamer`, and `mode.toggle` so "switch to gamer mode" works.
 */
const STORAGE_KEY = 'jarvis.uiMode';
const VALID_MODES = ['dev', 'gamer'];
const DEFAULT_MODE = 'dev';

function readStoredMode() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return VALID_MODES.includes(v) ? v : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function useUIMode() {
  const [mode, setModeState] = useState(readStoredMode);

  const setMode = (next) => {
    if (!VALID_MODES.includes(next)) return;
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch { /* persistence is best-effort */ }
  };

  const toggleMode = () => setMode(mode === 'dev' ? 'gamer' : 'dev');

  // Expose mode on the document body so CSS can react with a single
  // `:root[data-ui-mode='gamer'] ...` rule if we later want mode-scoped
  // colour variables.
  useEffect(() => {
    document.body.setAttribute('data-ui-mode', mode);
    return () => document.body.removeAttribute('data-ui-mode');
  }, [mode]);

  // Voice / event-bus control. Done at the hook level so any consumer
  // automatically gets voice-driven mode switching for free.
  useEffect(() => {
    const onEvent = (e) => {
      const action = e?.detail?.action;
      if (action === 'mode.dev') setMode('dev');
      else if (action === 'mode.gamer') setMode('gamer');
      else if (action === 'mode.toggle') toggleMode();
    };
    window.addEventListener('jarvis-ui', onEvent);
    return () => window.removeEventListener('jarvis-ui', onEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return { mode, setMode, toggleMode, isDev: mode === 'dev', isGamer: mode === 'gamer' };
}
