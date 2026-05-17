const express = require('express');
const cors = require('cors');
const googleTTS = require('google-tts-api');
const https = require('https');

const config = require('./modules/config');
const telemetry = require('./modules/telemetry');
const aiRouter = require('./modules/ai_router');
const { runPowerShell } = require('./modules/utils');
const { normalizePayload, requiresConfirmation, summarizeAction } = require('./modules/command_registry');
const { handleAppCommand } = require('./modules/apps');
const { handleSystemCommand } = require('./modules/system');
const { handlePowerCommand } = require('./modules/power');
const { handleMediaCommand } = require('./modules/media');
const { handleFilesCommand } = require('./modules/files');
const { handleProductivityCommand } = require('./modules/productivity');
const { handleNetworkCommand } = require('./modules/network');
const { handleWorkspaceCommand } = require('./modules/workspace');
const { handleMessageCommand } = require('./modules/message');

const app = express();
const corsOptions = config.allowedOrigin === '*' ? {} : { origin: config.allowedOrigin };

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

const ttsCache = new Map();
const MAX_TTS_CACHE = 80;

function rememberTts(key, buffer) {
  if (ttsCache.size >= MAX_TTS_CACHE) {
    const oldest = ttsCache.keys().next().value;
    ttsCache.delete(oldest);
  }
  ttsCache.set(key, buffer);
}

function sendAudio(res, buffer) {
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(buffer);
}

app.get('/tts', async (req, res) => {
  const { text, lang } = req.query;
  const cleanText = String(text || '').trim().slice(0, 600);
  if (!cleanText) return res.status(400).send('Text is required');

  const ttsLang = lang && String(lang).includes('hi') ? 'en-IN' : 'en-GB';
  const cacheKey = `${ttsLang}:${cleanText}`;
  if (ttsCache.has(cacheKey)) return sendAudio(res, ttsCache.get(cacheKey));

  try {
    const url = googleTTS.getAudioUrl(cleanText, {
      lang: ttsLang,
      slow: false,
      host: 'https://translate.google.com',
    });

    https
      .get(url, (googleRes) => {
        if (googleRes.statusCode && googleRes.statusCode >= 400) {
          res.status(502).send('Synthesis failed');
          googleRes.resume();
          return;
        }

        const chunks = [];
        googleRes.on('data', (chunk) => chunks.push(chunk));
        googleRes.on('end', () => {
          const buffer = Buffer.concat(chunks);
          rememberTts(cacheKey, buffer);
          sendAudio(res, buffer);
        });
      })
      .on('error', (err) => {
        console.error('TTS proxy error:', err);
        res.status(500).send('Synthesis failed');
      });
  } catch (error) {
    console.error('TTS generation error:', error);
    res.status(500).send('Synthesis failed');
  }
});

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }

  try {
    const result = await aiRouter.chat(message);
    res.json(result);
  } catch (e) {
    console.error('[CHAT ERROR]', e);
    res.status(500).json({
      success: false,
      speech: "I'm experiencing technical difficulties. Please try again.",
      response: "I'm experiencing technical difficulties. Please try again.",
      actions: [],
      needsConfirmation: false,
      provider: 'error',
      status: 'error',
      error: e.message,
    });
  }
});

app.get('/api/ai-status', (req, res) => {
  res.json(aiRouter.getStatus());
});

app.post('/api/ai-clear', (req, res) => {
  aiRouter.clearHistory();
  res.json({ success: true });
});

app.get('/api/system-stats', async (req, res) => {
  const stats = await telemetry.getSystemStats();
  res.json(stats);
});

async function executePayload(payload) {
  if (payload.module === 'apps') return handleAppCommand(payload.action, payload.value);
  if (payload.module === 'system') return handleSystemCommand(payload.action, payload.value);
  if (payload.module === 'power') return handlePowerCommand(payload.action);
  if (payload.module === 'media') return handleMediaCommand(payload.action);
  if (payload.module === 'files') return handleFilesCommand(payload.action, payload.value);
  if (payload.module === 'productivity') return handleProductivityCommand(payload.action, payload.value);
  if (payload.module === 'network') return handleNetworkCommand(payload.action, payload.value);
  if (payload.module === 'workspace') return handleWorkspaceCommand(payload.action);
  if (payload.module === 'message') return handleMessageCommand(payload.action, payload.value);
  return { success: false, error: 'Module not implemented' };
}

app.post('/api/execute', async (req, res) => {
  const normalized = normalizePayload(req.body);
  if (!normalized.ok) {
    return res.status(400).json({ success: false, error: normalized.error });
  }

  const payload = normalized.payload;
  const isRisky = requiresConfirmation(payload);
  if (isRisky && req.body.confirmed !== true) {
    return res.status(409).json({
      success: false,
      requiresConfirmation: true,
      summary: summarizeAction(payload),
      error: 'Command requires confirmation.',
    });
  }

  try {
    const result = await executePayload(payload);
    res.json({
      ...result,
      module: payload.module,
      action: payload.action,
      summary: summarizeAction(payload),
    });
  } catch (e) {
    console.error('[ROUTER ERROR]', e);
    res.status(500).json({ success: false, error: e.message, summary: summarizeAction(payload) });
  }
});

app.get('/focus-browser', async (req, res) => {
  const script = `
$wshell = New-Object -ComObject WScript.Shell
$targets = @('Chrome', 'msedge', 'firefox')
foreach ($target in $targets) {
    if ($wshell.AppActivate($target)) {
        Write-Output "SUCCESS"
        exit
    }
}
Write-Output "NOT_FOUND"
`;
  const { stdout } = await runPowerShell(script);
  res.json({ success: stdout.includes('SUCCESS') });
});

let globalRadarData = [];
let isScanning = false;

async function runRadarScan() {
  if (isScanning) return;
  isScanning = true;

  const routerFilter = /(?:TP-Link|D-Link|Netgear|ASUS|Linksys|Tenda|Cisco|Huawei|ZTE|Fibernet|ACT_|Hathway|_Guest|_EXT$|JioFiber|Airtel|BSNL|Excitel|Extender|Repeater|Gateway)/i;
  const laptopHint = /(?:-PC|Laptop|Desktop|Workstation|MacBook|Surface|ProBook|EliteBook)/i;
  const currentDevices = [];

  try {
    const { stdout } = await runPowerShell('netsh wlan show networks mode=bssid');
    if (stdout) {
      const blocks = stdout.split(/SSID \d+ :/g).slice(1);
      for (const block of blocks) {
        const lines = block.split('\n');
        const name = (lines[0] || '').trim();
        if (!name || routerFilter.test(name)) continue;

        const sigMatch = block.match(/Signal\s+:\s+(\d+)%/);
        const signal = sigMatch ? Number(sigMatch[1]) : 0;
        if (signal < 10) continue;

        let distance = Math.round(((100 - signal) / 4) * 10) / 10;
        if (distance > 20) continue;
        if (distance < 1) distance = 1;

        currentDevices.push({
          name,
          type: laptopHint.test(name) ? 'LAPTOP' : 'PHONE',
          distance,
          signal,
        });
      }
    }
  } catch (e) {}

  try {
    const btScript = `
$devs = @()
Get-PnpDevice -Class AudioEndpoint -Status OK | Select-Object FriendlyName, InstanceId | ForEach-Object { $devs += @{ name=$_.FriendlyName; type="EARBUDS" } }
Get-PnpDevice -Class Bluetooth -Status OK | Select-Object FriendlyName, InstanceId | ForEach-Object { $devs += @{ name=$_.FriendlyName; type="DEVICE" } }
$devs | ConvertTo-Json
`;
    const { stdout } = await runPowerShell(btScript);
    if (stdout) {
      let btList = [];
      try {
        const parsed = JSON.parse(stdout);
        btList = Array.isArray(parsed) ? parsed : [parsed];
      } catch (err) {}

      for (const item of btList) {
        const name = item.name;
        if (name && !/(?:Realtek|Speakers|Microphone|Array|Digital Audio|Hands-Free|Enumerator|Adapter|Service|Protocol)/i.test(name)) {
          currentDevices.push({ name, type: item.type, distance: 3.5, signal: 85 });
        }
      }
    }
  } catch (e) {}

  try {
    const { stdout } = await runPowerShell('arp -a');
    if (stdout) {
      const lines = stdout.split('\n');
      for (const line of lines) {
        const match = line.match(/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\s+([0-9a-fA-F-]+)\s+dynamic/);
        if (!match) continue;
        const ip = match[1];
        const lastOctet = ip.split('.').pop();
        if (lastOctet === '1' || lastOctet === '255') continue;
        currentDevices.push({ name: `LAN_NODE_${lastOctet}`, type: 'LAN', distance: 8, signal: 60 });
      }
    }
  } catch (e) {}

  globalRadarData = Array.from(new Map(currentDevices.map((device) => [device.name, device])).values());
  isScanning = false;
}

app.get('/api/radar', (req, res) => {
  res.json({ success: true, devices: globalRadarData });
});

app.get('/system', async (req, res) => {
  const { target } = req.query;
  if (!target) return res.status(400).json({ error: 'Target is required' });

  const parts = String(target).toLowerCase().trim().split('_');
  const action = parts[0];
  const value = parts[1];
  const payload =
    action === 'volume'
      ? { module: 'system', action: value === 'mute' ? 'volume_mute' : value === 'unmute' ? 'volume_unmute' : 'volume_set', value }
      : action === 'brightness'
        ? { module: 'system', action: 'brightness_set', value }
        : null;

  if (!payload) return res.json({ success: false, error: 'Unknown system command' });
  const normalized = normalizePayload(payload);
  if (!normalized.ok) return res.json({ success: false, error: normalized.error });
  const result = await executePayload(normalized.payload);
  res.json({ ...result, target });
});

setInterval(runRadarScan, 15000);
runRadarScan();

app.listen(config.port, () => {
  console.log(`J.A.R.V.I.S backend online on port ${config.port}`);
  console.log('Endpoints: /api/chat, /api/execute, /tts, /api/system-stats, /api/radar');
});

process.on('SIGTERM', () => {
  aiRouter.stopHealthMonitor();
  process.exit(0);
});

module.exports = app;
