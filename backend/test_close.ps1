$wshell = New-Object -ComObject WScript.Shell
$procs = Get-Process | Where-Object { $_.MainWindowTitle -match 'YouTube' }
foreach ($p in $procs) {
  $res = $wshell.AppActivate($p.Id)
  Write-Output ("AppActivate returned: " + $res)
  Start-Sleep -Milliseconds 500
  $wshell.SendKeys('^{w}')
}
