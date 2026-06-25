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

# Set to True to log actions without making any ADB calls.
DRY_RUN = os.environ.get('DRY_RUN', '').lower() == 'true'


def _action(description, fn=None):
    """In dry-run mode, print the action. In live mode, also execute fn()."""
    print(f"[deliver] {'[DRY RUN] ' if DRY_RUN else ''}{description}")
    if not DRY_RUN and fn:
        fn()


def send_mail(username: str, item_name: str, quantity: int):
    if not DRY_RUN and not _is_calibrated():
        raise RuntimeError(
            "UI coordinates not calibrated. Run: python3 scripts/calibrate.py"
        )

    # ── Step 1: Tap the mailbox object in the game world ─────────────────────
    _action("Tap mailbox object", lambda: (_tap_coord('mailbox_object'), _wait('after_tap_mailbox')))

    # ── Step 2: Tap 'Mailbox View' from the context menu ─────────────────────
    _action("Select 'Mailbox View'", lambda: (_tap_coord('mailbox_view_option'), _wait('after_tap_mailbox_view')))

    # ── Step 3: Tap 'Mail' button inside the Mailbox panel ───────────────────
    _action("Tap Mail button", lambda: (_tap_coord('mail_button'), _wait('after_tap_mail_button')))

    # ── Step 4: Type the recipient username ───────────────────────────────────
    def _do_type_username():
        _tap_coord('username_search_field')
        time.sleep(0.4)
        _adb('shell', 'input', 'keyevent', 'KEYCODE_CTRL_A')
        _adb('shell', 'input', 'keyevent', 'KEYCODE_DEL')
        _type(username)
        _wait('after_type_username')

    _action(f"Type username: {username}", _do_type_username)

    # ── Step 5: Tap the first result in the autocomplete list ─────────────────
    _action("Select player from search results", lambda: (_tap_coord('first_search_result'), _wait('after_tap_user')))

    # ── Step 6: Find and tap the item in the inventory grid ───────────────────
    template_path = os.path.join(ITEM_TPL_DIR, f"{item_name}.png")

    if DRY_RUN:
        tpl_exists = os.path.exists(template_path)
        _action(f"Find '{item_name}' in inventory (template {'found' if tpl_exists else 'MISSING — add to assets/ui-templates/items/'})")
    else:
        print(f"[deliver] Looking for item '{item_name}' in inventory…")
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

    # ── Step 7: Tap Send ──────────────────────────────────────────────────────
    _action("Tap Send button", lambda: (_tap_coord('send_button'), _wait('after_tap_send')))

    # ── Step 8: Close the panel (optional) ────────────────────────────────────
    close = UI.get('close_button', {})
    if close.get('enabled', True) and (DRY_RUN or close.get('x', 0) != 0):
        _action("Close mail panel", lambda: (_tap(close['x'], close['y']), time.sleep(0.5)))

    print(f"[deliver] {'[DRY RUN] ' if DRY_RUN else ''}Done — '{item_name}' x{quantity} mailed to @{username}")


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    global DRY_RUN

    parser = argparse.ArgumentParser()
    parser.add_argument('--username', required=True, help='Recipient Roblox username')
    parser.add_argument('--item',     required=True, help='In-game item name')
    parser.add_argument('--qty',      required=True, type=int, help='Quantity to send')
    parser.add_argument('--dry-run',  action='store_true', help='Log steps without making ADB calls')
    args = parser.parse_args()

    if args.dry_run:
        DRY_RUN = True

    if DRY_RUN:
        print("[deliver] DRY RUN mode — no ADB calls will be made.")
    else:
        # Verify ADB is reachable only in live mode
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
