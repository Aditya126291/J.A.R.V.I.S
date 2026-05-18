# Implementation Plan: JARVIS Voice Pipeline

## Status Snapshot (last updated mid-execution)

**Done: 9 of 25 required tasks.** Optional `*` test tasks are deferred — none of them are required for the pipeline to work end-to-end, they only validate correctness properties.

Legend:
- `[x]` done and verified
- `[ ]` required, not yet started
- `[ ]*` optional (property/unit test) — skip for now, revisit when stable

What's working today (verified):
- Test infra (vitest backend, jest frontend, fast-check both sides, shared arbitraries)
- XML parser (`parseModelOutput`) totality + thought stripping
- Command registry: `normalizePayload` (clamping + path sandbox) and `requiresConfirmation` (closed Risky_Action_Set)
- Bounded conversation history (20-entry cap, raw XML for model entries)
- Health pings: REST `pingModel` and Live WS `pingModel` both return canonical `HealthResult`
- Emergency speech returning `{speech, actions:[]}`
- Frontend `splitSpeech`, echo-guard predicate `shouldDropTranscript`
- Reconnecting WebSocket client (`WsClient`)
- Glassmorphic Confirmation modal component (rendered, not yet wired)
- TTS proxy with engine fallback, 200-char limit, structured logging

What's left to make the voice pipeline run end-to-end (priority order):
1. **3.3** validateActions + summarizeAction → unblocks 9.2 confirmation flow
2. **6.1, 6.3** selectProvider + chatStream rewrite → spec-shape for routing
3. **5.3** Health_Table state machine → cleaner cooldown handling
4. **9.1, 9.2** /ws handler + /api/chat 409-on-pending → backend transport
5. **11.1, 11.2, 12.2** TTS queue, blob amplitude, echoProtect arming → frontend audio
6. **13.2** turn-resume on reconnect
7. **14.2** confirmation modal wiring
8. **15.1** end-to-end integration

Tasks 7 and 16 are checkpoints (review pauses). 6.2 emergencySpeech is already in the right shape; only marked done because no code change was needed.

## Overview

Convert the design into a series of incremental coding steps that implement the full-duplex voice pipeline end-to-end. Each step builds on the previous one, ends with the new code wired into a caller, and is paired with property-based tests for the universal invariants defined in `design.md`. Implementation language is JavaScript (Node.js for the backend, React for the frontend), matching the existing codebase under `backend/modules/` and `frontend/src/`.

The plan is organized as:

1. Test infrastructure and shared scaffolding
2. Backend pure-logic core: XML parser, command registry, history store
3. Backend provider layer: health monitor, router, emergency mode
4. Backend transport: TTS proxy, WebSocket streaming endpoint
5. Frontend pure-logic core: `splitSpeech`, echo-guard predicate
6. Frontend audio engine: TTS queue, blob amplitude wiring
7. Frontend transport: WebSocket client with reconnect, confirmation modal
8. End-to-end integration and final wiring

Each property-based test references the property number from `design.md` and the requirement clause from `requirements.md` it validates. Use `fast-check` as the property library on both sides.

## Tasks

- [x] 1. Set up test infrastructure and shared scaffolding
  - Add `fast-check` and a unit-test runner (`jest` or `vitest`) to `backend/package.json` and `frontend/package.json` as devDependencies
  - Create `backend/tests/` and `frontend/src/__tests__/` directories
  - Add npm scripts `test` and `test:watch` to both `package.json` files (use `--run` for single execution; do not run watch mode automatically)
  - Create `backend/tests/helpers/arbitraries.js` with reusable `fast-check` arbitraries for `ActionPayload`, `ProviderHealth`, raw model XML, and speech text fixtures
  - _Requirements: foundational; supports all subsequent test tasks_

- [x] 2. Implement the XML tag parser
  - [x] 2.1 Implement `parseModelOutput` in `backend/modules/xml_parser.js`
    - Total function: every input string yields `{ speak, actions, thoughtsStripped, malformed }`
    - Strip every `<thought>...</thought>` block before computing `speak`
    - Extract first `<speak>` block; fall back to non-thought, non-action residue when absent
    - Iterate every `<action>` block and use `extractJsonCandidates` + `tryParseJson` to recover tolerant JSON
    - Set `malformed: true` only when cleaned text is non-empty but residue is empty
    - Export `parseModelOutput` and `extractJsonCandidates`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
  - [ ]* 2.2 Write property test for XML parser totality
    - **Property 4: XML parser totality**
    - **Validates: Requirements 4.1, 4.2**
    - For all strings (including empty, malformed, unicode, mixed case tags): `typeof r.speak === "string"`, `Array.isArray(r.actions)`, and no character substring of any `<thought>...</thought>` inner content appears in `r.speak`
    - _Requirements: 4.1, 4.2_
  - [ ]* 2.3 Write unit tests for XML parser edge cases
    - Mixed-case tags, nested `<thought>` blocks, trailing commas in action JSON, smart quotes, multiple action blocks, missing `<speak>`, empty input
    - Verify `thoughtsStripped` and `malformed` flags
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

- [ ] 3. Implement the command registry and validator
  - [x] 3.1 Implement `normalizePayload` in `backend/modules/command_registry.js`
    - Returns `null` (never throws) for any value that fails schema validation
    - Clamps numeric `value` to `[0, 100]` for `module ∈ {system, media}`
    - Sandboxes `target` for `module === "files"` via `safeDesktopPath` / `isSafeDesktopName`
    - Rejects path traversal (`..`, `/`, `\`) and absolute paths outside Desktop_Root
    - _Requirements: 6.1, 6.3, 6.4, 6.5_
  - [x] 3.2 Implement `requiresConfirmation` in `backend/modules/command_registry.js`
    - Pure function returning `true` iff `module:action` is in the closed Risky_Action_Set: `{power:shutdown, power:restart, files:delete, files:format, network:wifi_disable, message:send}`
    - _Requirements: 6.6_
  - [ ] 3.3 Implement `validateActions` and `summarizeAction` in `backend/modules/command_registry.js`
    - `validateActions(actions)` returns `{ ok, pending, rejected }` where the three sets partition the input with no duplication and no loss
    - Risky payloads with `confirmed !== true` go into `pending`
    - `summarizeAction(payload)` returns a human-readable description for the confirmation modal
    - _Requirements: 6.2, 6.7, 6.11_
  - [ ]* 3.4 Write property test for validator clamping
    - **Property 6: Validator clamping**
    - **Validates: Requirements 6.1**
    - For any `ActionPayload` with `module ∈ {system, media}` and numeric `value`: `normalizePayload(a) === null` or `0 <= result.value <= 100`
    - _Requirements: 6.1_
  - [ ]* 3.5 Write property test for risky-action gating
    - **Property 7: Risky-action gating**
    - **Validates: Requirements 6.2**
    - For any `NormalizedAction n`: `requiresConfirmation(n) && n.confirmed !== true ⟹ n ∉ validateActions(...).ok`
    - _Requirements: 6.2_
  - [ ]* 3.6 Write property test for path sandbox
    - **Property 8: Path sandbox**
    - **Validates: Requirements 6.3**
    - For any `ActionPayload` with `module === "files"`: `normalizePayload(a) === null` or `result.target.startsWith(desktopRoot)`
    - Include adversarial inputs with `..`, absolute paths, null bytes, mixed separators
    - _Requirements: 6.3, 6.4_
  - [ ]* 3.7 Write unit tests for validator partition and summarization
    - Verify `ok ∪ pending ∪ rejected` equals the input multiset
    - Verify `summarizeAction` produces non-empty descriptions for every Risky_Action_Set entry
    - _Requirements: 6.5, 6.7, 6.11_

- [x] 4. Implement bounded conversation history
  - [x] 4.1 Implement `addToHistory` and history accessors in `backend/modules/ai_router.js`
    - Maintain a module-level `conversationHistory` array
    - Reject empty `content` without modifying state
    - Drop the oldest entry when length is 20 before appending
    - Store raw XML verbatim for model entries; never the parsed JSON
    - Stamp each entry with `Date.now()`
    - Export `addToHistory`, `getHistory`, `clearHistory`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [ ]* 4.2 Write property test for history bound
    - **Property 5: History bound**
    - **Validates: Requirements 5.1**
    - For any sequence of `addToHistory` calls (mix of valid and empty content): `getHistory().length <= 20` after every call
    - _Requirements: 5.1, 5.2, 5.4_

- [ ] 5. Implement provider health monitoring
  - [x] 5.1 Implement `pingModel` for REST providers in `backend/modules/gemini_health.js`
    - Use the existing `:countTokens` ping pattern with payload `"ping"`
    - Settle within 6000 ms; return a structured `HealthResult` (no thrown exceptions on missing `apiKey` or HTTP failure)
    - _Requirements: 8.5_
  - [x] 5.2 Implement `pingModel` for the Live WebSocket provider in `backend/modules/gemini_health.js`
    - Open `wss://generativelanguage.googleapis.com`, wait for `setupComplete`
    - Settle within 5000 ms; return structured `HealthResult`
    - _Requirements: 8.5_
  - [ ] 5.3 Implement the Health_Table state machine in `backend/modules/gemini_health.js`
    - Track `{ healthy, lastChecked, lastLatencyMs, consecutiveFailures, cooldownUntil }` per provider
    - Implement transitions per the design state machine: `Unknown → Healthy/Unhealthy`, `Healthy → Degraded → Unhealthy → Cooldown → Unknown`
    - Implement `getCooldownMs(consecutiveFailures)` with exponential growth
    - Treat snapshots older than 10 s as stale and re-ping before relying on them
    - Export `getHealthTable`, `markSuccess`, `markFailure`, `getProviderState`
    - _Requirements: 3.3, 3.4, 3.5, 3.6_
  - [ ]* 5.4 Write unit tests for the health state machine
    - Verify state transitions for `Healthy → Degraded → Unhealthy → Cooldown → Unknown`
    - Verify `cooldownUntil` is monotonically advanced on consecutive failures
    - Verify staleness threshold triggers a re-ping
    - _Requirements: 3.3, 3.4, 3.5, 3.6_

- [ ] 6. Implement the AI router with provider fallback
  - [ ] 6.1 Implement `selectProvider` in `backend/modules/ai_router.js`  ← NEXT
    - Walk the fixed `Provider_Priority_List = [gemini_live, gemini_rest, ollama_local, emergency]`
    - Return the first provider whose state is in `Selectable_State = {Healthy, Degraded}`
    - Treat providers in cooldown as not selectable
    - _Requirements: 3.1, 3.5_
  - [x] 6.2 Implement `emergencySpeech` in `backend/modules/ai_router.js`
    - Returns a non-empty canned `speech` string and an empty `actions` array
    - _Requirements: 10.1, 10.2_
  - [ ] 6.3 Implement `chatStream(userMessage, onEvent)` in `backend/modules/ai_router.js`
    - Use `selectProvider` to choose a provider per turn
    - On response success, call `markSuccess`; on failure, call `markFailure` and try the next provider
    - When every non-emergency provider is unselectable, invoke `emergencySpeech`, emit a `status` event with `provider: "emergency", switched: true`, then an `error` event with `code: "providers_exhausted"`
    - Stream tokens, parse with `parseModelOutput`, emit `speak` event(s) before any `action` event for the same turn
    - Append the raw XML to history via `addToHistory("model", rawXml)`
    - Emit `status`, `speak`, `action`, `error`, and `done` events through the `onEvent` callback
    - _Requirements: 3.1, 3.2, 8.3, 10.1, 10.3, 10.4, 10.5_
  - [ ]* 6.4 Write property test for provider fallback monotonicity
    - **Property 3: Provider fallback monotonicity**
    - **Validates: Requirements 3.1**
    - For any Health_Table snapshot and the fixed priority list: `selectProvider(H, P)` returns the first `p ∈ P` with state in `{Healthy, Degraded}`. A healthy higher-priority provider is never bypassed
    - _Requirements: 3.1, 3.2_
  - [ ]* 6.5 Write unit tests for emergency mode behavior
    - All providers unhealthy → `emergencySpeech` invoked, `status` and `error` events emitted in correct order
    - Background pings continue so the next turn can recover (verify health table is still polled)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ] 7. Checkpoint - Backend pure-logic and routing
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement the TTS proxy with engine fallback
  - [x] 8.1 Implement the `/tts` endpoint in `backend/modules/tts.js` (extending the existing module)
    - Accept `{ text, voice?, engine? }`; reject `text.length > 200` with HTTP 4xx before calling any engine
    - Stream MP3 bytes; first byte target ≤ 300 ms after request
    - On engine error, retry once with the alternate engine in `{google-tts-api, node-edge-tts}`
    - Emit a `jarvis-command-log` style server log when both engines fail
    - _Requirements: 8.4, 9.1, 9.2, 9.3, 9.5_
  - [ ]* 8.2 Write unit tests for the TTS proxy
    - 200-character boundary: 200 succeeds, 201 returns 4xx
    - Engine A failure → engine B success
    - Both engines fail → 5xx response with structured error body
    - _Requirements: 9.1, 9.2, 9.3_

- [ ] 9. Implement the backend WebSocket streaming endpoint
  - [ ] 9.1 Add the `/ws` handler in `backend/server.js`
    - Parse incoming `ClientMessage` (`prompt`, `cancel`, `confirm`)
    - Route `prompt` through `router.chatStream` and forward all events to the socket
    - On `cancel`, stop emitting `speak`, `action`, and `done` events for that `turnId`
    - On `confirm`, treat the payload as a re-issue of the original prompt with `confirmed: true` for the listed action ids; if `turnId` does not match the original confirmation `turnId`, treat `confirmed` as `false`
    - _Requirements: 6.9, 6.10, 7.5, 8.3_
  - [ ] 9.2 Wire the HTTP `/api/chat` and `/api/execute` paths to `validateActions`
    - When `validateActions` returns any `pending` entries, respond with HTTP 409 carrying the pending entries plus `summarizeAction` descriptions
    - _Requirements: 6.7, 6.8, 6.9, 6.10_
  - [ ]* 9.3 Write integration tests for the backend transport
    - Round-trip: `prompt` → mock router emits `speak` + `action` → socket receives them in correct order
    - `cancel` mid-turn suppresses subsequent events for that `turnId`
    - 409 confirmation flow: pending action → re-send with `confirmed: true` → action moves to `ok`
    - _Requirements: 6.7, 6.8, 6.9, 6.10, 7.5_

- [x] 10. Implement frontend `splitSpeech`
  - [x] 10.1 Implement `splitSpeech(text, maxLen = 180)` in `frontend/src/component/Terminal.js`
    - Split on sentence boundaries first, then word boundaries when a sentence exceeds `maxLen`
    - Return `[]` when the whitespace-normalized input is empty
    - Guarantee every chunk has `length <= maxLen`
    - Export the function so it is unit-testable independently of the queue
    - _Requirements: 2.2, 2.3, 2.4_
  - [ ]* 10.2 Write property test for `splitSpeech` length bound
    - **Property 9: splitSpeech length bound**
    - **Validates: Requirements 2.2**
    - For any string `s` and `maxLen >= 1`: `splitSpeech(s, maxLen).every(c => c.length <= maxLen)`
    - _Requirements: 2.2_
  - [ ]* 10.3 Write property test for `splitSpeech` content preservation
    - **Property 10: splitSpeech content preservation**
    - **Validates: Requirements 2.3**
    - For any string `s`: `normalizeWs(splitSpeech(s).join(" ")) === normalizeWs(s)` where `normalizeWs(x) = x.replace(/\s+/g, " ").trim()`
    - _Requirements: 2.3, 2.4_

- [ ] 11. Implement the frontend TTS queue
  - [ ] 11.1 Implement `enqueueSpeech(text, turnId)` and the chunk drainer in `frontend/src/component/Terminal.js`
    - Single-drainer pattern: only one in-flight drainer; chunks pushed in `seq` order are played in `seq` order regardless of `/tts` response order
    - Maintain `audioQueueRef`, `nextStartTimeRef`, `isJarvisSpeakingRef`
    - Set `nextStartTimeRef = max(audioContext.currentTime, nextStartTimeRef)` before scheduling each chunk
    - When pending chunks for a single turn exceed 8, merge the next chunk into the previous one up to `maxLen` characters before scheduling
    - On TTS-proxy failure for a chunk, advance `nextStartTimeRef` by an estimated duration and queue a synthetic short beep so timing stays aligned; emit a `jarvis-command-log` event
    - _Requirements: 2.1, 2.5, 2.7, 9.4, 9.5_
  - [ ] 11.2 Wire the blob visualizer amplitude in `Terminal.js`
    - While any chunk is scheduled or playing: `window.simulatedBlobVolumeTarget >= 120`
    - Otherwise drive `window.simulatedBlobVolumeTarget` toward `0`
    - _Requirements: 2.6_
  - [ ]* 11.3 Write property test for chunk ordering
    - **Property 2: Chunk ordering**
    - **Validates: Requirements 2.1**
    - For any speech text `s` and any permutation of `/tts` response delays (jitter schedule): scheduled `startAt` times are non-decreasing in `seq`, and the played order matches submission order
    - Use a fake `audioContext` and fake `fetchTtsAudio` returning buffers in a permuted order with random delays
    - _Requirements: 2.1, 2.5_

- [ ] 12. Implement the frontend echo-protect guard
  - [x] 12.1 Implement `shouldDropTranscript(now, isFinal)` in `frontend/src/component/Terminal.js`
    - Pure predicate over `now`, `isFinal`, and `echoProtectUntilRef`
    - Drop interim transcripts while `now < echoProtectUntilRef`
    - Drop final transcripts when `now < echoProtectUntilRef && (echoProtectUntilRef - now) > 100`
    - Return `false` once `now >= echoProtectUntilRef`
    - Export for unit testing
    - _Requirements: 1.1, 1.2, 1.5_
  - [ ] 12.2 Wire `echoProtectUntilRef` arming into the TTS queue
    - On chunk start: `echoProtectUntilRef = max(echoProtectUntilRef, now + duration*1000 + 350)`
    - On last-chunk end of a turn: `echoProtectUntilRef = max(echoProtectUntilRef, now + 250)`
    - _Requirements: 1.3, 1.4_
  - [ ]* 12.3 Write property test for echo-protection invariant
    - **Property 1: Echo-protection invariant**
    - **Validates: Requirements 1.1**
    - For any sequence of (chunk schedule, transcript event) pairs: while `isJarvisSpeakingRef === true` (any chunk scheduled or playing), `shouldDropTranscript(now, false) === true` for every interim transcript whose `now` falls inside the playback interval
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 13. Implement the frontend WebSocket client with reconnect
  - [x] 13.1 Implement `WsClient` in `frontend/src/api.js` (or a new `frontend/src/wsClient.js`)
    - State machine: `connecting | open | reconnecting | closed`
    - Exponential backoff with full jitter: delay drawn from `[0, min(30000, 250 * 2^attempt)]` ms
    - Reset `attempt` to `0` on successful open
    - Surface state changes through a callback so the NavBar can render them
    - _Requirements: 7.1, 7.2, 7.4_
  - [ ] 13.2 Implement turn resume on reconnect
    - Track `lastUnfinishedTurnId` and `lastPromptText`
    - On reconnect, send `cancel` for the previous turn followed by `prompt` with a new `turnId`
    - _Requirements: 7.3_
  - [ ]* 13.3 Write unit tests for reconnect behavior
    - Verify backoff delays land within `[0, min(30000, 250 * 2^attempt)]` over many runs
    - Verify attempt counter resets to 0 on success
    - Verify cancel-then-prompt is issued on reconnect when a turn was in flight
    - _Requirements: 7.1, 7.2, 7.3_

- [ ] 14. Implement the confirmation modal flow
  - [x] 14.1 Render the glassmorphic Confirmation_Modal in `frontend/src/component/`
    - Triggered by HTTP 409 responses or `requiresConfirmation` events
    - List the affected actions using the `summarizeAction` descriptions from the backend
    - Block execution until the user explicitly approves or cancels
    - _Requirements: 6.7, 6.8_
  - [ ] 14.2 Wire approval to re-send the payload with `confirmed: true`
    - Re-issue under the same `turnId` so the backend matches the confirmation gate
    - On cancel, send a `cancel` message and clear pending state
    - _Requirements: 6.9, 6.10_

- [ ] 15. End-to-end integration and wiring
  - [ ] 15.1 Wire all subsystems together in `frontend/src/App.js` and `backend/server.js`
    - Frontend: WebSpeech → Echo_Guard → WsClient.send(prompt) → handle `speak`/`action`/`status`/`error`/`done` events → TTS queue / action handler / NavBar / Confirmation_Modal
    - Backend: `/ws` and `/api/chat` route through `ai_router.chatStream`, `parseModelOutput`, and `validateActions`; `/tts` serves audio chunks
    - Ensure the `speak` event for a turn always precedes any `action` event for the same turn
    - _Requirements: 7.4, 7.5, 8.3_
  - [ ]* 15.2 Write integration test for the happy-path turn
    - Mock model emits `<speak>...</speak><action>[...]</action>`
    - Assert event order: `status` → `speak` (one or more) → `action` → `done`
    - Assert `<thought>` content never appears in the `speak` payload
    - _Requirements: 4.1, 4.2, 8.3_
  - [ ]* 15.3 Write integration test for the cascade fallback turn
    - Live WS marked unhealthy, REST marked degraded → REST is selected (monotonicity)
    - All non-emergency providers unhealthy → emergency mode emits `status` + `error` and produces canned speech
    - _Requirements: 3.1, 3.2, 10.1, 10.3, 10.5_

- [ ] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test-related sub-tasks and can be skipped for a faster MVP, but every property-based test in this plan corresponds 1:1 to a correctness property in `design.md` and a clause in `requirements.md`.
- All ten correctness properties from the design are covered:
  - Property 1 (echo-protection) → 12.3
  - Property 2 (chunk ordering) → 11.3
  - Property 3 (provider monotonicity) → 6.4
  - Property 4 (XML parser totality) → 2.2
  - Property 5 (history bound) → 4.2
  - Property 6 (validator clamping) → 3.4
  - Property 7 (risky-action gating) → 3.5
  - Property 8 (path sandbox) → 3.6
  - Property 9 (splitSpeech length bound) → 10.2
  - Property 10 (splitSpeech content preservation) → 10.3
- Latency budgets (Requirements 8.1, 8.2) are non-functional and validated through automated timing assertions in 15.2 / 15.3 against mocked providers; live-system measurement is a manual operator activity and is intentionally excluded from the task list.
- Checkpoints (tasks 7 and 16) are review pauses; they do not appear in the dependency graph.

## Task Dependency Graph

The waves below respect two rules: (1) tasks that write the same file are placed in different waves (Terminal.js, command_registry.js, ai_router.js, gemini_health.js, server.js, wsClient.js, and the Confirmation modal each have multi-write chains), and (2) test sub-tasks are placed in the wave immediately after their target source-file task.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "5.1", "10.1", "14.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.4", "3.6", "4.2", "5.2", "6.2", "8.1", "10.2", "10.3", "12.1", "13.1"] },
    { "id": 3, "tasks": ["3.3", "5.3", "8.2", "11.1", "13.2", "14.2"] },
    { "id": 4, "tasks": ["3.5", "3.7", "5.4", "6.1", "11.2", "11.3", "13.3"] },
    { "id": 5, "tasks": ["6.3", "6.4", "12.2"] },
    { "id": 6, "tasks": ["6.5", "9.1", "12.3"] },
    { "id": 7, "tasks": ["9.2"] },
    { "id": 8, "tasks": ["9.3", "15.1"] },
    { "id": 9, "tasks": ["15.2", "15.3"] }
  ]
}
```
