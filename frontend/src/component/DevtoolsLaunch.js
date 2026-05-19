import React, { useState, memo } from 'react';
import './widgets.css';
import { openApp } from '../api';

/**
 * DevtoolsLaunch — one-click chips for common dev apps.
 *
 * Each chip routes through the keyless `apps:open` action so we reuse
 * resolveOpenTarget. The set is intentionally small; users can add more
 * via the apps registry without code changes.
 */

const CHIPS = [
  { id: 'vscode',     label: 'VS CODE',  icon: 'CODE',  target: 'vscode' },
  { id: 'terminal',   label: 'TERMINAL', icon: 'PWSH',  target: 'terminal' },
  { id: 'chrome',     label: 'BROWSER',  icon: 'WEB',   target: 'chrome' },
  { id: 'github',     label: 'GITHUB',   icon: 'REPO',  target: 'github' },
  { id: 'localhost',  label: 'LOCALHOST',icon: 'DEV',   target: 'http://localhost:3000' },
  { id: 'task-mgr',   label: 'TASKS',    icon: 'PROC',  target: 'task manager' },
];

const DevtoolsLaunch = ({ blobConfig }) => {
  const accent = blobConfig?.color || '#00ffe1';
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null); // { id, ok }

  const click = async (chip) => {
    if (busy) return;
    setBusy(chip.id);
    setResult(null);
    try {
      const r = await openApp(chip.target);
      setResult({ id: chip.id, ok: r?.success !== false });
    } catch {
      setResult({ id: chip.id, ok: false });
    } finally {
      setTimeout(() => { setBusy(null); setResult(null); }, 1200);
    }
  };

  return (
    <div className="hud-card" style={{ borderColor: `${accent}4a`, boxShadow: `inset 0 0 10px ${accent}33` }}>
      <div className="hud-card-header">
        <span className="hud-card-dot" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
        <span className="hud-card-title" style={{ color: accent, textShadow: `0 0 5px ${accent}80` }}>
          QUICK.LAUNCH
        </span>
      </div>

      <div className="launch-grid">
        {CHIPS.map((c) => {
          const isActive = busy === c.id;
          const last = result && result.id === c.id ? result : null;
          const cls = `launch-chip${last ? (last.ok ? ' success' : ' danger') : ''}${isActive ? ' busy' : ''}`;
          return (
            <button
              key={c.id}
              type="button"
              className={cls}
              onClick={() => click(c)}
              disabled={isActive}
            >
              <span className="launch-chip-icon" style={{ color: accent }}>{isActive ? '...' : c.icon}</span>
              <span className="launch-chip-label">{c.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default memo(DevtoolsLaunch);
