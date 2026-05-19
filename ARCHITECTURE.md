# J.A.R.V.I.S. — Systems Architecture & Engineering Blueprint

J.A.R.V.I.S. is a real-time, voice-driven desktop control center. It pairs
a React holographic HUD with a Node.js backend that orchestrates a
self-healing Gemini cascade, native Windows interop, keyless live-data
tools, and a quota-aware fallback to local Ollama.

---

## Top-level data flow

```mermaid
graph TD
    subgraph Frontend [React HUD]
        V_IN[Voice / WebSpeech] --> TERM[Terminal.js]
        T_IN[Text Input] --> TERM
        TERM -->|/api/chat-stream SSE| API_C[api.js]
        BLOB[blob.js (SVG MCU)] <-->|simulatedBlobVolumeTarget| TERM
        WIDGETS[SystemPulse, TimePomodoro, Weather,
                NewsFeed, DevRail, NowPlaying,
                GamePresence, RichPresence] <-->|REST| API_C
        BUS[useUiBus jarvis-ui events] <-->|ui:* actions| TERM
        MODE[useUIMode dev/gamer toggle] -->|data-ui-mode| WIDGETS
    end

    subgraph Backend [Node.js / Express]
        API_C -->|/api/chat-stream| AI_R[ai_router.js]
        API_C -->|/api/execute| EXEC[server.js executor]
        API_C -->|/tts| TTS_P[tts.js dual-engine]
        API_C -->|/api/system-stats| TELEM[telemetry.js]
        API_C -->|/api/dev/*| DEV[dev_tools.js]
        API_C -->|/api/game/*| GAME[game_tools.js]

        AI_R -->|tryUiFastPath| UI[ui:* actions]
        AI_R -->|tryWebFastPath| WEB[web.js keyless tools]
        AI_R -->|smart router| SMART[regex action router]
        AI_R -->|LLM cascade| CASCADE[Gemini Primary →
                                       Gemini Fallback →
                                       Ollama Local →
                                       Emergency]
        AI_R -->|gate every call| QUOTA[quota_meter.js]
        AI_R -->|boot + 5min ping| HLTH[gemini_health.js]
        HLTH -->|.kiro/gemini_health_cache.json| FS_HLTH[(disk)]
        QUOTA -->|.kiro/quota.json| FS_QUOTA[(disk)]

        WEB -->|HTTP keyless| EXT_WEB[Open-Meteo, Wikipedia,
                                      CoinGecko, Google News RSS,
                                      DuckDuckGo HTML]
        EXEC --> REGISTRY[command_registry.js]
        REGISTRY -->|module-scoped| MODULES[apps, system, power, media,
                                             files, productivity, network,
                                             workspace, message, web, ui]
    end

    subgraph OS [Windows]
        MODULES --> PSHELL[PowerShell + WinRT + WMI]
        MODULES --> EXEC_NATIVE[execFile arp / netsh / taskkill]
        DEV --> AG_FS[%APPDATA%\Antigravity\
                       User\globalStorage\storage.json]
        DEV --> AG_LAUNCH[antigravity.cmd]
        GAME --> SMTC[Windows.Media.Control]
        GAME --> WIN32[GetForegroundWindow / GetWindowRect]
        GAME --> DISCORD[Discord IPC pipe]
    end
```

---

## Backend modules

### `ai_router.js` — orchestrator
Single source of truth for every LLM and tool decision.

- **Provider cascade**: `gemini_primary` → `gemini_fallback` → `ollama_local`
  → `emergency`. `getProviderList` reorders Ollama to the front when
  `quotaMeter.allNearLimit(['gemini_primary','gemini_fallback'], 0.8)`
  fires, so saturation routes to local inference instead of burning a
  429.
- **Smart router**: `tryUiFastPath` → `tryWebFastPath` → `tryNaturalRoute`
  → SMART_ROUTES regex table. Anything that pattern-matches bypasses the
  LLM entirely (sub-200ms, zero token cost).
- **Streaming chat**: `chatStream(userMessage, onEvent)` emits a uniform
  event stream — `meta`, `speech_delta`, `speech_end`, `action_ready`,
  `done`, `error`. `streamGeminiSse` does true SSE for streamable Gemini
  models; the Live WS branch buffers and fires once.
- **Tool-result loop**: Gemini emits `web:search` → backend executes →
  re-prompts the model with `[TOOL_RESULT]`. Capped at 1 hop, with a
  soft cap that skips the re-prompt and uses `formatWebResult` directly
  when the active provider is at ≥80% RPM (saves the second LLM call).
- **History**: 20-entry sliding window of raw XML model output; user
  turns stored verbatim.
- **Boot init**: reads `.kiro/gemini_health_cache.json`. If a key
  fingerprint + model pair was healthy within 24h, skip negotiation
  entirely. Cache misses run a single `negotiateModel` walk and store
  the result. Cuts restart-storm spend to zero.
- **Health monitor**: 5-minute interval (was 30s), single `pingModel`
  per provider (was a 5-candidate `negotiateModel` walk per tick). One
  request per cycle, not five.

### `quota_meter.js` — sliding-window rate limiter awareness
- Tracks request timestamps per provider with binary-search prune.
- `record(id)` is called before every Gemini round-trip.
- `wouldExceed(id, pct)` and `allNearLimit(ids, pct)` drive the
  router's saturation-aware decisions.
- Persists to `.kiro/quota.json` with coalesced 800ms writes so a
  backend restart inside the rate-limit window doesn't reset the meter.
- Default limits: primary 15 RPM / 1500 RPD, fallback 30 RPM / 1500 RPD,
  Ollama unlimited. `setLimits()` is exposed for when billing is enabled.

### `gemini_health.js` — health probes
- `pingModel(apiKey, model)` — single REST `:countTokens` call (sub-400ms).
- `pingLiveModel(apiKey, model)` — WebSocket handshake to
  `wss://generativelanguage.googleapis.com`, waits for `setupComplete`.
- `negotiateModel` — only used at boot on cache miss / stale, not in the
  monitor loop.

### `command_registry.js` — payload validator
- `normalizePayload(input) → NormalizedAction | null`. Total: never
  throws. Clamps system/media `value` to [0,100], sandboxes `files`
  targets under Desktop_Root, rejects path traversal + null bytes +
  Windows reserved device names.
- `requiresConfirmation(payload)` — closed Risky_Action_Set:
  `{power:shutdown, power:restart, files:delete, files:format,
   network:wifi_disable, message:send}`.
- `summarizeAction(payload)` — human-readable description used by both
  the confirmation modal and the chat speech.
- Action vocabulary now includes:
  - `web` — `search, fetch, weather, wiki, time, crypto, news` (keyless)
  - `ui` — `mode.dev, mode.gamer, mode.toggle, pomodoro.start/stop,
    weather.set_location, weather.refresh, news.refresh,
    news.set_topic, pulse.expand/collapse/toggle,
    rail.git/project/build/launch, project.refresh`

### `web.js` — keyless live-data tools
Every tool is total, returns `{ ok, ... }` shape, and respects a 6s
timeout + 32 KB body cap + 3000-char output clamp.

| Tool | Source |
|---|---|
| `getWeather(loc)` | Open-Meteo + their geocoder |
| `getWiki(query)` | Wikipedia REST `/page/summary` |
| `getTime(loc)` | Open-Meteo geocoder + `Intl.DateTimeFormat` (no API call) |
| `getCrypto(symbol)` | CoinGecko `/simple/price` |
| `getNews(topic)` | Google News RSS (regex parse) |
| `searchWeb(query)` | DuckDuckGo HTML scrape |
| `fetchUrl(url)` | `https.get` + minimal HTML→text extractor |

`formatWebResult(action, result)` produces conversational sentences for
the smart-router fast-path and the saturated-LLM tool-result fallback.

### `dev_tools.js` — workspace + Antigravity inspectors
- `getGitGlance(root)` — branch, dirty count + breakdown, ahead/behind,
  last commit. Uses `execFile` with 5s timeout.
- `getProjectInfo(root)` — reads `package.json` for workspace root,
  `frontend/`, `backend/`. Detects React / Express / Next / etc.
- `getBuildFeed(root)` — file-backed JSONL log at
  `<root>/.kiro/build-feed.log`, capped at 50 entries.
- `recordBuildEvent(root, event)` — append-only writer for build runs.
- `getAntigravityWorkspaces({ limit })` — reads
  `%APPDATA%\Antigravity\User\globalStorage\storage.json`,
  decodes the `file:///c%3A/...` URIs to native Windows paths, checks
  each one for existence.
- `openInAntigravity(path, mode)` — spawns `antigravity.cmd` with
  `-r` (reuse), `-n` (new window), or `-a` (add folder). Detached + unref'd.

### `game_tools.js` — gamer-mode telemetry
- `getNowPlaying()` — Windows.Media.Control (SMTC). Works with Spotify,
  browser tabs, Films & TV, anything that surfaces system media.
- `getGamePresence()` — foreground window via Win32 P/Invoke. Heuristic
  classifier (allow-list of known game launchers, block-list of
  non-games like Chrome/VSCode/Discord, `fullscreen + user-path`
  fallback). Returns `{ is_game, confidence, reason, name, title, pid }`.
- `getRichPresence()` — Discord IPC pipe handshake. Surfaces user
  identity. Activity payload depends on Discord build.

### `tts.js` — dual-engine TTS proxy
- `registerTtsRoute(app)` mounts `/tts`. 200-char cap. Default engine
  `edge`, alternate `google`. Single retry on engine failure.
- Two-tier cache: in-memory LRU (80 entries) + disk
  (`backend/cache/tts/<sha256>.mp3`, max 500 files / 200 MB, mtime LRU).
- Streams 4096-byte chunks; first byte target ≤300ms.

### `server.js` — Express transport
Endpoints:

| Path | Purpose |
|---|---|
| `/api/chat`, `/api/chat-stream` | Chat (legacy + SSE) |
| `/api/execute` | Action executor with confirmation gate (HTTP 409) |
| `/api/ai-status` | Cascade state + per-provider quota |
| `/api/system-stats` | Telemetry (CPU/RAM/GPU/network) |
| `/api/radar` | Wi-Fi + BLE + LAN sweep (subscription-gated) |
| `/api/dev/git`, `/project`, `/build-feed`, `/antigravity`, `/antigravity/open` | Dev widgets |
| `/api/game/now-playing`, `/presence`, `/rich-presence` | Gamer widgets |
| `/tts` | TTS proxy |

The radar scan no longer runs on a fixed 15s timer — it's gated by
`/api/radar` poll requests and pauses 60s after the HUD stops asking.
`netsh` and `arp` use `execFile` directly; only the `Get-PnpDevice` BLE
branch still routes through PowerShell.

---

## Frontend modules

### Layout & theme
- `App.js` — three-rail HUD (left: always-on + mode-scoped + news;
  center: blob; right: SystemPulse + Terminal). NavBar holds the
  DEV/GAMER toggle.
- `theme.css` — token system. `--accent` swaps between cobalt blue
  (`#4ea1ff`) and adversary red (`#ff4d6d`) based on
  `body[data-ui-mode]`. Panel bodies are dark slate; accent only paints
  borders, headers, dots, and progress fills. Hover lifts cards 2px and
  brightens the border + glow.
- `widgets.css` — shared inner-tile vocabulary (`--tile-bg`,
  `--tile-bg-hover`, `--tile-border`). Every interactive child has the
  same hover-lift pattern.
- `useUIMode` — persists `dev`/`gamer` in localStorage, mirrors to
  `<body data-ui-mode>`, listens for `mode.dev` / `mode.gamer` /
  `mode.toggle` voice events.
- `useUiBus` — pub/sub on a `jarvis-ui` CustomEvent. Widgets subscribe
  by action name.

### Widgets (left rail)

Always-on:
- `TimePomodoro` — clock, date, integrated 25/5 pomodoro state machine.
  Voice: `pomodoro.start`, `pomodoro.stop`.
- `Weather` — current temp, feels-like / humidity / wind, 3-day forecast,
  inline LOC override. Voice: `weather.set_location`, `weather.refresh`.
- `NewsFeed` — mode-aware Google News RSS rotation. Voice:
  `news.refresh`, `news.set_topic`.

Mode-scoped — Dev (compact icon strip + expanded panel):
- `DevRail` — 36px icon column with one expanded panel. Persists
  selection in localStorage. Voice: `rail.git`, `rail.project`,
  `rail.build`, `rail.launch`.
- `GitGlance` — branch, dirty/clean, ahead/behind, last commit.
- `ActiveProject` — Antigravity recent workspaces only (the
  package.json projects panel was removed). Click reuses window,
  Ctrl+Click forces new window.
- `BuildFeed` — JSONL feed of recent test/build runs.
- `DevtoolsLaunch` — 6 chip grid (VS Code, Terminal, Browser, GitHub,
  localhost, Task Mgr).

Mode-scoped — Gamer:
- `NowPlaying` — Windows media session.
- `GamePresence` — foreground window with game-or-not heuristic.
- `RichPresence` — Discord IPC user identity.

### Right rail
- `SystemPulse` — CPU + RAM + VRAM compact card. Click expands to
  60-sample sparklines + GPU name + CPU temp + network. Voice:
  `pulse.expand`, `pulse.collapse`, `pulse.toggle`.
- `Terminal` — chat + voice surface. Intercepts `module: "ui"` actions
  before they hit the backend executor and dispatches them on the local
  `jarvis-ui` event bus.

### Center
- `blob.js` — pure SVG MCU JARVIS holographic core. Four concentric
  rings rotating at staggered speeds, 24 tick marks, cardinal notches,
  radial scan sweep, inner hex+crosshair sigil with orbiting dots.
  All strokes use `currentColor` so they retune to the active accent.
  Audio reactivity: lerps mic/synthetic volume into outer-ring scale
  (subtle breathing) and inner-cluster scale (faster/larger pulse).
  Three.js was removed; bundle dropped from 214 kB → 79 kB gzipped.

### Performance posture
- `React.memo` on every leaf widget so the blob's per-frame
  `setBlobConfig` writes don't re-render the rest of the tree.
- `contain: layout style` on `.hud-left` and `.hud-right` to scope
  reflow.
- All animations use `transform` / `opacity` only — never `top`, `left`,
  `width`, `background-color`. Run on the compositor.
- `prefers-reduced-motion` honored on hex grid, ring rotations, sweep,
  mode toggle thumb.
- Hover effects gated behind `@media (hover: hover)` so touch devices
  don't get stuck-hover artifacts.

---

## Disk artifacts (workspace root `.kiro/`)
| File | Owner | Purpose |
|---|---|---|
| `gemini_health_cache.json` | `ai_router.js` | 24h TTL boot cache, key-fingerprinted |
| `quota.json` | `quota_meter.js` | Persisted RPM/RPD timestamps |
| `build-feed.log` | `dev_tools.js` | JSONL build/test history (50 entries) |

`backend/cache/tts/` holds the persistent TTS layer (sha256-keyed MP3s).

---

## Voice control surface

Every UI control has a voice command. The smart router emits a
`module: "ui"` action; Terminal intercepts before the executor and
dispatches on the local event bus.

| Command pattern | Action |
|---|---|
| "switch to gamer mode" | `mode.gamer` |
| "start a 30 minute focus timer" | `pomodoro.start` (value=30) |
| "set weather to mumbai" | `weather.set_location` |
| "show news about gpu drivers" | `news.set_topic` |
| "refresh the news" | `news.refresh` |
| "expand the system pulse" | `pulse.expand` |
| "show git glance" / "open project" | `rail.git` / `rail.project` |
| "weather in delhi" | `web:weather` (smart router, sub-200ms) |
| "price of bitcoin" | `web:crypto` (smart router) |
| "search for X" | `web:search` (smart router) |
| Anything else | LLM cascade with tool-result loop |

---

## Security & safety boundaries
1. **Filesystem jail**: file actions resolve under Desktop_Root via
   `safeDesktopPath`; traversal, null bytes, reserved device names
   rejected.
2. **Process whitelist**: `apps:close` only kills processes in the
   `CLOSE_MAP` allow-list or things matching `isSafeProcessName`.
3. **Risky-action gate**: closed set, validator partitions
   `ok / pending / rejected`, frontend modal re-issues with
   `confirmed: true`.
4. **Antigravity sandbox**: `dev_tools.openInAntigravity` requires the
   target path to exist and resolves to absolute before spawning.
5. **Web tools**: keyless, read-only, capped at 32 KB body / 6s timeout.
6. **Quota meter**: throttles attempts before they hit a 429, switches
   to local Ollama when both Gemini providers saturate.
7. **Focus-guarded SendKeys**: messaging / app automation captures the
   target HWND, re-checks `GetForegroundWindow` before each keystroke,
   aborts with `FOCUS_LOST` if the user clicks away.

---

## Known gaps (see `TODO.md`)
- Quota visualization in the HUD not yet rendered (backend exposes it).
- Spec-level pipeline tasks 3.3, 5.3, 6.1, 6.3, 9.1, 9.2, 11.1, 11.2,
  12.2, 13.2, 14.2, 15.1 still pending in the
  `jarvis-voice-pipeline` spec.
- Settings panel still uses a color picker that conflicts with the
  rival-color theme; should be replaced with size + sensitivity sliders
  only.
