import React, { useCallback, useEffect, useRef, useState, memo } from 'react';
import './SystemPulse.css';
import { getSystemStats } from '../api';
import { useUiBus } from '../hooks/useUiBus';

/**
 * SystemPulse — combined CPU + RAM + GPU/VRAM telemetry.
 *
 * Compact-by-default: 3 stat rows with a thin live bar each.
 * Click anywhere on the widget to expand: rows grow, sparklines render
 * the last ~60s of values, and GPU temp / network rows reveal.
 *
 * Now consumes theme tokens via .hud-card so the dev/gamer accent flip
 * is automatic.
 */

const HISTORY_LEN = 60; // ~60s @ 1s sampling
const POLL_MS = 1000;

function pushBounded(arr, value) {
  const out = arr.length >= HISTORY_LEN ? arr.slice(arr.length - HISTORY_LEN + 1) : arr.slice();
  out.push(value);
  return out;
}

const Sparkline = memo(function Sparkline({ values, width = 100, height = 22 }) {
  if (!values || values.length < 2) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const pts = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="pulse-spark" aria-hidden="true">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  );
});

const StatRow = memo(function StatRow({ label, value, unit, percent, history, expanded }) {
  const pct = Math.min(100, Math.max(0, percent || 0));
  return (
    <div className="pulse-row">
      <div className="pulse-row-head">
        <span className="pulse-row-label">{label}</span>
        <span className="pulse-row-value">
          {value}
          <span className="pulse-row-unit">{unit}</span>
        </span>
      </div>
      <div className="pulse-row-bar-wrap">
        <div className="pulse-row-bar-track">
          <div className="pulse-row-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        {expanded ? <Sparkline values={history} /> : null}
      </div>
    </div>
  );
});

const SystemPulse = () => {
  const [stats, setStats] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const cpuHistRef = useRef([]);
  const ramHistRef = useRef([]);
  const vramHistRef = useRef([]);
  const [, force] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const data = await getSystemStats();
        if (!alive || !data || data.success === false) return;
        setStats(data);
        cpuHistRef.current = pushBounded(cpuHistRef.current, Number(data.cpu?.load) || 0);
        ramHistRef.current = pushBounded(ramHistRef.current, Number(data.ram?.percent) || 0);
        const vramPct = data.gpu?.vramTotal
          ? (Number(data.gpu.vramUsed || 0) / Number(data.gpu.vramTotal)) * 100
          : 0;
        vramHistRef.current = pushBounded(vramHistRef.current, vramPct);
        force((n) => (n + 1) % 1000000);
      } catch { /* keep last frame */ }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Voice control bound at the top so hooks stay unconditional.
  useUiBus('pulse.expand',   useCallback(() => setExpanded(true),  []));
  useUiBus('pulse.collapse', useCallback(() => setExpanded(false), []));
  useUiBus('pulse.toggle',   useCallback(() => setExpanded((v) => !v), []));

  if (!stats) {
    return (
      <div className="hud-card pulse-widget pulse-loading">
        <div className="hud-card-header">
          <span className="hud-card-dot" />
          <span className="hud-card-title">SYSTEM.PULSE</span>
        </div>
        <div className="pulse-empty">SAMPLING…</div>
      </div>
    );
  }

  const cpu = stats.cpu || {};
  const ram = stats.ram || {};
  const gpu = stats.gpu || {};
  const vramPct = gpu.vramTotal ? Math.round((Number(gpu.vramUsed || 0) / Number(gpu.vramTotal)) * 100) : 0;

  const onToggle = () => setExpanded((v) => !v);

  return (
    <div
      className={`hud-card pulse-widget ${expanded ? 'expanded' : ''}`}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
    >
      <div className="hud-card-header">
        <span className="hud-card-dot" />
        <span className="hud-card-title">SYSTEM.PULSE</span>
        <span className="pulse-hint">{expanded ? '▾' : '▸'}</span>
      </div>

      <div className="pulse-rows">
        <StatRow
          label="CPU"
          value={cpu.load ?? 0}
          unit="%"
          percent={cpu.load}
          history={cpuHistRef.current}
          expanded={expanded}
        />
        <StatRow
          label="RAM"
          value={ram.used ?? 0}
          unit={`/${ram.total ?? 0} GB`}
          percent={ram.percent}
          history={ramHistRef.current}
          expanded={expanded}
        />
        <StatRow
          label="VRAM"
          value={gpu.vramUsed ?? 0}
          unit={`/${gpu.vramTotal ?? 0} MB`}
          percent={vramPct}
          history={vramHistRef.current}
          expanded={expanded}
        />
      </div>

      {expanded && (
        <div className="pulse-extra">
          <div className="pulse-meta-row">
            <span className="pulse-meta-label">GPU</span>
            <span className="pulse-meta-value" title={gpu.name}>{gpu.name || '—'}</span>
          </div>
          <div className="pulse-meta-row">
            <span className="pulse-meta-label">CPU TEMP</span>
            <span className="pulse-meta-value" style={{ color: cpu.temp > 80 ? 'var(--status-bad)' : 'var(--ink)' }}>
              {cpu.temp ?? '—'}°C
            </span>
          </div>
          <div className="pulse-meta-row">
            <span className="pulse-meta-label">NET</span>
            <span className="pulse-meta-value">
              ↓ {stats.network?.rx ?? 0} KB/s · ↑ {stats.network?.tx ?? 0} KB/s
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(SystemPulse);
