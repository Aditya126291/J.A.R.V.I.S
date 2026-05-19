import React, { useEffect, useState, memo } from 'react';
import './widgets.css';
import { getNowPlaying } from '../api';

/**
 * NowPlaying — pulls the currently-playing media session from Windows
 * SMTC (Spotify, browser tabs, Films & TV, etc.). Polls every 5s.
 */
const REFRESH_MS = 5_000;

function fmtSec(s) {
  if (!s || !Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const NowPlaying = ({ blobConfig }) => {
  const accent = blobConfig?.color || '#00ffe1';
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await getNowPlaying();
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
          NOW.PLAYING
        </span>
      </div>

      {!data && <div className="hud-card-empty">NO MEDIA</div>}

      {data && (
        <div className="np-grid">
          <span className="np-title">{data.title}</span>
          {data.artist && <span className="np-artist">{data.artist}</span>}
          <div className="np-meta-row">
            <span className="np-app">{data.app || 'media'}</span>
            <span className="np-status" style={{ color: data.status === 'Playing' ? '#00ff88' : 'rgba(255,255,255,0.5)' }}>
              {data.status === 'Playing' ? '▶ PLAYING' : `⏸ ${(data.status || '').toUpperCase()}`}
            </span>
          </div>
          {data.duration_s > 0 && (
            <>
              <div className="np-progress">
                <div className="np-progress-fill" style={{
                  width: `${Math.min(100, Math.max(0, (data.position_s / data.duration_s) * 100))}%`,
                  background: accent,
                  boxShadow: `0 0 6px ${accent}`,
                }} />
              </div>
              <div className="np-time-row">
                <span>{fmtSec(data.position_s)}</span>
                <span>{fmtSec(data.duration_s)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default memo(NowPlaying);
