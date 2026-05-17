Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asb = [AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $_.FullName -like 'System.Runtime.WindowsRuntime*' }
$watcher = New-Object Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher
$devices = @{}

$handler = [Windows.Foundation.TypedEventHandler[Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher, Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementReceivedEventArgs]] {
    param($sender, $args)
    $name = $args.Advertisement.LocalName
    if ($null -eq $name -or $name -eq "") {
        $name = "BLE_" + $args.BluetoothAddress.ToString("X")
    }
    $rssi = $args.RawSignalStrengthInDBm
    $devices[$args.BluetoothAddress] = @{
        name = $name
        rssi = $rssi
    }
}

$watcher.add_Received($handler)
$watcher.Start()
Start-Sleep -Seconds 3
$watcher.Stop()

$results = @()
foreach ($key in $devices.Keys) {
    $results += $devices[$key]
}
$results | ConvertTo-Json
