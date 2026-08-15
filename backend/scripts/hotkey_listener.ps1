$code = @"
using System;
using System.Runtime.InteropServices;

namespace Jarvis {
    public class HotkeyWatcher {
        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);
    }
}
"@

Add-Type -TypeDefinition $code -Language CSharp

[Console]::WriteLine("INITIALIZED")
[Console]::Out.Flush()
$state = $false

while ($true) {
    $res = [Jarvis.HotkeyWatcher]::GetAsyncKeyState(0xA5)
    $isDown = ($res -band 0x8000) -ne 0
    if ($isDown -and -not $state) {
        $state = $true
        [Console]::WriteLine("KEYDOWN:AltRight")
        [Console]::Out.Flush()
    } elseif (-not $isDown -and $state) {
        $state = $false
        [Console]::WriteLine("KEYUP:AltRight")
        [Console]::Out.Flush()
    }
    Start-Sleep -Milliseconds 25
}
