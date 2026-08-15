using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace KeyLoggerTest {
    class Program {
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_KEYUP = 0x0101;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const int WM_SYSKEYUP = 0x0105;

        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern sbyte GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [StructLayout(LayoutKind.Sequential)]
        private struct MSG {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public POINT pt;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT {
            public int x;
            public int y;
        }

        private static LowLevelKeyboardProc _proc = HookCallback;
        private static IntPtr _hookID = IntPtr.Zero;
        private static string logPath = "key_diagnostic.log";

        static void Main(string[] args) {
            File.WriteAllText(logPath, "KEY_TESTER_STARTED\n");
            
            // In .NET 4.0 on Windows 10/11, SetWindowsHookEx requires GetModuleHandle of the current main module
            using (Process curProcess = Process.GetCurrentProcess())
            using (ProcessModule curModule = curProcess.MainModule) {
                _hookID = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(curModule.ModuleName), 0);
            }

            if (_hookID == IntPtr.Zero) {
                _hookID = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, IntPtr.Zero, 0);
            }

            string initMsg = "KEY_TESTER_ACTIVE: HookID=" + _hookID + " LastError=" + Marshal.GetLastWin32Error() + "\n";
            Console.Write(initMsg);
            Console.Out.Flush();
            File.AppendAllText(logPath, initMsg);

            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
            }
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
            if (nCode >= 0) {
                int msg = wParam.ToInt32();
                KBDLLHOOKSTRUCT kbd = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                string eventType = (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) ? "DOWN" : "UP";
                string logLine = string.Format("[{0}] MSG:0x{1:X4} VK:0x{2:X2} (dec:{2}) SCAN:0x{3:X2} FLAGS:0x{4:X2} EXT:{5}\n",
                    eventType, msg, kbd.vkCode, kbd.scanCode, kbd.flags, (kbd.flags & 1) != 0);
                Console.Write(logLine);
                Console.Out.Flush();
                try { File.AppendAllText(logPath, logLine); } catch {}
            }
            return CallNextHookEx(_hookID, nCode, wParam, lParam);
        }
    }
}
