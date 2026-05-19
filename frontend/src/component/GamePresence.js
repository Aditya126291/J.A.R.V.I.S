import React, { useEffect, useState, memo } from 'react';
import './widgets.css';
import { getGamePresence } from '../api';

/**
 * GamePresence — what's in the foreground, with a heuristic flag for
 * "is this a game". Polls every 5s.
 */
const REFRESH_MS = 5_000;

function fmtSince(s) {
  if (!s || !Number.isFinite(s) || s < 0) return '';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  return `${Math.floor(s / 86400)}d`;
}

const GamePresence = ({ blobConfig }) => {
  const accent = blobConfig?.color || '#00ffe1';
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await getGamePresence();
      if (!alive) return;
      setData(r && r.ok ? r : null);
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <div className="hud-card" style={{ borderColor: `${accent}4a`, boxShadow: `inset 0 0 10px ${accent}33` }}>
      <div className="hud-card-header">
        <span className="hud-card-dot" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
        <span className="hud-card-title" style={{ color: accent, textShadow: `0 0 5px ${accent}80` }}>
          PLAYING
        </span>
        {data && (
          <span className={`gp-flag${data.is_game ? '' : ' not-game'}`}>
            {data.is_game ? `GAME · ${data.confidence}` : 'IDLE'}
          </span>
        )}
      </div>

      {!data && <div className="hud-card-empty">NO FOREGROUND</div>}

      {data && (
        <>
          <div className="gp-name" style={{ color: data.is_game ? accent : '#fff' }}>{data.name}</div>
          {data.title && <div className="gp-title">{data.title}</div>}
          <div className="gp-meta">
            <span>PID {data.pid}</span>
            <span>{data.width}×{data.height}</span>
            {data.since_s > 0 && <span>{fmtSince(data.since_s)}</span>}
          </div>
        </>
      )}
    </div>
  );
};

export default memo(GamePresence);
