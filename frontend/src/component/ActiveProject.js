import React, { useEffect, useState, useCallback, memo } from 'react';
import './widgets.css';
import {
  getAntigravityWorkspaces,
  openAntigravityWorkspace,
} from '../api';
import { useUiBus } from '../hooks/useUiBus';

/**
 * ActiveProject — Antigravity recent workspaces.
 *
 * The package.json reader for `frontend/` and `backend/` was removed from
 * this widget — the entire panel is now dedicated to Antigravity's
 * `User\globalStorage\storage.json` recents (parsed server-side).
 *
 * Click → reuses the active Antigravity window.
 * Ctrl+Click → forces a new window.
 * Missing folders are dimmed and disabled. Result feedback ("OPENED" /
 * error code) flashes for ~2.4s on the row you clicked.
 */

const REFRESH_MS = 60_000;

const ActiveProject = ({ blobConfig }) => {
  const [ws, setWs] = useState(null);
  const [wsError, setWsError] = useState(null);
  const [opening, setOpening] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const loadAll = useCallback(async () => {
    const w = await getAntigravityWorkspaces();
    if (w && w.ok) {
      setWs(w);
      setWsError(null);
    } else {
      setWs(null);
      setWsError(w?.error || 'unknown');
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => { if (alive) await loadAll(); };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, [loadAll]);

  // Voice control: "refresh project" / "refresh workspaces".
  useUiBus('project.refresh', loadAll);

  const open = async (entry, forceNew = false) => {
    if (!entry || opening) return;
    setOpening(entry.path);
    setFeedback(null);
    const r = await openAntigravityWorkspace(entry.path, forceNew ? 'new' : 'reuse');
    setOpening(null);
    setFeedback({ path: entry.path, ok: r?.success === true, error: r?.error });
    setTimeout(() => setFeedback(null), 2400);
  };

  return (
    <div className="hud-card">
      <div className="hud-card-header">
        <span className="hud-card-dot" />
        <span className="hud-card-title">PROJECT</span>
        {ws?.workspaces?.length > 0 && (
          <span className="hud-card-sub">{ws.workspaces.length} RECENT</span>
        )}
      </div>

      {!ws && !wsError && <div className="hud-card-empty">SCANNING…</div>}

      {!ws && wsError && (
        <div
          className="hud-card-empty"
          style={{ color: 'var(--ink-faint)', fontSize: '0.78rem' }}
        >
          {wsError === 'antigravity_not_installed'
            ? 'ANTIGRAVITY NOT FOUND'
            : wsError === 'no_workspace_entries'
              ? 'NO RECENT WORKSPACES'
              : wsError === 'network_error'
                ? 'BACKEND OFFLINE — RESTART JARVIS'
                : `ERROR: ${wsError.toUpperCase()}`}
        </div>
      )}

      {ws && ws.workspaces?.length > 0 && (
        <div className="ag-list ag-list-tall">
          {ws.workspaces.map((w) => {
            const isOpening = opening === w.path;
            const fb = feedback && feedback.path === w.path ? feedback : null;
            return (
              <button
                key={w.path}
                type="button"
                className={
                  'ag-item' +
                  (isOpening ? ' busy' : '') +
                  (fb && fb.ok ? ' ok' : '') +
                  (fb && !fb.ok ? ' err' : '') +
                  (!w.exists ? ' missing' : '')
                }
                disabled={isOpening || !w.exists}
                onClick={(e) => open(w, e.ctrlKey || e.metaKey)}
                title={
                  w.exists
                    ? `${w.path}\nClick: reuse window  ·  Ctrl+Click: new window`
                    : 'Folder not found on disk'
                }
              >
                <span className="ag-item-name">{w.name}</span>
                <span className="ag-item-path">{w.path}</span>
                {fb && fb.ok && <span className="ag-item-flag ok">OPENED</span>}
                {fb && !fb.ok && (
                  <span className="ag-item-flag err">
                    {(fb.error || 'FAILED').toUpperCase()}
                  </span>
                )}
                {isOpening && <span className="ag-item-flag">…</span>}
                {!w.exists && !fb && !isOpening && (
                  <span className="ag-item-flag muted">MISSING</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default memo(ActiveProject);
