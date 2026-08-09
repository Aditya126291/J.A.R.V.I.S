const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');

function loadDotEnv(filePath, overwrite = false) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      if (overwrite || process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

// Initial load (respect existing but overwrite if explicitly called)
loadDotEnv(envPath, true);

const config = {
  port: Number(process.env.JARVIS_PORT || 5000),
  allowedOrigin: process.env.JARVIS_ALLOWED_ORIGIN || '*',
  geminiPrimaryApiKey: process.env.GEMINI_PRIMARY_API_KEY || '',
  geminiPrimaryModel: process.env.GEMINI_PRIMARY_MODEL || 'gemini-3.1-flash-live-preview',
  geminiFallbackApiKey: process.env.GEMINI_FALLBACK_API_KEY || '',
  geminiFallbackModel: process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-live-preview',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'gemma4:26b',
  securityPin: process.env.JARVIS_SECURITY_PIN || '',
  reload() {
    loadDotEnv(envPath, true);
    this.port = Number(process.env.JARVIS_PORT || 5000);
    this.allowedOrigin = process.env.JARVIS_ALLOWED_ORIGIN || '*';
    this.geminiPrimaryApiKey = process.env.GEMINI_PRIMARY_API_KEY || '';
    this.geminiPrimaryModel = process.env.GEMINI_PRIMARY_MODEL || 'gemini-3.1-flash-live-preview';
    this.geminiFallbackApiKey = process.env.GEMINI_FALLBACK_API_KEY || '';
    this.geminiFallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-live-preview';
    this.ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.ollamaModel = process.env.OLLAMA_MODEL || 'gemma4:26b';
    this.securityPin = process.env.JARVIS_SECURITY_PIN || '';
    console.log('[CONFIG] Environment variables and configuration dynamically reloaded.');
  }
};

module.exports = config;
