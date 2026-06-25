#!/usr/bin/env python3
"""
deliver.py — Sends an in-game Gag2 mail via pyautogui (Mac screen automation).

Controls the running Roblox (Grow a Garden 2) client on the local Mac screen.

Called by src/roblox/deliver.js as a subprocess:
    python3 scripts/deliver.py --username <name> --item <item_name> --qty <n>

Exit codes:
    0  mail sent successfully
    1  delivery failed (reason printed to stderr)

Prerequisites:
    - Roblox is open and the bot account is inside Grow a Garden 2
    - Run 'python3 scripts/calibrate.py' first to set UI coordinates
    - Each item you sell has a template image in assets/ui-templates/items/<ItemName>.png
    - Python packages: pip3 install -r requirements.txt
"""

import argparse
import json
import os
import sys
import time

try:
    import pyautogui
    from PIL import Image
    import numpy as np
    import cv2
except ImportError as e:
    sys.stderr.write(f"Missing dependency: {e}. Run: pip3 install -r requirements.txt\n")
    sys.exit(1)

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.1

# ── paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT  = os.path.dirname(SCRIPT_DIR)
CFG_PATH   = os.path.join(REPO_ROOT, 'config', 'gameUI.json')

with open(CFG_PATH) as f:
    UI = json.load(f)

TIMINGS      = UI.get('timings', {})
ITEM_TPL_DIR = os.path.join(REPO_ROOT, UI.get('item_templates_dir', 'assets/ui-templates/items'))

DRY_RUN = os.environ.get('DRY_RUN', '').lower() == 'true'


# ── helpers ───────────────────────────────────────────────────────────────────

def _wait(key, fallback_ms=500):
    ms = TIMINGS.get(key, fallback_ms)
    time.sleep(ms / 1000)


def _tap(x, y):
    pyautogui.click(int(x), int(y))


def _type(text):
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.1)
    pyautogui.typewrite(text, interval=0.05)


def _screenshot():
    img = pyautogui.screenshot()
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def _tap_coord(key):
    elem = UI.get(key, {})
    x, y = elem.get('x', 0), elem.get('y', 0)
    if x == 0 and y == 0:
        raise RuntimeError(
            f"Element '{key}' has no calibrated coordinates. "
            f"Run: python3 scripts/calibrate.py"
        )
    _tap(x, y)


def _find_template(template_path, screen_img=None, confidence=0.75):
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


def _is_calibrated():
    required = ['mailbox_object', 'mailbox_view_option', 'mail_button',
                'username_search_field', 'first_search_result', 'send_button']
    for key in required:
        elem = UI.get(key, {})
        if elem.get('x', 0) == 0 and elem.get('y', 0) == 0:
            return False
    return True


def _action(description, fn=None):
    print(f"[deliver] {'[DRY RUN] ' if DRY_RUN else ''}{description}")
    if not DRY_RUN and fn:
        fn()


# ── scroll-and-search ─────────────────────────────────────────────────────────

def _find_item_with_scroll(template_path, item_name, max_scrolls=15, scroll_amount=-3):
    if not os.path.exists(template_path):
        raise RuntimeError(
            f"Template image not found: {template_path}\n"
            f"Save a cropped screenshot of the item icon to that path."
        )

    # Scroll position: use calibrated inventory_scroll_area if set, else center screen
    scroll_elem = UI.get('inventory_scroll_area', {})
    sw = scroll_elem.get('x', 0) or pyautogui.size()[0] // 2
    sh = scroll_elem.get('y', 0) or pyautogui.size()[1] // 2

    print(f"[deliver] Searching for '{item_name}' (will scroll up to {max_scrolls} times)…")

    # Scroll to top of inventory first
    pyautogui.click(sw, sh)
    time.sleep(0.3)
    for _ in range(10):
        pyautogui.scroll(10, x=sw, y=sh)
    time.sleep(0.5)

    for attempt in range(max_scrolls + 1):
        pos = _find_template(template_path)
        if pos:
            return pos
        if attempt < max_scrolls:
            pyautogui.scroll(scroll_amount, x=sw, y=sh)
            time.sleep(0.4)

    raise RuntimeError(
        f"Item '{item_name}' not found after scrolling through inventory. "
        f"Check that the template image matches the in-game icon."
    )


# ── delivery flow ─────────────────────────────────────────────────────────────

def send_mail(username: str, item_name: str, quantity: int):
    if not DRY_RUN and not _is_calibrated():
        raise RuntimeError(
            "UI coordinates not calibrated. Run: python3 scripts/calibrate.py"
        )

    _action("Click mailbox object", lambda: (_tap_coord('mailbox_object'), _wait('after_tap_mailbox')))
    _action("Select 'Mailbox View'", lambda: (_tap_coord('mailbox_view_option'), _wait('after_tap_mailbox_view')))
    _action("Click Mail button", lambda: (_tap_coord('mail_button'), _wait('after_tap_mail_button')))

    def _do_type_username():
        _tap_coord('username_search_field')
        time.sleep(0.4)
        _type(username)
        _wait('after_type_username')

    _action(f"Type username: {username}", _do_type_username)
    _action("Select player from results", lambda: (_tap_coord('first_search_result'), _wait('after_tap_user')))

    template_path = os.path.join(ITEM_TPL_DIR, f"{item_name}.png")

    if DRY_RUN:
        tpl_exists = os.path.exists(template_path)
        _action(f"Find '{item_name}' in inventory (template {'found' if tpl_exists else 'MISSING — add to assets/ui-templates/items/'})")
    else:
        pos = _find_item_with_scroll(template_path, item_name)
        print(f"[deliver] Found '{item_name}' at ({pos[0]}, {pos[1]}) — clicking…")
        _tap(*pos)
        _wait('after_tap_item')

    _action("Click Send button", lambda: (_tap_coord('send_button'), _wait('after_tap_send')))

    close = UI.get('close_button', {})
    if close.get('enabled', True) and (DRY_RUN or close.get('x', 0) != 0):
        _action("Close mail panel", lambda: (_tap(close['x'], close['y']), time.sleep(0.5)))

    print(f"[deliver] {'[DRY RUN] ' if DRY_RUN else ''}Done — '{item_name}' x{quantity} mailed to @{username}")


# ── entry point ───────────────────────────────────────────────────────────────

def main():
    global DRY_RUN

    parser = argparse.ArgumentParser()
    parser.add_argument('--username', required=True)
    parser.add_argument('--item',     required=True)
    parser.add_argument('--qty',      required=True, type=int)
    parser.add_argument('--dry-run',  action='store_true')
    args = parser.parse_args()

    if args.dry_run:
        DRY_RUN = True

    if DRY_RUN:
        print("[deliver] DRY RUN mode — no screen automation will run.")

    try:
        send_mail(args.username, args.item, args.qty)
    except Exception as e:
        sys.stderr.write(f"ERROR: {e}\n")
        sys.exit(1)


if __name__ == '__main__':
    main()
