using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace FastJarvisHotkey {
    class Program {
        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        [DllImport("user32.dll")]
        private static extern sbyte GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        private const int WM_HOTKEY = 0x0312;
        private const int VK_RMENU = 0xA5;    // Right Alt
        private const int VK_LMENU = 0xA4;    // Left Alt
        private const int VK_MENU = 0x12;     // Any Alt
        private const int VK_RCONTROL = 0xA3; // Right Ctrl
        private const int VK_APPS = 0x5D;     // Menu / Apps key
        private const int SW_RESTORE = 9;

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

        private static string logPath = "fast_hotkey.log";

        static void Main(string[] args) {
            File.WriteAllText(logPath, "FAST_HOTKEY_WATCHER_STARTED\n");

            // Thread 1: High-Speed Direct Kernel State Poller (GetAsyncKeyState)
            Thread pollerThread = new Thread(PollerLoop);
            pollerThread.IsBackground = true;
            pollerThread.Priority = ThreadPriority.Highest;
            pollerThread.Start();

            Console.WriteLine("INITIALIZED");
            Console.Out.Flush();

            // Thread 2 (Main): Message Loop for RegisterHotKey
            RegisterHotKey(IntPtr.Zero, 1, 0x4000 /* MOD_NOREPEAT */, (uint)VK_RMENU);

            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
                if (msg.message == WM_HOTKEY) {
                    OnHotkeyDown("RegisterHotKey");
                }
            }
        }

        private static bool _isDown = false;
        private static long _lastTriggerTime = 0;

        private static void PollerLoop() {
            while (true) {
                try {
                    short rMenu = GetAsyncKeyState(VK_RMENU);
                    short lMenu = GetAsyncKeyState(VK_LMENU);
                    short menu = GetAsyncKeyState(VK_MENU);
                    short apps = GetAsyncKeyState(VK_APPS);

                    // Right Alt is pressed when VK_RMENU is down, OR when VK_MENU is down without VK_LMENU
                    bool rMenuDown = (rMenu & 0x8000) != 0;
                    bool altWithoutLeft = ((menu & 0x8000) != 0) && ((lMenu & 0x8000) == 0);
                    bool appsDown = (apps & 0x8000) != 0;

                    bool down = rMenuDown || altWithoutLeft;

                    if (down && !_isDown) {
                        _isDown = true;
                        OnHotkeyDown("GetAsyncKeyState");
                    } else if (!down && _isDown) {
                        _isDown = false;
                        OnHotkeyUp("GetAsyncKeyState");
                    }
                } catch (Exception ex) {
                    try { File.AppendAllText(logPath, "ERR: " + ex.Message + "\n"); } catch {}
                }

                Thread.Sleep(15);
            }
        }

        private static void OnHotkeyDown(string source) {
            long now = DateTime.Now.Ticks / TimeSpan.TicksPerMillisecond;
            if (now - _lastTriggerTime < 300) return; // Debounce
            _lastTriggerTime = now;

            string msg = "KEYDOWN:AltRight";
            Console.WriteLine(msg);
            Console.Out.Flush();
            try { File.AppendAllText(logPath, "[" + DateTime.Now.ToString("HH:mm:ss.fff") + "] " + msg + " (" + source + ")\n"); } catch {}

            FocusJarvisWindow();
        }

        private static void OnHotkeyUp(string source) {
            string msg = "KEYUP:AltRight";
            Console.WriteLine(msg);
            Console.Out.Flush();
            try { File.AppendAllText(logPath, "[" + DateTime.Now.ToString("HH:mm:ss.fff") + "] " + msg + " (" + source + ")\n"); } catch {}
        }

        public static void FocusJarvisWindow() {
            try {
                EnumWindows((hWnd, lParam) => {
                    if (!IsWindowVisible(hWnd)) return true;

                    StringBuilder sbTitle = new StringBuilder(256);
                    GetWindowText(hWnd, sbTitle, 256);
                    string title = sbTitle.ToString();

                    if (!string.IsNullOrEmpty(title) &&
                       (title.IndexOf("J.A.R.V.I.S", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        title.IndexOf("localhost:3000", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        title.IndexOf("React App", StringComparison.OrdinalIgnoreCase) >= 0)) {
                        ShowWindow(hWnd, SW_RESTORE);
                        SetForegroundWindow(hWnd);
                        BringWindowToTop(hWnd);
                        SwitchToThisWindow(hWnd, true);
                        return false;
                    }
                    return true;
                }, IntPtr.Zero);
            } catch (Exception) {}
        }
    }
}
