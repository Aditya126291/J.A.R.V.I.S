const express = require('express');
const cors = require('cors');

const config = require('./modules/config');
const telemetry = require('./modules/telemetry');
const aiRouter = require('./modules/ai_router');
const tts = require('./modules/tts');
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
const { handleWebCommand } = require('./modules/web');
const security = require('./modules/security');
const conversationStore = require('./modules/conversation_store');
const memory = require('./modules/memory');

const app = express();
const corsOptions = config.allowedOrigin === '*' ? {} : { origin: config.allowedOrigin };

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

tts.registerTtsRoute(app);

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

function sseSend(res, type, payload) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  if (typeof res.flush === 'function') res.flush();
}

app.get('/api/chat-stream', async (req, res) => {
  const message = String(req.query.message || '').slice(0, 2000);
  if (!message) {
    res.status(400).end('message required');
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Heartbeat every 10s in case Express keeps things buffered
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': hb\n\n');
  }, 10000);

  let closed = false;
  req.on('close', () => { closed = true; clearInterval(heartbeat); });

  try {
    if (typeof aiRouter.chatStream !== 'function') {
      // Fallback to non-streaming chat behind SSE
      const result = await aiRouter.chat(message);
      sseSend(res, 'meta', { provider: result.provider, providerSwitch: result.providerSwitch || null });
      sseSend(res, 'speech_delta', { text: result.speech || '' });
      if (Array.isArray(result.actions) && result.actions.length) {
        sseSend(res, 'action_ready', { actions: result.actions, needsConfirmation: !!result.needsConfirmation });
      }
      sseSend(res, 'done', { speech: result.speech, actions: result.actions || [], status: result.status, provider: result.provider });
    } else {
      // ai_router.chatStream uses a unified event callback `(event) => ...`
      // where event = { type, data }. Forward each event straight through SSE.
      await aiRouter.chatStream(message, (event) => {
        if (closed || !event || !event.type) return;
        sseSend(res, event.type, event.data || {});
      });
    }
  } catch (e) {
    console.error('[CHAT-STREAM ERROR]', e);
    sseSend(res, 'error', { message: e.message || 'stream failed', code: e.code || 'INTERNAL' });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) {
      try { res.end(); } catch (_) {}
    }
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

// --- Dev-mode widget endpoints (read-only project inspectors) -----------
const devTools = require('./modules/dev_tools');

app.get('/api/dev/git', async (req, res) => {
  res.json(await devTools.getGitGlance(req.query.root));
});

app.get('/api/dev/project', async (req, res) => {
  res.json(await devTools.getProjectInfo(req.query.root));
});

app.get('/api/dev/build-feed', async (req, res) => {
  res.json(await devTools.getBuildFeed(req.query.root));
});

app.post('/api/dev/build-feed', express.json({ limit: '32kb' }), async (req, res) => {
  const event = req.body || {};
  res.json(devTools.recordBuildEvent(req.query.root, event));
});

app.get('/api/dev/antigravity', async (req, res) => {
  const limit = Number(req.query.limit) || 12;
  res.json(await devTools.getAntigravityWorkspaces({ limit }));
});

app.post('/api/dev/antigravity/open', express.json({ limit: '8kb' }), (req, res) => {
  const target = String(req.body?.path || '');
  const mode = String(req.body?.mode || 'reuse').toLowerCase();
  res.json(devTools.openInAntigravity(target, mode));
});

// --- Gamer-mode widget endpoints (read-only) ----------------------------
const gameTools = require('./modules/game_tools');

app.get('/api/game/now-playing', async (req, res) => {
  res.json(await gameTools.getNowPlaying());
});

app.get('/api/game/presence', async (req, res) => {
  res.json(await gameTools.getGamePresence());
});

app.get('/api/game/rich-presence', async (req, res) => {
  res.json(await gameTools.getRichPresence());
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
  if (payload.module === 'web') return handleWebCommand(payload.action, payload.value);
  return { success: false, error: 'Module not implemented' };
}

app.post('/api/execute', async (req, res) => {
  const payload = normalizePayload(req.body);
  if (!payload) {
    return res.status(400).json({ success: false, error: 'Invalid or unsupported command payload.' });
  }

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
let radarSubscriberCount = 0;
let radarLastSubscriberAt = 0;
let radarTimer = null;

const RADAR_INTERVAL_MS = 30000;
const RADAR_IDLE_GRACE_MS = 60000; // keep scanning for 60s after last subscriber

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = require('child_process').execFile(
      command,
      args,
      { windowsHide: true, timeout: 5000, ...options },
      (error, stdout, stderr) => {
        resolve({ error, stdout: stdout || '', stderr: stderr || '' });
      }
    );
    child.on('error', () => { /* swallow ENOENT/spawn errors */ });
  });
}

async function runRadarScan() {
  if (isScanning) return;
  isScanning = true;

  const routerFilter = /(?:TP-Link|D-Link|Netgear|ASUS|Linksys|Tenda|Cisco|Huawei|ZTE|Fibernet|ACT_|Hathway|_Guest|_EXT$|JioFiber|Airtel|BSNL|Excitel|Extender|Repeater|Gateway)/i;
  const laptopHint = /(?:-PC|Laptop|Desktop|Workstation|MacBook|Surface|ProBook|EliteBook)/i;
  const currentDevices = [];

  // Wi-Fi via netsh — native binary, no PowerShell host startup.
  try {
    const { stdout } = await execFileAsync('netsh', ['wlan', 'show', 'networks', 'mode=bssid']);
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

  // Bluetooth/PnP query — Get-PnpDevice has no native equivalent, so we
  // still need PowerShell here. Kept inside the gated radar loop only.
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

  // ARP via the native binary, no shell.
  try {
    const { stdout } = await execFileAsync('arp', ['-a']);
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

function ensureRadarLoop() {
  if (radarTimer) return;
  radarTimer = setInterval(() => {
    const idle = Date.now() - radarLastSubscriberAt;
    if (radarSubscriberCount === 0 && idle > RADAR_IDLE_GRACE_MS) {
      clearInterval(radarTimer);
      radarTimer = null;
      return;
    }
    runRadarScan();
  }, RADAR_INTERVAL_MS);
}

function noteRadarSubscriber() {
  radarSubscriberCount = 1; // single-client model; bump if multi-tenant
  radarLastSubscriberAt = Date.now();
  ensureRadarLoop();
}

app.get('/api/radar', (req, res) => {
  // Each fetch counts as a live subscriber heartbeat. Loop pauses ~60s
  // after the HUD stops polling.
  noteRadarSubscriber();
  // Trigger a scan if data is stale (cold-start / just-resumed loop).
  if (globalRadarData.length === 0 && !isScanning) {
    runRadarScan();
  }
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
  if (!normalized) return res.json({ success: false, error: 'Invalid system command payload.' });
  const result = await executePayload(normalized);
  res.json({ ...result, target });
});

// --- Seven-Layer Security Matrix Endpoint ---
app.get('/api/security-matrix', (req, res) => {
  res.json({ success: true, levels: security.AUTHORITY_LEVELS });
});

// --- Conversation Store Endpoints ---
app.get('/api/sessions', (req, res) => {
  const sessions = conversationStore.listSessions();
  res.json({ success: true, sessions });
});

app.get('/api/turns', (req, res) => {
  const { sessionId, limit } = req.query;
  const turns = conversationStore.listTurns(sessionId, Number(limit) || 50);
  res.json({ success: true, turns });
});

app.get('/api/audit-log', (req, res) => {
  const logs = conversationStore.listAuditLogs(Number(req.query.limit) || 50);
  res.json({ success: true, auditLogs: logs });
});

// --- Long-Term Memory Endpoints ---
app.get('/api/memory', (req, res) => {
  const { q } = req.query;
  const memories = memory.listMemories(q);
  res.json({ success: true, memories });
});

app.post('/api/memory', (req, res) => {
  const { kind, content, tags } = req.body;
  if (!content) return res.status(400).json({ success: false, error: 'Memory content is required' });
  const record = memory.addMemory(kind, content, tags, 'manual_api');
  conversationStore.logAuditEvent('memory_create', 'A3', 'memory_store', 'success', `Created memory: "${content.slice(0, 40)}"`);
  res.json({ success: true, memory: record });
});

app.delete('/api/memory/:id', (req, res) => {
  const { id } = req.params;
  const removed = memory.deleteMemory(id);
  if (removed) {
    conversationStore.logAuditEvent('memory_delete', 'A6', 'memory_store', 'success', `Deleted memory ID: ${id}`);
  }
  res.json({ success: removed, deletedId: id });
});

app.listen(config.port, () => {
  console.log(`J.A.R.V.I.S backend online on port ${config.port}`);
  console.log('Endpoints: /api/chat, /api/execute, /tts, /api/system-stats, /api/radar, /api/memory, /api/sessions, /api/audit-log, /api/security-matrix');
});

process.on('SIGTERM', () => {
  if (radarTimer) { clearInterval(radarTimer); radarTimer = null; }
  aiRouter.stopHealthMonitor();
  process.exit(0);
});

module.exports = app;
