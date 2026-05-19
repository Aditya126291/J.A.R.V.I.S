import React, { useEffect, useState, memo } from 'react';
import './DevRail.css';
import GitGlance from './GitGlance';
import ActiveProject from './ActiveProject';
import BuildFeed from './BuildFeed';
import DevtoolsLaunch from './DevtoolsLaunch';
import { useUiBus } from '../hooks/useUiBus';

/**
 * DevRail — the four dev widgets compacted into an icon strip.
 *
 * One panel open at a time; rest sit as 36px chips. Default open is
 * `git`. Voice control hooks into the same selection so "show project
 * widget" / "open build feed" can swap which panel is expanded.
 */

const PANELS = [
  { id: 'git',     label: 'GIT',     Component: GitGlance,      icon: GitIcon,     bus: 'rail.git' },
  { id: 'project', label: 'PROJECT', Component: ActiveProject,  icon: ProjectIcon, bus: 'rail.project' },
  { id: 'build',   label: 'BUILD',   Component: BuildFeed,      icon: BuildIcon,   bus: 'rail.build' },
  { id: 'launch',  label: 'LAUNCH',  Component: DevtoolsLaunch, icon: LaunchIcon,  bus: 'rail.launch' },
];

const STORAGE_KEY = 'jarvis.devRail.active';

function loadActive() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (PANELS.some((p) => p.id === v)) return v;
  } catch {}
  return 'git';
}

function GitIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="12" r="2.2" />
      <path d="M6 8.2v7.6" />
      <path d="M8.1 6.6c4 0 7.5 1.6 7.7 5.4" />
    </svg>
  );
}

function ProjectIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7.5l2.5-3h5l2 2h7.5v11A1.5 1.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5V7.5z" />
      <path d="M3 11h18" />
    </svg>
  );
}

function BuildIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12l3 3 3-3 3 3 3-3 3 3" />
      <path d="M5 17l3 3 3-3 3 3 3-3 3 3" />
      <path d="M5 7l3 3 3-3 3 3 3-3 3 3" />
    </svg>
  );
}

function LaunchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19l8-8m0 0H7m6 0v6" />
      <path d="M14 4h6v6" />
      <path d="M20 4l-7 7" />
    </svg>
  );
}

const DevRail = ({ blobConfig }) => {
  const [active, setActive] = useState(loadActive);

  // Persist selection across reloads.
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, active); } catch {}
  }, [active]);

  // Voice control: "show git glance" / "open build feed" / etc.
  useUiBus('rail.git',     React.useCallback(() => setActive('git'),     []));
  useUiBus('rail.project', React.useCallback(() => setActive('project'), []));
  useUiBus('rail.build',   React.useCallback(() => setActive('build'),   []));
  useUiBus('rail.launch',  React.useCallback(() => setActive('launch'),  []));

  const ActivePanel = (PANELS.find((p) => p.id === active) || PANELS[0]).Component;

  return (
    <div className="dev-rail" role="tablist" aria-orientation="vertical">
      <div className="dev-rail-icons">
        {PANELS.map((p) => {
          const Icon = p.icon;
          const isActive = active === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={p.label}
              data-tip={p.label}
              className={`dev-rail-icon${isActive ? ' active' : ''}`}
              onClick={() => setActive(p.id)}
            >
              <Icon />
            </button>
          );
        })}
      </div>
      <div className="dev-rail-panel">
        <ActivePanel blobConfig={blobConfig} />
      </div>
    </div>
  );
};

export default memo(DevRail);
