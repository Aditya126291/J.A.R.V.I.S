"""
J.A.R.V.I.S Global Hotkey Watcher — Python + ctypes (Win32 API direct)
Polls GetAsyncKeyState every 15ms for Right Alt, F9, and Right Ctrl.
Outputs KEYDOWN:AltRight / KEYUP:AltRight to stdout for Node.js to read.
"""
import ctypes
import ctypes.wintypes
import sys
import time
import threading

user32 = ctypes.windll.user32

# Virtual key codes
VK_RMENU   = 0xA5   # Right Alt
VK_LMENU   = 0xA4   # Left Alt
VK_MENU    = 0x12   # Any Alt
VK_RCONTROL= 0xA3   # Right Ctrl
VK_F9      = 0x78   # F9

SW_RESTORE = 9

EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.wintypes.BOOL, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)


def is_key_down(vk):
    """Check if a virtual key is currently pressed using GetAsyncKeyState."""
    state = user32.GetAsyncKeyState(vk)
    return bool(state & 0x8000)


def focus_jarvis_window():
    """Find and focus the J.A.R.V.I.S browser window."""
    target_titles = [b'J.A.R.V.I.S', b'localhost:3000', b'React App', b'Control Center']
    found = [False]

    def enum_callback(hwnd, lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        buf = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(hwnd, buf, 256)
        title = buf.value
        if not title:
            return True
        title_lower = title.lower()
        for t in target_titles:
            if t.decode().lower() in title_lower:
                user32.ShowWindow(hwnd, SW_RESTORE)
                user32.SetForegroundWindow(hwnd)
                user32.BringWindowToTop(hwnd)
                found[0] = True
                return False  # Stop enumeration
        return True

    cb = EnumWindowsProc(enum_callback)
    user32.EnumWindows(cb, 0)
    return found[0]


def main():
    print("INITIALIZED", flush=True)

    was_down = False
    last_trigger = 0

    while True:
        try:
            # Direct Win32 API call — no .NET, no overhead
            r_alt_down  = is_key_down(VK_RMENU)
            l_alt_down  = is_key_down(VK_LMENU)
            any_alt_down= is_key_down(VK_MENU)
            r_ctrl_down = is_key_down(VK_RCONTROL)
            f9_down     = is_key_down(VK_F9)

            # Right Alt = VK_RMENU pressed, OR generic Alt pressed without Left Alt (AltGr keyboards)
            alt_right = r_alt_down or (any_alt_down and not l_alt_down)

            is_down = alt_right or r_ctrl_down or f9_down

            now = time.monotonic()

            if is_down and not was_down:
                # Debounce: ignore if less than 300ms since last trigger
                if (now - last_trigger) >= 0.3:
                    last_trigger = now
                    print("KEYDOWN:AltRight", flush=True)
                    # Focus J.A.R.V.I.S window in a separate thread to not block polling
                    threading.Thread(target=focus_jarvis_window, daemon=True).start()
                was_down = True

            elif not is_down and was_down:
                print("KEYUP:AltRight", flush=True)
                was_down = False

        except Exception:
            pass

        time.sleep(0.015)  # 15ms poll interval = ~66 Hz


if __name__ == '__main__':
    main()
