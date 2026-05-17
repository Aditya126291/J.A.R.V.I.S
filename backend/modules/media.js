const { runPowerShell } = require('./utils');

async function handleMediaCommand(action) {
    let script = '';
    // Use SendKeys to simulate media keys. Note: WScript.Shell SendKeys doesn't directly support 
    // media keys well in all Windows versions, so we use a C# interop snippet for reliable virtual key codes.
    const vkScript = `
        Add-Type -TypeDefinition @'
        using System;
        using System.Runtime.InteropServices;
        public class Keyboard {
            [DllImport("user32.dll")]
            public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
            public static void Press(byte key) {
                keybd_event(key, 0, 0, UIntPtr.Zero);
                keybd_event(key, 0, 0x0002, UIntPtr.Zero);
            }
        }
'@
    `;

    if (action === 'play_pause') {
        script = vkScript + `\n[Keyboard]::Press(179) # VK_MEDIA_PLAY_PAUSE`;
    } else if (action === 'next') {
        script = vkScript + `\n[Keyboard]::Press(176) # VK_MEDIA_NEXT_TRACK`;
    } else if (action === 'prev') {
        script = vkScript + `\n[Keyboard]::Press(177) # VK_MEDIA_PREV_TRACK`;
    } else {
        return { success: false, error: 'Unknown media action' };
    }

    try {
        await runPowerShell(script);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

module.exports = { handleMediaCommand };
