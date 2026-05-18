const config = require('./config');
const { negotiateModel } = require('./gemini_health');
const {
  normalizePayload,
  normalizeSimpleText,
  requiresConfirmation,
  summarizeAction,
} = require('./command_registry');

const SYSTEM_PROMPT = [
  "You are J.A.R.V.I.S., a clever but safe desktop assistant for Aditya.",
  "You speak naturally, briefly, and confidently. Your responses are read aloud.",
  "",
  "Return ONLY these two XML-like tags, in this order:",
  "<speak>Clear, natural, spoken response to Aditya. This is the only text that will be read aloud.</speak>",
  "<action>JSON array of actions to execute, or [] if only chatting. Format: [{\"module\":\"module_name\",\"action\":\"action_name\",\"value\":val}]</action>",
  "",
  "Never include hidden reasoning, chain-of-thought, analysis, scratchpad, markdown, or any text outside those two tags.",
  "",
  "Allowed actions:",
  "- {\"module\":\"apps\",\"action\":\"open|close\",\"value\":\"app_or_site\"}",
  "- {\"module\":\"apps\",\"action\":\"automate\",\"value\":{\"app\":\"app_name\",\"sequence\":[\"{WAIT:1000}\",\"text\",\"{ENTER}\"]}}",
  "- {\"module\":\"message\",\"action\":\"send\",\"value\":{\"app\":\"whatsapp|telegram\",\"contact\":\"name_or_phone\",\"message\":\"text\"}}",
  "- {\"module\":\"system\",\"action\":\"volume_set|volume_mute|volume_unmute|brightness_set|brightness_adjust|bluetooth_enable|bluetooth_disable\",\"value\":number_or_null}",
  "- {\"module\":\"power\",\"action\":\"sleep|restart|shutdown\",\"value\":null}",
  "- {\"module\":\"media\",\"action\":\"play_pause|next|prev\",\"value\":null}",
  "- {\"module\":\"files\",\"action\":\"create_folder|create_file|delete|sort_downloads|empty_recycle_bin\",\"value\":\"name_or_null\"}",
  "- {\"module\":\"productivity\",\"action\":\"create_note\",\"value\":\"note_text\"}",
  "- {\"module\":\"network\",\"action\":\"ping|wifi_enable|wifi_disable\",\"value\":\"target_or_null\"}",
  "- {\"module\":\"workspace\",\"action\":\"focus_mode|coding_mode\",\"value\":null}",
  "- {\"module\":\"web\",\"action\":\"search|wiki|weather|time|crypto|news|fetch\",\"value\":\"query_or_target\"}  ← live data tools (read-only)",
  "",
  "Live-data rules:",
  "- When the user asks about current events, today's weather/time/prices, anything past your training cutoff, or any factual question you are not sure about, EMIT a `web:*` action and let the system fetch the answer.",
  "- Prefer the typed tool that fits the query: weather→`web:weather`, who/what is→`web:wiki`, current time→`web:time`, crypto price→`web:crypto`, latest news→`web:news`. For everything else use `web:search`.",
  "- After you emit a `web:*` action, the system will fetch the data and re-prompt you with the result. Use that result to write a short, conversational `<speak>` answer.",
  "- Do NOT guess at facts you don't know — emit `web:search` instead.",
  "",
  "Rules:",
  "- Speak in the same style as Aditya, English or Roman Hinglish only.",
  "- If no action is needed, return empty: <action>[]</action>.",
  "- If the user intent is ambiguous, return no actions and ask one short question in <speak>.",
  "- For relative brightness requests, use brightness_adjust with a positive or negative delta. Choose a small practical delta such as +/-10 unless the user asks for a stronger change.",
  "- Do not wrap the JSON inside <action> with markdown code blocks. Keep it raw and valid.",
  "",
  "CRITICAL: You MUST emit <speak>...</speak> first, then <action>...</action>. Anything outside those tags is a bug.",
  "CRITICAL: <action> must contain only valid JSON, no markdown fences, no comments, no trailing commas.",
  "CRITICAL: Keep <speak> under 60 words. One or two sentences. Conversational, not robotic."
].join('\n');

const providers = [
  {
    id: 'gemini_primary',
    name: 'Gemini Primary',
    type: 'gemini',
    apiKey: config.geminiPrimaryApiKey,
    model: config.geminiPrimaryModel,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    configured: Boolean(config.geminiPrimaryApiKey),
    available: Boolean(config.geminiPrimaryApiKey),
    failCount: 0,
    cooldownUntil: 0,
    lastErrorCode: config.geminiPrimaryApiKey ? null : 'MISSING_API_KEY',
    lastError: config.geminiPrimaryApiKey ? null : 'API key is not configured',
    maxTokens: 1024,
  },
  {
    id: 'gemini_fallback',
    name: 'Gemini Fallback',
    type: 'gemini',
    apiKey: config.geminiFallbackApiKey,
    model: config.geminiFallbackModel,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    configured: Boolean(config.geminiFallbackApiKey),
    available: Boolean(config.geminiFallbackApiKey),
    failCount: 0,
    cooldownUntil: 0,
    lastErrorCode: config.geminiFallbackApiKey ? null : 'MISSING_API_KEY',
    lastError: config.geminiFallbackApiKey ? null : 'API key is not configured',
    maxTokens: 1024,
  },
  {
    id: 'ollama_local',
    name: 'Ollama Local',
    type: 'ollama',
    model: config.ollamaModel,
    baseUrl: `${config.ollamaBaseUrl.replace(/\/$/, '')}/api/chat`,
    available: true,
    configured: true,
    failCount: 0,
    cooldownUntil: 0,
    maxTokens: 1024,
    manualOnly: true,
  },
  {
    id: 'emergency',
    name: 'Emergency Mode',
    type: 'emergency',
    available: true,
    configured: true,
    failCount: 0,
    cooldownUntil: 0,
  },
];

let conversationHistory = [];
let activeProviderId = providers.find((p) => p.available && !p.manualOnly)?.id || 'emergency';
let forceProviderId = null;
let lastProviderSwitch = null;
let healthCheckInterval = null;

const SMART_ROUTES = [
  { pattern: /\b(?:open|launch|start)\s+([\w .-]+)/i, module: 'apps', action: 'open', value: (m) => m[1] },
  { pattern: /\b(?:close|kill|exit|quit)\s+([\w .-]+)/i, module: 'apps', action: 'close', value: (m) => m[1] },
  { pattern: /\b(?:volume|vol)\s+(?:set\s+(?:to\s+)?|at\s+)?(\d{1,3})\b/i, module: 'system', action: 'volume_set', value: (m) => Number(m[1]) },
  { pattern: /\bmute\b/i, module: 'system', action: 'volume_mute', value: () => null },
  { pattern: /\bunmute\b/i, module: 'system', action: 'volume_unmute', value: () => null },
  { pattern: /\b(?:brightness)\s+(?:set\s+(?:to\s+)?|at\s+)?(\d{1,3})\b/i, module: 'system', action: 'brightness_set', value: (m) => Number(m[1]) },
  { pattern: /\b(?:play|pause)\b/i, module: 'media', action: 'play_pause', value: () => null },
  { pattern: /\b(?:next\s+(?:song|track)|skip)\b/i, module: 'media', action: 'next', value: () => null },
  { pattern: /\b(?:prev(?:ious)?\s+(?:song|track)|go\s+back)\b/i, module: 'media', action: 'prev', value: () => null },
  { pattern: /\b(?:disconnect|disable|turn\s+off|band\s+kar[oa]?)\s+(?:the\s+)?wifi\b/i, module: 'network', action: 'wifi_disable', value: () => null },
  { pattern: /\b(?:connect|enable|turn\s+on|chalu\s+kar[oa]?)\s+(?:the\s+)?wifi\b/i, module: 'network', action: 'wifi_enable', value: () => null },
  { pattern: /\bwifi\s+(?:disconnect|disable|off|band)\b/i, module: 'network', action: 'wifi_disable', value: () => null },
  { pattern: /\bwifi\s+(?:connect|enable|on|chalu)\b/i, module: 'network', action: 'wifi_enable', value: () => null },
  { pattern: /\b(?:disconnect|disable|turn\s+off|band\s+kar[oa]?)\s+(?:the\s+)?bluetooth\b/i, module: 'system', action: 'bluetooth_disable', value: () => null },
  { pattern: /\b(?:connect|enable|turn\s+on|chalu\s+kar[oa]?)\s+(?:the\s+)?bluetooth\b/i, module: 'system', action: 'bluetooth_enable', value: () => null },
  { pattern: /\b(?:sleep|hibernate)\b.*\b(?:computer|pc|system|laptop)\b/i, module: 'power', action: 'sleep', value: () => null },
  { pattern: /\b(?:restart|reboot)\b.*\b(?:computer|pc|system|laptop)\b/i, module: 'power', action: 'restart', value: () => null },
  { pattern: /\b(?:shut\s*down|power\s+off)\b/i, module: 'power', action: 'shutdown', value: () => null },
  { pattern: /\bfocus\s+mode\b/i, module: 'workspace', action: 'focus_mode', value: () => null },
  { pattern: /\bcoding\s+mode\b/i, module: 'workspace', action: 'coding_mode', value: () => null },
  { pattern: /\b(?:sort|organize|clean)\s+(?:my\s+)?downloads?\b/i, module: 'files', action: 'sort_downloads', value: () => null },
  { pattern: /\b(?:empty|clear)\s+(?:the\s+)?(?:recycle\s*bin|trash)\b/i, module: 'files', action: 'empty_recycle_bin', value: () => null },
];

const CONVERSATION_PATTERNS = [
  /\b(?:who|what|when|where|why|how|tell|explain|describe|define)\b/i,
  /\b(?:joke|story|poem|sing|advice)\b/i,
  /\b(?:how\s+are\s+you|kaise\s+ho|kya\s+hal)\b/i,
  /\b(?:thank|thanks|shukriya|dhanyavad)\b/i,
  /\b(?:good\s+morning|good\s+night|hello|hi|hey)\b/i,
];

function extractNumber(text) {
  const match = String(text).match(/\b(\d{1,3})\s*%?\b/);
  if (!match) return null;
  return Math.min(100, Math.max(0, Number(match[1])));
}

function cleanTarget(value) {
  return String(value || '')
    .replace(/\b(jarvis|please|pls|karo|kar|krdo|kar do|the|a|my|app|application)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Live-data fast paths (web:*). Run before the conversation gate so words
// like "who"/"what"/"tell" don't short-circuit a wiki/news lookup.
function tryWebFastPath(cleaned) {
  const lower = cleaned.toLowerCase();

  // weather in <place> / what's the weather in <place>
  let m = lower.match(/\b(?:what(?:'s| is)?\s+(?:the\s+)?)?weather(?:\s+(?:in|at|for))?\s+(.+?)(?:\s+today|\s+now|[?.!]*$)/i);
  if (m && m[1].trim()) return webAction('weather', m[1].trim());

  // what time (is it) in <place>
  m = lower.match(/\b(?:what(?:'s| is)?\s+the\s+)?time\s+(?:is\s+it\s+)?(?:in|at)\s+(.+?)[?.!]*$/i);
  if (m && m[1].trim()) return webAction('time', m[1].trim());

  // price of <coin> / how much is <coin> / <coin> price
  m = lower.match(/\b(?:price\s+of|how\s+much\s+is|value\s+of)\s+(.+?)(?:\s+(?:in\s+(?:usd|inr|dollars))?\s*)?[?.!]*$/i);
  if (m && m[1].trim()) return webAction('crypto', m[1].trim());
  m = lower.match(/^(bitcoin|btc|ethereum|eth|solana|sol|dogecoin|doge|cardano|ada|ripple|xrp|polkadot|dot|litecoin|ltc|polygon|matic|avalanche|avax|binance|bnb|shiba inu|shib)\s+price\b[?.!]*$/i);
  if (m) return webAction('crypto', m[1].trim());

  // latest news about <topic> / news about <topic>
  m = lower.match(/\b(?:latest\s+)?news(?:\s+(?:about|on|regarding))?\s+(.+?)[?.!]*$/i);
  if (m && m[1].trim()) return webAction('news', m[1].trim());

  // who is X / what is X / tell me about X
  m = lower.match(/\b(?:who\s+(?:is|was|are)|what\s+(?:is|are|was)|tell\s+me\s+about|tell\s+about)\s+(.+?)[?.!]*$/i);
  if (m && m[1].trim() && m[1].trim().length > 2) return webAction('wiki', m[1].trim());

  // search for X / google X / look up X / find me X
  m = lower.match(/\b(?:search\s+(?:for|the\s+web\s+for)|google|look\s+up|find\s+me)\s+(.+?)[?.!]*$/i);
  if (m && m[1].trim()) return webAction('search', m[1].trim());

  return null;
}

function structuredAction(module, action, value, speech = 'Right away, sir.') {
  return makeStructured({
    speech,
    actions: [{ module, action, value }],
    provider: 'smart_router',
    status: 'action',
  });
}

// Fast-path for live-data lookups. Speaks a brief acknowledgement; the actual
// data fetch happens in `executePayload` (server.js) and the result is shown
// to the user via the action-result UI. The speech is intentionally minimal
// — for natural-language synthesis (e.g. "It's 28°C and clear in Delhi"),
// the user can ask in a way that doesn't match these patterns and it'll
// fall through to the LLM tool-result loop instead.
function webAction(action, target) {
  const cleanedTarget = String(target || '').replace(/\b(jarvis|please|pls)\b/gi, '').trim();
  if (!cleanedTarget) return null;
  const ackByAction = {
    weather: `Looking up the weather for ${cleanedTarget}.`,
    time: `Checking the time in ${cleanedTarget}.`,
    crypto: `Fetching the price of ${cleanedTarget}.`,
    news: `Pulling the latest on ${cleanedTarget}.`,
    wiki: `Looking up ${cleanedTarget}.`,
    search: `Searching the web for ${cleanedTarget}.`,
    fetch: `Reading ${cleanedTarget}.`,
  };
  return structuredAction('web', action, cleanedTarget, ackByAction[action] || 'On it.');
}

function tryNaturalRoute(cleaned) {
  const lower = cleaned.toLowerCase();
  const number = extractNumber(lower);

  // -------- (existing fast paths below) --------
  if (/\b(volume|vol|sound|audio)\b/.test(lower)) {
    if (/\b(unmute|awaz\s+on|sound\s+on)\b/.test(lower)) {
      return structuredAction('system', 'volume_unmute', null);
    }
    if (/\b(mute|silent|silence|awaz\s+band|sound\s+off)\b/.test(lower)) {
      return structuredAction('system', 'volume_mute', null);
    }
    if (number !== null) {
      return structuredAction('system', 'volume_set', number);
    }
  }

  if (/\b(brightness|screen|display)\b/.test(lower) && number !== null) {
    return structuredAction('system', 'brightness_set', number, 'Brightness adjusted.');
  }

  if (/\bwifi\b/.test(lower)) {
    if (/\b(off|disable|disconnect|band|turn\s+off|shut)\b/.test(lower)) {
      return structuredAction('network', 'wifi_disable', null);
    }
    if (/\b(on|enable|connect|chalu|turn\s+on)\b/.test(lower)) {
      return structuredAction('network', 'wifi_enable', null);
    }
  }

  if (/\bbluetooth\b/.test(lower)) {
    if (/\b(off|disable|disconnect|band|turn\s+off|shut)\b/.test(lower)) {
      return structuredAction('system', 'bluetooth_disable', null);
    }
    if (/\b(on|enable|connect|chalu|turn\s+on)\b/.test(lower)) {
      return structuredAction('system', 'bluetooth_enable', null);
    }
  }

  if (/\b(next|skip)\b.*\b(song|track|music)?\b/.test(lower)) {
    return structuredAction('media', 'next', null);
  }
  if (/\b(previous|prev|back)\b.*\b(song|track|music)?\b/.test(lower)) {
    return structuredAction('media', 'prev', null);
  }
  if (/\b(play|pause|resume|stop)\b.*\b(song|track|music|media)?\b/.test(lower)) {
    return structuredAction('media', 'play_pause', null);
  }

  if (/\b(shutdown|shut\s+down|power\s+off|turn\s+off)\b.*\b(pc|computer|system|laptop)?\b/.test(lower)) {
    return structuredAction('power', 'shutdown', null);
  }
  if (/\b(restart|reboot)\b/.test(lower)) {
    return structuredAction('power', 'restart', null);
  }
  if (/\b(sleep|hibernate)\b/.test(lower)) {
    return structuredAction('power', 'sleep', null);
  }

  if (/\bfocus\s+mode\b/.test(lower)) return structuredAction('workspace', 'focus_mode', null);
  if (/\b(coding|developer|dev)\s+mode\b/.test(lower)) return structuredAction('workspace', 'coding_mode', null);

  let match = lower.match(/\b(?:open|launch|start|run|kholo|khol)\s+(.+)$/i);
  if (match) {
    const target = cleanTarget(match[1]);
    if (target && !/\s+and\s+/.test(target)) return structuredAction('apps', 'open', target);
  }

  match = lower.match(/\b(?:close|kill|quit|exit|band\s+kar|band)\s+(.+)$/i);
  if (match) {
    const target = cleanTarget(match[1]);
    if (target && !/\s+and\s+/.test(target)) return structuredAction('apps', 'close', target);
  }

  match = lower.match(/\b(?:create|make|new)\s+(?:a\s+)?folder\s+(?:named|called)?\s*(.+)$/i);
  if (match) return structuredAction('files', 'create_folder', cleanTarget(match[1]));

  match = lower.match(/\b(?:create|make|new)\s+(?:a\s+)?file\s+(?:named|called)?\s*(.+)$/i);
  if (match) return structuredAction('files', 'create_file', cleanTarget(match[1]));

  match = lower.match(/\b(?:delete|remove)\s+(.+)$/i);
  if (match) return structuredAction('files', 'delete', cleanTarget(match[1]));

  if (/\b(sort|organize|clean)\b.*\bdownloads?\b/.test(lower)) {
    return structuredAction('files', 'sort_downloads', null);
  }
  if (/\b(empty|clear)\b.*\b(recycle\s*bin|trash)\b/.test(lower)) {
    return structuredAction('files', 'empty_recycle_bin', null);
  }

  match = lower.match(/\b(?:take|create|make|write)\s+(?:a\s+)?note\s+(?:that|saying|about)?\s*(.+)$/i);
  if (match) return structuredAction('productivity', 'create_note', match[1].trim());

  match = lower.match(/\bping\s+([\w.-]+)\b/i);
  if (match) return structuredAction('network', 'ping', match[1]);

  match = lower.match(/\bsend\s+(.+?)\s+to\s+(.+?)\s+on\s+(whatsapp|telegram)\b/i);
  if (match) {
    return structuredAction('message', 'send', {
      app: match[3].toLowerCase(),
      contact: match[2].trim(),
      message: match[1].trim(),
    });
  }

  return null;
}

function getCooldownMs(failCount) {
  const base = 30000;
  const maxCooldown = 300000;
  return Math.min(base * Math.pow(2, failCount - 1), maxCooldown);
}

function providerError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function classifyGeminiError(status, message = '') {
  const text = String(message).toLowerCase();
  if (status === 429 || text.includes('rate limit') || text.includes('quota')) return 'RATE_LIMIT';
  if (status === 401 || status === 403 || text.includes('api key') || text.includes('permission')) return 'AUTH_ERROR';
  if (status === 404 || text.includes('not found') || text.includes('not supported')) return 'MODEL_NOT_FOUND';
  return 'HTTP_ERROR';
}

function isLiveGeminiModel(model) {
  const m = String(model || '');
  // Match the gemini_health.js definition: "live" OR "native-audio" models
  // both require the BidiGenerateContent WebSocket endpoint, not the REST
  // :generateContent path. Keeping this in sync prevents the health monitor
  // from marking a model healthy via WS while the chat path tries (and fails)
  // to call it over REST.
  return /live/i.test(m) || /native-audio/i.test(m);
}

// History bound: at most 20 entries. Each entry is { role, content, ts }.
// Model entries store the raw XML verbatim — never the parsed JSON — so that
// follow-up turns see the same structure the model emitted.
const HISTORY_MAX = 20;

function addToHistory(role, content) {
  // Reject empty / whitespace-only content without modifying state.
  if (typeof content !== 'string' || content.trim() === '') {
    return;
  }
  // Accept the spec roles ("user" | "model"). "assistant" is a back-compat
  // alias for "model" used by legacy callers in this module; any other role
  // is rejected without modifying state.
  const normalizedRole = role === 'assistant' ? 'model' : role;
  if (normalizedRole !== 'user' && normalizedRole !== 'model') {
    return;
  }
  // Drop the oldest entry whenever we are at or above the 20-entry bound,
  // BEFORE appending, so length stays <= 20 after every call.
  while (conversationHistory.length >= HISTORY_MAX) {
    conversationHistory.shift();
  }
  conversationHistory.push({
    role: normalizedRole,
    content, // verbatim; for model entries this is the raw XML response
    ts: Date.now(),
  });
}

function getHistory() {
  // Return a defensive copy so external callers cannot mutate the buffer.
  return conversationHistory.map((entry) => ({ ...entry }));
}

function buildMessages(userMessage) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory.slice(-10),
    { role: 'user', content: userMessage },
  ];
}

function toGeminiContents(messages) {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: (message.role === 'assistant' || message.role === 'model') ? 'model' : 'user',
      parts: [{ text: String(message.content || '') }],
    }));
}

function geminiThinkingConfig(model) {
  const name = String(model || '').toLowerCase();
  if (/gemini-3/.test(name)) {
    return { thinkingLevel: 'minimal', includeThoughts: false };
  }
  if (/gemini-2\.5|native-audio|live/.test(name)) {
    return { thinkingBudget: 0, includeThoughts: false };
  }
  return null;
}

function isThoughtPart(part) {
  if (!part || typeof part !== 'object') return false;
  if (part.thought === true || part.thought === 'true') return true;
  const type = String(part.metadata?.type || part.type || '').toLowerCase();
  return type.includes('thought') || type.includes('reasoning');
}

function visibleGeminiText(parts = []) {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part) => part?.text && !isThoughtPart(part))
    .map((part) => part.text)
    .join('');
}

function latestUserContent(messages) {
  const latest = [...messages].reverse().find((message) => message.role === 'user');
  return latest?.content || '';
}

function actionTag(actions) {
  return actions.length ? `[CMD:${JSON.stringify(actions)}]` : '';
}

function makeStructured({ speech, actions = [], provider, providerSwitch = null, status = 'chat' }) {
  const normalizedActions = [];
  const errors = [];

  for (const action of actions) {
    const normalized = normalizePayload(action);
    if (normalized) normalizedActions.push(normalized);
    else errors.push(`Rejected payload for ${action?.module || 'unknown'}.${action?.action || 'unknown'}`);
  }

  const finalActions = errors.length ? [] : normalizedActions;
  const needsConfirmation = finalActions.some(requiresConfirmation);
  const safeSpeech =
    normalizeSimpleText(speech, 600) ||
    (finalActions.length ? 'Right away, sir.' : "I'm here, sir.");

  return {
    success: errors.length === 0,
    speech: errors.length ? `I could not prepare that command. ${errors[0]}` : safeSpeech,
    response: finalActions.length ? actionTag(finalActions) : filterReasoning(safeSpeech),
    actions: finalActions,
    needsConfirmation,
    status,
    provider,
    providerSwitch,
    errors,
  };
}

function trySmartRoute(userMessage) {
  const cleaned = userMessage.replace(/\bjarvis\b/gi, '').trim();
  if (!cleaned) return null;

  if (/^(open|close|delete|send|message|call)$/i.test(cleaned)) {
    return makeStructured({
      speech: 'Which target should I use?',
      provider: 'smart_router',
      status: 'clarify',
    });
  }

  // Web fast-paths run BEFORE the conversation gate. The wiki/weather/news
  // patterns intentionally use words like "who", "what", "tell" that the
  // conversation gate would otherwise filter out — those are exactly the
  // queries that need a live lookup, not a chat fallback.
  const webShortcut = tryWebFastPath(cleaned);
  if (webShortcut) return webShortcut;

  for (const cp of CONVERSATION_PATTERNS) {
    if (cp.test(cleaned)) return null;
  }

  const natural = tryNaturalRoute(cleaned);
  if (natural) return natural;

  for (const route of SMART_ROUTES) {
    const match = cleaned.match(route.pattern);
    if (!match) continue;

    let value = route.value(match);
    if (route.module === 'apps') {
      value = String(value)
        .replace(/\b(jarvis|please|pls|karo|kar|the|a|my)\b/gi, '')
        .trim()
        .toLowerCase();
      if (!value || value.length < 2 || /\s+and\s+/i.test(value)) return null;
    }

    return makeStructured({
      speech: 'Right away, sir.',
      actions: [{ module: route.module, action: route.action, value }],
      provider: 'smart_router',
      status: 'action',
    });
  }

  return null;
}

function extractLegacyCommandActions(text) {
  // Bug 5: only scan for [CMD:...] when the response has no XML structure
  // at all, and only outside any tags. If the model emits [CMD:...] inside
  // a <thought>/<speak>/<action> block we must NOT pick it up here.
  const hasSpeak = /<speak(?:\s[^>]*)?>/i.test(text);
  const hasAction = /<action(?:\s[^>]*)?>/i.test(text);
  if (hasSpeak || hasAction) return null;

  // Strip every XML-ish tag block before searching so [CMD:...] tokens
  // that happen to live inside hidden-reasoning tags are never matched.
  const tagless = String(text).replace(/<([a-zA-Z_][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/g, '');

  const cmdStart = tagless.indexOf('[CMD:');
  if (cmdStart === -1) return null;

  const afterCmd = tagless.substring(cmdStart + 5);
  let depth = 0;
  let endIdx = -1;

  for (let i = 0; i < afterCmd.length; i++) {
    const ch = afterCmd[i];
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }

  if (endIdx === -1) return null;

  try {
    const jsonStr = afterCmd.substring(0, endIdx + 1);
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    return null;
  }
}

// --- Speech sanitizer (Bug A) -------------------------------------------
// Hidden-reasoning leakage has multiple failure modes:
//   1. Model emits everything on a single line: "Thoughts: ... Speak: ..."
//   2. Model wraps reasoning in <thought>/<scratchpad>/<analysis>/etc tags
//      that may be unclosed if the response was truncated.
//   3. Model leaks raw JSON, code fences, or [CMD:...] tokens into speech.
// The sanitizer is intentionally non-anchored and idempotent so we can
// safely apply it per-fragment during streaming.

const HIDDEN_TAG_NAMES = [
  'thought', 'thoughts', 'think', 'thinking', 'scratchpad',
  'reasoning', 'analysis', 'system', 'action', 'plan',
  'reflection', 'tool_call', 'tool_use'
];
const REASONING_LABEL_RE = /\b(?:thoughts?|thinking|reasoning|analysis|scratchpad|internal monologue|plan|reflection)\s*:/i;
const SPEECH_LABEL_RE = /\b(?:speak|response|final|answer)\s*:\s*/i;
const FALLBACK_SPEECH = 'Acknowledged, sir.';

function looksMalformed(text) {
  if (!text) return true;
  if (text.length > 800) return true;
  const lower = text.toLowerCase();
  if (lower.includes('thinkingbudget') || lower.includes('includethoughts')) return true;
  // High brace density usually means raw JSON leaked into the speech path.
  const braceCount = (text.match(/[{}]/g) || []).length;
  if (braceCount > 0 && braceCount / Math.max(text.length, 1) > (2 / 50)) return true;
  return false;
}

function stripHiddenTags(text) {
  let cleaned = text;
  // Remove paired blocks first, then any unclosed dangling open tags.
  for (const tag of HIDDEN_TAG_NAMES) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    const dangling = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, 'i');
    let prev;
    do {
      prev = cleaned;
      cleaned = cleaned.replace(paired, '');
    } while (cleaned !== prev);
    cleaned = cleaned.replace(dangling, '');
  }
  // Drop any remaining stray opener/closer for hidden tags.
  cleaned = cleaned.replace(
    new RegExp(`<\\/?(?:${HIDDEN_TAG_NAMES.join('|')})\\b[^>]*>`, 'gi'),
    ''
  );
  return cleaned;
}

function stripReasoningPreamble(text) {
  // Non-anchored: cut from a "Thoughts:" / "Reasoning:" / etc up to the
  // next Speak/Response/Final/Answer label or end of string. Repeated to
  // handle interleaved cases like "Thoughts: ... Speak: ... Thoughts: ...".
  let cleaned = text;
  const reasoningRun = /\b(?:thoughts?|thinking|reasoning|analysis|scratchpad|internal monologue|plan|reflection)\s*:[\s\S]*?(?=\b(?:speak|response|final|answer)\s*:|$)/gi;
  let prev;
  do {
    prev = cleaned;
    cleaned = cleaned.replace(reasoningRun, '');
  } while (cleaned !== prev);
  // After cutting reasoning, drop the remaining "Speak:" / "Response:" /
  // "Final:" / "Answer:" label so it never reaches TTS.
  cleaned = cleaned.replace(/^\s*(?:speak|response|final|answer)\s*:\s*/i, '');
  cleaned = cleaned.replace(/\b(?:speak|response|final|answer)\s*:\s*/i, '');
  return cleaned;
}

function stripCodeAndCommandTokens(text) {
  let cleaned = text;
  // Remove fenced code blocks entirely.
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/```[\s\S]*$/g, '');
  // Strip legacy command markers.
  cleaned = cleaned.replace(/\[CMD:[\s\S]*?\]/gi, '');
  cleaned = cleaned.replace(/\[TOOL:[\s\S]*?\]/gi, '');
  cleaned = cleaned.replace(/\[(system|thought|think|scratchpad|reasoning|analysis|instruction):?[\s\S]*?\]/gi, '');
  // Drop a leading JSON object/array if the model dumped raw planner output.
  cleaned = cleaned.replace(/^\s*[\{\[][\s\S]*?[\}\]]/, '');
  // Bug 2 defensive pass: remove leaked action payload blobs that contain
  // both "module" and "action" keys, anywhere in the string.
  cleaned = cleaned.replace(/\{[^{}]{0,2000}\}/g, (match) =>
    /"module"/.test(match) && /"action"/.test(match) ? '' : match
  );
  return cleaned;
}

function filterReasoning(text) {
  if (text === undefined || text === null) return '';
  let cleaned = String(text);

  // 1. If a <speak> tag exists anywhere in the candidate text, only the
  //    captured group is allowed through. Everything outside is discarded.
  const speakMatch = cleaned.match(/<speak(?:\s[^>]*)?>([\s\S]*?)<\/speak>/i);
  if (speakMatch) {
    cleaned = speakMatch[1];
  } else {
    // 2. No speak tag — non-anchored stripper for "Thoughts:"-style preambles.
    cleaned = stripReasoningPreamble(cleaned);
  }

  // 3. Strip hidden-reasoning tags (paired or dangling).
  cleaned = stripHiddenTags(cleaned);
  // 4 & 5. Drop code fences and stray command/JSON fragments.
  cleaned = stripCodeAndCommandTokens(cleaned);

  // Defensive: if a reasoning label survived, run the stripper again.
  if (REASONING_LABEL_RE.test(cleaned) || SPEECH_LABEL_RE.test(cleaned)) {
    cleaned = stripReasoningPreamble(cleaned);
  }

  // 6. Collapse whitespace.
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // 7. Final tripwire: if cleanup left us with garbage (empty, too long,
  //    or dense braces), refuse to read it aloud.
  if (looksMalformed(cleaned)) return FALLBACK_SPEECH;
  return cleaned;
}

// --- JSON repair ladder (Bug B) -----------------------------------------
// Models love to emit "almost JSON": fenced code blocks, trailing commas,
// stray comments, single-quoted keys, etc. Each step here narrows the
// damage; we try the cheapest fix first and fall through to brace-balanced
// extraction over the entire raw response as a last resort.

function stripJsonFences(str) {
  let out = String(str || '').trim();
  // ```json ... ``` or ``` ... ```
  out = out.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '');
  out = out.replace(/\n?```\s*$/, '');
  return out.trim();
}

function quoteSingleQuotedStrings(str) {
  // Best-effort: convert obvious single-quoted JSON literals to double-quoted.
  // Only touches sequences that look like `'...'` after `:` or `,` or `[`,
  // i.e. values, and keys followed by `:`. Leaves apostrophes inside
  // double-quoted strings alone (we don't track string state perfectly,
  // but this is good enough for the malformed planner outputs we see).
  return String(str || '').replace(
    /([:,\[\{]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'/g,
    (_, prefix, inner) => `${prefix}"${inner.replace(/"/g, '\\"')}"`
  ).replace(
    /([\{,]\s*)'([^'\\]*)'(\s*:)/g,
    (_, prefix, key, suffix) => `${prefix}"${key.replace(/"/g, '\\"')}"${suffix}`
  );
}

function cleanJsonString(str) {
  // a. fences
  let cleaned = stripJsonFences(str);
  // b. block + line comments (but not URLs like http://)
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  cleaned = cleaned.replace(/(^|[^\\:])\/\/.*$/gm, '$1');
  // c. trailing commas
  cleaned = cleaned.replace(/,(\s*[\]}])/g, '$1');
  // d. single-quoted strings
  cleaned = quoteSingleQuotedStrings(cleaned);
  return cleaned.trim();
}

function tryParseJson(str) {
  try {
    return { ok: true, value: JSON.parse(str) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function extractJsonCandidates(text) {
  // Brace-balanced scan. Tracks both `{}` and `[]` so we recover top-level
  // arrays as well as objects. Honors string state so `{` inside a string
  // doesn't open a new candidate.
  const candidates = [];
  const openers = { '{': '}', '[': ']' };
  let inString = false;
  let escape = false;
  let stack = [];
  let startIdx = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{' || ch === '[') {
      if (stack.length === 0) startIdx = i;
      stack.push(openers[ch]);
    } else if (ch === '}' || ch === ']') {
      const expected = stack[stack.length - 1];
      if (expected === ch) {
        stack.pop();
        if (stack.length === 0 && startIdx !== -1) {
          candidates.push(text.substring(startIdx, i + 1));
          startIdx = -1;
        }
      } else {
        // Mismatched close - reset and keep scanning.
        stack = [];
        startIdx = -1;
      }
    }
  }

  // Sort by length descending so the largest valid JSON wins.
  return candidates.sort((a, b) => b.length - a.length);
}

function balanceBraces(str) {
  // Bug 6: if the action body was truncated mid-array (max-token cutoff),
  // append the closing brackets/braces needed to balance it. Honors string
  // state so we don't count braces inside strings.
  const stack = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = inString ? str + '"' : str;
  while (stack.length) out += stack.pop();
  return out;
}

function repairAndParseActions(actionContent, rawText) {
  // Returns either { ok: true, value: <parsed array or object> }
  //         or     { ok: false }
  const tryOne = (str) => {
    const cleaned = cleanJsonString(str);
    const parsed = tryParseJson(cleaned);
    if (parsed.ok) return parsed.value;
    return null;
  };

  // a-e: clean + parse on the action body.
  const direct = tryOne(actionContent);
  if (direct !== null) return { ok: true, value: direct };

  // f: brace-balanced extraction inside the action body.
  for (const candidate of extractJsonCandidates(actionContent)) {
    const parsed = tryOne(candidate);
    if (parsed !== null) return { ok: true, value: parsed };
  }

  // g: brace-balanced extraction over the entire raw response.
  if (rawText && rawText !== actionContent) {
    for (const candidate of extractJsonCandidates(rawText)) {
      const parsed = tryOne(candidate);
      if (parsed !== null && (Array.isArray(parsed) || (parsed && typeof parsed === 'object' && parsed.module))) {
        return { ok: true, value: parsed };
      }
    }
  }

  // Bug 6.h: aggressive fence-stripper. Some models wrap the JSON in
  // ```json ... ``` even though we forbid it. Strip and retry.
  const fenceStripped = String(actionContent || '')
    .replace(/```(?:json|javascript|js)?\s*/gi, '')
    .replace(/```\s*$/g, '')
    .trim();
  if (fenceStripped && fenceStripped !== actionContent) {
    const fenced = tryOne(fenceStripped);
    if (fenced !== null) return { ok: true, value: fenced };
  }

  // Bug 6.i: brace-balancer. Truncated mid-array? Append the missing
  // closers and retry.
  const balanced = balanceBraces(fenceStripped || String(actionContent || ''));
  if (balanced) {
    const balancedTry = tryOne(balanced);
    if (balancedTry !== null) return { ok: true, value: balancedTry };
    for (const candidate of extractJsonCandidates(balanced)) {
      const parsed = tryOne(candidate);
      if (parsed !== null) return { ok: true, value: parsed };
    }
  }

  return { ok: false };
}

function normalizeActionList(raw) {
  // Always returns a plain array of normalized payloads. Invalid items are
  // dropped with a warning rather than aborting the whole response (Bug B).
  let arr = [];
  if (Array.isArray(raw)) arr = raw;
  else if (raw && typeof raw === 'object') arr = [raw];

  const validated = [];
  for (const act of arr) {
    const normalized = normalizePayload(act);
    if (normalized) {
      validated.push(normalized);
    } else {
      console.warn('[AI ROUTER] Skipping invalid action:', act);
    }
  }
  return validated;
}

function parsePlannerJson(text) {
  const rawText = String(text || '').trim();

  // Try extracting legacy [CMD:...] commands first for backward compat.
  const legacy = extractLegacyCommandActions(rawText);
  if (legacy) {
    return {
      speech: 'Right away, sir.',
      actions: normalizeActionList(legacy),
      status: 'action',
    };
  }

  // 1. XML-like structured parsing (<speak>, <action>).
  const speakMatch = rawText.match(/<speak(?:\s[^>]*)?>([\s\S]*?)<\/speak>/i);
  const actionMatch = rawText.match(/<action(?:\s[^>]*)?>([\s\S]*?)<\/action>/i);

  if (speakMatch || actionMatch) {
    const speechRaw = speakMatch ? speakMatch[1] : '';
    let actions = [];

    if (actionMatch) {
      const actionContent = actionMatch[1].trim();
      if (actionContent && actionContent !== '[]') {
        const repaired = repairAndParseActions(actionContent, rawText);
        if (repaired.ok) {
          actions = normalizeActionList(repaired.value);
        } else {
          // Bug 1: NEVER speak a parse-error message. Log to console.error
          // for debugging and continue with empty actions; the speech still
          // goes out (or falls back to "Acknowledged.").
          console.error('[AI ROUTER] Malformed <action> JSON', actionContent);
          actions = [];
        }
      }
    }

    const safeSpeech = filterReasoning(speechRaw) || 'Acknowledged.';
    return {
      speech: safeSpeech,
      actions,
      status: actions.length ? 'action' : 'chat',
    };
  }

  // 2. Plain JSON envelope { speech, actions } fallback (legacy planner
  //    format from older Ollama prompts).
  const cleanedFull = cleanJsonString(rawText);
  const direct = tryParseJson(cleanedFull);
  if (direct.ok && direct.value && typeof direct.value === 'object' && !Array.isArray(direct.value)) {
    const actions = normalizeActionList(direct.value.actions);
    return {
      speech: filterReasoning(direct.value.speech || ''),
      actions,
      status: direct.value.status || (actions.length ? 'action' : 'chat'),
    };
  }

  // Search the raw text for JSON candidates carrying { speech, actions }.
  for (const candidate of extractJsonCandidates(rawText)) {
    const parsed = tryParseJson(cleanJsonString(candidate));
    if (parsed.ok && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)) {
      const actions = normalizeActionList(parsed.value.actions);
      return {
        speech: filterReasoning(parsed.value.speech || ''),
        actions,
        status: parsed.value.status || (actions.length ? 'action' : 'chat'),
      };
    }
  }

  // 3. No structure recognized - run the sanitizer on the whole blob.
  const speechOnly = filterReasoning(rawText);
  return {
    speech: speechOnly || FALLBACK_SPEECH,
    actions: [],
    status: 'chat',
  };
}

// Requirements 3.1, 3.5: deterministic provider selection over the fixed
// Provider_Priority_List. Walks the priority list in order and returns the
// first provider whose Provider_State is in Selectable_State = {Healthy,
// Degraded}. Anything else (Unknown, Unhealthy, Cooldown, or a missing entry)
// is skipped. Cooldown is therefore *not* selectable — the Health_Table state
// machine in `gemini_health.js` is responsible for surfacing the Cooldown
// state once `cooldownUntil > now`; this function only consumes the snapshot.
//
// Pure: no I/O, no side effects, no mutation of inputs. Returns `null` when
// no provider in the supplied priority list qualifies — the caller is
// responsible for falling back to emergency mode (see `emergencySpeech`).
//
// Property 3 (monotonicity): a Healthy higher-priority provider is never
// bypassed in favor of a lower-priority one, because the loop visits
// providers in priority order and returns on the first match.
const PROVIDER_PRIORITY_LIST = Object.freeze([
  'gemini_live',
  'gemini_rest',
  'ollama_local',
  'emergency',
]);
const SELECTABLE_STATES = new Set(['Healthy', 'Degraded']);

function selectProvider(healthTable, priorityList = PROVIDER_PRIORITY_LIST) {
  if (!healthTable || typeof healthTable !== 'object') return null;
  if (!Array.isArray(priorityList)) return null;

  for (const id of priorityList) {
    const entry = healthTable[id];
    if (!entry || typeof entry !== 'object') continue;
    if (SELECTABLE_STATES.has(entry.state)) return id;
  }
  return null;
}

// Requirements 10.1, 10.2: when the Provider_Priority_List is exhausted (no
// non-emergency provider is in the Selectable_State set) the AI_Router invokes
// emergencySpeech() and treats its result as the Turn's response. The contract
// is `{ speech: <non-empty string>, actions: [] }` per design.md — every
// branch below MUST yield a non-empty speech string and an empty actions list,
// and the function MUST be pure (no side effects beyond reading the
// module-local `providers` array, which is required for branch selection).
function emergencySpeech() {
  const geminiProviders = providers.filter((p) => p.type === 'gemini');
  const configuredGemini = geminiProviders.filter((p) => p.configured);

  if (configuredGemini.length === 0) {
    return {
      speech: 'I am in limited mode because the Gemini API keys are not configured.',
      actions: [],
    };
  }

  const allConfiguredRateLimited =
    configuredGemini.length === geminiProviders.length &&
    configuredGemini.every((p) => p.lastErrorCode === 'RATE_LIMIT');
  if (allConfiguredRateLimited) {
    return {
      speech: 'I am in limited mode because both the primary and secondary Gemini models have reached their rate limits.',
      actions: [],
    };
  }

  const anyAuthError = configuredGemini.some((p) => p.lastErrorCode === 'AUTH_ERROR');
  if (anyAuthError) {
    return {
      speech: 'I am in limited mode because one of the Gemini API keys was rejected. Please check the key configuration.',
      actions: [],
    };
  }

  const allModelsUnavailable = configuredGemini.every((p) => p.lastErrorCode === 'MODEL_NOT_FOUND');
  if (allModelsUnavailable) {
    return {
      speech: 'I am in limited mode because the configured Gemini model was not found or is not available for these API keys.',
      actions: [],
    };
  }

  return {
    speech: 'I am in limited mode because the cloud models are currently unavailable. I can still handle local commands.',
    actions: [],
  };
}

function callGeminiLive(provider, messages) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket !== 'function') {
      reject(providerError('This Node.js runtime does not support WebSocket.', 'WEBSOCKET_UNAVAILABLE'));
      return;
    }

    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(provider.apiKey)}`;
    const socket = new WebSocket(url);
    let finished = false;
    let setupComplete = false;
    let text = '';

    const finish = (error, result = '') => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch (e) {}
      if (error) reject(error);
      else resolve(result.trim());
    };

    const timeout = setTimeout(() => {
      finish(providerError(`${provider.name} live request timed out`, 'NETWORK_ERROR'));
    }, 25000);

    socket.addEventListener('open', () => {
      const isNativeAudio = /native-audio/i.test(provider.model);
      const responseModalities = ['TEXT'];

      socket.send(
        JSON.stringify({
          setup: {
            model: `models/${provider.model}`,
            generationConfig: {
              temperature: 0.25,
              maxOutputTokens: provider.maxTokens,
              responseModalities: responseModalities,
              ...(geminiThinkingConfig(provider.model) && { thinkingConfig: geminiThinkingConfig(provider.model) }),
              ...(responseModalities.includes('AUDIO') && {
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: 'Puck'
                    }
                  }
                }
              })
            },
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: true,
              },
            },
            systemInstruction: {
              parts: [{ text: SYSTEM_PROMPT }],
            },
          },
        })
      );
    });

    socket.addEventListener('message', async (event) => {
      let payloadText = '';
      if (typeof event.data === 'string') {
        payloadText = event.data;
      } else if (event.data instanceof ArrayBuffer) {
        payloadText = Buffer.from(event.data).toString('utf8');
      } else if (event.data && typeof event.data.text === 'function') {
        payloadText = await event.data.text();
      } else if (event.data) {
        payloadText = Buffer.from(event.data).toString('utf8');
      }

      let message;
      try {
        message = JSON.parse(payloadText);
      } catch (e) {
        return;
      }

      if (message.error) {
        finish(providerError(message.error.message || 'Gemini Live API error', classifyGeminiError(message.error.code, message.error.message)));
        return;
      }

      if (message.setupComplete && !setupComplete) {
        setupComplete = true;
        socket.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
        socket.send(JSON.stringify({ realtimeInput: { text: String(latestUserContent(messages)) } }));
        socket.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
        return;
      }

      const parts = message.serverContent?.modelTurn?.parts || [];
      text += visibleGeminiText(parts);

      if (message.serverContent?.turnComplete || message.serverContent?.generationComplete) {
        finish(null, text);
      }
    });

    socket.addEventListener('error', () => {
      finish(providerError('Gemini Live WebSocket failed', 'NETWORK_ERROR'));
    });

    socket.addEventListener('close', (event) => {
      if (finished) return;
      const reason = event.reason || `WebSocket closed with code ${event.code}`;
      finish(providerError(reason, classifyGeminiError(event.code, reason)));
    });
  });
}

async function callGemini(provider, messages) {
  if (!provider.apiKey) throw providerError(`${provider.name} API key is missing`, 'MISSING_API_KEY');

  if (isLiveGeminiModel(provider.model)) {
    return callGeminiLive(provider, messages);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const url = `${provider.baseUrl}/models/${encodeURIComponent(provider.model)}:generateContent`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': provider.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: toGeminiContents(messages),
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: provider.maxTokens,
          ...(geminiThinkingConfig(provider.model) && { thinkingConfig: geminiThinkingConfig(provider.model) }),
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw providerError(`HTTP ${response.status}: ${response.statusText}`, classifyGeminiError(response.status, errorBody));
    }
    const data = await response.json();
    return visibleGeminiText(data.candidates?.[0]?.content?.parts || []);
  } catch (err) {
    clearTimeout(timeout);
    if (!err.code) err.code = 'NETWORK_ERROR';
    throw err;
  }
}

async function callOllama(provider, messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(provider.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.model,
        messages,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!response.ok) throw providerError(`Ollama HTTP ${response.status}`, 'OLLAMA_ERROR');
    const data = await response.json();
    return data.message?.content || '';
  } catch (err) {
    clearTimeout(timeout);
    if (!err.code) err.code = 'OLLAMA_UNAVAILABLE';
    throw err;
  }
}

function callEmergency(userMessage) {
  const smart = trySmartRoute(userMessage);
  if (smart) return smart;

  // emergencySpeech() now returns { speech, actions: [] } per design.md.
  // Pull out the canned speech string for makeStructured; the empty actions
  // list is preserved by passing nothing (makeStructured defaults to []).
  return makeStructured({
    speech: emergencySpeech().speech,
    provider: 'Emergency Mode',
    status: 'chat',
  });
}

async function callProvider(provider, messages) {
  if (provider.type === 'gemini') {
    if (isLiveGeminiModel(provider.model)) {
      return callGeminiLive(provider, messages);
    }
    return callGemini(provider, messages);
  }
  if (provider.type === 'ollama') return callOllama(provider, messages);
  if (provider.type === 'emergency') return callEmergency(messages[messages.length - 1]?.content || '');
  throw new Error('Unknown provider type');
}

function getProviderList() {
  if (forceProviderId) {
    return providers.filter((p) => (p.id === forceProviderId || p.id === 'emergency') && p.configured);
  }
  return providers.filter((p) => !p.manualOnly && p.configured);
}

async function chat(userMessage) {
  // Hot-reload config and sync provider API keys/models dynamically
  syncProvidersWithConfig();

  const cleanMsg = userMessage.toLowerCase().replace(/[^\w\s]/g, '').trim();

  if (
    cleanMsg.includes('enable power mode') ||
    cleanMsg.includes('switch to power mode') ||
    cleanMsg.includes('switch to power model') ||
    cleanMsg.includes('use power model') ||
    cleanMsg.includes('use gemma') ||
    cleanMsg.includes('switch to gemma')
  ) {
    const previousProvider = activeProviderId;
    forceProviderId = 'ollama_local';
    activeProviderId = 'ollama_local';
    return makeStructured({
      speech: 'Power mode on. I will use the local model.',
      provider: 'system',
      providerSwitch: { from: previousProvider, to: 'Ollama Local', type: 'manual' },
      status: 'chat',
    });
  }

  if (
    cleanMsg.includes('enable normal mode') ||
    cleanMsg.includes('switch to normal mode') ||
    cleanMsg.includes('switch back to normal') ||
    cleanMsg.includes('disable power mode')
  ) {
    const previousProvider = activeProviderId;
    forceProviderId = null;
    activeProviderId = providers.find((p) => p.configured && p.available && !p.manualOnly)?.id || 'emergency';
    return makeStructured({
      speech: 'Normal mode restored.',
      provider: 'system',
      providerSwitch: { from: previousProvider, to: activeProviderId, type: 'manual' },
      status: 'chat',
    });
  }

  const smart = trySmartRoute(userMessage);
  if (smart) {
    addToHistory('user', userMessage);
    addToHistory('assistant', smart.speech);
    return smart;
  }

  const messages = buildMessages(userMessage);
  let providerSwitchNotification = null;

  for (const provider of getProviderList()) {
    if (!provider.configured) continue;
    if (!provider.available && Date.now() < provider.cooldownUntil) continue;
    if (!provider.available && Date.now() >= provider.cooldownUntil) {
      provider.available = true;
      provider.failCount = 0;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await callProvider(provider, messages);
        console.log("[LLM RESPONSE RECEIVED] from " + provider.name);
        if (raw && typeof raw === 'object' && raw.actions) {
          activeProviderId = provider.id;
          addToHistory('user', userMessage);
          addToHistory('assistant', raw.speech || 'Command prepared.');
          return raw;
        }

        provider.available = true;
        provider.failCount = 0;
        provider.lastErrorCode = null;
        provider.lastError = null;

        if (activeProviderId !== provider.id) {
          const oldProvider = providers.find((p) => p.id === activeProviderId);
          providerSwitchNotification = {
            from: oldProvider?.name || activeProviderId,
            to: provider.name,
            type: provider.id === activeProviderId ? 'restored' : 'failover',
          };
          activeProviderId = provider.id;
        }

        const parsed = parsePlannerJson(raw);
        const structured = parsed
          ? makeStructured({
              speech: parsed.speech,
              actions: Array.isArray(parsed.actions) ? parsed.actions : [],
              provider: provider.name,
              providerSwitch: providerSwitchNotification,
              status: parsed.status || (parsed.actions?.length ? 'action' : 'chat'),
            })
          : makeStructured({
              speech: raw,
              provider: provider.name,
              providerSwitch: providerSwitchNotification,
              status: 'chat',
            });

        addToHistory('user', userMessage);
        addToHistory('assistant', structured.speech);

        return structured;
      } catch (err) {
        console.error(`[AI ROUTER] ${provider.name} failed:`, err.message);
        provider.lastErrorCode = err.code || 'UNKNOWN';
        provider.lastError = err.message;
        if (attempt === 1) {
          provider.available = false;
          provider.failCount++;
          provider.cooldownUntil = Date.now() + getCooldownMs(provider.failCount);
        }
      }
    }
  }

  return makeStructured({
    speech: emergencySpeech().speech,
    provider: 'none',
    providerSwitch: { from: activeProviderId, to: 'none', type: 'total_failure' },
    status: 'chat',
  });
}

function syncProvidersWithConfig() {
  try {
    config.reload();

    const primary = providers.find((p) => p.id === 'gemini_primary');
    if (primary) {
      const prevKey = primary.apiKey;
      primary.apiKey = config.geminiPrimaryApiKey;
      primary.model = config.geminiPrimaryModel;
      const wasConfigured = primary.configured;
      primary.configured = Boolean(config.geminiPrimaryApiKey);
      if (!primary.configured) {
        primary.available = false;
        primary.lastErrorCode = 'MISSING_API_KEY';
        primary.lastError = 'API key is not configured';
      } else if (primary.apiKey !== prevKey || !wasConfigured) {
        primary.cooldownUntil = 0;
        primary.failCount = 0;
        primary.available = false;
        primary.lastErrorCode = null;
        primary.lastError = null;
      }
    }

    const fallback = providers.find((p) => p.id === 'gemini_fallback');
    if (fallback) {
      const prevKey = fallback.apiKey;
      fallback.apiKey = config.geminiFallbackApiKey;
      fallback.model = config.geminiFallbackModel;
      const wasConfigured = fallback.configured;
      fallback.configured = Boolean(config.geminiFallbackApiKey);
      if (!fallback.configured) {
        fallback.available = false;
        fallback.lastErrorCode = 'MISSING_API_KEY';
        fallback.lastError = 'API key is not configured';
      } else if (fallback.apiKey !== prevKey || !wasConfigured) {
        fallback.cooldownUntil = 0;
        fallback.failCount = 0;
        fallback.available = false;
        fallback.lastErrorCode = null;
        fallback.lastError = null;
      }
    }
  } catch (err) {
    console.error('[AI ROUTER] Error syncing providers with config:', err.message);
  }
}

function startHealthMonitor() {
  if (healthCheckInterval) return;

  healthCheckInterval = setInterval(async () => {
    syncProvidersWithConfig();
    for (const provider of providers) {
      if (provider.available || provider.type === 'emergency' || provider.manualOnly) continue;
      if (Date.now() < provider.cooldownUntil) continue;
      if (!provider.configured) continue;

      try {
        if (provider.type === 'gemini') {
          const res = await negotiateModel(provider.apiKey, provider.model);
          if (!res.success) {
            throw new Error(res.message);
          }
          provider.model = res.model; // update potentially negotiated operational model name
        }
        
        provider.available = true;
        provider.failCount = 0;
        provider.lastErrorCode = null;
        provider.lastError = null;

        const currentIdx = providers.findIndex((p) => p.id === activeProviderId);
        const recoveredIdx = providers.findIndex((p) => p.id === provider.id);
        if (recoveredIdx !== -1 && (currentIdx === -1 || recoveredIdx < currentIdx)) {
          lastProviderSwitch = {
            from: activeProviderId,
            to: provider.id,
            type: 'restored',
            timestamp: Date.now(),
            notified: false,
          };
          activeProviderId = provider.id;
        }
      } catch (e) {
        provider.lastErrorCode = e.code || 'UNKNOWN';
        provider.lastError = e.message;
        provider.cooldownUntil = Date.now() + getCooldownMs(Math.max(provider.failCount, 1));
      }
    }
  }, 30000);
}

function stopHealthMonitor() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

function getStatus() {
  return {
    activeProvider: activeProviderId,
    activeProviderName: providers.find((p) => p.id === activeProviderId)?.name || 'Unknown',
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      available: p.available,
      cooldownUntil: p.cooldownUntil,
      failCount: p.failCount,
      configured: p.configured,
      lastErrorCode: p.lastErrorCode || null,
      lastError: p.lastError || null,
    })),
    conversationLength: conversationHistory.length,
    lastSwitch: lastProviderSwitch,
  };
}

function clearHistory() {
  conversationHistory = [];
}

async function initializeRouter() {
  console.log('[AI ROUTER] Starting dynamic provider negotiation and verification...');
  
  // Dynamic sync config first
  syncProvidersWithConfig();

  // Resolve primary model
  const primary = providers.find(p => p.id === 'gemini_primary');
  if (primary && primary.configured) {
    const res = await negotiateModel(primary.apiKey, primary.model);
    if (res.success) {
      primary.model = res.model;
      primary.available = true;
      primary.lastErrorCode = null;
      primary.lastError = null;
    } else {
      primary.available = false;
      primary.lastErrorCode = 'NEGOTIATION_FAILED';
      primary.lastError = res.message;
    }
  }

  // Resolve fallback model
  const fallback = providers.find(p => p.id === 'gemini_fallback');
  if (fallback && fallback.configured) {
    const res = await negotiateModel(fallback.apiKey, fallback.model);
    if (res.success) {
      fallback.model = res.model;
      fallback.available = true;
      fallback.lastErrorCode = null;
      fallback.lastError = null;
    } else {
      fallback.available = false;
      fallback.lastErrorCode = 'NEGOTIATION_FAILED';
      fallback.lastError = res.message;
    }
  }
  
  // Re-evaluate active provider after verification
  activeProviderId = providers.find((p) => p.available && !p.manualOnly)?.id || 'emergency';
  console.log(`[AI ROUTER] Dynamic routing settled. Active: "${activeProviderId}"`);
}

// Start boot check and health monitor
initializeRouter().catch(err => {
  console.error('[AI ROUTER] Boot initialization failed:', err);
});
startHealthMonitor();

// --- Streaming chat (chatStream) ----------------------------------------
// Yields events shaped for the frontend so it never has to branch between
// fast-path (smart router) and streamed-LLM responses.
//
// Event types:
//   meta        { provider, providerSwitch }
//   speech_delta{ text }            // fragment, NOT cumulative
//   speech_end  {}
//   action_ready{ actions, needsConfirmation }
//   done        { speech, actions, status, provider }
//   error       { message, code }

function safeOnEvent(onEvent, type, data) {
  try {
    onEvent({ type, data });
  } catch (err) {
    console.error('[AI ROUTER] chatStream onEvent threw:', err.message);
  }
}

/**
 * Parse one SSE chunk for Gemini streamGenerateContent. The endpoint emits
 * `data: { ... }` lines separated by blank lines. We accumulate a buffer
 * across chunk boundaries and pull complete events out.
 */
function makeSseFramer() {
  let buffer = '';
  return function feed(chunkText) {
    buffer += chunkText;
    const out = [];
    let idx;
    // SSE events are terminated by \n\n (or \r\n\r\n).
    while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const event = buffer.slice(0, idx);
      buffer = buffer.slice(idx).replace(/^(?:\r?\n){2}/, '');
      const dataLines = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());
      if (!dataLines.length) continue;
      const payload = dataLines.join('\n');
      if (payload === '[DONE]') {
        out.push({ done: true });
        continue;
      }
      try {
        out.push({ json: JSON.parse(payload) });
      } catch (e) {
        // Some Gemini responses come as a single concatenated JSON array
        // when alt=sse is honored loosely. Skip silently.
      }
    }
    return out;
  };
}

/**
 * SSE pump for Gemini streamGenerateContent. Calls onText(deltaString) for
 * each visible text chunk. Returns the full concatenated visible text on
 * success, throws on failure.
 */
async function streamGeminiSse(provider, messages, onText) {
  if (!provider.apiKey) {
    throw providerError(`${provider.name} API key is missing`, 'MISSING_API_KEY');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const url = `${provider.baseUrl}/models/${encodeURIComponent(provider.model)}:streamGenerateContent?alt=sse`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': provider.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: toGeminiContents(messages),
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: provider.maxTokens,
          ...(geminiThinkingConfig(provider.model) && { thinkingConfig: geminiThinkingConfig(provider.model) }),
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw providerError(`HTTP ${response.status}: ${response.statusText}`, classifyGeminiError(response.status, errorBody));
    }
    if (!response.body) {
      throw providerError(`${provider.name} returned no stream body`, 'NETWORK_ERROR');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const framer = makeSseFramer();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkText = decoder.decode(value, { stream: true });
      const events = framer(chunkText);
      for (const ev of events) {
        if (ev.done) continue;
        const parts = ev.json?.candidates?.[0]?.content?.parts || [];
        const visible = visibleGeminiText(parts);
        if (visible) {
          fullText += visible;
          try { onText(visible); } catch (e) { /* swallow */ }
        }
      }
    }
    // Flush any trailing chunk by injecting blank lines through the framer.
    const flush = framer('\n\n');
    for (const ev of flush) {
      if (ev.done) continue;
      const parts = ev.json?.candidates?.[0]?.content?.parts || [];
      const visible = visibleGeminiText(parts);
      if (visible) {
        fullText += visible;
        try { onText(visible); } catch (e) { /* swallow */ }
      }
    }
    return fullText;
  } catch (err) {
    if (!err.code) err.code = 'NETWORK_ERROR';
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Incremental tag scanner. Accepts text fragments via push(); whenever a
 * fragment crosses a state boundary (open/close <speak>, open/close
 * <action>) it fires the appropriate callback.
 */
function makeTagStreamer(callbacks) {
  // State: before_speak | in_speak | between | in_action | done
  let state = 'before_speak';
  let buffer = '';
  let speakBody = '';
  let actionBody = '';

  function flushSpeakDelta(delta) {
    if (!delta) return;
    const cleaned = filterReasoning(delta);
    if (cleaned) callbacks.onSpeechDelta(cleaned);
  }

  return {
    push(fragment) {
      buffer += fragment;

      // Process state transitions and emit deltas as far as we can each call.
      // Loop because a single fragment can cross multiple boundaries.
      while (true) {
        if (state === 'before_speak') {
          const open = buffer.search(/<speak(?:\s[^>]*)?>/i);
          if (open === -1) {
            // Discard everything before <speak>; never speak it.
            buffer = '';
            return;
          }
          const after = buffer.slice(open).match(/<speak(?:\s[^>]*)?>/i);
          buffer = buffer.slice(open + after[0].length);
          state = 'in_speak';
          continue;
        }

        if (state === 'in_speak') {
          const closeMatch = buffer.match(/<\/speak\s*>/i);
          if (!closeMatch) {
            // Hold back any partial open-tag-like trailing chars so we don't
            // emit a half-tag as speech.
            const safeUpTo = buffer.lastIndexOf('<');
            if (safeUpTo === -1) {
              speakBody += buffer;
              flushSpeakDelta(buffer);
              buffer = '';
            } else {
              const safe = buffer.slice(0, safeUpTo);
              speakBody += safe;
              flushSpeakDelta(safe);
              buffer = buffer.slice(safeUpTo);
            }
            return;
          }
          const before = buffer.slice(0, closeMatch.index);
          speakBody += before;
          flushSpeakDelta(before);
          buffer = buffer.slice(closeMatch.index + closeMatch[0].length);
          callbacks.onSpeechEnd(speakBody);
          state = 'between';
          continue;
        }

        if (state === 'between') {
          const openA = buffer.match(/<action(?:\s[^>]*)?>/i);
          if (!openA) return;
          buffer = buffer.slice(openA.index + openA[0].length);
          state = 'in_action';
          continue;
        }

        if (state === 'in_action') {
          const closeA = buffer.match(/<\/action\s*>/i);
          if (!closeA) {
            actionBody += buffer;
            buffer = '';
            return;
          }
          actionBody += buffer.slice(0, closeA.index);
          buffer = buffer.slice(closeA.index + closeA[0].length);
          callbacks.onActionBody(actionBody);
          state = 'done';
          return;
        }

        if (state === 'done') {
          buffer = '';
          return;
        }
      }
    },
    end() {
      // Stream finished without a closing tag for the current state.
      if (state === 'before_speak') {
        // No <speak> ever opened. Treat the whole buffer as raw text and
        // emit it as a single delta after sanitization.
        const sanitized = filterReasoning(buffer);
        if (sanitized) callbacks.onSpeechDelta(sanitized);
        callbacks.onSpeechEnd(sanitized);
      } else if (state === 'in_speak') {
        speakBody += buffer;
        flushSpeakDelta(buffer);
        callbacks.onSpeechEnd(speakBody);
      } else if (state === 'between') {
        // <speak> closed, no <action> seen.
      } else if (state === 'in_action') {
        actionBody += buffer;
        callbacks.onActionBody(actionBody);
      }
      buffer = '';
    },
    getState() {
      return { state, speakBody, actionBody };
    },
  };
}

/**
 * Streaming chat. See module-level docstring for event shape.
 *
 * @param {string} userMessage
 * @param {(event: { type: string, data: object }) => void} onEvent
 * @returns {Promise<void>}
 */
async function chatStream(userMessage, onEvent) {
  if (typeof onEvent !== 'function') {
    throw new TypeError('chatStream requires an onEvent callback');
  }

  syncProvidersWithConfig();
  const cleanMsg = String(userMessage || '').toLowerCase().replace(/[^\w\s]/g, '').trim();

  // --- Mode-switch shortcuts (mirror chat()) ----------------------------
  if (
    cleanMsg.includes('enable power mode') ||
    cleanMsg.includes('switch to power mode') ||
    cleanMsg.includes('switch to power model') ||
    cleanMsg.includes('use power model') ||
    cleanMsg.includes('use gemma') ||
    cleanMsg.includes('switch to gemma')
  ) {
    const previousProvider = activeProviderId;
    forceProviderId = 'ollama_local';
    activeProviderId = 'ollama_local';
    const result = makeStructured({
      speech: 'Power mode on. I will use the local model.',
      provider: 'system',
      providerSwitch: { from: previousProvider, to: 'Ollama Local', type: 'manual' },
      status: 'chat',
    });
    safeOnEvent(onEvent, 'meta', { provider: 'system', providerSwitch: result.providerSwitch });
    safeOnEvent(onEvent, 'speech_delta', { text: result.speech });
    safeOnEvent(onEvent, 'speech_end', {});
    safeOnEvent(onEvent, 'action_ready', { actions: [], needsConfirmation: false });
    safeOnEvent(onEvent, 'done', {
      speech: result.speech,
      actions: [],
      status: result.status,
      provider: 'system',
    });
    return;
  }

  if (
    cleanMsg.includes('enable normal mode') ||
    cleanMsg.includes('switch to normal mode') ||
    cleanMsg.includes('switch back to normal') ||
    cleanMsg.includes('disable power mode')
  ) {
    const previousProvider = activeProviderId;
    forceProviderId = null;
    activeProviderId = providers.find((p) => p.configured && p.available && !p.manualOnly)?.id || 'emergency';
    const result = makeStructured({
      speech: 'Normal mode restored.',
      provider: 'system',
      providerSwitch: { from: previousProvider, to: activeProviderId, type: 'manual' },
      status: 'chat',
    });
    safeOnEvent(onEvent, 'meta', { provider: 'system', providerSwitch: result.providerSwitch });
    safeOnEvent(onEvent, 'speech_delta', { text: result.speech });
    safeOnEvent(onEvent, 'speech_end', {});
    safeOnEvent(onEvent, 'action_ready', { actions: [], needsConfirmation: false });
    safeOnEvent(onEvent, 'done', {
      speech: result.speech,
      actions: [],
      status: result.status,
      provider: 'system',
    });
    return;
  }

  // --- Smart-router fast path ------------------------------------------
  const smart = trySmartRoute(userMessage);
  if (smart) {
    // If the smart router emitted a `web:*` action, run it synchronously
    // and replace the speech with the formatted result so the user actually
    // hears the data instead of just an acknowledgement. This is what makes
    // the keyless live-data tools feel useful in conversation.
    let liveSpeech = smart.speech;
    let executedAction = null;
    let actionResult = null;
    const firstWebAction = (smart.actions || []).find(
      (a) => a && a.module === 'web'
    );
    if (firstWebAction) {
      try {
        const { handleWebCommand, formatWebResult } = require('./web');
        actionResult = await handleWebCommand(firstWebAction.action, firstWebAction.value);
        const formatted = formatWebResult(firstWebAction.action, actionResult);
        if (formatted) liveSpeech = formatted;
        executedAction = firstWebAction;
      } catch (err) {
        console.error('[AI ROUTER] web fast-path execution failed:', err.message);
        liveSpeech = "I couldn't fetch that right now. Try again in a moment.";
      }
    }

    addToHistory('user', userMessage);
    addToHistory('assistant', liveSpeech);
    safeOnEvent(onEvent, 'meta', { provider: smart.provider || 'smart_router', providerSwitch: smart.providerSwitch || null });
    safeOnEvent(onEvent, 'speech_delta', { text: liveSpeech });
    safeOnEvent(onEvent, 'speech_end', {});
    safeOnEvent(onEvent, 'action_ready', {
      // Web fast-paths run server-side already; expose them as `[]` so the
      // frontend doesn't try to re-execute. Non-web smart actions (apps,
      // system, media, etc.) still flow through the action handler so the
      // existing UI keeps working.
      actions: executedAction ? [] : (Array.isArray(smart.actions) ? smart.actions : []),
      needsConfirmation: Boolean(smart.needsConfirmation),
    });
    safeOnEvent(onEvent, 'done', {
      speech: liveSpeech,
      actions: executedAction ? [] : (Array.isArray(smart.actions) ? smart.actions : []),
      status: smart.status,
      provider: smart.provider || 'smart_router',
      // Surface the raw result so the HUD can show it in the action panel
      // if the user wants more detail than the spoken summary.
      ...(executedAction && actionResult ? { webResult: actionResult } : {}),
    });
    return;
  }

  // --- Provider walk ----------------------------------------------------
  const messages = buildMessages(userMessage);
  let providerSwitchNotification = null;
  let lastError = null;

  for (const provider of getProviderList()) {
    if (!provider.configured) continue;
    if (!provider.available && Date.now() < provider.cooldownUntil) continue;
    if (!provider.available && Date.now() >= provider.cooldownUntil) {
      provider.available = true;
      provider.failCount = 0;
    }

    if (activeProviderId !== provider.id) {
      const oldProvider = providers.find((p) => p.id === activeProviderId);
      providerSwitchNotification = {
        from: oldProvider?.name || activeProviderId,
        to: provider.name,
        type: 'failover',
      };
    }

    safeOnEvent(onEvent, 'meta', {
      provider: provider.name,
      providerSwitch: providerSwitchNotification,
    });

    const isLive = provider.type === 'gemini' && isLiveGeminiModel(provider.model);
    const isStreamableGemini = provider.type === 'gemini' && !isLive;

    let streamerEnded = false;
    let actionEmitted = false;
    let collectedActions = [];
    let collectedSpeech = '';

    const streamer = makeTagStreamer({
      onSpeechDelta(delta) {
        safeOnEvent(onEvent, 'speech_delta', { text: delta });
      },
      onSpeechEnd(fullSpeak) {
        if (streamerEnded) return;
        streamerEnded = true;
        collectedSpeech = filterReasoning(fullSpeak || '');
        safeOnEvent(onEvent, 'speech_end', {});
      },
      onActionBody(body) {
        if (actionEmitted) return;
        actionEmitted = true;
        const trimmed = String(body || '').trim();
        if (!trimmed || trimmed === '[]') {
          safeOnEvent(onEvent, 'action_ready', { actions: [], needsConfirmation: false });
          return;
        }
        const repaired = repairAndParseActions(trimmed, trimmed);
        if (repaired.ok) {
          collectedActions = normalizeActionList(repaired.value);
        } else {
          console.error('[AI ROUTER] Malformed <action> JSON', trimmed);
          collectedActions = [];
        }
        safeOnEvent(onEvent, 'action_ready', {
          actions: collectedActions,
          needsConfirmation: collectedActions.some(requiresConfirmation),
        });
      },
    });

    try {
      let rawFullText = '';

      if (isStreamableGemini) {
        rawFullText = await streamGeminiSse(provider, messages, (delta) => {
          streamer.push(delta);
        });
      } else if (isLive) {
        rawFullText = await callGeminiLive(provider, messages);
        streamer.push(rawFullText);
      } else if (provider.type === 'ollama') {
        rawFullText = await callOllama(provider, messages);
        streamer.push(rawFullText);
      } else if (provider.type === 'emergency') {
        const emergency = callEmergency(userMessage);
        safeOnEvent(onEvent, 'speech_delta', { text: emergency.speech });
        safeOnEvent(onEvent, 'speech_end', {});
        safeOnEvent(onEvent, 'action_ready', {
          actions: Array.isArray(emergency.actions) ? emergency.actions : [],
          needsConfirmation: Boolean(emergency.needsConfirmation),
        });
        safeOnEvent(onEvent, 'done', {
          speech: emergency.speech,
          actions: Array.isArray(emergency.actions) ? emergency.actions : [],
          status: emergency.status,
          provider: provider.name,
        });
        addToHistory('user', userMessage);
        addToHistory('assistant', emergency.speech);
        return;
      } else {
        throw providerError('Unknown provider type', 'PROVIDER_ERROR');
      }

      streamer.end();

      // Make sure speech_end and action_ready always fire exactly once.
      if (!streamerEnded) {
        safeOnEvent(onEvent, 'speech_end', {});
        streamerEnded = true;
      }
      if (!actionEmitted) {
        safeOnEvent(onEvent, 'action_ready', { actions: [], needsConfirmation: false });
        actionEmitted = true;
      }

      // Reconcile via parsePlannerJson on the full raw text so we still
      // honor legacy [CMD:...] responses and JSON-envelope fallbacks for
      // providers that didn't emit <speak>/<action> at all.
      const parsed = parsePlannerJson(rawFullText);
      let finalSpeech = collectedSpeech || (parsed && parsed.speech) || '';
      let finalActions = collectedActions.length
        ? collectedActions
        : (parsed && Array.isArray(parsed.actions) ? parsed.actions : []);

      // -------- LLM tool-result loop (one hop) --------
      // If Gemini emitted a `web:*` action, run it server-side, append the
      // result to history as a tool note, and re-prompt this same provider
      // with `[TOOL_RESULT]` so the model can speak a natural-language
      // answer instead of leaving the user with a raw action JSON.
      const firstWebFromLlm = finalActions.find(
        (a) => a && a.module === 'web'
      );
      const reentry = (typeof userMessage === 'string') && /^\[TOOL_RESULT\]/.test(userMessage);
      if (firstWebFromLlm && !reentry) {
        try {
          const { handleWebCommand } = require('./web');
          const toolResult = await handleWebCommand(firstWebFromLlm.action, firstWebFromLlm.value);
          // Re-prompt Gemini once with the tool result as a synthetic user
          // turn. We mark the message with [TOOL_RESULT] so the recursion
          // guard above prevents infinite loops if the model emits another
          // web action in response.
          const toolJson = JSON.stringify(toolResult).slice(0, 4000);
          const reentryPrompt =
            `[TOOL_RESULT] You called web:${firstWebFromLlm.action} with value "${firstWebFromLlm.value}". ` +
            `Result: ${toolJson}. ` +
            `Now produce a final answer for the original user message: "${userMessage}". ` +
            `Speak the answer in <speak>; emit <action>[]</action>.`;
          // Avoid stamping history with provider-specific bookkeeping for the
          // intermediate turn; just recurse so the user sees one done event.
          await chatStream(reentryPrompt, onEvent);
          return;
        } catch (err) {
          console.error('[AI ROUTER] tool-result loop failed:', err.message);
          // Fall through and emit the original done with whatever speech we
          // already collected so the user isn't left in silence.
        }
      }

      const structured = makeStructured({
        speech: finalSpeech,
        actions: finalActions,
        provider: provider.name,
        providerSwitch: providerSwitchNotification,
        status: finalActions.length ? 'action' : (parsed?.status || 'chat'),
      });

      provider.available = true;
      provider.failCount = 0;
      provider.lastErrorCode = null;
      provider.lastError = null;
      activeProviderId = provider.id;

      addToHistory('user', userMessage);
      addToHistory('assistant', structured.speech);

      safeOnEvent(onEvent, 'done', {
        speech: structured.speech,
        actions: structured.actions,
        status: structured.status,
        provider: provider.name,
      });
      return;
    } catch (err) {
      console.error(`[AI ROUTER] chatStream ${provider.name} failed:`, err.message);
      provider.lastErrorCode = err.code || 'UNKNOWN';
      provider.lastError = err.message;
      provider.available = false;
      provider.failCount++;
      provider.cooldownUntil = Date.now() + getCooldownMs(provider.failCount);
      lastError = err;
      // Fall through to next provider; meta will be re-emitted at top of loop.
      continue;
    }
  }

  // --- Total failure: emergency speech, no throw ------------------------
  const fallback = callEmergency(userMessage);
  safeOnEvent(onEvent, 'meta', {
    provider: 'none',
    providerSwitch: { from: activeProviderId, to: 'none', type: 'total_failure' },
  });
  safeOnEvent(onEvent, 'error', {
    message: lastError?.message || fallback.speech,
    code: lastError?.code || 'ALL_PROVIDERS_FAILED',
  });
  safeOnEvent(onEvent, 'speech_delta', { text: fallback.speech });
  safeOnEvent(onEvent, 'speech_end', {});
  safeOnEvent(onEvent, 'action_ready', {
    actions: Array.isArray(fallback.actions) ? fallback.actions : [],
    needsConfirmation: Boolean(fallback.needsConfirmation),
  });
  safeOnEvent(onEvent, 'done', {
    speech: fallback.speech,
    actions: Array.isArray(fallback.actions) ? fallback.actions : [],
    status: fallback.status,
    provider: 'none',
  });
}

module.exports = {
  chat,
  chatStream,
  getStatus,
  addToHistory,
  getHistory,
  clearHistory,
  startHealthMonitor,
  stopHealthMonitor,
  summarizeAction,
  emergencySpeech,
  selectProvider,
  PROVIDER_PRIORITY_LIST,
};
