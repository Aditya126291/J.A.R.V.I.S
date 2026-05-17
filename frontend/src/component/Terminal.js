import React, { useState, useEffect, useRef, useCallback } from 'react';
import './Terminal.css';
import ConfirmDialog from './ConfirmDialog';
import { chatWithJarvis, executeJarvisAction, focusBrowser, ttsUrl } from '../api';

function sanitizeSpokenText(text) {
  let clean = String(text || '');
  clean = clean.replace(/<speak[^>]*>([\s\S]*?)<\/speak>/gi, '$1');
  clean = clean.replace(/<(?:thought|think|scratchpad|reasoning|analysis|system|action)[^>]*>[\s\S]*?<\/(?:thought|think|scratchpad|reasoning|analysis|system|action)>/gi, '');
  clean = clean.replace(/<(?:thought|think|scratchpad|reasoning|analysis|system|action)[^>]*>[\s\S]*/gi, '');
  clean = clean.replace(/<\/?speak[^>]*>/gi, '');
  clean = clean.replace(/<\/?[^>]+>/g, '');
  clean = clean.replace(/(?:^|\n)\s*(?:thoughts?(?:\s+summary)?|thinking|reasoning|analysis|scratchpad|internal monologue)\s*:[\s\S]*?(?=\n\s*(?:speak|response|final|answer)\s*:|$)/gi, '\n');
  clean = clean.replace(/^\s*(?:speak|response|final|answer)\s*:\s*/i, '');
  return clean.replace(/[*#_\x60]/g, '').replace(/\s+/g, ' ').trim();
}

function splitSpeech(text) {
  const clean = sanitizeSpokenText(text);
  if (!clean) return [];

  const sentences = clean.match(/[^.!?]+[.!?]?/g) || [clean];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (next.length <= 180) {
      current = next;
    } else {
      if (current) chunks.push(current);
      current = sentence.trim();
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function summarizePayload(payload) {
  if (!payload) return 'Unknown action';
  if (payload.module === 'apps') return `${payload.action} ${payload.value}`;
  if (payload.module === 'message' && payload.value) {
    return `send ${payload.value.app} message to ${payload.value.contact}`;
  }
  if (payload.module === 'system') {
    if (payload.action === 'brightness_adjust') return `brightness adjust ${payload.value > 0 ? '+' : ''}${payload.value}`;
    return payload.action.endsWith('_set')
      ? `${payload.action.replace('_', ' ')} to ${payload.value}`
      : payload.action.replace(/_/g, ' ');
  }
  return `${payload.module} ${payload.action}${payload.value ? ` ${payload.value}` : ''}`;
}

function successMessage(payload, data) {
  if (data?.message) return data.message;
  if (!payload) return 'Command completed.';
  if (payload.module === 'apps' && payload.action === 'close') return `${payload.value} has been terminated.`;
  if (payload.module === 'apps' && payload.action === 'open') return `${payload.value} is now open.`;
  if (payload.module === 'apps' && payload.action === 'automate') return `${payload.value.app} automation complete.`;
  if (payload.module === 'system') {
    if (payload.action === 'brightness_adjust') return 'Brightness adjusted.';
    return `System ${payload.action.replace(/_/g, ' ')} executed.`;
  }
  if (payload.module === 'message') return 'Message sent.';
  return `${summarizePayload(payload)} completed.`;
}

const Terminal = ({ blobConfig = {} }) => {
  const [chatHistory, setChatHistory] = useState([]);
  const [liveSpeech, setLiveSpeech] = useState('');
  const [fading, setFading] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [providerLabel, setProviderLabel] = useState('READY');

  const recognitionRef = useRef(null);
  const timeoutRef = useRef(null);
  const debounceTimer = useRef(null);
  const currentTranscriptRef = useRef('');
  const isJarvisSpeakingRef = useRef(false);
  const echoProtectUntilRef = useRef(0);
  const chatContainerRef = useRef(null);
  const currentAudioRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingQueueRef = useRef(false);
  const isProcessingRef = useRef(false);
  const pendingActionRef = useRef(null);

  const activeColor = blobConfig.color || '#00ffe1';

  useEffect(() => {
    pendingActionRef.current = pendingAction;
    if (pendingAction) focusBrowser();
  }, [pendingAction]);

  const appendChat = useCallback((entry) => {
    setChatHistory((prev) => [...prev.slice(-7), entry]);
  }, []);

  const updateLastJarvis = useCallback((text) => {
    setChatHistory((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i].role === 'J.A.R.V.I.S') {
          next[i] = { ...next[i], text };
          return next;
        }
      }
      return [...next, { role: 'J.A.R.V.I.S', text }];
    });
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory, liveSpeech]);

  const resetFadeTimer = useCallback(() => {
    setFading(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setFading(true), 20000);
  }, []);

  const processAudioQueue = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingQueueRef.current = false;
      isJarvisSpeakingRef.current = false;
      echoProtectUntilRef.current = Date.now() + 900;
      currentAudioRef.current = null;
      window.simulatedBlobVolumeTarget = 0;
      resetFadeTimer();
      return;
    }

    isPlayingQueueRef.current = true;
    const { text, onPlayCallback } = audioQueueRef.current.shift();
    const audio = new Audio(ttsUrl(text, blobConfig.language || 'en-IN'));
    audio.preload = 'auto';
    currentAudioRef.current = audio;

    audio.onplaying = () => {
      echoProtectUntilRef.current = Date.now() + 99999999;
      window.simulatedBlobVolumeTarget = 120;
      if (onPlayCallback) onPlayCallback();
    };

    audio.onended = () => {
      window.simulatedBlobVolumeTarget = 0;
      processAudioQueue();
    };

    audio.onerror = () => {
      processAudioQueue();
    };

    audio.play().catch(() => {
      processAudioQueue();
    });
  }, [blobConfig.language, resetFadeTimer]);

  const enqueueAudio = useCallback(
    (text, onPlayCallback) => {
      if (!text || !text.trim()) return;
      audioQueueRef.current.push({ text, onPlayCallback });
      if (!isPlayingQueueRef.current) {
        isJarvisSpeakingRef.current = true;
        echoProtectUntilRef.current = Date.now() + 99999999;
        processAudioQueue();
      }
    },
    [processAudioQueue]
  );

  const enqueueSpeech = useCallback(
    (text, onFirstChunk) => {
      const chunks = splitSpeech(text);
      chunks.forEach((chunk, index) => enqueueAudio(chunk, index === 0 ? onFirstChunk : null));
    },
    [enqueueAudio]
  );

  const stopCurrentAudio = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = '';
    }
    audioQueueRef.current = [];
    isPlayingQueueRef.current = false;
    isJarvisSpeakingRef.current = false;
    window.simulatedBlobVolumeTarget = 0;
  }, []);

  const dispatchLog = useCallback((text, status = 'success') => {
    window.dispatchEvent(
      new CustomEvent('jarvis-command-log', {
        detail: {
          time: new Date().toLocaleTimeString('en-US', {
            hour12: false,
            hour: 'numeric',
            minute: 'numeric',
          }),
          text,
          status,
        },
      })
    );
  }, []);

  const executeCommand = useCallback(
    async (payloads, confirmed = false, skipSpeak = false) => {
      if (!Array.isArray(payloads) || payloads.length === 0) {
        enqueueSpeech('I encountered a command parsing error. Please try again.');
        return;
      }

      for (const payload of payloads) {
        try {
          const data = await executeJarvisAction(payload, confirmed);

          if (data.requiresConfirmation) {
            setPendingAction({ payloads: [payload], speech: 'I need authorization before I do that.' });
            updateLastJarvis('Authorization required.');
            enqueueSpeech('I need authorization before I do that.');
            dispatchLog(`Authorization required: ${summarizePayload(payload)}`, 'warning');
            continue;
          }

          if (data.success) {
            const msg = successMessage(payload, data);
            if (!skipSpeak) {
              enqueueSpeech(msg, () => appendChat({ role: 'J.A.R.V.I.S', text: msg }));
            } else {
              appendChat({ role: 'J.A.R.V.I.S', text: msg });
            }
            dispatchLog(msg, 'success');
          } else {
            const msg = `I could not execute that. ${data.error || ''}`.trim();
            enqueueSpeech(msg, () => appendChat({ role: 'J.A.R.V.I.S', text: msg }));
            dispatchLog(msg, 'error');
          }
        } catch (err) {
          const msg = `I could not execute that. ${err.message || ''}`.trim();
          enqueueSpeech(msg, () => appendChat({ role: 'J.A.R.V.I.S', text: msg }));
          dispatchLog(msg, 'error');
        }
      }
    },
    [appendChat, dispatchLog, enqueueSpeech, updateLastJarvis]
  );

  const handleConfirm = useCallback(() => {
    const action = pendingActionRef.current;
    if (!action) return;
    setPendingAction(null);
    updateLastJarvis('Authorized. Executing command...');
    executeCommand(action.payloads, true);
  }, [executeCommand, updateLastJarvis]);

  const handleCancel = useCallback(() => {
    setPendingAction(null);
    const msg = 'Very well sir, request denied.';
    updateLastJarvis(msg);
    enqueueSpeech(msg);
  }, [enqueueSpeech, updateLastJarvis]);

  const submitToJarvisRef = useRef(null);

  submitToJarvisRef.current = async (promptText) => {
    if (!promptText || isProcessingRef.current) return;
    isProcessingRef.current = true;

    appendChat({ role: 'USER', text: promptText });
    appendChat({ role: 'J.A.R.V.I.S', text: 'Thinking...' });
    resetFadeTimer();

    try {
      const result = await chatWithJarvis(promptText);
      const actions = Array.isArray(result.actions) ? result.actions : [];
      const speech = sanitizeSpokenText(result.speech || result.response || 'At your service, sir.') || 'At your service, sir.';
      setProviderLabel((result.provider || 'unknown').toUpperCase());

      if (result.providerSwitch) {
        const sw = result.providerSwitch;
        const switchMsg =
          sw.type === 'failover'
            ? `Switching to ${sw.to}.`
            : sw.type === 'restored'
              ? 'Primary model is back online.'
              : sw.type === 'total_failure'
                ? 'All AI providers are currently unavailable.'
                : `Switched to ${sw.to}.`;
        dispatchLog(switchMsg, sw.type === 'total_failure' ? 'error' : 'warning');
      }

      if (actions.length > 0) {
        if (result.needsConfirmation) {
          updateLastJarvis('Authorization required.');
          setPendingAction({ payloads: actions, speech });
          enqueueSpeech(speech || 'I need authorization before I do that.');
          dispatchLog(`Authorization required: ${actions.map(summarizePayload).join(', ')}`, 'warning');
        } else {
          const hasSpeech = !!(speech && speech.trim());
          updateLastJarvis(speech || 'Executing command...');
          if (hasSpeech) {
            enqueueSpeech(speech);
          }
          executeCommand(actions, false, hasSpeech);
        }
        window.dispatchEvent(new CustomEvent('jarvis-api-status', { detail: 'connected' }));
        return;
      }

      updateLastJarvis(speech);
      enqueueSpeech(speech);
      window.dispatchEvent(new CustomEvent('jarvis-api-status', { detail: 'connected' }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('jarvis-api-status', { detail: 'disconnected' }));
      const errorMsg = 'System error. Neural link severed.';
      updateLastJarvis(errorMsg);
      enqueueSpeech(errorMsg);
      dispatchLog(err.message || errorMsg, 'error');
    } finally {
      isProcessingRef.current = false;
    }
  };

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      appendChat({ role: 'J.A.R.V.I.S', text: 'Speech recognition is not available in this browser.' });
      return undefined;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = blobConfig.language || 'en-IN';
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';

      window.simulatedBlobVolumeTarget = 80;
      clearTimeout(window.blobSilenceTimer);
      window.blobSilenceTimer = setTimeout(() => {
        window.simulatedBlobVolumeTarget = 0;
      }, 450);

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
        else interimTranscript += event.results[i][0].transcript;
      }

      const displayText = finalTranscript || interimTranscript;
      if (!displayText.trim()) return;

      if (pendingActionRef.current && finalTranscript.trim()) {
        const heard = finalTranscript.toLowerCase().trim();
        const isYes =
          heard.includes('yes') ||
          heard.includes('yeah') ||
          heard.includes('yep') ||
          heard.includes('sure') ||
          heard.includes('do it') ||
          heard.includes('go ahead') ||
          heard.includes('haan') ||
          heard.includes('han') ||
          heard.includes('kar do') ||
          heard.includes('ok') ||
          heard.includes('okay');
        const isNo =
          heard.includes('no') ||
          heard.includes('nope') ||
          heard.includes('cancel') ||
          heard.includes('stop') ||
          heard.includes('nahi') ||
          heard.includes('mat') ||
          heard.includes('ruk') ||
          heard.includes("don't");

        if (isYes) handleConfirm();
        else if (isNo) handleCancel();
        return;
      }

      if (Date.now() < echoProtectUntilRef.current) {
        if (isJarvisSpeakingRef.current) {
          stopCurrentAudio();
          echoProtectUntilRef.current = Date.now() + 700;
        }
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        setLiveSpeech('');
        currentTranscriptRef.current = '';
        return;
      }

      setLiveSpeech(displayText);
      resetFadeTimer();

      if (finalTranscript.trim()) {
        currentTranscriptRef.current = finalTranscript;
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
          const finalPrompt = currentTranscriptRef.current.trim();
          setLiveSpeech('');
          currentTranscriptRef.current = '';
          if (finalPrompt && submitToJarvisRef.current) {
            submitToJarvisRef.current(finalPrompt);
          }
        }, 220);
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current && !pendingActionRef.current) {
        try {
          recognitionRef.current.start();
        } catch (e) {}
      }
    };

    try {
      recognition.start();
    } catch (err) {}

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      clearTimeout(window.blobSilenceTimer);
      stopCurrentAudio();
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        try {
          recognitionRef.current.stop();
        } catch (e) {}
        recognitionRef.current = null;
      }
    };
  }, [
    appendChat,
    blobConfig.language,
    executeCommand,
    handleCancel,
    handleConfirm,
    resetFadeTimer,
    stopCurrentAudio,
  ]);

  const hideTerminal = fading || (chatHistory.length === 0 && !liveSpeech);

  return (
    <>
      {pendingAction && (
        <ConfirmDialog
          payloads={pendingAction.payloads}
          speech={pendingAction.speech}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          activeColor={activeColor}
        />
      )}

      <div
        className={`terminal-container ${hideTerminal ? 'fade-out' : 'fade-in'}`}
        style={{
          borderColor: `${activeColor}4a`,
          boxShadow: `0 10px 30px rgba(0, 0, 0, 0.5), inset 0 0 15px ${activeColor}33`,
        }}
      >
        <div className="terminal-header">
          <span className="dot red"></span>
          <span className="dot yellow"></span>
          <span className="dot green"></span>
          <span className="title" style={{ color: activeColor, textShadow: `0 0 5px ${activeColor}80` }}>
            J.A.R.V.I.S. - {providerLabel}
          </span>
        </div>

        <div className="terminal-content" ref={chatContainerRef}>
          {chatHistory.map((msg, idx) => (
            <div className={`chat-line ${msg.role === 'USER' ? 'user-line' : 'jarvis-line'}`} key={`${msg.role}-${idx}`}>
              <span className="prompt" style={{ color: msg.role === 'USER' ? '#ffffff' : activeColor }}>
                {msg.role}:
              </span>
              <span
                className="speech-text"
                style={{
                  color: msg.role === 'USER' ? 'rgba(255,255,255,0.82)' : activeColor,
                  textShadow: msg.role === 'J.A.R.V.I.S' ? `0 0 8px ${activeColor}99` : 'none',
                }}
              >
                {msg.text}
              </span>
            </div>
          ))}

          {liveSpeech && (
            <div className="chat-line user-line">
              <span className="prompt" style={{ color: '#ffffff' }}>USER:</span>
              <span className="speech-text" style={{ color: 'rgba(255,255,255,0.82)' }}>
                {liveSpeech}
                <span className="cursor" style={{ backgroundColor: activeColor, boxShadow: `0 0 10px ${activeColor}` }}></span>
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Terminal;
