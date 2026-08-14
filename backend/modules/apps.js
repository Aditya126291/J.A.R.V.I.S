const fs = require('fs');
const { execFile } = require('child_process');
const { runPowerShell } = require('./utils');
const {
  APP_MAP,
  CLOSE_MAP,
  WEBSITE_TARGETS,
  TITLE_KEYWORDS,
  psQuote,
  escapeRegex,
  normalizeUrl,
  isSafeUrlLike,
  isSafeProcessName,
  isSafeLaunchName,
} = require('./command_registry');

function execFileAsync(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function processNamesForTarget(lower) {
  const processName = CLOSE_MAP[lower];
  return processName ? [processName.replace(/\.exe$/i, '')] : [];
}

async function waitForProcess(processNames, timeoutMs = 7000) {
  if (!processNames.length) return { success: true };

  const script = `
$names = ${psQuote(JSON.stringify(processNames))} | ConvertFrom-Json
$deadline = (Get-Date).AddMilliseconds(${Math.min(15000, Math.max(500, timeoutMs))})
do {
    foreach ($name in $names) {
        if (Get-Process -Name $name -ErrorAction SilentlyContinue) {
            Write-Output "READY"
            exit 0
        }
    }
    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)
Write-Output "NOT_READY"
`;
  const { stdout } = await runPowerShell(script);
  return stdout.includes('READY')
    ? { success: true }
    : { success: false, error: 'Windows accepted the request, but the app did not start. Check that it is installed.' };
}

async function startTarget(target, expectedProcesses = []) {
  const script = `
$ErrorActionPreference = 'Stop'
try {
    Start-Process -FilePath ${psQuote(target)} -ErrorAction Stop | Out-Null
    Write-Output "LAUNCH_REQUESTED"
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
`;
  const { error, stderr, stdout } = await runPowerShell(script);
  if (error || !stdout.includes('LAUNCH_REQUESTED')) {
    return { success: false, error: stderr || error?.message || 'Windows could not start that app.' };
  }
  return waitForProcess(expectedProcesses);
}

async function launchWhatsApp() {
  const script = `
$ErrorActionPreference = 'Stop'
try {
    $desktopExe = Join-Path $env:LOCALAPPDATA 'WhatsApp\\WhatsApp.exe'
    if (Test-Path $desktopExe) {
        Start-Process -FilePath $desktopExe -ErrorAction Stop | Out-Null
        Write-Output "LAUNCH_REQUESTED"
        exit 0
    }

    $app = Get-StartApps | Where-Object { $_.Name -eq 'WhatsApp' } | Select-Object -First 1
    if ($app -and $app.AppID) {
        Start-Process -FilePath 'explorer.exe' -ArgumentList "shell:AppsFolder\\$($app.AppID)" -ErrorAction Stop | Out-Null
        Write-Output "LAUNCH_REQUESTED"
        exit 0
    }

    Write-Error 'WhatsApp Desktop is not installed or is not registered in the Start menu.'
    exit 1
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
`;
  const { error, stderr, stdout } = await runPowerShell(script);
  if (error || !stdout.includes('LAUNCH_REQUESTED')) {
    return { success: false, error: stderr || error?.message || 'WhatsApp could not be started.' };
  }
  return waitForProcess(['WhatsApp', 'WhatsAppBeta']);
}

function resolveOpenTarget(rawTarget) {
  const lower = String(rawTarget || '').toLowerCase().trim();
  if (!lower) return null;

  if (APP_MAP[lower]) return APP_MAP[lower];
  if (isSafeUrlLike(lower)) return normalizeUrl(lower);
  if ((lower.includes('\\') || lower.includes('/') || lower.includes(':')) && fs.existsSync(rawTarget)) {
    return rawTarget;
  }
  if (isSafeLaunchName(lower)) return lower;
  return null;
}

function isSendKeyToken(step) {
  return /^\{(?:ENTER|TAB|ESCAPE|ESC|UP|DOWN|LEFT|RIGHT|BACKSPACE|DELETE|HOME|END|PGUP|PGDN|SPACE)\}$/i.test(String(step || ''));
}

async function closeWebsiteTab(lower) {
  const keyword = TITLE_KEYWORDS[lower] || lower;
  const escapedKeyword = escapeRegex(keyword);

  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$keyword = ${psQuote(escapedKeyword)}
$root = [System.Windows.Automation.AutomationElement]::RootElement
$chromeCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "Chrome_WidgetWin_1")
$chromes = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $chromeCondition)
$found = $false

foreach ($chrome in $chromes) {
    $tabCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
    $tabs = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)
    foreach ($tab in $tabs) {
        if ($tab.Current.Name -match $keyword) {
            $selectionPattern = $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern) -as [System.Windows.Automation.SelectionItemPattern]
            if ($selectionPattern) {
                $selectionPattern.Select()
                Start-Sleep -Milliseconds 80
                $shell = New-Object -ComObject WScript.Shell
                $shell.SendKeys('^w')
                $found = $true
                break
            }
        }
    }
    if ($found) { break }
}

if ($found) { Write-Output "SUCCESS" } else { Write-Output "NOT_FOUND" }
`;

  const { stdout } = await runPowerShell(script);
  return stdout.includes('SUCCESS');
}

async function taskKill(processName) {
  if (!isSafeProcessName(processName)) {
    return { success: false, error: 'Unsafe process target.' };
  }

  const { error, stdout, stderr } = await execFileAsync('taskkill', ['/IM', processName, '/F', '/T']);
  const output = `${stdout}${stderr}`.toLowerCase();
  if (!error || output.includes('success')) return { success: true };
  return { success: false, error: stderr || error.message || 'Process not found.' };
}

async function handleAppCommand(action, target) {
  if (!target) return { success: false, error: 'Target required' };
  const lower = typeof target === 'string' ? target.toLowerCase().trim() : '';

  if (action === 'open') {
    const openTarget = resolveOpenTarget(target);
    if (!openTarget) return { success: false, error: 'I cannot safely open that target.' };
    if (lower === 'whatsapp') return launchWhatsApp();
    return startTarget(openTarget, processNamesForTarget(lower));
  }

  if (action === 'close') {
    if (WEBSITE_TARGETS.has(lower) || TITLE_KEYWORDS[lower]) {
      const tabClosed = await closeWebsiteTab(lower);
      if (tabClosed) return { success: true };
      return { success: false, error: `I could not find an open ${target} tab. I did not close your browser.` };
    }

    const processName = CLOSE_MAP[lower] || (isSafeLaunchName(lower) ? `${lower}.exe` : '');
    if (!processName) return { success: false, error: 'I cannot safely close that target.' };
    return taskKill(processName);
  }

  if (action === 'automate') {
    const { app, sequence } = target;
    if (!app || !sequence || !Array.isArray(sequence)) {
      return { success: false, error: 'Invalid automation payload.' };
    }

    let psCode = `
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
    $w = New-Object -ComObject WScript.Shell
    $w.AppActivate($pid) | Out-Null
    Start-Sleep -Milliseconds 250
    $script:targetHwnd = $proc.MainWindowHandle
    return $true
}

function Test-JarvisFocus {
    if ($script:targetHwnd -eq [IntPtr]::Zero) { return $false }
    return ([Win32.User32]::GetForegroundWindow() -eq $script:targetHwnd)
}

function Send-JarvisKeys {
    param([string]$keys)
    if (-not (Test-JarvisFocus)) {
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

$appName = ${psQuote(app)}
$procs = Get-Process | Where-Object { $_.MainWindowTitle -match [regex]::Escape($appName) -or $_.Name -match [regex]::Escape($appName) }
if ($procs) {
    if (-not (Set-JarvisFocus $procs[0].Id)) {
        Write-Output "APP_NOT_FOUND"
        exit
    }
    Start-Sleep -Milliseconds 500
} else {
    Write-Output "APP_NOT_FOUND"
    exit
}
`;

    for (const step of sequence) {
      if (typeof step === 'string' && step.startsWith('{WAIT:')) {
        const match = step.match(/\{WAIT:(\d+)\}/);
        if (match) psCode += `Start-Sleep -Milliseconds ${Math.min(10000, Number(match[1]))}\n`;
      } else if (isSendKeyToken(step)) {
        psCode += `Send-JarvisKeys ${psQuote(step)}\n`;
        psCode += `Start-Sleep -Milliseconds 120\n`;
      } else {
        psCode += `Send-JarvisPaste ${psQuote(step)}\n`;
        psCode += `Start-Sleep -Milliseconds 120\n`;
      }
    }

    psCode += 'Write-Output "SUCCESS"\n';
    const { stdout, error, stderr } = await runPowerShell(psCode);
    if (error) return { success: false, error: stderr || error.message };
    if (stdout.includes('FOCUS_LOST')) {
      return { success: false, error: 'Focus shifted away from the target app during automation. Try again without switching windows.' };
    }
    if (stdout.includes('APP_NOT_FOUND')) {
      return { success: false, error: 'Target app window not found.' };
    }
    if (stdout.includes('SUCCESS')) return { success: true };
    return { success: false, error: 'Automation did not complete.' };
  }

  return { success: false, error: 'Unknown app action.' };
}

module.exports = {
  handleAppCommand,
  // Exported as pure helpers for regression tests; execution stays private.
  processNamesForTarget,
  resolveOpenTarget,
};
