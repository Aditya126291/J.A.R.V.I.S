'use strict';

/**
 * J.A.R.V.I.S. web tools module.
 *
 * Keyless live-data fetchers used by the AI router and the smart-router
 * fast paths. Every fetcher is "total" — it never throws; failures resolve
 * to `{ ok: false, error: '<lowercase code>' }` so the chat path can fall
 * back to the LLM (or to the canned emergency speech) without crashing.
 *
 * Tools:
 *   - getWeather(location)   Open-Meteo (no key)
 *   - getWiki(query)         Wikipedia REST API (no key)
 *   - getTime(location)      WorldTimeAPI (no key)
 *   - getCrypto(symbol)      CoinGecko (no key)
 *   - getNews(topic)         Google News RSS (no key)
 *   - searchWeb(query, n)    DuckDuckGo HTML scrape (no key, unofficial)
 *   - fetchUrl(url)          https.get + minimal HTML→text extractor
 *
 * Every tool obeys a 6-second hard timeout via AbortController so a slow
 * upstream never wedges the chat turn. Output buffers are size-capped at
 * 32 KB to keep token bills sane when results are fed back into the LLM.
 *
 * Required by tasks added after the 9 spec leaves; not part of the original
 * voice-pipeline spec, so no requirement IDs are referenced in the code
 * comments.
 */

const https = require('https');

const FETCH_TIMEOUT_MS = 6000;
const HTTP_BODY_CAP_BYTES = 32 * 1024; // 32 KB cap — protects token budget
const TEXT_OUT_CAP = 3000;             // chars returned to the LLM per tool

// ---------------------------------------------------------------------------
// Tiny HTTP helper (no extra deps)
// ---------------------------------------------------------------------------

function httpGet(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || FETCH_TIMEOUT_MS;
  return new Promise((resolve) => {
    const headers = {
      'User-Agent': 'JARVIS/1.0 (+https://github.com/jarvis-voice-pipeline)',
      Accept: opts.accept || 'application/json,text/plain,*/*',
      ...(opts.headers || {}),
    };
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const req = https.get(url, { headers }, (res) => {
      const status = res.statusCode || 0;
      // Follow simple redirects (one hop).
      if (status >= 300 && status < 400 && res.headers.location && !opts._redirected) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return httpGet(next, { ...opts, _redirected: true }).then(settle);
      }
      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        if (total >= HTTP_BODY_CAP_BYTES) return;
        const room = HTTP_BODY_CAP_BYTES - total;
        if (c.length <= room) {
          chunks.push(c);
          total += c.length;
        } else {
          chunks.push(c.slice(0, room));
          total += room;
        }
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        settle({ ok: status >= 200 && status < 300, status, body });
      });
      res.on('error', (err) => settle({ ok: false, status: 0, error: err.message }));
    });
    req.on('error', (err) => settle({ ok: false, status: 0, error: err.message }));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
      settle({ ok: false, status: 0, error: 'timeout' });
    });
  });
}

function safeParseJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function clampText(s, max = TEXT_OUT_CAP) {
  if (typeof s !== 'string') return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function stripHtmlEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function htmlToText(html) {
  // Minimal extractor: drop scripts/styles/nav, then strip remaining tags.
  // Good enough for the kind of pages an assistant cites in conversation.
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
  s = s.replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  s = s.replace(/<header[\s\S]*?<\/header>/gi, ' ');
  s = s.replace(/<aside[\s\S]*?<\/aside>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = stripHtmlEntities(s);
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// ---------------------------------------------------------------------------
// Geocoding (used by getWeather)
// ---------------------------------------------------------------------------

async function geocode(name) {
  const q = encodeURIComponent(String(name || '').trim().slice(0, 80));
  if (!q) return null;
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=en&format=json`;
  const r = await httpGet(url);
  if (!r.ok) return null;
  const data = safeParseJson(r.body);
  const hit = data && data.results && data.results[0];
  if (!hit) return null;
  return {
    lat: hit.latitude,
    lon: hit.longitude,
    label: [hit.name, hit.admin1, hit.country].filter(Boolean).join(', '),
    timezone: hit.timezone || 'auto',
  };
}

// ---------------------------------------------------------------------------
// Weather (Open-Meteo)
// ---------------------------------------------------------------------------

async function getWeather(location) {
  const place = await geocode(location);
  if (!place) return { ok: false, error: 'location_not_found' };
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${place.lat}&longitude=${place.lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
    `&timezone=${encodeURIComponent(place.timezone)}&forecast_days=3`;
  const r = await httpGet(url);
  if (!r.ok) return { ok: false, error: 'weather_api_error', status: r.status };
  const data = safeParseJson(r.body);
  if (!data || !data.current) return { ok: false, error: 'weather_parse_error' };

  const cur = data.current;
  const code = cur.weather_code;
  const condition = WMO_CODES[code] || `code ${code}`;

  return {
    ok: true,
    location: place.label,
    current: {
      temperature_c: cur.temperature_2m,
      feels_like_c: cur.apparent_temperature,
      humidity: cur.relative_humidity_2m,
      wind_kph: cur.wind_speed_10m,
      condition,
    },
    forecast: (data.daily?.time || []).map((day, i) => ({
      date: day,
      high_c: data.daily.temperature_2m_max[i],
      low_c: data.daily.temperature_2m_min[i],
      condition: WMO_CODES[data.daily.weather_code[i]] || `code ${data.daily.weather_code[i]}`,
    })),
  };
}

// WMO Weather interpretation codes — Open-Meteo's documented mapping.
const WMO_CODES = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'rime fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow',
  77: 'snow grains',
  80: 'rain showers', 81: 'heavy rain showers', 82: 'violent rain showers',
  85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'severe thunderstorm with hail',
};

// ---------------------------------------------------------------------------
// Wikipedia (REST API)
// ---------------------------------------------------------------------------

async function getWiki(query) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: 'empty_query' };
  const title = encodeURIComponent(q.replace(/\s+/g, '_').slice(0, 200));
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${title}`;
  const r = await httpGet(url);
  if (!r.ok) {
    if (r.status === 404) return { ok: false, error: 'not_found' };
    return { ok: false, error: 'wiki_api_error', status: r.status };
  }
  const data = safeParseJson(r.body);
  if (!data) return { ok: false, error: 'wiki_parse_error' };
  if (data.type === 'disambiguation') {
    return { ok: false, error: 'disambiguation', hint: data.extract };
  }
  return {
    ok: true,
    title: data.title,
    summary: clampText(data.extract || '', TEXT_OUT_CAP),
    url: data.content_urls?.desktop?.page || null,
  };
}

// ---------------------------------------------------------------------------
// Time (WorldTimeAPI)
// ---------------------------------------------------------------------------

async function getTime(location) {
  const raw = String(location || '').trim();
  // We resolve the IANA timezone for the place via the Open-Meteo geocoder
  // (or a small alias map for common cities) and then format the current
  // time locally with `Intl.DateTimeFormat`. This avoids depending on
  // WorldTimeAPI which has been unreliable lately, and it's instant.
  const direct = LOCATION_TZ_MAP[raw.toLowerCase()];
  let tz = direct;
  let label = raw;
  if (!tz) {
    const place = await geocode(raw);
    if (place) {
      label = place.label;
      if (place.timezone && place.timezone !== 'auto') tz = place.timezone;
    }
  }
  if (!tz) return { ok: false, error: 'tz_not_found' };

  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZoneName: 'short', hour12: false,
    });
    const formatted = fmt.format(now);
    // Best-effort UTC offset string ("+05:30") via the same Intl machinery.
    let utcOffset = '';
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, timeZoneName: 'longOffset',
      }).formatToParts(now);
      const off = parts.find((p) => p.type === 'timeZoneName');
      if (off) utcOffset = off.value.replace(/^GMT/, '') || '+00:00';
    } catch (_) {}
    return {
      ok: true,
      location: label,
      timezone: tz,
      datetime: now.toISOString(),
      formatted,
      utc_offset: utcOffset,
    };
  } catch (e) {
    return { ok: false, error: 'time_format_error', detail: e.message };
  }
}

const LOCATION_TZ_MAP = {
  india: 'Asia/Kolkata', delhi: 'Asia/Kolkata', mumbai: 'Asia/Kolkata',
  bangalore: 'Asia/Kolkata', kolkata: 'Asia/Kolkata', chennai: 'Asia/Kolkata',
  tokyo: 'Asia/Tokyo', japan: 'Asia/Tokyo',
  london: 'Europe/London', uk: 'Europe/London',
  paris: 'Europe/Paris', france: 'Europe/Paris',
  berlin: 'Europe/Berlin', germany: 'Europe/Berlin',
  'new york': 'America/New_York', nyc: 'America/New_York',
  'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles',
  sydney: 'Australia/Sydney', australia: 'Australia/Sydney',
  dubai: 'Asia/Dubai', uae: 'Asia/Dubai',
  singapore: 'Asia/Singapore',
  beijing: 'Asia/Shanghai', china: 'Asia/Shanghai',
};

// ---------------------------------------------------------------------------
// Crypto (CoinGecko)
// ---------------------------------------------------------------------------

async function getCrypto(symbol) {
  const raw = String(symbol || '').trim().toLowerCase();
  if (!raw) return { ok: false, error: 'empty_symbol' };
  const id = COINGECKO_ID_MAP[raw] || raw;
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd,inr&include_24hr_change=true&include_market_cap=true`;
  const r = await httpGet(url);
  if (!r.ok) return { ok: false, error: 'crypto_api_error', status: r.status };
  const data = safeParseJson(r.body);
  const entry = data && data[id];
  if (!entry) return { ok: false, error: 'symbol_not_found' };
  return {
    ok: true,
    symbol: id,
    usd: entry.usd,
    inr: entry.inr,
    change_24h: entry.usd_24h_change,
    market_cap_usd: entry.usd_market_cap,
  };
}

const COINGECKO_ID_MAP = {
  btc: 'bitcoin', bitcoin: 'bitcoin',
  eth: 'ethereum', ethereum: 'ethereum',
  sol: 'solana', solana: 'solana',
  ada: 'cardano', cardano: 'cardano',
  doge: 'dogecoin', dogecoin: 'dogecoin',
  shib: 'shiba-inu', 'shiba inu': 'shiba-inu',
  xrp: 'ripple', ripple: 'ripple',
  bnb: 'binancecoin', binance: 'binancecoin',
  matic: 'matic-network', polygon: 'matic-network',
  avax: 'avalanche-2', avalanche: 'avalanche-2',
  ltc: 'litecoin', litecoin: 'litecoin',
  dot: 'polkadot', polkadot: 'polkadot',
};

// ---------------------------------------------------------------------------
// News (Google News RSS)
// ---------------------------------------------------------------------------

async function getNews(topic, max = 5) {
  const q = encodeURIComponent(String(topic || '').trim().slice(0, 120));
  if (!q) return { ok: false, error: 'empty_topic' };
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;
  const r = await httpGet(url, { accept: 'application/rss+xml,text/xml,*/*' });
  if (!r.ok) return { ok: false, error: 'news_api_error', status: r.status };

  // Tiny RSS parser — the feed is consistent enough that regex is fine.
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(r.body)) !== null && items.length < max) {
    const block = m[1];
    const get = (tag) => {
      const inner = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      if (!inner) return '';
      return stripHtmlEntities(inner[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
    };
    items.push({
      title: get('title'),
      url: get('link'),
      source: get('source'),
      published: get('pubDate'),
    });
  }
  if (items.length === 0) return { ok: false, error: 'no_news_found' };
  return { ok: true, topic, items };
}

// ---------------------------------------------------------------------------
// Generic web search (DuckDuckGo HTML)
// ---------------------------------------------------------------------------

async function searchWeb(query, n = 5) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: 'empty_query' };
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const r = await httpGet(url, { accept: 'text/html,*/*' });
  if (!r.ok) return { ok: false, error: 'search_api_error', status: r.status };

  const results = [];
  // DuckDuckGo HTML wraps each result in `<div class="result results_links...">`
  // with a `result__a` anchor and a `result__snippet` block. The structure is
  // stable enough to regex but we keep the parser forgiving.
  const itemRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = itemRe.exec(r.body)) !== null && results.length < n) {
    const rawHref = m[1];
    // DuckDuckGo wraps outbound links in /l/?uddg=ENCODED. Unwrap.
    let href = rawHref;
    if (href.startsWith('//duckduckgo.com/l/') || href.startsWith('/l/')) {
      const u = href.startsWith('//') ? `https:${href}` : `https://duckduckgo.com${href}`;
      try {
        const parsed = new URL(u);
        const target = parsed.searchParams.get('uddg');
        if (target) href = decodeURIComponent(target);
      } catch (_) { /* keep raw */ }
    }
    results.push({
      title: clampText(htmlToText(m[2]), 200),
      snippet: clampText(htmlToText(m[3]), 400),
      url: href,
    });
  }
  if (results.length === 0) {
    return { ok: false, error: 'no_search_results' };
  }
  return { ok: true, query: q, results };
}

// ---------------------------------------------------------------------------
// Fetch a specific URL and return cleaned text
// ---------------------------------------------------------------------------

async function fetchUrl(url) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, error: 'invalid_url' };
  const r = await httpGet(u, { accept: 'text/html,application/xhtml+xml,*/*' });
  if (!r.ok) return { ok: false, error: 'fetch_failed', status: r.status };
  const text = htmlToText(r.body);
  if (!text) return { ok: false, error: 'empty_content' };
  return {
    ok: true,
    url: u,
    text: clampText(text, TEXT_OUT_CAP),
    truncated: text.length > TEXT_OUT_CAP,
  };
}

// ---------------------------------------------------------------------------
// Action handler — wires the registry's `web:*` actions to the fetchers.
// ---------------------------------------------------------------------------

async function handleWebCommand(action, value) {
  // `value` is what normalizePayload produced; for the web module we keep it
  // as a plain string (query / location / symbol / topic / url).
  switch (action) {
    case 'weather':  return getWeather(value);
    case 'wiki':     return getWiki(value);
    case 'time':     return getTime(value);
    case 'crypto':   return getCrypto(value);
    case 'news':     return getNews(value);
    case 'search':   return searchWeb(value);
    case 'fetch':    return fetchUrl(value);
    default:
      return { ok: false, error: 'unknown_web_action' };
  }
}

module.exports = {
  handleWebCommand,
  formatWebResult,
  getWeather,
  getWiki,
  getTime,
  getCrypto,
  getNews,
  searchWeb,
  fetchUrl,
  // Exposed for tests
  _internals: {
    httpGet,
    htmlToText,
    geocode,
    WMO_CODES,
    LOCATION_TZ_MAP,
    COINGECKO_ID_MAP,
    HTTP_BODY_CAP_BYTES,
    TEXT_OUT_CAP,
    FETCH_TIMEOUT_MS,
  },
};

// ---------------------------------------------------------------------------
// Result formatters — turn a tool result into a short conversational sentence
// the TTS engine can speak. Used by the smart-router fast paths so the user
// hears the actual answer, not just an acknowledgement.
// ---------------------------------------------------------------------------

function _fmtNumber(n, digits = 0) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatWebResult(action, result) {
  if (!result) return null;
  if (result.ok === false) {
    if (result.error === 'location_not_found') return "I couldn't find that location.";
    if (result.error === 'tz_not_found')       return "I couldn't find a timezone for that location.";
    if (result.error === 'symbol_not_found')   return "I couldn't find that symbol on CoinGecko.";
    if (result.error === 'not_found')          return "I couldn't find that on Wikipedia.";
    if (result.error === 'disambiguation')     return `That term has multiple meanings. ${result.hint ? result.hint.slice(0, 200) : 'Try a more specific name.'}`;
    if (result.error === 'no_news_found')      return "I couldn't find any news on that topic.";
    if (result.error === 'no_search_results')  return "I couldn't find any matching results.";
    if (result.error === 'timeout')            return "The lookup timed out. Try again.";
    return `Lookup failed (${result.error}).`;
  }

  switch (action) {
    case 'weather': {
      const c = result.current;
      if (!c) return null;
      const temp = _fmtNumber(c.temperature_c, 0);
      const feels = _fmtNumber(c.feels_like_c, 0);
      const cond = c.condition || '';
      const place = result.location || 'there';
      const feelsBit = (feels !== null && feels !== temp) ? `, feels like ${feels}°` : '';
      const tomorrow = result.forecast && result.forecast[1];
      const tail = tomorrow
        ? ` Tomorrow: ${_fmtNumber(tomorrow.low_c, 0)}° to ${_fmtNumber(tomorrow.high_c, 0)}°, ${tomorrow.condition}.`
        : '';
      return `It's ${temp}°C and ${cond} in ${place}${feelsBit}.${tail}`;
    }
    case 'wiki': {
      const summary = (result.summary || '').replace(/\s+/g, ' ').trim();
      if (!summary) return null;
      return summary.length > 280 ? summary.slice(0, 277) + '...' : summary;
    }
    case 'time': {
      const where = result.location || result.timezone || 'that location';
      return result.formatted ? `It's ${result.formatted} in ${where}.` : null;
    }
    case 'crypto': {
      const sym = (result.symbol || '').replace(/-/g, ' ');
      const usd = _fmtNumber(result.usd, result.usd >= 1 ? 2 : 6);
      const inr = _fmtNumber(result.inr, 0);
      const change = typeof result.change_24h === 'number'
        ? ` ${result.change_24h >= 0 ? 'up' : 'down'} ${Math.abs(result.change_24h).toFixed(2)}% today`
        : '';
      const inrBit = inr ? ` (₹${inr})` : '';
      return usd ? `${sym} is at $${usd}${inrBit}${change}.` : null;
    }
    case 'news': {
      if (!Array.isArray(result.items) || result.items.length === 0) return null;
      const top = result.items.slice(0, 3).map((it, i) => `${i + 1}. ${it.title}`).join(' ');
      return `Top headlines on ${result.topic}: ${top}`;
    }
    case 'search': {
      if (!Array.isArray(result.results) || result.results.length === 0) return null;
      const lines = result.results.slice(0, 3).map((r) => {
        const snip = (r.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        return `${r.title}. ${snip}`;
      });
      return `Top results: ${lines.join(' — ')}`;
    }
    case 'fetch': {
      if (!result.text) return null;
      const t = result.text.replace(/\s+/g, ' ').trim();
      return t.length > 400 ? t.slice(0, 397) + '...' : t;
    }
    default:
      return null;
  }
}

module.exports.formatWebResult = formatWebResult;
