Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher,Windows.Devices.Bluetooth,ContentType=WindowsRuntime] | Out-Null

$watcher = [Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher]::new()
$watcher.ScanningMode = [Windows.Devices.Bluetooth.Advertisement.BluetoothLEScanningMode]::Active

$devices = @{}

$handler = [Windows.Foundation.TypedEventHandler[Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher, Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementReceivedEventArgs]]{
    param($sender, $args)
    if ($args.Advertisement.LocalName -ne "") {
        $devices[$args.BluetoothAddress] = $args.Advertisement.LocalName
    }
}

$watcher.add_Received($handler)
$watcher.Start()

Write-Output "Scanning for 5 seconds..."
Start-Sleep -Seconds 5
$watcher.Stop()

$results = @()
foreach ($key in $devices.Keys) {
    $results += @{ Name = $devices[$key]; Address = $key }
}

$results | ConvertTo-Json -Compress
