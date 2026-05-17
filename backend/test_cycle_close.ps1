Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    public static string GetActiveWindowTitle() {
        IntPtr handle = GetForegroundWindow();
        StringBuilder sb = new StringBuilder(256);
        GetWindowText(handle, sb, 256);
        return sb.ToString();
    }
}
"@

$keyword = 'YouTube'
$wshell = New-Object -ComObject WScript.Shell

$chromeProcess = Get-Process | Where-Object { $_.ProcessName -eq 'chrome' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1

if ($chromeProcess) {
    [Win32]::SetForegroundWindow($chromeProcess.MainWindowHandle)
    Start-Sleep -Milliseconds 200

    $found = $false
    for ($i = 0; $i -lt 30; $i++) {
        $title = [Win32]::GetActiveWindowTitle()
        if ($title -match $keyword) {
            $wshell.SendKeys('^{w}')
            $found = $true
            break
        }
        $wshell.SendKeys('^{TAB}')
        Start-Sleep -Milliseconds 100
    }

    if ($found) { Write-Output "SUCCESS" } else { Write-Output "NOT_FOUND" }
} else {
    Write-Output "NOT_FOUND"
}
