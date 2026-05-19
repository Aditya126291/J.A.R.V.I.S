import React from 'react';
import './ModeToggle.css';

/**
 * Two-state pill toggle for Dev / Gamer mode. Lives in the NavBar.
 *
 * Stateless: receives current mode + setter from `useUIMode()` upstream.
 * The thumb glides between halves; each half's color is locked to its
 * faction (dev=blue, gamer=red) regardless of current accent so the
 * widget reads as a faction switch, not just a tab.
 */
const ModeToggle = ({ mode, setMode }) => {
  const isDev = mode === 'dev';

  return (
    <div className="mode-toggle" role="tablist" aria-label="UI mode">
      <button
        type="button"
        role="tab"
        data-side="dev"
        aria-selected={isDev}
        className={`mode-toggle-btn ${isDev ? 'active' : ''}`}
        onClick={() => setMode('dev')}
      >
        DEV
      </button>
      <button
        type="button"
        role="tab"
        data-side="gamer"
        aria-selected={!isDev}
        className={`mode-toggle-btn ${!isDev ? 'active' : ''}`}
        onClick={() => setMode('gamer')}
      >
        GAMER
      </button>
      <span className={`mode-toggle-thumb ${isDev ? 'left' : 'right'}`} aria-hidden="true" />
    </div>
  );
};

export default ModeToggle;
