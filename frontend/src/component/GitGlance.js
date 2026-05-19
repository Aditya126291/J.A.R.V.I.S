import React, { useEffect, useState, memo } from 'react';
import './widgets.css';
import { getGitGlance } from '../api';

/**
 * GitGlance — branch + dirty state + last commit for the configured project root.
 * Polls every 30s. Backend resolves the root (defaults to the workspace).
 */
const REFRESH_MS = 30_000;

const GitGlance = ({ blobConfig }) => {
  const accent = blobConfig?.color || '#00ffe1';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await getGitGlance();
      if (!alive) return;
      if (r && r.ok) { setData(r); setError(null); }
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
          GIT.GLANCE
        </span>
        {data?.dirty > 0 && <span className="hud-card-sub" style={{ color: '#ffcc00' }}>● DIRTY</span>}
        {data?.dirty === 0 && <span className="hud-card-sub" style={{ color: '#00ff88' }}>● CLEAN</span>}
      </div>

      {!data && !error && <div className="hud-card-empty">SCANNING…</div>}
      {!data && error && (
        <div className="hud-card-empty" style={{ color: '#ff3366' }}>
          {error === 'not_a_git_repo' ? 'NOT A REPO' : `ERROR: ${error.toUpperCase()}`}
        </div>
      )}

      {data && (
        <>
          <div className="git-row">
            <span className="git-branch" style={{ color: accent }}>{data.branch}</span>
            {data.upstream && (
              <span className="git-arrows">
                {data.ahead > 0 && <span style={{ color: '#00ff88' }}>↑{data.ahead} </span>}
                {data.behind > 0 && <span style={{ color: '#ffcc00' }}>↓{data.behind} </span>}
                {data.ahead === 0 && data.behind === 0 && <span style={{ color: 'rgba(255,255,255,0.4)' }}>up to date</span>}
              </span>
            )}
            {!data.upstream && <span className="git-arrows" style={{ color: 'rgba(255,255,255,0.35)' }}>no upstream</span>}
          </div>

          <div className="git-dirty">
            <span><span className="num" style={{ color: '#ffcc00' }}>{data.dirtyBreakdown.modified}</span> mod</span>
            <span><span className="num" style={{ color: '#00ff88' }}>{data.dirtyBreakdown.staged}</span> staged</span>
            <span><span className="num" style={{ color: 'rgba(255,255,255,0.65)' }}>{data.dirtyBreakdown.untracked}</span> new</span>
          </div>

          {data.lastCommit && (
            <div className="git-commit">
              <div className="git-commit-hash">{data.lastCommit.hash}</div>
              <div className="git-commit-subject">{data.lastCommit.subject}</div>
              <div className="git-commit-when">{data.lastCommit.when}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default memo(GitGlance);
