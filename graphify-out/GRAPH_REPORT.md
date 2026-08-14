# Graph Report - J.A.R.V.I.S - Copy - Copy  (2026-08-15)

## Corpus Check
- 98 files · ~317,635 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 889 nodes · 1616 edges · 91 communities (78 shown, 13 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `946f545a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]

## God Nodes (most connected - your core abstractions)
1. `runPowerShell()` - 28 edges
2. `useUiBus()` - 20 edges
3. `chatStream()` - 19 edges
4. `jsonRequest()` - 19 edges
5. `handleAppCommand()` - 16 edges
6. `psQuote()` - 15 edges
7. `normalizePayload()` - 13 edges
8. `loadJson()` - 13 edges
9. `JARVIS — Pending Work` - 13 edges
10. `handleWebCommand()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `chatStream()` --calls--> `handleWebCommand()`  [INFERRED]
  backend/modules/ai_router.js → C:/Users/Aditya Kumar/OneDrive/Desktop/J.A.R.V.I.S/backend/modules/web.js
- `chatStream()` --calls--> `formatWebResult()`  [INFERRED]
  backend/modules/ai_router.js → C:/Users/Aditya Kumar/OneDrive/Desktop/J.A.R.V.I.S/backend/modules/web.js
- `executePayload()` --calls--> `handlePowerCommand()`  [EXTRACTED]
  backend/server.js → C:/Users/Aditya Kumar/OneDrive/Desktop/J.A.R.V.I.S/backend/modules/power.js
- `executePayload()` --calls--> `handleMediaCommand()`  [EXTRACTED]
  backend/server.js → C:/Users/Aditya Kumar/OneDrive/Desktop/J.A.R.V.I.S/backend/modules/media.js
- `executePayload()` --calls--> `handleFilesCommand()`  [EXTRACTED]
  backend/server.js → C:/Users/Aditya Kumar/OneDrive/Desktop/J.A.R.V.I.S/backend/modules/files.js

## Communities (91 total, 13 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (51): aiRouter, app, artifact, buffer, chunks, classification, cleanText, config (+43 more)

### Community 1 - "Community 1"
Cohesion: 0.2
Nodes (5): sanitizeSpokenText(), splitSpeech(), successMessage(), summarizePayload(), ttsUrl()

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (21): {
  APP_MAP,
  CLOSE_MAP,
  WEBSITE_TARGETS,
  TITLE_KEYWORDS,
  psQuote,
  escapeRegex,
  normalizeUrl,
  isSafeUrlLike,
  isSafeProcessName,
  isSafeLaunchName,
}, closeWebsiteTab(), { execFile }, execFileAsync(), fs, isSendKeyToken(), processNamesForTarget(), resolveOpenTarget() (+13 more)

### Community 3 - "Community 3"
Cohesion: 0.18
Nodes (22): AUDIT_FILE, compactExpiredSessions(), compactSession(), createSession(), crypto, ensureStoreDir(), fs, getFilePath() (+14 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (78): aiRouter, delay(), runDiagnostics(), actionTag(), addToHistory(), balanceBraces(), buildMessages(), callEmergency() (+70 more)

### Community 5 - "Community 5"
Cohesion: 0.13
Nodes (13): Advanced Configuration, Analyzing the Bundle Size, Available Scripts, Code Splitting, Deployment, Getting Started with Create React App, Learn More, Making a Progressive Web App (+5 more)

### Community 6 - "Community 6"
Cohesion: 0.43
Nodes (6): DESKTOP_DIR, { DESKTOP_DIR }, fs, handleProductivityCommand(), NOTES_FILE, path

### Community 7 - "Community 7"
Cohesion: 0.24
Nodes (15): cache, chatWithJarvis(), chatWithJarvisStream(), createArtifact(), createMemory(), deleteMemory(), executeJarvisAction(), focusBrowser() (+7 more)

### Community 8 - "Community 8"
Cohesion: 0.53
Nodes (4): { EdgeTTS }, os, path, test()

### Community 9 - "Community 9"
Cohesion: 0.7
Nodes (3): fs, runTests(), testEndpoint()

### Community 10 - "Community 10"
Cohesion: 0.5
Nodes (4): keys, models, run(), testKey()

### Community 30 - "Community 30"
Cohesion: 0.67
Nodes (3): modelsToTest, run(), testModelWS()

### Community 35 - "Community 35"
Cohesion: 0.08
Nodes (24): quickHealthCheck(), applyTransition(), effectiveState(), getCooldownMs(), getProviderState(), HealthState, healthTable, isLiveGeminiModel() (+16 more)

### Community 36 - "Community 36"
Cohesion: 0.12
Nodes (33): actionBlockArb, actionForModuleArb(), actionInnerArb, actionPayloadArb, actionPayloadForModuleArb(), ACTIONS_BY_MODULE, adversarialPathArb, fc (+25 more)

### Community 37 - "Community 37"
Cohesion: 0.11
Nodes (32): config, envPath, fs, path, alternateEngine(), config, createCache(), createDiskCache() (+24 more)

### Community 38 - "Community 38"
Cohesion: 0.04
Nodes (46): `ai_router.js` — orchestrator, Backend modules, Center, code:mermaid (graph TD), `command_registry.js` — payload validator, `dev_tools.js` — workspace + Antigravity inspectors, Disk artifacts (workspace root `.kiro/`), Frontend modules (+38 more)

### Community 39 - "Community 39"
Cohesion: 0.2
Nodes (22): ANTIGRAVITY_LAUNCHERS, ANTIGRAVITY_STORAGE_JSON, detectFramework(), ensureFeedDir(), { execFile, spawn }, execFileAsync(), FEED_BASENAME, feedPath() (+14 more)

### Community 40 - "Community 40"
Cohesion: 0.1
Nodes (33): ActiveProject(), BuildIcon(), DevRail(), GitIcon(), LaunchIcon(), loadActive(), PANELS, ProjectIcon() (+25 more)

### Community 41 - "Community 41"
Cohesion: 0.2
Nodes (20): allNearLimit(), CACHE_DIR, CACHE_FILE, countWithin(), DEFAULT_LIMITS, ensureDir(), fs, getLimits() (+12 more)

### Community 42 - "Community 42"
Cohesion: 0.29
Nodes (20): clampText(), COINGECKO_ID_MAP, fetchUrl(), _fmtNumber(), formatWebResult(), geocode(), getCrypto(), getNews() (+12 more)

### Community 43 - "Community 43"
Cohesion: 0.15
Nodes (15): ConfirmationModal(), { container }, dialog, list, onCancel, onConfirm, { rerender }, sampleActions (+7 more)

### Community 44 - "Community 44"
Cohesion: 0.19
Nodes (19): addArtifact(), addMemory(), ARTIFACTS_FILE, crypto, deleteMemory(), ensureMemoryDir(), extractAndSaveMemories(), fs (+11 more)

### Community 45 - "Community 45"
Cohesion: 0.28
Nodes (14): { execFile }, execFileAsync(), fs, GAME_KEYWORDS, getGamePresence(), getNowPlaying(), getRichPresence(), KNOWN_GAME_HOSTS (+6 more)

### Community 46 - "Community 46"
Cohesion: 0.13
Nodes (13): 10. Known issues, 1. Verify the in-flight backend changes haven't regressed anything, 2. Smoke-test the live quota + saturation routing, 3. Wire quota usage into the HUD, 4. Voice command for quota state, 5. Migrate the fallback key to a different Google Cloud project, 6. Optional: enable billing on the primary's Cloud project, 7. Original spec tasks left (jarvis-voice-pipeline) (+5 more)

### Community 47 - "Community 47"
Cohesion: 0.29
Nodes (12): addMessage(), getSession(), hasPendingActions(), normalizeSessionId(), publish(), { randomUUID }, send(), sessions (+4 more)

### Community 48 - "Community 48"
Cohesion: 0.67
Nodes (3): AUTHORITY_LEVELS, classifyAuthority(), generateDryRunPreview()

### Community 50 - "Community 50"
Cohesion: 0.41
Nodes (11): balanceBraces(), cleanJsonString(), extractJsonCandidates(), flattenToActionObjects(), normalizeSmartCharacters(), parseActionBody(), parseModelOutput(), quoteSingleQuotedStrings() (+3 more)

### Community 51 - "Community 51"
Cohesion: 0.3
Nodes (10): requiresConfirmation(), first, inputs, NON_RISKY_PAIRS, payload, { requiresConfirmation }, result, RISKY_PAIRS (+2 more)

### Community 52 - "Community 52"
Cohesion: 0.16
Nodes (8): readStoredMode(), useUIMode(), VALID_MODES, App(), GamerSlot, NAV_ITEMS, SECTION_META, linkElement

### Community 53 - "Community 53"
Cohesion: 0.28
Nodes (11): isSafeHost(), psQuote(), handleNetworkCommand(), { isSafeHost, psQuote }, { runPowerShell }, { exec }, fs, os (+3 more)

### Community 54 - "Community 54"
Cohesion: 0.39
Nodes (7): after, aiRouter, before, entries, [entry], fresh, snapshot

### Community 55 - "Community 55"
Cohesion: 0.22
Nodes (11): clampNumber(), HOME_DIR, isPlainObject(), isSafeDesktopName(), normalizePayload(), os, path, RISKY_ACTIONS (+3 more)

### Community 56 - "Community 56"
Cohesion: 0.43
Nodes (6): computeBackoffDelay(), createWsClient(), decodePayloadShape(), defaultGenerateTurnId(), encodePayload(), STATES

### Community 57 - "Community 57"
Cohesion: 0.17
Nodes (4): cachedJson(), getAiStatus(), getAuditLog(), getSecurityMatrix()

### Community 58 - "Community 58"
Cohesion: 0.29
Nodes (8): launchWhatsApp(), startTarget(), waitForProcess(), handleMediaCommand(), { runPowerShell }, handlePowerCommand(), { runPowerShell }, runPowerShell()

### Community 59 - "Community 59"
Cohesion: 0.32
Nodes (11): normalizeSimpleText(), DEEPLINKS, focusGuardPrelude(), handleMessageCommand(), handleTelegram(), handleWhatsApp(), normalizePhone(), openProtocol() (+3 more)

### Community 60 - "Community 60"
Cohesion: 0.35
Nodes (8): executePayload(), handleAppCommand(), { clampNumber }, handleSystemCommand(), { runPowerShell }, { handleAppCommand }, { handleSystemCommand }, handleWorkspaceCommand()

### Community 61 - "Community 61"
Cohesion: 0.42
Nodes (7): DOWNLOADS_DIR, safeDesktopPath(), { DOWNLOADS_DIR, safeDesktopPath }, fs, handleFilesCommand(), path, { runPowerShell }

### Community 81 - "Community 81"
Cohesion: 0.25
Nodes (7): fs, os, path, preview, session, sessions, sessionsFile

### Community 82 - "Community 82"
Cohesion: 0.47
Nodes (4): AIVoiceBlob(), params, RING_DEFS, TICKS

### Community 83 - "Community 83"
Cohesion: 0.53
Nodes (4): BuildFeed(), STATUS_COLOR, whenAgo(), getBuildFeed()

### Community 84 - "Community 84"
Cohesion: 0.6
Nodes (3): CHIPS, DevtoolsLaunch(), openApp()

### Community 85 - "Community 85"
Cohesion: 0.7
Nodes (3): fmtSince(), GamePresence(), getGamePresence()

### Community 87 - "Community 87"
Cohesion: 0.7
Nodes (3): fmtSec(), NowPlaying(), getNowPlaying()

## Knowledge Gaps
- **189 isolated node(s):** `aiRouter`, `keys`, `models`, `express`, `cors` (+184 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pingModel()` connect `Community 35` to `Community 4`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `requiresConfirmation()` connect `Community 51` to `Community 0`, `Community 4`, `Community 55`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `chatStream()` (e.g. with `handleWebCommand()` and `formatWebResult()`) actually correct?**
  _`chatStream()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `aiRouter`, `keys`, `models` to the rest of the system?**
  _189 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._