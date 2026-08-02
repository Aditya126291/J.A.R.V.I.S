# Graph Report - J.A.R.V.I.S - Copy - Copy  (2026-08-02)

## Corpus Check
- 96 files · ~315,724 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 846 nodes · 1522 edges · 73 communities (64 shown, 9 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `895a96e9`
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
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 65|Community 65]]

## God Nodes (most connected - your core abstractions)
1. `runPowerShell()` - 26 edges
2. `useUiBus()` - 20 edges
3. `chatStream()` - 19 edges
4. `handleAppCommand()` - 14 edges
5. `psQuote()` - 14 edges
6. `normalizePayload()` - 13 edges
7. `JARVIS — Pending Work` - 13 edges
8. `handleWebCommand()` - 12 edges
9. `jsonRequest()` - 12 edges
10. `executePayload()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `chatStream()` --calls--> `handleWebCommand()`  [INFERRED]
  backend/modules/ai_router.js → C:/Users/Aditya Kumar/OneDrive/Desktop/J.A.R.V.I.S/backend/modules/web.js
- `chatStream()` --calls--> `formatWebResult()`  [INFERRED]
  backend/modules/ai_router.js → C:/Users/Aditya Kumar/OneDrive/Desktop/J.A.R.V.I.S/backend/modules/web.js
- `executePayload()` --calls--> `handleProductivityCommand()`  [EXTRACTED]
  backend/server.js → C:/Users/Aditya Kumar/OneDrive/Desktop/J.A.R.V.I.S/backend/modules/productivity.js
- `executePayload()` --calls--> `handleWebCommand()`  [EXTRACTED]
  backend/server.js → C:/Users/Aditya Kumar/OneDrive/Desktop/J.A.R.V.I.S/backend/modules/web.js
- `runRadarScan()` --calls--> `runPowerShell()`  [EXTRACTED]
  backend/server.js → C:/Users/Aditya Kumar/OneDrive/Desktop/J.A.R.V.I.S/backend/modules/utils.js

## Communities (73 total, 9 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (46): aiRouter, app, buffer, chunks, cleanText, config, conversationStore, cors (+38 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (32): BuildFeed(), STATUS_COLOR, whenAgo(), CHIPS, DevtoolsLaunch(), fmtSince(), GamePresence(), GitGlance() (+24 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (72): executePayload(), {
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
}, closeWebsiteTab(), { execFile }, execFileAsync(), fs, handleAppCommand(), isSendKeyToken() (+64 more)

### Community 3 - "Community 3"
Cohesion: 0.21
Nodes (16): AUDIT_FILE, crypto, ensureStoreDir(), fs, getOrCreateActiveSession(), listAuditLogs(), listSessions(), listTurns() (+8 more)

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
Cohesion: 0.33
Nodes (4): config, envPath, fs, path

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
Cohesion: 0.16
Nodes (26): alternateEngine(), createCache(), createDiskCache(), createTtsHandler(), createTwoTierCache(), crypto, DEFAULT_DISK_CACHE_DIR, defaultCache (+18 more)

### Community 38 - "Community 38"
Cohesion: 0.04
Nodes (46): `ai_router.js` — orchestrator, Backend modules, Center, code:mermaid (graph TD), `command_registry.js` — payload validator, `dev_tools.js` — workspace + Antigravity inspectors, Disk artifacts (workspace root `.kiro/`), Frontend modules (+38 more)

### Community 39 - "Community 39"
Cohesion: 0.2
Nodes (22): ANTIGRAVITY_LAUNCHERS, ANTIGRAVITY_STORAGE_JSON, detectFramework(), ensureFeedDir(), { execFile, spawn }, execFileAsync(), FEED_BASENAME, feedPath() (+14 more)

### Community 40 - "Community 40"
Cohesion: 0.1
Nodes (32): ActiveProject(), BuildIcon(), DevRail(), GitIcon(), LaunchIcon(), loadActive(), PANELS, ProjectIcon() (+24 more)

### Community 41 - "Community 41"
Cohesion: 0.2
Nodes (20): allNearLimit(), CACHE_DIR, CACHE_FILE, countWithin(), DEFAULT_LIMITS, ensureDir(), fs, getLimits() (+12 more)

### Community 42 - "Community 42"
Cohesion: 0.29
Nodes (20): clampText(), COINGECKO_ID_MAP, fetchUrl(), _fmtNumber(), formatWebResult(), geocode(), getCrypto(), getNews() (+12 more)

### Community 43 - "Community 43"
Cohesion: 0.06
Nodes (29): AIVoiceBlob(), params, RING_DEFS, TICKS, ConfirmationModal(), { container }, dialog, list (+21 more)

### Community 44 - "Community 44"
Cohesion: 0.22
Nodes (15): addMemory(), ARTIFACTS_FILE, crypto, deleteMemory(), ensureMemoryDir(), extractAndSaveMemories(), fs, initializeDefaultMemories() (+7 more)

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

### Community 54 - "Community 54"
Cohesion: 0.39
Nodes (7): after, aiRouter, before, entries, [entry], fresh, snapshot

### Community 56 - "Community 56"
Cohesion: 0.43
Nodes (6): computeBackoffDelay(), createWsClient(), decodePayloadShape(), defaultGenerateTurnId(), encodePayload(), STATES

## Knowledge Gaps
- **174 isolated node(s):** `aiRouter`, `keys`, `models`, `express`, `cors` (+169 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pingModel()` connect `Community 35` to `Community 4`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `requiresConfirmation()` connect `Community 51` to `Community 0`, `Community 2`, `Community 4`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `chatStream()` (e.g. with `handleWebCommand()` and `formatWebResult()`) actually correct?**
  _`chatStream()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `aiRouter`, `keys`, `models` to the rest of the system?**
  _174 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._