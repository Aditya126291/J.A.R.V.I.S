import React, { useCallback, useEffect, useRef, useState, memo } from 'react';
import './widgets.css';
import { callWebTool } from '../api';
import { useUiBus } from '../hooks/useUiBus';

/**
 * NewsFeed — mode-aware headlines.
 *
 *   dev    → "AI" / "OpenAI" / "Anthropic" / etc rotated topics
 *   gamer  → "video games" / "Steam" / "PC games" rotated topics
 *
 * Backend: hits `web:news` (Google News RSS, keyless). Refreshes every
 * 15 min. We rotate the topic on each refresh inside the same mode so
 * the feed feels alive without spamming the API.
 */

const REFRESH_MS = 15 * 60 * 1000;

const TOPICS = {
  dev: [
    'AI model release',
    'OpenAI',
    'Anthropic Claude',
    'Google Gemini',
    'open source LLM',
  ],
  gamer: [
    'video games',
    'Steam new release',
    'PC gaming',
    'GPU driver release',
    'game launch',
  ],
};

function pickTopic(mode, idx) {
  const list = TOPICS[mode] || TOPICS.dev;
  return list[idx % list.length];
}

function fmtPublished(s) {
  if (!s) return '';
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    const now = Date.now();
    const diff = (now - d.getTime()) / 1000;
    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  } catch { return ''; }
}

const NewsFeed = ({ blobConfig, mode }) => {
  const accent = blobConfig?.color || '#00ffe1';
  const [items, setItems] = useState([]);
  const [topic, setTopic] = useState(pickTopic(mode, 0));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const rotationRef = useRef(0);

  const refreshOnce = useCallback(async (forcedTopic = null) => {
    const next = forcedTopic || pickTopic(mode, rotationRef.current);
    rotationRef.current += 1;
    setTopic(next);
    setLoading(true);
    setError(null);
    const r = await callWebTool('news', next);
    if (r && r.ok && Array.isArray(r.items)) {
      setItems(r.items);
    } else {
      setError(r?.error || 'unknown');
    }
    setLoading(false);
  }, [mode]);

  useEffect(() => {
    let alive = true;
    rotationRef.current = 0;
    const tick = async () => { if (alive) await refreshOnce(); };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, [refreshOnce]);

  // Voice: "refresh news" / "next news topic" / "show news about <topic>".
  useUiBus('news.refresh',  useCallback(() => refreshOnce(), [refreshOnce]));
  useUiBus('news.set_topic', useCallback((d) => {
    const t = String(d?.value || '').trim();
    if (t) refreshOnce(t);
  }, [refreshOnce]));

  const title = mode === 'gamer' ? 'GAMING.FEED' : 'AI.FEED';

  return (
    <div className="hud-card" style={{ borderColor: `${accent}4a`, boxShadow: `inset 0 0 10px ${accent}33` }}>
      <div className="hud-card-header">
        <span className="hud-card-dot" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
        <span className="hud-card-title" style={{ color: accent, textShadow: `0 0 5px ${accent}80` }}>
          {title}
        </span>
        <span className="hud-card-sub" title={`Topic: ${topic}`}>{topic.toUpperCase().slice(0, 18)}</span>
      </div>

      {items.length === 0 && loading && <div className="hud-card-empty">FETCHING…</div>}
      {items.length === 0 && !loading && error && (
        <div className="hud-card-empty" style={{ color: '#ff3366' }}>
          {error === 'no_news_found' ? 'NO HEADLINES' : `ERROR: ${error.toUpperCase()}`}
        </div>
      )}

      {items.length > 0 && (
        <div className="news-list">
          {items.slice(0, 6).map((it, i) => (
            <a
              key={`${it.url}-${i}`}
              className="news-item"
              href={it.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="news-item-title">{it.title}</span>
              <span className="news-item-meta">
                <span>{(it.source || 'NEWS').toUpperCase()}</span>
                {fmtPublished(it.published) && <span>· {fmtPublished(it.published)} ago</span>}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

export default memo(NewsFeed);
