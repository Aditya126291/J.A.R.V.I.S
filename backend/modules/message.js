const { runPowerShell } = require('./utils');
const { psQuote, normalizeSimpleText } = require('./command_registry');

const DEEPLINKS = {
  whatsapp: {
    byNumber: (phone, text) => `whatsapp://send?phone=${phone}&text=${encodeURIComponent(text)}`,
  },
};

function normalizePhone(contact) {
  const phoneClean = String(contact || '').replace(/[^0-9+]/g, '');
  if (!phoneClean || phoneClean.length < 10) return '';
  if (phoneClean.startsWith('+')) return phoneClean.slice(1);
  return phoneClean.startsWith('91') ? phoneClean : `91${phoneClean}`;
}

async function openProtocol(url) {
  const { error, stderr } = await runPowerShell(`Start-Process -FilePath ${psQuote(url)}`);
  if (error) return { success: false, error: stderr || error.message };
  return { success: true };
}

function pasteTextScript(text) {
  return `
Set-Clipboard -Value ${psQuote(text)}
[System.Windows.Forms.SendKeys]::SendWait("^v")
`;
}

async function handleWhatsApp(contact, message) {
  const phone = normalizePhone(contact);
  if (phone) {
    const deepLink = DEEPLINKS.whatsapp.byNumber(phone, message);
    const opened = await openProtocol(deepLink);
    if (!opened.success) return opened;

    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic
Start-Sleep -Milliseconds 1800
$procs = Get-Process | Where-Object { $_.MainWindowTitle -match 'WhatsApp' -or $_.Name -match 'WhatsApp' }
if ($procs) {
    [Microsoft.VisualBasic.Interaction]::AppActivate($procs[0].Id)
    Start-Sleep -Milliseconds 400
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Write-Output "SUCCESS"
} else {
    Write-Output "WHATSAPP_NOT_FOUND"
}
`;
    const { stdout } = await runPowerShell(script);
    if (stdout.includes('WHATSAPP_NOT_FOUND')) {
      return { success: false, error: 'WhatsApp window not found. Is it installed?' };
    }
    return { success: true };
  }

  const opened = await openProtocol('whatsapp:');
  if (!opened.success) return opened;

  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic
Start-Sleep -Milliseconds 2500
$procs = Get-Process | Where-Object { $_.MainWindowTitle -match 'WhatsApp' -or $_.Name -match 'WhatsApp' }
if ($procs) {
    [Microsoft.VisualBasic.Interaction]::AppActivate($procs[0].Id)
    Start-Sleep -Milliseconds 500
} else {
    Write-Output "WHATSAPP_NOT_FOUND"
    exit
}
[System.Windows.Forms.SendKeys]::SendWait("^f")
Start-Sleep -Milliseconds 400
${pasteTextScript(contact)}
Start-Sleep -Milliseconds 1200
[System.Windows.Forms.SendKeys]::SendWait("{DOWN}")
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 800
${pasteTextScript(message)}
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Write-Output "SUCCESS"
`;

  const { stdout } = await runPowerShell(script);
  if (stdout.includes('WHATSAPP_NOT_FOUND')) {
    return { success: false, error: 'WhatsApp window not found. Is it installed?' };
  }
  return { success: true };
}

async function handleTelegram(contact, message) {
  const opened = await openProtocol('telegram:');
  if (!opened.success) return opened;

  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic
Start-Sleep -Milliseconds 2500
$procs = Get-Process | Where-Object { $_.MainWindowTitle -match 'Telegram' -or $_.Name -match 'Telegram' }
if ($procs) {
    [Microsoft.VisualBasic.Interaction]::AppActivate($procs[0].Id)
    Start-Sleep -Milliseconds 500
} else {
    Write-Output "TELEGRAM_NOT_FOUND"
    exit
}
[System.Windows.Forms.SendKeys]::SendWait("{ESCAPE}")
Start-Sleep -Milliseconds 300
${pasteTextScript(contact)}
Start-Sleep -Milliseconds 1200
[System.Windows.Forms.SendKeys]::SendWait("{DOWN}")
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 800
${pasteTextScript(message)}
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Write-Output "SUCCESS"
`;

  const { stdout } = await runPowerShell(script);
  if (stdout.includes('TELEGRAM_NOT_FOUND')) {
    return { success: false, error: 'Telegram window not found. Is it installed?' };
  }
  return { success: true };
}

async function handleMessageCommand(action, value) {
  if (action !== 'send') return { success: false, error: 'Unknown message action.' };
  if (!value) return { success: false, error: 'Message details required.' };

  const app = normalizeSimpleText(value.app, 40).toLowerCase();
  const contact = normalizeSimpleText(value.contact, 120);
  const message = normalizeSimpleText(value.message, 1000);
  if (!app || !contact || !message) {
    return { success: false, error: 'App, contact, and message are required.' };
  }

  if (app === 'whatsapp') return handleWhatsApp(contact, message);
  if (app === 'telegram') return handleTelegram(contact, message);
  return { success: false, error: `Messaging not supported for app: ${app}` };
}

module.exports = { handleMessageCommand };
