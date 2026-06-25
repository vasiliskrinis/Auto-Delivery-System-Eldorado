#!/usr/bin/env python3
"""
deliver.py — Sends an in-game Gag2 mail via ADB (Android/Waydroid).

Controls the running Roblox (Grow a Garden 2) client on the configured
ADB device or Waydroid emulator.

Called by src/roblox/deliver.js as a subprocess:
    python3 scripts/deliver.py --username <name> --item <item_name> --qty <n>

Exit codes:
    0  mail sent successfully
    1  delivery failed (reason printed to stderr)

Prerequisites:
    - ADB is installed (apt install adb)
    - Waydroid is running OR a physical Android device is connected via USB/WiFi ADB
    - Roblox is open and the bot account is inside Grow a Garden 2
    - Run 'python3 scripts/calibrate.py' first to set UI coordinates
    - Each item you sell has a template image in assets/ui-templates/items/<ItemName>.png
    - Python packages: pip3 install -r requirements.txt
"""

import argparse
import json
import os
import subprocess
import sys
import time
import tempfile

try:
    from PIL import Image
    import numpy as np
    import cv2
except ImportError as e:
    sys.stderr.write(f"Missing dependency: {e}. Run: pip3 install -r requirements.txt\n")
    sys.exit(1)

# ── paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT  = os.path.dirname(SCRIPT_DIR)
CFG_PATH   = os.path.join(REPO_ROOT, 'config', 'gameUI.json')

with open(CFG_PATH) as f:
    UI = json.load(f)

TIMINGS       = UI.get('timings', {})
ITEM_TPL_DIR  = os.path.join(REPO_ROOT, UI.get('item_templates_dir', 'assets/ui-templates/items'))
DEVICE_SERIAL = UI.get('device', {}).get('serial', '').strip()

# ADB base command — includes -s <serial> if configured
ADB = ['adb'] + (['-s', DEVICE_SERIAL] if DEVICE_SERIAL else [])


# ── ADB helpers ───────────────────────────────────────────────────────────────

def _adb(*args, check=True):
    cmd = ADB + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise RuntimeError(f"ADB command failed ({' '.join(args)}): {result.stderr.strip()}")
    return result.stdout.strip()


def _tap(x, y):
    """Sends a tap at screen coordinates (x, y)."""
    _adb('shell', 'input', 'tap', str(int(x)), str(int(y)))


def _type(text):
    """Types text into the focused input field.
    Roblox/Android requires special handling of spaces and special chars."""
    # Replace spaces with %s (URL-encoded space for ADB input)
    escaped = text.replace(' ', '%s').replace("'", "\\'")
    _adb('shell', 'input', 'text', escaped)


def _screenshot():
    """Returns the device screen as a numpy BGR array."""
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
        tmp_path = tmp.name
    try:
        # Take screenshot directly to local machine via pipe
        result = subprocess.run(
            ADB + ['exec-out', 'screencap', '-p'],
            capture_output=True
        )
        if result.returncode != 0:
            raise RuntimeError(f"screencap failed: {result.stderr.decode()}")
        with open(tmp_path, 'wb') as f:
            f.write(result.stdout)
        img = cv2.imread(tmp_path)
        if img is None:
            raise RuntimeError("Failed to decode screenshot")
        return img
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def _wait(key, fallback_ms=500):
    ms = TIMINGS.get(key, fallback_ms)
    time.sleep(ms / 1000)


# ── Element finding ───────────────────────────────────────────────────────────

def _find_template(template_path, screen_img=None, confidence=0.75):
    """
    Finds a template image on screen using OpenCV template matching.
    Returns (cx, cy) of the best match, or None if below confidence threshold.
    """
    if not os.path.exists(template_path):
        return None

    if screen_img is None:
        screen_img = _screenshot()

    template = cv2.imread(template_path)
    if template is None:
        return None

    result = cv2.matchTemplate(screen_img, template, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(result)

    if max_val >= confidence:
        h, w = template.shape[:2]
        return max_loc[0] + w // 2, max_loc[1] + h // 2

    return None


def _tap_coord(key):
    """Taps a UI element by its config key (uses calibrated x,y)."""
    elem = UI.get(key, {})
    x, y = elem.get('x', 0), elem.get('y', 0)
    if x == 0 and y == 0:
        raise RuntimeError(
            f"Element '{key}' has no calibrated coordinates. "
            f"Run: python3 scripts/calibrate.py"
        )
    _tap(x, y)


def _is_calibrated():
    required = ['mailbox_object', 'mailbox_view_option', 'mail_button',
                'username_search_field', 'first_search_result', 'send_button']
    for key in required:
        elem = UI.get(key, {})
        if elem.get('x', 0) == 0 and elem.get('y', 0) == 0:
            return False
    return True


# ── Delivery flow ─────────────────────────────────────────────────────────────

def send_mail(username: str, item_name: str, quantity: int):
    if not _is_calibrated():
        raise RuntimeError(
            "UI coordinates not calibrated. Run: python3 scripts/calibrate.py"
        )

    # ── Step 1: Tap the mailbox object in the game world ─────────────────────
    print(f"[deliver] Tapping mailbox object…")
    _tap_coord('mailbox_object')
    _wait('after_tap_mailbox')

    # ── Step 2: Tap 'Mailbox View' from the context menu ─────────────────────
    print(f"[deliver] Selecting 'Mailbox View'…")
    _tap_coord('mailbox_view_option')
    _wait('after_tap_mailbox_view')

    # ── Step 3: Tap 'Mail' button inside the Mailbox panel ───────────────────
    print(f"[deliver] Tapping Mail button…")
    _tap_coord('mail_button')
    _wait('after_tap_mail_button')

    # ── Step 4: Type the recipient username ───────────────────────────────────
    print(f"[deliver] Typing username: {username}")
    _tap_coord('username_search_field')
    time.sleep(0.4)
    # Clear any existing text first
    _adb('shell', 'input', 'keyevent', 'KEYCODE_CTRL_A')
    _adb('shell', 'input', 'keyevent', 'KEYCODE_DEL')
    _type(username)
    _wait('after_type_username')

    # ── Step 5: Tap the first result in the autocomplete list ─────────────────
    print(f"[deliver] Selecting player from search results…")
    _tap_coord('first_search_result')
    _wait('after_tap_user')

    # ── Step 6: Find and tap the item in the inventory grid ───────────────────
    print(f"[deliver] Looking for item '{item_name}' in inventory…")
    template_path = os.path.join(ITEM_TPL_DIR, f"{item_name}.png")

    screen = _screenshot()
    pos = _find_template(template_path, screen)

    if pos is None:
        raise RuntimeError(
            f"Item '{item_name}' not found in inventory screenshot. "
            f"Make sure the template image exists at: {template_path}\n"
            f"Also check that the item is in the bot account's inventory."
        )

    print(f"[deliver] Found '{item_name}' at ({pos[0]}, {pos[1]}) — tapping…")
    _tap(*pos)
    _wait('after_tap_item')

    # If quantity > 1 and a quantity input appears, set it
    # (The game may auto-select all of one item or show a qty dialog)
    # Currently no qty dialog detected — sending full stack is the default.
    # If you need partial quantities, calibrate a 'quantity_field' entry and
    # uncomment the block below.
    #
    # qty_elem = UI.get('quantity_field', {})
    # if qty_elem.get('enabled') and qty_elem.get('x', 0) != 0:
    #     _tap(qty_elem['x'], qty_elem['y'])
    #     _adb('shell', 'input', 'keyevent', 'KEYCODE_CTRL_A')
    #     _type(str(quantity))

    # ── Step 7: Tap Send ──────────────────────────────────────────────────────
    print(f"[deliver] Tapping Send…")
    _tap_coord('send_button')
    _wait('after_tap_send')

    # ── Step 8: Close the panel (optional) ────────────────────────────────────
    close = UI.get('close_button', {})
    if close.get('enabled', True) and close.get('x', 0) != 0:
        _tap(close['x'], close['y'])
        time.sleep(0.5)

    print(f"[deliver] Done — '{item_name}' x{quantity} mailed to @{username}")


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--username', required=True, help='Recipient Roblox username')
    parser.add_argument('--item',     required=True, help='In-game item name')
    parser.add_argument('--qty',      required=True, type=int, help='Quantity to send')
    args = parser.parse_args()

    # Verify ADB is reachable
    devices = _adb('devices', check=False)
    if 'device' not in devices:
        sys.stderr.write(
            "No ADB device found. Start Waydroid ('waydroid session start') "
            "or connect your Android device and run 'adb devices' to verify.\n"
        )
        sys.exit(1)

    try:
        send_mail(args.username, args.item, args.qty)
    except Exception as e:
        sys.stderr.write(f"ERROR: {e}\n")
        sys.exit(1)


if __name__ == '__main__':
    main()
