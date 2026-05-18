const { runPowerShell } = require('./utils');
const { psQuote, normalizeSimpleText } = require('./command_registry');

const DEEPLINKS = {
  whatsapp: {
    byNumber: (phone, text) => `whatsapp://send?phone=${phone}&text=${encodeURIComponent(text)}`,
  },
};

// Focus-guarded SendKeys: every keystroke is preceded by a re-activation
// check. If the foreground window drifts away from the target HWND mid-flow
// (user clicks into VS Code, Discord, etc.) the script aborts with
// FOCUS_LOST instead of leaking keystrokes into the wrong app.
//
// Implementation notes:
//   - We capture the target HWND once after the initial AppActivate.
//   - Before each SendKeys block we call GetForegroundWindow() and compare.
//     If it differs, we try to re-activate ONCE; if that fails too, we abort.
//   - This is wrapped in PowerShell because Node has no clean Win32 API
//     access without a native module. The `runPowerShell` cost is paid
//     once per turn, not per keystroke.
function focusGuardPrelude() {
  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -Namespace Win32 -Name User32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
'@

$script:targetHwnd = [IntPtr]::Zero

function Set-JarvisFocus {
    param([int]$pid)
    $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
    if (-not $proc) { return $false }
    [Microsoft.VisualBasic.Interaction]::AppActivate($pid) | Out-Null
    Start-Sleep -Milliseconds 250
    $script:targetHwnd = $proc.MainWindowHandle
    return $true
}

function Test-JarvisFocus {
    if ($script:targetHwnd -eq [IntPtr]::Zero) { return $false }
    $current = [Win32.User32]::GetForegroundWindow()
    return $current -eq $script:targetHwnd
}

function Send-JarvisKeys {
    param([string]$keys)
    if (-not (Test-JarvisFocus)) {
        # One re-activation attempt before giving up.
        if ($script:targetHwnd -ne [IntPtr]::Zero) {
            [Win32.User32]::SetForegroundWindow($script:targetHwnd) | Out-Null
            Start-Sleep -Milliseconds 200
        }
        if (-not (Test-JarvisFocus)) {
            Write-Output "FOCUS_LOST"
            exit
        }
    }
    [System.Windows.Forms.SendKeys]::SendWait($keys)
}

function Send-JarvisPaste {
    param([string]$text)
    Set-Clipboard -Value $text
    Send-JarvisKeys "^v"
}
`;
}

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
  // Routes through Send-JarvisPaste so focus is verified before each
  // ^v gets fired.
  return `Send-JarvisPaste ${psQuote(text)}\n`;
}

async function handleWhatsApp(contact, message) {
  const phone = normalizePhone(contact);
  if (phone) {
    const deepLink = DEEPLINKS.whatsapp.byNumber(phone, message);
    const opened = await openProtocol(deepLink);
    if (!opened.success) return opened;

    const script = `${focusGuardPrelude()}
Start-Sleep -Milliseconds 1800
$procs = Get-Process | Where-Object { $_.MainWindowTitle -match 'WhatsApp' -or $_.Name -match 'WhatsApp' }
if ($procs) {
    if (-not (Set-JarvisFocus $procs[0].Id)) {
        Write-Output "WHATSAPP_NOT_FOUND"
        exit
    }
    Send-JarvisKeys "{ENTER}"
    Write-Output "SUCCESS"
} else {
    Write-Output "WHATSAPP_NOT_FOUND"
}
`;
    const { stdout } = await runPowerShell(script);
    if (stdout.includes('FOCUS_LOST')) {
      return { success: false, error: 'Focus shifted away from WhatsApp during send. Try again without switching windows.' };
    }
    if (stdout.includes('WHATSAPP_NOT_FOUND')) {
      return { success: false, error: 'WhatsApp window not found. Is it installed?' };
    }
    return { success: true };
  }

  const opened = await openProtocol('whatsapp:');
  if (!opened.success) return opened;

  const script = `${focusGuardPrelude()}
Start-Sleep -Milliseconds 2500
$procs = Get-Process | Where-Object { $_.MainWindowTitle -match 'WhatsApp' -or $_.Name -match 'WhatsApp' }
if ($procs) {
    if (-not (Set-JarvisFocus $procs[0].Id)) {
        Write-Output "WHATSAPP_NOT_FOUND"
        exit
    }
} else {
    Write-Output "WHATSAPP_NOT_FOUND"
    exit
}
Send-JarvisKeys "^f"
Start-Sleep -Milliseconds 400
${pasteTextScript(contact)}
Start-Sleep -Milliseconds 1200
Send-JarvisKeys "{DOWN}"
Start-Sleep -Milliseconds 200
Send-JarvisKeys "{ENTER}"
Start-Sleep -Milliseconds 800
${pasteTextScript(message)}
Start-Sleep -Milliseconds 300
Send-JarvisKeys "{ENTER}"
Write-Output "SUCCESS"
`;

  const { stdout } = await runPowerShell(script);
  if (stdout.includes('FOCUS_LOST')) {
    return { success: false, error: 'Focus shifted away from WhatsApp during send. Try again without switching windows.' };
  }
  if (stdout.includes('WHATSAPP_NOT_FOUND')) {
    return { success: false, error: 'WhatsApp window not found. Is it installed?' };
  }
  return { success: true };
}

async function handleTelegram(contact, message) {
  const opened = await openProtocol('telegram:');
  if (!opened.success) return opened;

  const script = `${focusGuardPrelude()}
Start-Sleep -Milliseconds 2500
$procs = Get-Process | Where-Object { $_.MainWindowTitle -match 'Telegram' -or $_.Name -match 'Telegram' }
if ($procs) {
    if (-not (Set-JarvisFocus $procs[0].Id)) {
        Write-Output "TELEGRAM_NOT_FOUND"
        exit
    }
} else {
    Write-Output "TELEGRAM_NOT_FOUND"
    exit
}
Send-JarvisKeys "{ESCAPE}"
Start-Sleep -Milliseconds 300
${pasteTextScript(contact)}
Start-Sleep -Milliseconds 1200
Send-JarvisKeys "{DOWN}"
Start-Sleep -Milliseconds 200
Send-JarvisKeys "{ENTER}"
Start-Sleep -Milliseconds 800
${pasteTextScript(message)}
Start-Sleep -Milliseconds 300
Send-JarvisKeys "{ENTER}"
Write-Output "SUCCESS"
`;

  const { stdout } = await runPowerShell(script);
  if (stdout.includes('FOCUS_LOST')) {
    return { success: false, error: 'Focus shifted away from Telegram during send. Try again without switching windows.' };
  }
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
