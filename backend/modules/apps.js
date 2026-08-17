const fs = require('fs');
const { execFile, exec } = require('child_process');
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

// #region agent log
function dbgApps(hypothesisId, location, message, data) {
  fetch('http://127.0.0.1:7725/ingest/24b532b9-8624-4538-bfe3-0c7dd0936c97', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'bbe3e7' }, body: JSON.stringify({ sessionId: 'bbe3e7', runId: 'pre-fix', hypothesisId, location, message, data, timestamp: Date.now() }) }).catch(() => {});
}
// #endregion

function execFileAsync(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function processNamesForTarget(lower) {
  const target = CLOSE_MAP[lower];
  if (!target) return [];
  const list = Array.isArray(target) ? target : [target];
  return list.map((item) => item.replace(/\.exe$/i, ''));
}

async function waitForAppWindow(processNames, timeoutMs = 7000) {
  if (!processNames.length) return { success: true };

  const script = `
$names = ${psQuote(JSON.stringify(processNames))} | ConvertFrom-Json
$deadline = (Get-Date).AddMilliseconds(${Math.min(15000, Math.max(500, timeoutMs))})
do {
    foreach ($name in $names) {
        if (Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }) {
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
    : { success: false, error: 'Windows accepted the request, but no app window appeared. Check that the app is installed and not blocked.' };
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
  return waitForAppWindow(expectedProcesses);
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
  return waitForAppWindow(['WhatsApp', 'WhatsAppBeta', 'WhatsApp.Root', 'WhatsAppDesktop']);
}

function resolveOpenTarget(rawTarget) {
  const lower = String(rawTarget || '').toLowerCase().trim();
  if (!lower) return null;

  if (APP_MAP[lower]) return APP_MAP[lower];
  if (isSafeUrlLike(lower)) return normalizeUrl(lower);
  if (fs.existsSync(String(rawTarget).trim())) {
    return rawTarget;
  }

  // If user explicitly asks for a website / site, resolve to direct web navigation
  if (/\b(?:website|site|webpage|portal)\b/i.test(lower)) {
    const clean = lower.replace(/\b(the|a|my|website|site|webpage|portal)\b/gi, '').replace(/\s+/g, ' ').trim();
    if (clean) {
      if (APP_MAP[clean]) return APP_MAP[clean];
      if (isSafeUrlLike(clean)) return normalizeUrl(clean);
      return `https://duckduckgo.com/?q=!+${encodeURIComponent(clean + ' website')}`;
    }
  }

  return null;
}

function normalizeLookupName(value) {
  return String(value || '')
    .trim()
    .replace(/\.(lnk|url|exe|bat|cmd)$/i, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function findLaunchableTarget(rawTarget) {
  const query = String(rawTarget || '').trim();
  if (!query) return null;

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$query = ${psQuote(query)}
function Normalize-JarvisName([string]$value) {
    return (($value -replace '\\.(lnk|url|exe|bat|cmd)$', '') -replace '\\s+', ' ').Trim().ToLowerInvariant()
}

$needle = Normalize-JarvisName $query
if (-not $needle) { exit 0 }

function Write-JarvisResult($kind, $target, $name) {
    [pscustomobject]@{ kind = $kind; target = $target; name = $name } | ConvertTo-Json -Compress
    exit 0
}

# 1. Search filesystem shortcuts and program executables first (Desktop, Start Menu, LocalAppData Programs)
$roots = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path $env:USERPROFILE 'OneDrive\\Desktop'),
    (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),
    (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs'),
    (Join-Path $env:LOCALAPPDATA 'Programs'),
    (Join-Path $env:ProgramFiles ''),
    (Join-Path \${env:ProgramFiles(x86)} ''),
    [Environment]::GetFolderPath('MyDocuments'),
    (Join-Path $env:USERPROFILE 'Downloads')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

foreach ($root in $roots) {
    # Check direct children first
    $directMatches = @(Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue |
        Where-Object { (Normalize-JarvisName $_.Name) -eq $needle } |
        Select-Object -First 2)
    if ($directMatches.Count -eq 1) {
        $item = $directMatches[0]
        Write-JarvisResult 'path' $item.FullName $item.Name
    }
    if ($directMatches.Count -gt 1) {
        $names = $directMatches | ForEach-Object { $_.FullName }
        [pscustomobject]@{ kind = 'ambiguous'; target = ($names -join '; '); name = $query } | ConvertTo-Json -Compress
        exit 0
    }

    # Recursive check with depth cap 3
    $matches = @(Get-ChildItem -LiteralPath $root -Force -Recurse -Depth 3 -ErrorAction SilentlyContinue |
        Where-Object { (Normalize-JarvisName $_.Name) -eq $needle } |
        Select-Object -First 2)
    if ($matches.Count -eq 1) {
        $item = $matches[0]
        Write-JarvisResult 'path' $item.FullName $item.Name
    }
    if ($matches.Count -gt 1) {
        $names = $matches | ForEach-Object { $_.FullName }
        [pscustomobject]@{ kind = 'ambiguous'; target = ($names -join '; '); name = $query } | ConvertTo-Json -Compress
        exit 0
    }
}

# 2. Check UWP / Store Apps from Get-StartApps
$registeredApp = Get-StartApps | Where-Object { (Normalize-JarvisName $_.Name) -eq $needle } | Select-Object -First 1
if ($registeredApp -and $registeredApp.AppID) {
    Write-JarvisResult 'appId' $registeredApp.AppID $registeredApp.Name
}
`;
  const { error, stdout } = await runPowerShell(script);
  if (error || !stdout.trim()) return null;
  try {
    return JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  } catch {
    return null;
  }
}

function openWithShell(target, label) {
  return new Promise((resolve) => {
    // Windows native ShellExecute via cmd start
    exec(`start "" "${String(target).replace(/"/g, '""')}"`, { windowsHide: true }, (error) => {
      if (error) {
        const script = `
$ErrorActionPreference = 'Stop'
try {
    Invoke-Item -LiteralPath ${psQuote(target)} -ErrorAction Stop
    Write-Output 'LAUNCH_REQUESTED'
} catch {
    Start-Process -FilePath 'explorer.exe' -ArgumentList ${psQuote(target)} -ErrorAction Stop | Out-Null
    Write-Output 'LAUNCH_REQUESTED'
}
`;
        runPowerShell(script).then(({ error: psErr, stderr, stdout }) => {
          if (psErr || !stdout.includes('LAUNCH_REQUESTED')) {
            resolve({ success: false, error: stderr || psErr?.message || `Windows could not open ${label || target}.` });
          } else {
            resolve({ success: true, message: `Opening ${label || target}.` });
          }
        });
        return;
      }
      resolve({ success: true, message: `Opening ${label || target}.` });
    });
  });
}

async function openResolvedTarget(resolved) {
  if (resolved.kind === 'appId') {
    return openWithShell(`shell:AppsFolder\\${resolved.target}`, resolved.name);
  }

  if (resolved.kind === 'path') {
    return openWithShell(resolved.target, resolved.name);
  }

  return { success: false, error: 'I could not resolve that item.' };
}

function isSendKeyToken(step) {
  return /^\{(?:ENTER|TAB|ESCAPE|ESC|UP|DOWN|LEFT|RIGHT|BACKSPACE|DELETE|HOME|END|PGUP|PGDN|SPACE)\}$/i.test(String(step || ''));
}

async function dynamicProcessKill(targetLower) {
  const safeTarget = targetLower.replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!safeTarget || safeTarget.length < 2) return false;

  const script = `
$target = "${safeTarget}"
$excluded = @('node', 'powershell', 'pwsh', 'cmd', 'explorer', 'svchost', 'dwm', 'csrss', 'services', 'lsass', 'winlogon', 'system', 'smss', 'conhost', 'idle', 'taskhostw')
$procs = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $name = $_.ProcessName.ToLower()
    $title = $_.MainWindowTitle.ToLower()
    ($name -like "*$target*" -or $title -like "*$target*") -and ($excluded -notcontains $name)
}
if ($procs) {
    foreach ($p in $procs) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Output "SUCCESS"
} else {
    Write-Output "NOT_FOUND"
}
`;
  const { stdout } = await runPowerShell(script);
  return stdout.includes('SUCCESS');
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
  // #region agent log
  dbgApps('H-CL3', 'apps.js:taskKill', 'taskkill raw output', { processName, stdout: String(stdout).slice(0, 300), stderr: String(stderr).slice(0, 300), error: error ? String(error.message).slice(0, 300) : null });
  // #endregion
  if (!error || output.includes('success')) return { success: true };
  return { success: false, error: stderr || error.message || 'Process not found.' };
}

async function closeAppOrTab(target) {
  if (!target) return { success: false, error: 'Target required.' };
  const rawTarget = String(target).trim();
  const lower = rawTarget.toLowerCase();

  // Strip conversational wrappers: "close my whatsapp", "close whatsapp tab", "close the whatsapp app", "close whatsapp window"
  const cleaned = lower.replace(/\b(the|a|my|app|application|tab|window|process|program)\b/gi, '').replace(/\s+/g, ' ').trim();
  const searchKey = cleaned || lower;

  // 1. Gather all executable candidates from CLOSE_MAP or fallback
  const mapped = CLOSE_MAP[searchKey] || CLOSE_MAP[lower] || [];
  const candidates = Array.isArray(mapped) ? [...mapped] : (mapped ? [mapped] : []);
  if (!candidates.length && isSafeLaunchName(searchKey)) {
    candidates.push(`${searchKey}.exe`);
  }

  // 2. Try killing known candidates
  for (const cand of candidates) {
    if (isSafeProcessName(cand)) {
      const res = await taskKill(cand);
      if (res.success) {
        return { success: true, message: `Closed ${target}.` };
      }
    }
  }

  // 3. Try dynamic process termination by process/window name match
  const dynKilled = await dynamicProcessKill(searchKey);
  if (dynKilled) {
    return { success: true, message: `Closed ${target}.` };
  }

  // 4. Try browser tab closure if it's a website or tab
  const tabClosed = await closeWebsiteTab(searchKey);
  if (tabClosed) {
    return { success: true, message: `Closed ${target} tab.` };
  }

  return { success: false, error: `I could not find an open window, app, or tab for "${target}".` };
}

async function handleAppCommand(action, target) {
  if (!target) return { success: false, error: 'Target required' };
  const lower = typeof target === 'string' ? target.toLowerCase().trim() : '';

  if (action === 'open') {
    const openTarget = resolveOpenTarget(target);
    if (!openTarget) {
      const resolved = await findLaunchableTarget(target);
      if (!resolved) {
        // Universal web fallback: open top official website/result for unmapped target
        const cleanName = lower.replace(/\b(the|a|my|app|application|program|website|site)\b/gi, '').replace(/\s+/g, ' ').trim() || target;
        const webUrl = `https://duckduckgo.com/?q=!+${encodeURIComponent(cleanName)}`;
        return openWithShell(webUrl, target);
      }
      if (resolved.kind === 'ambiguous') {
        return { success: false, error: `I found multiple items named “${target}”. Please say the location as well, for example “open ${target} in Downloads”.` };
      }
      return openResolvedTarget(resolved);
    }
    if (lower === 'whatsapp') return launchWhatsApp();
    if (/^(https?:\/\/|[a-z][a-z0-9+.-]*:)$/i.test(openTarget)) return openWithShell(openTarget, target);
    if (fs.existsSync(String(openTarget))) {
      return openResolvedTarget({ kind: 'path', target: String(openTarget), name: target });
    }
    return startTarget(openTarget, processNamesForTarget(lower));
  }

  if (action === 'close') {
    return closeAppOrTab(target);
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
  normalizeLookupName,
  findLaunchableTarget,
};
