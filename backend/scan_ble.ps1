[Windows.System.UserProfile.LockScreen,Windows.System.UserProfile,ContentType=WindowsRuntime] | Out-Null
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
Function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
}

[Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime] | Out-Null
$selector = [Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelector()
$devicesTask = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($selector)
$devices = Await $devicesTask ([Windows.Devices.Enumeration.DeviceInformationCollection])

$results = @()
foreach ($dev in $devices) {
    if ($dev.Name) {
        $results += @{
            name = $dev.Name
            id = $dev.Id
        }
    }
}

$results | ConvertTo-Json -Compress
