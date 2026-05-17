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
  "",
  "Rules:",
  "- Speak in the same style as Aditya, English or Roman Hinglish only.",
  "- If no action is needed, return empty: <action>[]</action>.",
  "- If the user intent is ambiguous, return no actions and ask one short question in <speak>.",
  "- For relative brightness requests, use brightness_adjust with a positive or negative delta. Choose a small practical delta such as +/-10 unless the user asks for a stronger change.",
  "- Do not wrap the JSON inside <action> with markdown code blocks. Keep it raw and valid."
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
    maxTokens: 350,
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
    maxTokens: 350,
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
    maxTokens: 350,
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

function structuredAction(module, action, value, speech = 'Right away, sir.') {
  return makeStructured({
    speech,
    actions: [{ module, action, value }],
    provider: 'smart_router',
    status: 'action',
  });
}

function tryNaturalRoute(cleaned) {
  const lower = cleaned.toLowerCase();
  const number = extractNumber(lower);

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
  return /live/i.test(m);
}

function addToHistory(role, content) {
  const safeContent = role === 'assistant'
    ? filterReasoning(content).replace(/\s+/g, ' ').trim()
    : content;
  conversationHistory.push({ role, content: safeContent });
  // Keep enough recent context without preserving hidden reasoning or command payloads.
  if (conversationHistory.length > 20) {
    conversationHistory = conversationHistory.slice(-20);
  }
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
      role: message.role === 'assistant' ? 'model' : 'user',
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
    if (normalized.ok) normalizedActions.push(normalized.payload);
    else errors.push(normalized.error);
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
  const cmdStart = text.indexOf('[CMD:');
  if (cmdStart === -1) return null;

  const afterCmd = text.substring(cmdStart + 5);
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

function filterReasoning(text) {
  let cleaned = String(text || '');

  // Keep only the user-facing part if a speak tag exists.
  const speakMatch = cleaned.match(/<speak(?:\s[^>]*)?>([\s\S]*?)<\/speak>/i);
  if (speakMatch) cleaned = speakMatch[1];

  // Strip hidden reasoning and command payloads before anything can reach TTS.
  const hiddenTags = 'thought|think|scratchpad|reasoning|analysis|system|action';
  cleaned = cleaned.replace(new RegExp('<(' + hiddenTags + ')[^>]*>[\\s\\S]*?<\\/\\1>', 'gi'), '');
  cleaned = cleaned.replace(new RegExp('<(' + hiddenTags + ')[^>]*>[\\s\\S]*', 'gi'), '');
  cleaned = cleaned.replace(/<\/?speak[^>]*>/gi, '');

  cleaned = cleaned.replace(/\[(system|thought|think|scratchpad|reasoning|analysis|instruction):?[\s\S]*?\]/gi, '');
  cleaned = cleaned.replace(new RegExp('```(?:json)?\\s*(\\{[\\s\\S]*?\\})\\s*```', 'gi'), '$1');
  cleaned = cleaned.replace(/(?:^|\n)\s*(?:thoughts?|thinking|reasoning|analysis|scratchpad|internal monologue)\s*:\s*[\s\S]*?(?=\n\s*(?:speak|response|final)\s*:|$)/gi, '\n');
  cleaned = cleaned.replace(/^\s*(?:speak|response|final)\s*:\s*/i, '');

  return cleaned.replace(/\s+/g, ' ').trim();
}

function cleanJsonString(str) {
  // Remove block comments /*...*/ and line comments //...
  let cleaned = str.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');

  // Strip trailing commas from arrays and objects
  cleaned = cleaned.replace(/,(\s*[\]}])/g, '$1');

  return cleaned.trim();
}

function extractJsonCandidates(text) {
  const candidates = [];
  let braceCount = 0;
  let inString = false;
  let startIdx = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"' && text[i - 1] !== '\\') {
      inString = !inString;
    }

    if (!inString) {
      if (char === '{') {
        if (braceCount === 0) {
          startIdx = i;
        }
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0 && startIdx !== -1) {
          candidates.push(text.substring(startIdx, i + 1));
          startIdx = -1;
        }
      }
    }
  }
  return candidates;
}

function parsePlannerJson(text) {
  const rawText = String(text || '').trim();

  // Try extracting legacy commands first
  const legacy = extractLegacyCommandActions(rawText);
  if (legacy) return { speech: 'Right away, sir.', actions: legacy, status: 'action' };

  // 1. Try XML-like structured parsing (<thought>, <speak>, <action>)
  const speakMatch = rawText.match(/<speak(?:\s[^>]*)?>([\s\S]*?)<\/speak>/i);
  const actionMatch = rawText.match(/<action(?:\s[^>]*)?>([\s\S]*?)<\/action>/i);

  if (speakMatch || actionMatch) {
    let speech = '';
    if (speakMatch) {
      speech = speakMatch[1].trim();
    } else {
      speech = filterReasoning(rawText);
    }

    let actions = [];
    let parsingErrorOccurred = false;

    if (actionMatch) {
      const actionContent = actionMatch[1].trim();
      if (actionContent && actionContent !== '[]') {
        try {
          const cleanedAction = cleanJsonString(actionContent);
          const parsedAction = JSON.parse(cleanedAction);
          if (Array.isArray(parsedAction)) {
            actions = parsedAction;
          } else if (parsedAction && typeof parsedAction === 'object') {
            actions = [parsedAction];
          }
        } catch (e) {
          // Attempt extraction using extractJsonCandidates within <action> tag
          const candidates = extractJsonCandidates(actionContent);
          let recovered = false;
          for (const candidate of candidates) {
            try {
              const cleanedCandidate = cleanJsonString(candidate);
              const parsed = JSON.parse(cleanedCandidate);
              if (parsed && typeof parsed === 'object') {
                if (Array.isArray(parsed)) {
                  actions = parsed;
                } else {
                  actions = [parsed];
                }
                recovered = true;
                break;
              }
            } catch (inner) {}
          }

          if (!recovered) {
            console.error('[AI ROUTER] Malformed JSON in <action> tag:', actionContent);
            parsingErrorOccurred = true;
          }
        }
      }
    }

    if (parsingErrorOccurred) {
      return {
        speech: "I encountered a command parsing error. The action payload was malformed.",
        actions: [],
        status: "chat"
      };
    }

    const validatedActions = [];
    for (const act of actions) {
      const normalized = normalizePayload(act);
      if (normalized.ok) {
        validatedActions.push(normalized.payload);
      } else {
        console.warn('[AI ROUTER] Skipping invalid action:', act, normalized.error);
      }
    }

    return {
      speech: filterReasoning(speech || 'Right away, sir.'),
      actions: validatedActions,
      status: validatedActions.length ? 'action' : 'chat'
    };
  }

  // 2. FALLBACK to standard JSON parsing (for backward compatibility)
  try {
    const cleanedFull = cleanJsonString(rawText);
    const parsed = JSON.parse(cleanedFull);
    if (parsed && typeof parsed === 'object') {
      const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
      const validatedActions = [];
      for (const act of actions) {
        const normalized = normalizePayload(act);
        if (normalized.ok) validatedActions.push(normalized.payload);
      }
      return {
        speech: filterReasoning(parsed.speech || ''),
        actions: validatedActions,
        status: parsed.status || (validatedActions.length ? 'action' : 'chat')
      };
    }
  } catch (e) {}

  // Find candidate JSON blocks within the text
  const candidates = extractJsonCandidates(rawText);
  for (const candidate of candidates) {
    try {
      const cleanedCandidate = cleanJsonString(candidate);
      const parsed = JSON.parse(cleanedCandidate);
      if (parsed && typeof parsed === 'object') {
        const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
        const validatedActions = [];
        for (const act of actions) {
          const normalized = normalizePayload(act);
          if (normalized.ok) validatedActions.push(normalized.payload);
        }
        return {
          speech: filterReasoning(parsed.speech || ''),
          actions: validatedActions,
          status: parsed.status || (validatedActions.length ? 'action' : 'chat')
        };
      }
    } catch (inner) {}
  }

  // Fallback
  const speechOnly = filterReasoning(rawText);
  return {
    speech: speechOnly || 'Right away, sir.',
    actions: [],
    status: 'chat'
  };
}

function emergencySpeech() {
  const geminiProviders = providers.filter((p) => p.type === 'gemini');
  const configuredGemini = geminiProviders.filter((p) => p.configured);

  if (configuredGemini.length === 0) {
    return 'I am in limited mode because the Gemini API keys are not configured.';
  }

  const allConfiguredRateLimited =
    configuredGemini.length === geminiProviders.length &&
    configuredGemini.every((p) => p.lastErrorCode === 'RATE_LIMIT');
  if (allConfiguredRateLimited) {
    return 'I am in limited mode because both the primary and secondary Gemini models have reached their rate limits.';
  }

  const anyAuthError = configuredGemini.some((p) => p.lastErrorCode === 'AUTH_ERROR');
  if (anyAuthError) {
    return 'I am in limited mode because one of the Gemini API keys was rejected. Please check the key configuration.';
  }

  const allModelsUnavailable = configuredGemini.every((p) => p.lastErrorCode === 'MODEL_NOT_FOUND');
  if (allModelsUnavailable) {
    return 'I am in limited mode because the configured Gemini model was not found or is not available for these API keys.';
  }

  return 'I am in limited mode because the cloud models are currently unavailable. I can still handle local commands.';
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

  return makeStructured({
    speech: emergencySpeech(),
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
    speech: emergencySpeech(),
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

module.exports = {
  chat,
  getStatus,
  clearHistory,
  startHealthMonitor,
  stopHealthMonitor,
  summarizeAction,
};
