import React, { useEffect, useState, memo } from 'react';
import './widgets.css';
import { getBuildFeed } from '../api';

/**
 * BuildFeed — recent test/build run history.
 *
 * The feed is file-backed at `<root>/.kiro/build-feed.log`. Anything that
 * wants to appear here just POSTs to `/api/dev/build-feed`. For now it
 * polls every 10s; later we can switch to a Server-Sent Event for instant
 * updates when a build finishes.
 */

const REFRESH_MS = 10_000;

const STATUS_COLOR = {
  pass: '#00ff88',
  fail: '#ff3366',
  running: '#ffcc00',
  unknown: 'rgba(255,255,255,0.5)',
};

function whenAgo(ts) {
  const diff = Math.max(0, Math.floor((Date.now() - Number(ts || 0)) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

const BuildFeed = ({ blobConfig }) => {
  const accent = blobConfig?.color || '#00ffe1';
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await getBuildFeed();
      if (!alive) return;
      if (r && r.ok) { setEvents(r.events.slice().reverse()); setError(null); }
      else { setError(r?.error || 'unknown'); }
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
          BUILD.FEED
        </span>
      </div>

      {events.length === 0 && !error && (
        <div className="hud-card-empty">NO RUNS YET</div>
      )}
      {events.length === 0 && error && (
        <div className="hud-card-empty" style={{ color: '#ff3366' }}>ERROR: {String(error).toUpperCase()}</div>
      )}

      {events.length > 0 && (
        <div className="feed-list">
          {events.slice(0, 8).map((e, i) => {
            const c = STATUS_COLOR[e.status] || STATUS_COLOR.unknown;
            return (
              <div key={`${e.ts}-${i}`} className="feed-item" style={{ '--feed-status-color': c }}>
                <span className="feed-status-badge" style={{ color: c }}>{(e.status || '').toUpperCase()}</span>
                <span className="feed-label" title={e.detail}>{e.label || e.type}</span>
                <span className="feed-when">{whenAgo(e.ts)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default memo(BuildFeed);
