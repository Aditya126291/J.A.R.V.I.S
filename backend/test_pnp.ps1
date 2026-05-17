Get-PnpDevice -Class Bluetooth | Where-Object { $_.Present -eq $true } | Select-Object FriendlyName, Status, Class, InstanceId | Format-Table -AutoSize
