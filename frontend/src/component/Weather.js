import React, { useCallback, useEffect, useState, memo } from 'react';
import './widgets.css';
import { callWebTool } from '../api';
import { useUiBus } from '../hooks/useUiBus';

/**
 * Weather — current conditions + 3-day forecast.
 *
 * Calls into the keyless `web:weather` backend tool (Open-Meteo), so no
 * frontend API keys, no per-vendor quotas. Refreshes every 10 minutes.
 *
 * Default location: Delhi (matches the JARVIS dev profile). User can
 * override with the inline input; the choice is persisted in localStorage.
 */

const STORAGE_KEY = 'jarvis.weather.location';
const DEFAULT_LOCATION = 'Delhi';
const REFRESH_MS = 10 * 60 * 1000;

function loadLocation() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (typeof v === 'string' && v.trim()) return v.trim();
  } catch {}
  return DEFAULT_LOCATION;
}

function saveLocation(v) {
  try { window.localStorage.setItem(STORAGE_KEY, v); } catch {}
}

function dayLabel(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '—';
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'TODAY';
    const tomorrow = new Date(today.getTime() + 86400000);
    if (d.toDateString() === tomorrow.toDateString()) return 'TMRW';
    return d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
  } catch { return '—'; }
}

const Weather = ({ blobConfig }) => {
  const accent = blobConfig?.color || '#00ffe1';
  const [location, setLocation] = useState(loadLocation);
  const [pendingInput, setPendingInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchWeather = useCallback(async (loc) => {
    setLoading(true);
    setError(null);
    const r = await callWebTool('weather', loc);
    if (r && r.ok) {
      setData(r);
    } else {
      setData(null);
      setError(r?.error || 'unknown');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    const wrapped = async () => { if (alive) await fetchWeather(location); };
    wrapped();
    const id = setInterval(wrapped, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, [location, fetchWeather]);

  const onSubmit = (e) => {
    e.preventDefault();
    const next = pendingInput.trim();
    if (!next) return;
    saveLocation(next);
    setLocation(next);
    setPendingInput('');
    setEditing(false);
  };

  // Voice control: "set weather to <city>" or "show weather for <city>".
  const handleVoice = useCallback((detail) => {
    const v = String(detail?.value || '').trim();
    if (!v) return;
    saveLocation(v);
    setLocation(v);
    setEditing(false);
  }, []);
  useUiBus('weather.set_location', handleVoice);
  useUiBus('weather.refresh', useCallback(() => fetchWeather(location), [fetchWeather, location]));

  return (
    <div className="hud-card" style={{ borderColor: `${accent}4a`, boxShadow: `inset 0 0 10px ${accent}33` }}>
      <div className="hud-card-header">
        <span className="hud-card-dot" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
        <span className="hud-card-title" style={{ color: accent, textShadow: `0 0 5px ${accent}80` }}>
          WEATHER
        </span>
        <button
          type="button"
          className="timepom-pomo-btn"
          onClick={() => { setEditing((v) => !v); setPendingInput(location); }}
          aria-label="Change location"
        >
          {editing ? 'CANCEL' : 'LOC'}
        </button>
      </div>

      {!data && loading && <div className="hud-card-empty">FETCHING…</div>}
      {!data && !loading && error && (
        <div className="hud-card-empty" style={{ color: '#ff3366' }}>
          {error === 'location_not_found' ? 'LOCATION NOT FOUND' : `ERROR: ${error.toUpperCase()}`}
        </div>
      )}

      {data && (
        <>
          <div className="weather-now">
            <span className="weather-temp" style={{ color: accent }}>
              {Math.round(data.current?.temperature_c ?? 0)}°
            </span>
            <span className="weather-cond">{data.current?.condition || ''}</span>
          </div>
          <div className="weather-loc" title={data.location}>{data.location}</div>

          <div className="weather-meta">
            <div className="weather-meta-cell">
              <span className="weather-meta-label">FEELS</span>
              <span className="weather-meta-value">{Math.round(data.current?.feels_like_c ?? 0)}°</span>
            </div>
            <div className="weather-meta-cell">
              <span className="weather-meta-label">HUMID</span>
              <span className="weather-meta-value">{Math.round(data.current?.humidity ?? 0)}%</span>
            </div>
            <div className="weather-meta-cell">
              <span className="weather-meta-label">WIND</span>
              <span className="weather-meta-value">{Math.round(data.current?.wind_kph ?? 0)}</span>
            </div>
          </div>

          <div className="weather-forecast">
            {(data.forecast || []).slice(0, 3).map((d, i) => (
              <div key={d.date || i} className="weather-forecast-cell">
                <span className="weather-forecast-day">{dayLabel(d.date)}</span>
                <span className="weather-forecast-range" style={{ color: accent }}>
                  {Math.round(d.low_c)}°/{Math.round(d.high_c)}°
                </span>
                <span className="weather-forecast-cond">{d.condition}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {editing && (
        <form className="weather-input-row" onSubmit={onSubmit}>
          <input
            className="weather-input"
            type="text"
            placeholder="city or place"
            value={pendingInput}
            onChange={(e) => setPendingInput(e.target.value)}
            autoFocus
          />
          <button className="timepom-pomo-btn" type="submit">SET</button>
        </form>
      )}
    </div>
  );
};

export default memo(Weather);
