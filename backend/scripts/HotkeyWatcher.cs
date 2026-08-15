using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace JarvisHotkey {
    class Program {
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_KEYUP = 0x0101;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const int WM_SYSKEYUP = 0x0105;

        private const int VK_MENU = 0x12;     // Alt
        private const int VK_LMENU = 0xA4;    // Left Alt
        private const int VK_RMENU = 0xA5;    // Right Alt

        private const int SW_RESTORE = 9;
        private const int SW_SHOW = 5;

        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        private static extern sbyte GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        private static extern bool TranslateMessage([In] ref MSG lpMsg);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage([In] ref MSG lpmsg);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

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
        private static bool _rightAltDown = false;

        static void Main(string[] args) {
            // WH_KEYBOARD_LL requires IntPtr.Zero as hMod in .NET
            _hookID = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, IntPtr.Zero, 0);

            if (_hookID == IntPtr.Zero) {
                // Fallback to module handle
                using (Process curProcess = Process.GetCurrentProcess())
                using (ProcessModule curModule = curProcess.MainModule) {
                    _hookID = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(curModule.ModuleName), 0);
                }
            }

            if (_hookID == IntPtr.Zero) {
                Console.WriteLine("ERROR:HOOK_FAILED:" + Marshal.GetLastWin32Error());
                Console.Out.Flush();
                return;
            }

            Console.WriteLine("INITIALIZED");
            Console.Out.Flush();

            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }

            UnhookWindowsHookEx(_hookID);
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
            if (nCode >= 0) {
                int msg = wParam.ToInt32();
                KBDLLHOOKSTRUCT kbd = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));

                bool isExtended = (kbd.flags & 1) != 0; // LLKHF_EXTENDED = 0x01
                bool isRightAlt = (kbd.vkCode == VK_RMENU) || (kbd.vkCode == VK_MENU && isExtended);

                if (isRightAlt) {
                    if ((msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) && !_rightAltDown) {
                        _rightAltDown = true;
                        Console.WriteLine("KEYDOWN:AltRight");
                        Console.Out.Flush();
                        FocusJarvisWindow();
                    } else if ((msg == WM_KEYUP || msg == WM_SYSKEYUP) && _rightAltDown) {
                        _rightAltDown = false;
                        Console.WriteLine("KEYUP:AltRight");
                        Console.Out.Flush();
                    }
                }
            }
            return CallNextHookEx(_hookID, nCode, wParam, lParam);
        }

        public static void FocusJarvisWindow() {
            try {
                EnumWindows((hWnd, lParam) => {
                    if (!IsWindowVisible(hWnd)) return true;

                    StringBuilder sbTitle = new StringBuilder(256);
                    GetWindowText(hWnd, sbTitle, 256);
                    string title = sbTitle.ToString();

                    StringBuilder sbClass = new StringBuilder(256);
                    GetClassName(hWnd, sbClass, 256);
                    string className = sbClass.ToString();

                    // Match J.A.R.V.I.S dedicated app window or browser window
                    bool isJarvis = false;
                    if (!string.IsNullOrEmpty(title)) {
                        isJarvis = title.IndexOf("J.A.R.V.I.S", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                   title.IndexOf("localhost:3000", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                   title.IndexOf("React App", StringComparison.OrdinalIgnoreCase) >= 0;
                    }

                    if (isJarvis) {
                        ShowWindow(hWnd, SW_RESTORE);
                        SetForegroundWindow(hWnd);
                        BringWindowToTop(hWnd);
                        SwitchToThisWindow(hWnd, true);
                        return false; // Stop enumeration once found
                    }
                    return true;
                }, IntPtr.Zero);
            } catch (Exception) {}
        }
    }
}
