Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName, MainWindowTitle | Out-File "c:\Users\Aditya Kumar\OneDrive\Desktop\J.A.R.V.I.S\backend\titles.txt"
