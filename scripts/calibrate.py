#!/usr/bin/env python3
"""
calibrate.py — Record UI coordinates by hovering over each element.

For each step:
  1. The script tells you what to open in Roblox
  2. You hover your mouse over that element
  3. Press ENTER — the current mouse position is recorded

No screenshot window, no clicking on images. Works reliably on Mac Retina.

Usage:
    python3.11 scripts/calibrate.py
"""

import json
import os
import sys
import time

try:
    import pyautogui
except ImportError as e:
    sys.stderr.write(f"Missing dependency: {e}. Run: pip3.11 install -r requirements.txt\n")
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT  = os.path.dirname(SCRIPT_DIR)
CFG_PATH   = os.path.join(REPO_ROOT, 'config', 'gameUI.json')

STEPS = [
    (
        'mailbox_object',
        [
            'Go to your mailbox in the game world.',
            'Hover your mouse over the MAILBOX OBJECT.',
        ],
        False,
    ),
    (
        'mailbox_view_option',
        [
            'Interact/right-click the mailbox so the context menu appears.',
            'Hover your mouse over "Mailbox View" in the context menu.',
        ],
        False,
    ),
    (
        'mail_button',
        [
            'Click "Mailbox View" — the mailbox panel should open.',
            'Hover your mouse over the MAIL button inside the panel.',
        ],
        False,
    ),
    (
        'username_search_field',
        [
            'Click the Mail button — the compose screen should appear.',
            'Hover your mouse over the USERNAME SEARCH FIELD.',
        ],
        False,
    ),
    (
        'first_search_result',
        [
            'Type a real Roblox username in the search field.',
            'Hover your mouse over the FIRST RESULT in the autocomplete list.',
        ],
        False,
    ),
    (
        'inventory_scroll_area',
        [
            'The item inventory grid should now be visible.',
            'Hover your mouse over the CENTER of the item grid.',
        ],
        False,
    ),
    (
        'send_button',
        [
            'Click any item in the inventory.',
            'Hover your mouse over the green SEND button.',
        ],
        False,
    ),
    (
        'close_button',
        [
            'After sending, a close/X button may appear.',
            'Hover over the X/CLOSE button — or press S to skip if there is none.',
        ],
        True,
    ),
]


def _record_position(skippable=False):
    """Live-display mouse position, record on ENTER, skip on S."""
    print()
    print("  Move your mouse to the element. Position updates every 0.2s.")
    if skippable:
        print("  Press ENTER to record  |  Type S + ENTER to skip")
    else:
        print("  Press ENTER to record position.")
    print()

    # Show live position while waiting for input in a background thread
    import threading
    stop = threading.Event()

    def _show_pos():
        while not stop.is_set():
            x, y = pyautogui.position()
            print(f"  \r  Mouse: ({x:4d}, {y:4d})   ", end='', flush=True)
            time.sleep(0.2)

    t = threading.Thread(target=_show_pos, daemon=True)
    t.start()

    try:
        answer = input().strip().lower()
    finally:
        stop.set()
        t.join(timeout=0.5)

    print()

    if skippable and answer == 's':
        return '__skip__'

    x, y = pyautogui.position()
    return (x, y)


def main():
    print()
    print("=" * 60)
    print("  Grow a Garden 2 — UI Calibration")
    print("=" * 60)
    print()
    print("Hover your mouse over each element in Roblox, then press")
    print("ENTER to record its position.")
    print()

    with open(CFG_PATH) as f:
        config = json.load(f)

    total      = len(STEPS)
    step_index = 0

    while step_index < total:
        key, instructions, skippable = STEPS[step_index]

        print(f"\n─── Step {step_index + 1}/{total}: {key} {'(optional)' if skippable else ''}")
        for line in instructions:
            print(f"    {line}")

        result = _record_position(skippable)

        if result == '__skip__':
            if key not in config:
                config[key] = {}
            config[key]['x'] = 0
            config[key]['y'] = 0
            if 'enabled' in config.get(key, {}):
                config[key]['enabled'] = False
            print(f"  Skipped {key}.")
        else:
            x, y = result
            if key not in config:
                config[key] = {}
            config[key]['x'] = x
            config[key]['y'] = y
            if 'enabled' in config.get(key, {}):
                config[key]['enabled'] = True
            print(f"  ✓ {key}: ({x}, {y})")

        step_index += 1

    with open(CFG_PATH, 'w') as f:
        json.dump(config, f, indent=2)

    print()
    print("=" * 60)
    print("  Calibration saved to config/gameUI.json")
    print("=" * 60)
    print()
    print("Next steps:")
    print("  1. Crop each item icon and save to:")
    print("     assets/ui-templates/items/<ItemName>.png")
    print("  2. Run: npm start")
    print("  3. Test: eld testdeliver <username> 1 <item name>")
    print()


if __name__ == '__main__':
    main()
