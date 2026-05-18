# Requirements Document

## Introduction

The JARVIS Voice Pipeline is the full-duplex, real-time voice control loop that turns spoken user input into validated system actions and synthesized spoken replies. It spans a React HUD frontend (WebSpeech recognition, chunked TTS playback through a `/tts` proxy, an echo-protect guard, a 3D blob visualizer, and a glassmorphic confirmation modal) and a Node.js Express + WebSocket backend that routes prompts through `ai_router.js` with a four-tier provider fallback (Gemini Live WS → Gemini REST → Ollama Local → Emergency Offline), parses XML-tagged model output, and gates actions through `command_registry.js`.

These requirements describe the externally observable behavior the pipeline must guarantee: ordered low-latency playback, safe execution of model-emitted commands, deterministic provider selection, total parsing of untrusted model output, bounded conversation memory, and a resilient streaming transport. Each requirement is written so that the corresponding correctness property in `design.md` can be verified against it.

## Glossary

- **Voice_Pipeline**: The end-to-end system that converts user speech into validated actions and synthesized speech, comprising the Browser Client and Backend.
- **Browser_Client**: The React HUD frontend, including WebSpeech recognition, the TTS_Queue, the Echo_Guard, the WS_Client, and the Blob_Visualizer.
- **Backend**: The Node.js Express + WebSocket server hosting `ai_router.js`, `command_registry.js`, the XML_Parser, the History_Store, and the TTS_Proxy.
- **TTS_Queue**: The frontend component (`Terminal.js`) that splits speech via `splitSpeech`, fetches audio chunks through the TTS_Proxy, and plays them in submission order.
- **splitSpeech**: The pure function that breaks a speech string into chunks of at most a configured maximum length (default 180 characters).
- **Echo_Guard**: The frontend component that gates WebSpeech transcripts using `echoProtectUntilRef` so the microphone cannot hear JARVIS's own audio output.
- **WS_Client**: The browser WebSocket client that streams prompts and receives `speak`, `action`, `status`, `error`, and `done` events.
- **Blob_Visualizer**: The 3D particle visualizer (`blob.js`) whose amplitude target is driven by the TTS_Queue via `window.simulatedBlobVolumeTarget`.
- **AI_Router**: The backend component (`ai_router.js`) that selects a provider, streams the response, parses XML, and emits structured events.
- **Provider**: One of the four AI providers, each identified by a `ProviderId` from `{gemini_live, gemini_rest, ollama_local, emergency}`, listed in priority order.
- **Provider_Priority_List**: The fixed list `[gemini_live, gemini_rest, ollama_local, emergency]` consulted on every turn.
- **Health_Table**: A map from `ProviderId` to a `ProviderHealth` snapshot (`healthy`, `lastChecked`, `lastLatencyMs`, `consecutiveFailures`, `cooldownUntil`).
- **Provider_State**: One of `Unknown`, `Healthy`, `Degraded`, `Unhealthy`, or `Cooldown`, computed from a `ProviderHealth` snapshot.
- **Selectable_State**: The set `{Healthy, Degraded}`. A provider is selectable iff its state is in this set.
- **XML_Parser**: The total function `parseModelOutput(raw)` that returns `{speak, actions, thoughtsStripped, malformed}`.
- **Thought_Block**: Any substring of the raw model output matching `<thought ...>...</thought>` (case-insensitive).
- **Speak_Block**: Any substring of the raw model output matching `<speak ...>...</speak>` (case-insensitive).
- **Action_Block**: Any substring of the raw model output matching `<action ...>...</action>` (case-insensitive).
- **Command_Registry**: The backend module (`command_registry.js`) exposing `normalizePayload`, `requiresConfirmation`, and `summarizeAction`.
- **Action_Payload**: A model-emitted command object with at least `module` and `action` fields.
- **Normalized_Action**: A validated, clamped, and sandboxed `Action_Payload` returned by `normalizePayload`.
- **Risky_Action_Set**: The closed set `{power:shutdown, power:restart, files:delete, files:format, network:wifi_disable, message:send}`.
- **Desktop_Root**: The absolute filesystem path of the user's Desktop directory.
- **Confirmation_Modal**: The glassmorphic UI modal in the Browser_Client that requests explicit user approval before re-issuing a Risky_Action with `confirmed: true`.
- **TTS_Proxy**: The `/tts` HTTP endpoint that streams MP3 audio for a single chunk using `google-tts-api` (primary) or `node-edge-tts` (secondary).
- **History_Store**: The sliding `conversationHistory` buffer maintained by AI_Router.
- **Turn**: One user-prompt-to-system-reply cycle, identified by a `turnId`.
- **First_Audio_Latency**: The wall-clock interval from end-of-utterance to the first audible byte of JARVIS's reply on the user's speakers.

## Requirements

### Requirement 1: Echo Protection During TTS Playback

**User Story:** As a user speaking to JARVIS, I want the microphone to ignore JARVIS's own voice while it is speaking, so that the assistant does not transcribe its own output and enter an echo loop.

#### Acceptance Criteria

1. WHILE the TTS_Queue is playing any audio chunk, THE Echo_Guard SHALL cause `shouldDropTranscript(now, false)` to return `true` for every interim WebSpeech transcript.
2. WHILE the TTS_Queue is playing any audio chunk, THE Echo_Guard SHALL cause `shouldDropTranscript(now, true)` to return `true` for any final WebSpeech transcript whose `now` satisfies `echoProtectUntilRef - now > 100`.
3. WHEN the TTS_Queue starts playback of an audio chunk of duration `d` seconds, THE Browser_Client SHALL set `echoProtectUntilRef` to a value greater than or equal to `now + d * 1000 + 350`.
4. WHEN the TTS_Queue finishes playback of the last scheduled chunk for a Turn, THE Browser_Client SHALL set `echoProtectUntilRef` to a value greater than or equal to `now + 250`.
5. WHEN `now >= echoProtectUntilRef`, THE Echo_Guard SHALL cause `shouldDropTranscript(now, isFinal)` to return `false` for every value of `isFinal`.

### Requirement 2: Chunked TTS Playback Ordering and Bounds

**User Story:** As a user, I want JARVIS's spoken replies to be played gaplessly and in the original sentence order regardless of network jitter, so that the response sounds coherent and arrives quickly.

#### Acceptance Criteria

1. WHEN the TTS_Queue receives speech text for a Turn and enqueues `N` chunks via `splitSpeech`, THE TTS_Queue SHALL play those chunks in strictly increasing `seq` order from `0` to `N-1`, regardless of the order in which the TTS_Proxy responds.
2. WHEN `splitSpeech(s, maxLen)` is called with any string `s` and integer `maxLen >= 1`, THE Browser_Client SHALL return a list in which every element has `length <= maxLen`.
3. WHEN `splitSpeech(s)` is called with any string `s`, THE Browser_Client SHALL return a list whose elements joined by a single space, after whitespace normalization (`/\s+/g` → `" "` and trim), equal `s` after the same whitespace normalization.
4. WHEN `splitSpeech(s)` is called with a string `s` whose whitespace-normalized form is empty, THE Browser_Client SHALL return an empty list.
5. WHEN the TTS_Queue schedules an audio chunk for playback, THE TTS_Queue SHALL set `nextStartTimeRef` to a value greater than or equal to the chunk's scheduled `startAt + duration`.
6. WHILE any chunk for a Turn is scheduled or playing, THE TTS_Queue SHALL drive `window.simulatedBlobVolumeTarget` to a value greater than or equal to `120`, and otherwise THE TTS_Queue SHALL drive it toward `0`.
7. WHILE the TTS_Queue contains more than 8 pending chunks for a single Turn, THE TTS_Queue SHALL merge the next chunk into the previous chunk up to `maxLen` characters before scheduling.

### Requirement 3: Provider Fallback Monotonicity

**User Story:** As a system operator, I want the AI_Router to always prefer the highest-priority healthy provider, so that quality and latency do not silently degrade when the primary is available.

#### Acceptance Criteria

1. WHEN the AI_Router selects a Provider for a Turn, THE AI_Router SHALL return the first Provider in the Provider_Priority_List whose Provider_State (derived from the Health_Table) is in the Selectable_State set.
2. IF no Provider in the Provider_Priority_List has a Provider_State in the Selectable_State set, THEN THE AI_Router SHALL select `emergency` and emit a `status` event with `provider = "emergency"` and `switched = true`.
3. WHEN a Provider's response succeeds, THE AI_Router SHALL transition that Provider's state toward `Healthy` per the Fallback State Machine and reset `consecutiveFailures` to `0`.
4. WHEN a Provider's response fails, THE AI_Router SHALL increment `consecutiveFailures`, transition the Provider's state per the Fallback State Machine, and set `cooldownUntil` according to `getCooldownMs(consecutiveFailures)`.
5. WHILE a Provider's `cooldownUntil` is greater than `now`, THE AI_Router SHALL treat that Provider as not in the Selectable_State set.
6. WHEN the Health_Table entry for a Provider is older than 10 seconds, THE AI_Router SHALL re-ping that Provider via `gemini_health.pingModel` before relying on its state for selection.

### Requirement 4: XML Parser Totality and Thought Stripping

**User Story:** As a security-conscious developer, I want every model response to be parsed into a well-typed result with all internal reasoning removed, so that no chain-of-thought ever reaches TTS and no malformed output crashes the pipeline.

#### Acceptance Criteria

1. WHEN `parseModelOutput(raw)` is invoked with any string `raw` (including empty, whitespace-only, malformed, or arbitrary unicode), THE XML_Parser SHALL return a result object where `typeof result.speak === "string"` and `Array.isArray(result.actions) === true`.
2. WHEN `parseModelOutput(raw)` is invoked, THE XML_Parser SHALL ensure that for every Thought_Block in `raw` with non-empty inner content `t`, the substring `t` does not appear in `result.speak`.
3. WHEN `raw` contains at least one Speak_Block, THE XML_Parser SHALL set `result.speak` to the trimmed inner content of the first Speak_Block.
4. WHEN `raw` contains no Speak_Block, THE XML_Parser SHALL set `result.speak` to the trimmed residue of `raw` after removing all Thought_Blocks and all Action_Blocks.
5. WHEN `raw` contains no Speak_Block and the trimmed non-thought, non-action residue is empty while the cleaned text is non-empty, THE XML_Parser SHALL set `result.malformed = true`.
6. WHEN `raw` contains one or more Action_Blocks, THE XML_Parser SHALL parse each Action_Block using `extractJsonCandidates` and append every successfully parsed object to `result.actions`.
7. IF JSON parsing of any Action_Block fails for every candidate produced by `extractJsonCandidates`, THEN THE XML_Parser SHALL omit that Action_Block from `result.actions` without throwing.
8. WHEN at least one Thought_Block is removed from `raw`, THE XML_Parser SHALL set `result.thoughtsStripped = true`.

### Requirement 5: Bounded Conversation History

**User Story:** As a backend operator, I want the conversation history to stay within a fixed size, so that token costs and memory usage remain predictable across long sessions.

#### Acceptance Criteria

1. WHEN `addToHistory(role, content)` is called any number of times in any sequence, THE History_Store SHALL maintain `conversationHistory.length <= 20` after every call.
2. WHEN `addToHistory(role, content)` is called and `conversationHistory.length === 20`, THE History_Store SHALL drop the oldest entry before appending the new entry.
3. WHEN `addToHistory(role, content)` is called with a non-empty `content`, THE History_Store SHALL append an entry whose `role` and `content` equal the arguments and whose `timestamp` is the current epoch milliseconds.
4. IF `addToHistory(role, content)` is called with empty `content`, THEN THE History_Store SHALL reject the call without modifying `conversationHistory`.
5. WHEN AI_Router records a model Turn in the History_Store, THE AI_Router SHALL store the raw XML response verbatim, with no JSON serialization of parsed actions.

### Requirement 6: Action Validation, Clamping, Risky-Action Gating, and Path Sandboxing

**User Story:** As a user delegating system control to JARVIS, I want every action to be range-checked, sandboxed to safe filesystem locations, and confirmed before destructive operations execute, so that no model output can damage the system or escape its intended scope.

#### Acceptance Criteria

1. WHEN `normalizePayload(a)` is called with an Action_Payload `a` whose `module ∈ {system, media}` and whose `value` is a number, THE Command_Registry SHALL return either `null` or a Normalized_Action whose `value` satisfies `0 <= value <= 100`.
2. WHEN `validateActions(actions)` processes a Normalized_Action `n` for which `requiresConfirmation(n)` is `true` and `n.confirmed !== true`, THE Command_Registry SHALL place `n` in the `pending` partition and SHALL NOT place `n` in the `ok` partition.
3. WHEN `normalizePayload(a)` is called with an Action_Payload `a` whose `module === "files"` and whose `target` is defined, THE Command_Registry SHALL return either `null` or a Normalized_Action whose `target` is an absolute path that starts with Desktop_Root.
4. IF `a.target` contains any of `..`, `/`, or `\`, or otherwise fails `isSafeDesktopName`, THEN THE Command_Registry SHALL return `null` from `normalizePayload(a)`.
5. WHEN `normalizePayload(a)` is called with any input value (including `null`, `undefined`, primitives, or objects that fail schema validation), THE Command_Registry SHALL return `null` without throwing an exception.
6. WHEN `requiresConfirmation(n)` is invoked, THE Command_Registry SHALL return `true` if and only if `n.module:n.action` belongs to the Risky_Action_Set.
7. WHEN the Backend processes a request whose validated actions contain any pending entry, THE Backend SHALL respond with HTTP `409` (or a `requiresConfirmation` event over WebSocket) carrying the pending entries and a `summarizeAction` description for each.
8. WHEN the Browser_Client receives a `409` or `requiresConfirmation` event, THE Browser_Client SHALL display the Confirmation_Modal listing the affected actions and SHALL NOT execute them until the user explicitly approves.
9. WHEN the user approves the Confirmation_Modal, THE Browser_Client SHALL re-send the same payload with `confirmed: true` under the same `turnId`.
10. IF a payload arrives with `confirmed: true` whose `turnId` does not match the `turnId` under which the confirmation was issued, THEN THE Backend SHALL treat `confirmed` as `false` for the purpose of the risky-action gate.
11. WHEN `validateActions(actions)` returns `{ok, pending, rejected}`, THE Command_Registry SHALL ensure that `ok ∪ pending ∪ rejected` partitions the input list with no duplication and no loss.

### Requirement 7: WebSocket Streaming Transport with Reconnect

**User Story:** As a user, I want the assistant to recover automatically from transient network drops without losing my current request, so that I do not have to manually retry when the connection blips.

#### Acceptance Criteria

1. WHEN the WS_Client detects that `socket.state !== "open"`, THE WS_Client SHALL enter a reconnect loop that, on attempt `n`, waits a delay drawn uniformly from `[0, min(30000, 250 * 2^n)]` milliseconds before attempting to reconnect.
2. WHEN the WS_Client successfully establishes a new connection, THE WS_Client SHALL reset the attempt counter to `0`.
3. WHEN the WS_Client reconnects while a Turn is in flight, THE WS_Client SHALL send a `cancel` message for `lastUnfinishedTurnId` followed by a `prompt` message carrying the original prompt text under a newly generated `turnId`.
4. WHILE the WS_Client is in the `connecting` or `reconnecting` state, THE Browser_Client SHALL surface that state to the NavBar status indicator.
5. WHEN the Backend receives a `cancel` message for a `turnId`, THE Backend SHALL stop emitting `speak`, `action`, and `done` events for that `turnId`.

### Requirement 8: First-Audio Latency Budget

**User Story:** As a user, I want JARVIS's reply to begin within roughly one second of finishing my sentence, so that the conversation feels real-time.

#### Acceptance Criteria

1. WHEN the primary Provider is `Healthy` and its Health_Table entry is fresh (age < 10 s), THE Voice_Pipeline SHALL achieve First_Audio_Latency `<= 800` milliseconds for at least the median Turn.
2. WHEN the primary Provider is `Healthy` and its Health_Table entry is fresh, THE Voice_Pipeline SHALL achieve First_Audio_Latency `<= 1000` milliseconds for at least the 95th-percentile Turn.
3. WHEN the AI_Router has streamed enough tokens to form one complete Speak_Block, THE AI_Router SHALL emit a `speak` event for that block before any `action` event for the same Turn.
4. WHEN the TTS_Proxy receives a chunk request, THE TTS_Proxy SHALL begin streaming the first audio byte within `300` milliseconds of receiving the request.
5. WHEN `gemini_health.pingModel` is invoked, THE Backend SHALL settle the call within `6000` milliseconds for REST providers and within `5000` milliseconds for the Live WebSocket provider.

### Requirement 9: TTS Proxy Engine Fallback

**User Story:** As a user, I want spoken output to remain continuous even if one TTS engine fails, so that I rarely hear gaps or silence in JARVIS's voice.

#### Acceptance Criteria

1. WHEN the TTS_Proxy receives a chunk request with `text.length <= 200`, THE TTS_Proxy SHALL stream MP3 audio bytes for that text.
2. IF `text.length > 200`, THEN THE TTS_Proxy SHALL reject the request with a `4xx` status before invoking any synthesis engine.
3. WHEN the configured engine returns an error, THE TTS_Proxy SHALL retry the request once using the alternate engine from `{google-tts-api, node-edge-tts}`.
4. IF both engines fail for the same chunk, THEN THE TTS_Queue SHALL skip the chunk, advance `nextStartTimeRef` by an estimated chunk duration, and queue a synthetic short beep so subsequent chunks remain time-aligned.
5. WHEN the TTS_Queue skips a chunk due to TTS failure, THE Browser_Client SHALL emit a `jarvis-command-log` event so the diagnostic console records the skip.

### Requirement 10: Provider Exhaustion and Emergency Speech

**User Story:** As a user, I want JARVIS to give me a clear spoken response even when no AI provider is reachable, so that the system never appears silently broken.

#### Acceptance Criteria

1. WHEN every Provider in the Provider_Priority_List except `emergency` has a Provider_State outside the Selectable_State set, THE AI_Router SHALL invoke `emergencySpeech()` and treat its result as the Turn's response.
2. WHEN `emergencySpeech()` is invoked, THE AI_Router SHALL return a non-empty `speech` string and an empty `actions` array.
3. WHEN the AI_Router enters Emergency mode for a Turn, THE Backend SHALL emit a `status` event with `provider = "emergency"` and `switched = true` followed by an `error` event with `code = "providers_exhausted"`.
4. WHILE the AI_Router is operating in Emergency mode, THE Backend SHALL continue background health pings so that the next Turn re-evaluates the Health_Table.
5. WHEN the next Turn after Emergency mode begins and any non-emergency Provider has returned to the Selectable_State set, THE AI_Router SHALL select that Provider per Requirement 3.1.
