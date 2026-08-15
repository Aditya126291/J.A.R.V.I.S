using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace JarvisHotkey {
    class Program {
        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        private const int VK_MENU = 0x12;     // Any Alt
        private const int VK_LMENU = 0xA4;    // Left Alt
        private const int VK_RMENU = 0xA5;    // Right Alt

        static void Main(string[] args) {
            Console.WriteLine("INITIALIZED");
            Console.Out.Flush();

            bool wasDown = false;

            while (true) {
                short rMenuState = GetAsyncKeyState(VK_RMENU);
                bool isRMenu = (rMenuState & 0x8000) != 0;

                // Also check if Alt is pressed without Left Alt (some layouts report VK_MENU)
                short menuState = GetAsyncKeyState(VK_MENU);
                short lMenuState = GetAsyncKeyState(VK_LMENU);
                bool isAltWithoutLeft = ((menuState & 0x8000) != 0) && ((lMenuState & 0x8000) == 0);

                bool isDown = isRMenu || isAltWithoutLeft;

                if (isDown && !wasDown) {
                    wasDown = true;
                    Console.WriteLine("KEYDOWN:AltRight");
                    Console.Out.Flush();
                } else if (!isDown && wasDown) {
                    wasDown = false;
                    Console.WriteLine("KEYUP:AltRight");
                    Console.Out.Flush();
                }

                Thread.Sleep(20);
            }
        }
    }
}
