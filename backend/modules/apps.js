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

async function startTarget(target) {
  const script = `Start-Process -FilePath ${psQuote(target)}`;
  const { error, stderr } = await runPowerShell(script);
  if (error) return { success: false, error: stderr || error.message };
  return { success: true };
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
            $closeCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Close")
            $closeBtn = $tab.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $closeCond)
            if ($closeBtn) {
                $invokePattern = $closeBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) -as [System.Windows.Automation.InvokePattern]
                if ($invokePattern) {
                    $invokePattern.Invoke()
                    $found = $true
                    break
                }
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
    return startTarget(openTarget);
  }

  if (action === 'close') {
    if (WEBSITE_TARGETS.has(lower) || TITLE_KEYWORDS[lower]) {
      const tabClosed = await closeWebsiteTab(lower);
      if (tabClosed) return { success: true };
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

$appName = ${psQuote(app)}
$procs = Get-Process | Where-Object { $_.MainWindowTitle -match [regex]::Escape($appName) -or $_.Name -match [regex]::Escape($appName) }
if ($procs) {
    $wshell = New-Object -ComObject WScript.Shell
    $wshell.AppActivate($procs[0].Id)
    Start-Sleep -Milliseconds 500
} else {
    Write-Output "APP_NOT_FOUND"
}
`;

    for (const step of sequence) {
      if (typeof step === 'string' && step.startsWith('{WAIT:')) {
        const match = step.match(/\{WAIT:(\d+)\}/);
        if (match) psCode += `Start-Sleep -Milliseconds ${Math.min(10000, Number(match[1]))}\n`;
      } else if (isSendKeyToken(step)) {
        psCode += `[System.Windows.Forms.SendKeys]::SendWait(${psQuote(step)})\n`;
        psCode += `Start-Sleep -Milliseconds 120\n`;
      } else {
        psCode += `Set-Clipboard -Value ${psQuote(step)}\n`;
        psCode += `[System.Windows.Forms.SendKeys]::SendWait("^v")\n`;
        psCode += `Start-Sleep -Milliseconds 120\n`;
      }
    }

    psCode += 'Write-Output "SUCCESS"\n';
    const { stdout, error, stderr } = await runPowerShell(psCode);
    if (error) return { success: false, error: stderr || error.message };
    if (stdout.includes('SUCCESS')) return { success: true };
    return { success: false, error: 'Automation did not complete.' };
  }

  return { success: false, error: 'Unknown app action.' };
}

module.exports = { handleAppCommand };
