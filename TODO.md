# JARVIS — Pending Work

Snapshot of work that was in flight when the session paused. Each item lists
what's done, what's left, and exactly how to finish it. Pick up in any
order; nothing here blocks anything else.

---

## 1. Verify the in-flight backend changes haven't regressed anything

**Status:** code is written but never re-tested in this session.

**Steps:**
1. `cd backend`
2. `node --check modules/ai_router.js` (already passed — sanity)
3. `node --check modules/quota_meter.js` (already passed)
4. `npx vitest --run` — expect the 20 existing tests to pass. The router
   rewrite is contained to `startHealthMonitor`, `initializeRouter`,
   `getProviderList`, `callGemini`, `callGeminiLive`, `streamGeminiSse`,
   `getStatus`, and the tool-result loop in `chatStream`. None of those
   are exercised by the current test files, so this should be green.
5. Restart the backend (`node server.js` or however you launch it). On
   first boot you'll see one negotiation pass per Gemini provider; the
   result is written to `.kiro/gemini_health_cache.json`. Subsequent
   restarts inside 24h skip negotiation entirely.
6. `cd ../frontend && npm run build` — expect the theme rewrite to
   compile (warnings about unused `memo` are stale ESLint cache, ignore).

**If anything fails:** the most likely culprit is a missed `quotaMeter`
import or a typo in the cache JSON path. The new module is at
`backend/modules/quota_meter.js`; the router imports it as
`require('./quota_meter')` near the top of `ai_router.js`.

---

## 2. Smoke-test the live quota + saturation routing

**Status:** the meter exists; never run end-to-end.

**Steps:**
1. Restart the backend.
2. Hit the chat endpoint a few times so `gemini_primary` accumulates
   counts. The meter persists at `backend/.kiro/quota.json`.
3. `curl http://localhost:5000/api/ai-status` and confirm the
   `providers[i].quota` field shows `rpm_used`, `rpm_pct`, `rpd_used`,
   `rpd_pct` per provider.
4. To force the saturation path without burning real quota, edit
   `quota_meter.js` temporarily and lower `DEFAULT_LIMITS.gemini_primary.rpm`
   to e.g. `2`. Send 2 chats. The 3rd request should route to Ollama
   automatically (the `done` event will report
   `provider: "Ollama Local"`).
5. Revert the limit back to 15. Done.

**Acceptance:** `getProviderList` returns Ollama first when
`allNearLimit(['gemini_primary','gemini_fallback'], 0.8)` is true; the
HUD's AI status panel shows quota usage per provider.

---

## 3. Wire quota usage into the HUD

**Status:** backend exposes the data; frontend doesn't read it yet.

**Where:**
- File: `frontend/src/component/SystemPulse.js` (good place; or add a
  small new card called `QuotaMeter`)
- Endpoint: `GET /api/ai-status` already returns `providers[i].quota`

**What to render:**
- Per Gemini provider, two thin bars: RPM (used / limit) and RPD
- Bar color: green <50%, amber 50–80%, red >80%, using the
  `--status-good` / `--status-warn` / `--status-bad` tokens
- Tooltip on hover: "X / Y this minute · Z / W today"
- When `bothSaturated` (both at >=80% RPM), surface a small badge
  "ROUTING TO LOCAL" so the user knows we're on Ollama

**Estimated size:** ~80 lines, one new file or an addition to SystemPulse.

---

## 4. Voice command for quota state

**Status:** infrastructure is there; no command yet.

**Where:**
- `backend/modules/ai_router.js` `tryUiFastPath` — add a regex for
  `"how many requests left"` / `"check quota"` / `"am i rate limited"`
- It should emit `ui:quota.show` and the smart-router speech becomes
  "Primary at 12 of 15 per minute, fallback at 5 of 30." Generated from
  `quotaMeter.snapshot()` server-side, before the action ships.

**Estimated size:** ~30 lines.

---

## 5. Migrate the fallback key to a different Google Cloud project

**Status:** purely a configuration change, no code.

**Steps (you do these, not the agent):**
1. Sign into a different Google account in incognito (or use a separate
   Cloud project on the same account)
2. Create a new API key for that project
3. Enable the Generative Language API on it
4. Replace `GEMINI_FALLBACK_API_KEY` in `backend/.env` with the new key
5. Restart backend

This doubles your effective free quota (limits are per project, not per
key). You should also delete `backend/.kiro/gemini_health_cache.json`
once after the swap so the boot path re-negotiates with the fresh key.

---

## 6. Optional: enable billing on the primary's Cloud project

**Status:** the only real way to use Gemini "for a long time" without
quota anxiety. Not required.

If you ever do this, the limits jump to 2000 RPM / 4M tokens-min
automatically. To match the new ceiling, update the meter:

```js
// In ai_router.js boot, after syncProvidersWithConfig():
quotaMeter.setLimits('gemini_primary',  { rpm: 2000, rpd: 1000000 });
quotaMeter.setLimits('gemini_fallback', { rpm: 2000, rpd: 1000000 });
```

(Or expose them via env vars — `GEMINI_PRIMARY_RPM` etc. — so you don't
have to edit code.)

---

## 7. Original spec tasks left (jarvis-voice-pipeline)

These were in the spec workflow before the UI work took over. Status
snapshot is in `.kiro/specs/jarvis-voice-pipeline/tasks.md`. The
required tasks remaining are:

- 3.3 — `validateActions` + `summarizeAction` (the registry-side
  validator partition)
- 5.3 — Health_Table state machine (cleaner cooldowns)
- 6.1 — `selectProvider` (formal version of the priority-list walk —
  current `getProviderList` already handles it informally)
- 6.3 — `chatStream` rewrite (the current `chatStream` is the spec's
  shape minus a few details)
- 9.1 — `/ws` WebSocket transport (currently SSE; the spec wants WS)
- 9.2 — wire `/api/chat` + `/api/execute` to `validateActions` and 409
- 11.1, 11.2, 12.2 — frontend TTS queue improvements (chunk drainer,
  blob amplitude, echoProtect arming)
- 13.2 — turn-resume on WS reconnect
- 14.2 — confirmation modal wiring
- 15.1 — end-to-end integration

None of these block today's HUD from working. They tighten the voice
pipeline contract. Tackle when you want; the spec doc has full detail.

---

## 8. Cleanup that fell through the cracks

- `backend/diag_quota.js` — temporary diag, safe to delete.
- `frontend/src/component/{SystemStatus,HUDWidgets,CurrentMode}.{js,css}` —
  removed in earlier sessions; double-check none are referenced anywhere
  with `grep -r "SystemStatus\|HUDWidgets\|CurrentMode" frontend/src`.
- The two ESLint warnings (`memo defined but never used` on
  `BuildFeed.js` and `Weather.js`) are false positives — `export default
  memo(...)` does use them. Clear `node_modules/.cache/.eslintcache` to
  silence.

---

## 9. UX polish wishlist (not started)

In rough priority:
- Settings panel for the blob never got the new theme — currently uses a
  hardcoded color picker that fights the rival-color system. Replace
  with size + sensitivity sliders only.
- Voice command "what time is the timer ending" → speak the pomodoro
  remaining time.
- The radar widget code in `server.js` still spawns PowerShell for
  Bluetooth. Could use a Node BLE library (`noble`) but it's a real
  refactor; deferred.
- News feed should let the user pick a topic (right now it rotates).
  Add a small overflow menu on the card header with "set news topic".
- Game presence widget could remember a per-app session log so you can
  ask "how long did I play X yesterday".

---

## 10. Known issues

- **Antigravity recents network error** when backend isn't restarted.
  Solved by restarting once after the route was added; document is
  worth a single line in the README so the next reload doesn't
  surprise you.
- **Ollama auto-fallback may stutter** if Ollama isn't running. The
  code falls back to the next provider in the cascade, but the user
  hears a longer silence. Fix: check Ollama health on boot the same way
  Gemini is checked, mark unavailable if it can't be reached, only
  promote to fallback under saturation if it actually responded.
- **Build feed file** at `<root>/.kiro/build-feed.log` grows unbounded
  if some external script keeps appending. Cap at 50 events is enforced
  on writes from inside JARVIS; an outside writer can blow past it.
  Low priority.

---

## Quick-reference paths

- Quota meter: `backend/modules/quota_meter.js`
- Health monitor: `backend/modules/ai_router.js` (search `startHealthMonitor`)
- Boot cache: `backend/.kiro/gemini_health_cache.json`
- Quota persistence: `backend/.kiro/quota.json`
- Antigravity workspaces: `%APPDATA%\Antigravity\User\globalStorage\storage.json`
- Antigravity launcher: `%LOCALAPPDATA%\Programs\Antigravity\bin\antigravity.cmd`
- Theme tokens: `frontend/src/theme.css`
- Shared widget styles: `frontend/src/component/widgets.css`
- Spec status: `.kiro/specs/jarvis-voice-pipeline/tasks.md`
