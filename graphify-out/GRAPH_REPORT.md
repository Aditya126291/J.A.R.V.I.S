# Graph Report - J.A.R.V.I.S  (2026-05-17)

## Corpus Check
- 57 files · ~272,481 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 293 nodes · 460 edges · 36 communities (33 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

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
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 36|Community 36]]

## God Nodes (most connected - your core abstractions)
1. `runPowerShell()` - 21 edges
2. `handleAppCommand()` - 13 edges
3. `psQuote()` - 12 edges
4. `chat()` - 11 edges
5. `normalizePayload()` - 11 edges
6. `executePayload()` - 10 edges
7. `makeStructured()` - 9 edges
8. `callGemini()` - 9 edges
9. `callProvider()` - 8 edges
10. `parsePlannerJson()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `runRadarScan()` --calls--> `runPowerShell()`  [EXTRACTED]
  backend/server.js → backend/modules/utils.js
- `executePayload()` --calls--> `handleSystemCommand()`  [EXTRACTED]
  backend/server.js → backend/modules/system.js
- `executePayload()` --calls--> `handleProductivityCommand()`  [EXTRACTED]
  backend/server.js → backend/modules/productivity.js
- `executePayload()` --calls--> `handleWorkspaceCommand()`  [EXTRACTED]
  backend/server.js → backend/modules/workspace.js
- `makeStructured()` --calls--> `normalizePayload()`  [EXTRACTED]
  backend/modules/ai_router.js → backend/modules/command_registry.js

## Communities (36 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (37): aiRouter, app, buffer, chunks, cleanText, config, cors, express (+29 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (16): params, sanitizeSpokenText(), splitSpeech(), successMessage(), summarizePayload(), cache, cachedJson(), chatWithJarvis() (+8 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (33): {
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
}, { execFile }, execFileAsync(), fs, isSendKeyToken(), resolveOpenTarget(), { runPowerShell }, taskKill() (+25 more)

### Community 3 - "Community 3"
Cohesion: 0.11
Nodes (31): executePayload(), closeWebsiteTab(), handleAppCommand(), startTarget(), isSafeHost(), normalizeSimpleText(), psQuote(), handleFilesCommand() (+23 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (44): actionTag(), addToHistory(), buildMessages(), callEmergency(), callGemini(), callGeminiLive(), callGroq(), callOllama() (+36 more)

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (13): Advanced Configuration, Analyzing the Bundle Size, Available Scripts, Code Splitting, Deployment, Getting Started with Create React App, Learn More, Making a Progressive Web App (+5 more)

### Community 6 - "Community 6"
Cohesion: 0.29
Nodes (6): DESKTOP_DIR, { DESKTOP_DIR }, fs, handleProductivityCommand(), NOTES_FILE, path

### Community 7 - "Community 7"
Cohesion: 0.33
Nodes (4): config, envPath, fs, path

### Community 8 - "Community 8"
Cohesion: 0.4
Nodes (3): { EdgeTTS }, os, path

### Community 9 - "Community 9"
Cohesion: 0.67
Nodes (3): fs, runTests(), testEndpoint()

### Community 10 - "Community 10"
Cohesion: 0.5
Nodes (4): keys, models, run(), testKey()

### Community 30 - "Community 30"
Cohesion: 0.67
Nodes (3): modelsToTest, run(), testModelWS()

### Community 36 - "Community 36"
Cohesion: 0.67
Nodes (3): aiRouter, delay(), runDiagnostics()

## Knowledge Gaps
- **99 isolated node(s):** `aiRouter`, `keys`, `models`, `express`, `cors` (+94 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `runPowerShell()` connect `Community 3` to `Community 0`, `Community 2`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `normalizePayload()` connect `Community 2` to `Community 0`, `Community 3`, `Community 4`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Why does `handleAppCommand()` connect `Community 3` to `Community 0`, `Community 2`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **What connects `aiRouter`, `keys`, `models` to the rest of the system?**
  _99 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._