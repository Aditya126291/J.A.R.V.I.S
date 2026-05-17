const { runPowerShell } = require('./utils');
const { clampNumber } = require('./command_registry');

async function handleSystemCommand(action, value) {
    let script = '';

    if (action === 'volume_set' || action === 'volume_mute' || action === 'volume_unmute') {
        const volScript = `
        Add-Type -TypeDefinition @'
        using System;
        using System.Runtime.InteropServices;
        [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioEndpointVolume {
            int f(); int g(); int h(); int i();
            int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
            int j(); int GetMasterVolumeLevelScalar(out float pfLevel);
            int k(); int l(); int m(); int n();
            int SetMute(bool bMute, Guid pguidEventContext);
            int GetMute(out bool pbMute);
        }
        [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDevice {
            int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev);
        }
        [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceEnumerator {
            int f();
            int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        }
        [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
        class MMDeviceEnumeratorComObject { }
        public class Audio {
            static IAudioEndpointVolume Vol() {
                var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
                IMMDevice dev = null;
                enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
                IAudioEndpointVolume epv = null;
                Guid epvid = typeof(IAudioEndpointVolume).GUID;
                dev.Activate(ref epvid, 23, 0, out epv);
                return epv;
            }
            public static void Set(float v) { Vol().SetMasterVolumeLevelScalar(v, Guid.Empty); }
            public static void Mute(bool m) { Vol().SetMute(m, Guid.Empty); }
        }
'@
        `;

        if (action === 'volume_mute') {
            script = volScript + `\n[Audio]::Mute($true)`;
        } else if (action === 'volume_unmute') {
            script = volScript + `\n[Audio]::Mute($false)`;
        } else if (action === 'volume_set') {
            const num = clampNumber(value, 0, 100);
            if (num !== null) {
                const floatVal = (num / 100).toFixed(2);
                script = volScript + `\n[Audio]::Set(${floatVal})`;
            }
        }
    } else if (action === 'brightness_set' || action === 'brightness_adjust') {
        if (action === 'brightness_set') {
            const num = clampNumber(value, 0, 100);
            if (num !== null) {
                script = '(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, ' + num + ')';
            }
        } else {
            const delta = clampNumber(value, -100, 100);
            if (delta !== null && delta !== 0) {
                script = [
                    '$brightness = Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness | Select-Object -First 1 -ExpandProperty CurrentBrightness',
                    'if ($null -eq $brightness) { throw "Brightness sensor not found" }',
                    '$target = [Math]::Max(0, [Math]::Min(100, [int]$brightness + (' + delta + ')))',
                    '(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, $target)',
                    'Write-Output "BRIGHTNESS_SET:$target"'
                ].join('\n');
            }
        }
    } else if (action === 'bluetooth_disable' || action === 'bluetooth_enable') {
        const enable = action === 'bluetooth_enable';
        // Use the Bluetooth radio management via PowerShell
        script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
Function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
}
[Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Radios.RadioAccessStatus,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null
$radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
$bluetooth = $radios | Where-Object { $_.Kind -eq 'Bluetooth' }
if ($bluetooth) {
    Await ($bluetooth.SetStateAsync([Windows.Devices.Radios.RadioState]::${enable ? 'On' : 'Off'})) ([Windows.Devices.Radios.RadioAccessStatus])
    Write-Output "SUCCESS"
} else {
    Write-Output "NO_BLUETOOTH_RADIO"
}
`;
    }

    if (script) {
        const { error, stdout, stderr } = await runPowerShell(script);
        if (error) {
            return { success: false, error: (stderr || error.message || 'System command failed').trim() };
        }
        if (stdout && stdout.includes('NO_BLUETOOTH_RADIO')) {
            return { success: false, error: 'No Bluetooth radio found on this device' };
        }
        const brightnessMatch = String(stdout || '').match(/BRIGHTNESS_SET:(\d+)/);
        if (brightnessMatch) {
            return { success: true, message: 'Brightness adjusted to ' + brightnessMatch[1] + '%.' };
        }
        return { success: true };
    }
    return { success: false, error: 'Unknown system command' };
}

module.exports = {
    handleSystemCommand
};
