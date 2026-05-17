/**
 * J.A.R.V.I.S. Gemini Health & Dynamic Routing Negotiation Module
 * Provides lightweight health checks using the low-overhead `:countTokens` API
 * to dynamically confirm model compatibility, key validity, and negotiate fallback routes.
 */

/**
 * Pings Google Gemini API with a fast, zero-generation-cost token count request.
 * @param {string} apiKey - The Gemini API key to test.
 * @param {string} model - The model identifier (e.g. "gemini-2.5-flash-native-audio-latest").
 * @returns {Promise<{success: boolean, status: number, errorCode: string, message: string}>}
 */
function isLiveGeminiModel(model) {
  const m = String(model || '');
  return /live/i.test(m) || /native-audio/i.test(m);
}

function pingLiveModel(apiKey, model) {
  return new Promise((resolve) => {
    if (typeof WebSocket !== 'function') {
      resolve({ success: false, status: 0, errorCode: 'WEBSOCKET_UNAVAILABLE', message: 'WebSocket is not supported in this Node.js runtime' });
      return;
    }

    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
    const socket = new WebSocket(url);
    let finished = false;

    const finish = (success, errorCode = null, message = '') => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch (e) {}
      resolve({ success, status: success ? 200 : 0, errorCode, message });
    };

    const timeout = setTimeout(() => {
      finish(false, 'TIMEOUT', 'WebSocket handshake timed out after 5000ms');
    }, 5000);

    socket.addEventListener('open', () => {
      try {
        const isNativeAudio = /native-audio/i.test(model);
        const responseModalities = isNativeAudio ? ['AUDIO'] : ['TEXT'];
        socket.send(
          JSON.stringify({
            setup: {
              model: `models/${model}`,
              generationConfig: {
                temperature: 0.25,
                maxOutputTokens: 10,
                responseModalities: responseModalities,
                ...(isNativeAudio && {
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: {
                        voiceName: 'Puck'
                      }
                    }
                  }
                })
              },
            },
          })
        );
      } catch (e) {
        finish(false, 'SEND_ERROR', `Failed to send setup frame: ${e.message}`);
      }
    });

    socket.addEventListener('message', (event) => {
      let payloadText = '';
      try {
        if (typeof event.data === 'string') {
          payloadText = event.data;
        } else if (event.data && typeof event.data.text === 'function') {
          event.data.text().then((txt) => {
            handleMsgText(txt);
          }).catch((err) => {
            finish(false, 'PARSE_ERROR', `Failed to read blob text: ${err.message}`);
          });
          return;
        } else {
          payloadText = Buffer.from(event.data).toString('utf8');
        }
        handleMsgText(payloadText);
      } catch (e) {
        // Continue waiting
      }
    });

    function handleMsgText(text) {
      try {
        const msg = JSON.parse(text);
        if (msg.error) {
          finish(false, msg.error.status || 'API_ERROR', msg.error.message || 'Error during handshake');
        } else if (msg.setupComplete) {
          finish(true, null, 'Healthy');
        }
      } catch (e) {
        // Ignore parsing other fields
      }
    }

    socket.addEventListener('error', (err) => {
      finish(false, 'CONNECTION_ERROR', 'WebSocket connection failed');
    });

    socket.addEventListener('close', (event) => {
      if (!finished) {
        finish(false, 'CLOSED', `WebSocket closed (code: ${event.code}, reason: ${event.reason || 'None'})`);
      }
    });
  });
}

async function pingModel(apiKey, model) {
  if (!apiKey) {
    return { success: false, status: 0, errorCode: 'MISSING_API_KEY', message: 'API key is missing' };
  }
  
  if (isLiveGeminiModel(model)) {
    console.log(`[HEALTH CHECK] Live model detected. Performing WebSocket handshake for: "${model}"...`);
    return pingLiveModel(apiKey, model);
  }
  
  const cleanModel = String(model || '').replace(/^models\//, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:countTokens?key=${apiKey}`;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000); // 6 second strict timeout
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }] }),
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    const data = await response.json().catch(() => ({}));
    
    if (response.ok) {
      return { success: true, status: response.status, errorCode: null, message: 'Healthy' };
    }
    
    const errorDetails = data.error || {};
    const errorCode = errorDetails.status || 'API_ERROR';
    const message = errorDetails.message || `HTTP error ${response.status}`;
    
    return { success: false, status: response.status, errorCode, message };
  } catch (e) {
    const isTimeout = e.name === 'AbortError';
    return {
      success: false,
      status: 0,
      errorCode: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      message: isTimeout ? 'Request timed out' : e.message
    };
  }
}

/**
 * Negotiates a working model for a given key by trying a list of fallback candidates.
 * @param {string} apiKey - The Gemini API key to test.
 * @param {string} preferredModel - The model the user prefers to run.
 * @param {Array<string>} [candidates] - Optional list of fallback candidates to test if preferred fails.
 * @returns {Promise<{model: string, success: boolean, message: string}>}
 */
async function negotiateModel(apiKey, preferredModel, candidates = []) {
  console.log(`[HEALTH CHECK] Testing preferred model: "${preferredModel}"...`);
  const prefCheck = await pingModel(apiKey, preferredModel);
  
  if (prefCheck.success) {
    console.log(`[HEALTH CHECK] Preferred model "${preferredModel}" is healthy.`);
    return { model: preferredModel, success: true, message: 'Preferred model operational' };
  }
  
  console.warn(`[HEALTH CHECK] Preferred model "${preferredModel}" failed check: [${prefCheck.errorCode}] ${prefCheck.message}`);
  
  // Default list of fallback candidates sorted by preference
  const fallbackCandidates = candidates.length > 0 ? candidates : [
    'gemini-2.5-flash-native-audio-latest',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-3.1-flash-lite',
    'gemini-flash-latest'
  ];
  
  for (const candidate of fallbackCandidates) {
    if (candidate === preferredModel) continue; // Already tested
    
    console.log(`[HEALTH CHECK] Trying fallback candidate: "${candidate}"...`);
    const candidateCheck = await pingModel(apiKey, candidate);
    if (candidateCheck.success) {
      console.log(`[HEALTH CHECK] Successfully negotiated operational model: "${candidate}"`);
      return {
        model: candidate,
        success: true,
        message: `Negotiated operational model "${candidate}" after "${preferredModel}" failed.`
      };
    }
  }
  
  console.error('[HEALTH CHECK] All tested Gemini models failed to authenticate or respond.');
  return {
    model: preferredModel,
    success: false,
    message: `All models failed check. Last error: [${prefCheck.errorCode}] ${prefCheck.message}`
  };
}

module.exports = {
  pingModel,
  negotiateModel
};
