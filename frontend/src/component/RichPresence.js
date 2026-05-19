import React, { useEffect, useState, memo } from 'react';
import './widgets.css';
import { getRichPresence } from '../api';

/**
 * RichPresence — Discord local IPC. Surfaces the user identity if Discord
 * is running. Activity payload depends on Discord build; we render whatever
 * we get and gracefully degrade to "online" when only identity is available.
 */
const REFRESH_MS = 30_000;

const RichPresence = ({ blobConfig }) => {
  const accent = blobConfig?.color || '#00ffe1';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await getRichPresence();
      if (!alive) return;
      if (r && r.ok) { setData(r); setError(null); }
      else { setData(null); setError(r?.error || 'unknown'); }
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
          DISCORD
        </span>
        <span>
          <span className={`rp-status-dot${data ? '' : ' offline'}`} />
          <span className="hud-card-sub">{data ? 'ONLINE' : 'OFFLINE'}</span>
        </span>
      </div>

      {!data && error && (
        <div className="hud-card-empty" style={{ color: 'rgba(255,255,255,0.5)' }}>
          {error === 'discord_not_running' ? 'NOT RUNNING' : `ERROR: ${error.toUpperCase()}`}
        </div>
      )}

      {data && (
        <>
          <div className="rp-user" style={{ color: accent }}>
            {data.user?.global_name || data.user?.username || 'Discord User'}
          </div>
          {data.user?.username && data.user?.global_name && data.user.global_name !== data.user.username && (
            <div className="rp-tag">@{data.user.username}</div>
          )}
          <div className="rp-activity">
            {data.activity
              ? `${data.activity.name || 'In activity'}`
              : 'Connected. No activity reported.'}
          </div>
        </>
      )}
    </div>
  );
};

export default memo(RichPresence);
