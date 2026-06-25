#!/usr/bin/env python3
"""
calibrate.py — Interactive tool to set UI tap coordinates in config/gameUI.json.

This script takes a screenshot of your Android/Waydroid screen, opens it,
and lets you click each UI element to record its coordinates.

Usage:
    python3 scripts/calibrate.py

Requirements:
    - ADB connected to Waydroid or Android device ('adb devices' should show a device)
    - pip3 install -r requirements.txt
    - A display (run on your local machine, or use X11 forwarding / VNC to the VPS)

Steps:
    1. Open Roblox on the device, join Grow a Garden 2, walk to the mailbox
       and open the mail panel so all buttons are visible on screen
    2. Run this script — it will take a screenshot and open it
    3. Click each element when prompted
    4. Coordinates are saved to config/gameUI.json automatically
"""

import json
import os
import subprocess
import sys
import tempfile
import time

try:
    from PIL import Image, ImageDraw, ImageFont
    import tkinter as tk
    from tkinter import messagebox
except ImportError as e:
    sys.stderr.write(f"Missing dependency: {e}. Run: pip3 install -r requirements.txt\n")
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT  = os.path.dirname(SCRIPT_DIR)
CFG_PATH   = os.path.join(REPO_ROOT, 'config', 'gameUI.json')

with open(CFG_PATH) as f:
    cfg = json.load(f)

DEVICE_SERIAL = cfg.get('device', {}).get('serial', '').strip()
ADB = ['adb'] + (['-s', DEVICE_SERIAL] if DEVICE_SERIAL else [])

STEPS = [
    # (config_key,           instruction,                                                  skippable)
    ('mailbox_object',      'the MAILBOX OBJECT in the game world (the physical mailbox)', False),
    ('mailbox_view_option', "'Mailbox View' in the context menu (open it first)",          False),
    ('mail_button',         "the 'Mail' button inside the Your Mailbox panel",             False),
    ('username_search_field',"the USERNAME SEARCH FIELD where you type the recipient",     False),
    ('first_search_result', "the FIRST RESULT in the autocomplete player list",            False),
    ('send_button',         "the green SEND button on the inventory/compose screen",       False),
    ('close_button',        "the X / CLOSE button to dismiss the panel (skip if none)",   True),
]


def adb_screenshot():
    result = subprocess.run(ADB + ['exec-out', 'screencap', '-p'], capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(f"screencap failed: {result.stderr.decode()}")
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
        f.write(result.stdout)
        return f.name


class Calibrator:
    def __init__(self, screenshot_path):
        self.image       = Image.open(screenshot_path)
        self.orig_w, self.orig_h = self.image.size
        self.scale       = min(900 / self.orig_h, 500 / self.orig_w, 1.0)
        self.disp_w      = int(self.orig_w * self.scale)
        self.disp_h      = int(self.orig_h * self.scale)
        self.result      = None

        self.root = tk.Tk()
        self.root.title("Calibration — click the element, then press ENTER")
        self.root.resizable(False, False)

        from PIL import ImageTk
        resized   = self.image.resize((self.disp_w, self.disp_h), Image.LANCZOS)
        self.photo = ImageTk.PhotoImage(resized)

        self.canvas = tk.Canvas(self.root, width=self.disp_w, height=self.disp_h, cursor='crosshair')
        self.canvas.pack()
        self.canvas.create_image(0, 0, anchor='nw', image=self.photo)
        self.canvas.bind('<Button-1>', self._on_click)

        self.label = tk.Label(self.root, text="", wraplength=480, pady=6)
        self.label.pack()

        btn_frame = tk.Frame(self.root)
        btn_frame.pack(pady=4)
        tk.Button(btn_frame, text='Confirm',  width=12, command=self._confirm).pack(side='left', padx=4)
        tk.Button(btn_frame, text='Re-take screenshot', width=18, command=self._retake).pack(side='left', padx=4)

        self._marker = None
        self._clicked = None

    def _on_click(self, event):
        # Convert displayed coords back to device coords
        real_x = int(event.x / self.scale)
        real_y = int(event.y / self.scale)
        self._clicked = (real_x, real_y)

        if self._marker:
            self.canvas.delete(self._marker)
        r = 8
        self._marker = self.canvas.create_oval(
            event.x - r, event.y - r, event.x + r, event.y + r,
            outline='red', width=2
        )

    def _confirm(self):
        if self._clicked:
            self.result = self._clicked
            self.root.destroy()
        else:
            messagebox.showwarning("No point", "Click on the element first, then press Confirm.")

    def _retake(self):
        self.root.destroy()
        self.result = '__retake__'

    def prompt(self, instruction):
        self.label.config(text=f"Step: Click on  ➜  {instruction}")
        self._clicked = None
        if self._marker:
            self.canvas.delete(self._marker)
        self.root.mainloop()
        return self.result


def main():
    print("=" * 60)
    print("  Grow a Garden 2 — UI Calibration")
    print("=" * 60)
    print()

    # Verify ADB
    devices = subprocess.run(ADB + ['devices'], capture_output=True, text=True).stdout
    if 'device\n' not in devices:
        print("ERROR: No ADB device found. Start Waydroid or connect your Android device.")
        print("       Run 'adb devices' to verify.")
        sys.exit(1)

    print("Instructions:")
    print("  In Roblox, open the mail panel so all UI elements are visible.")
    print("  Then come back here and press ENTER to take a screenshot.")
    input("\nPress ENTER to capture the screen… ")

    screenshot_path = adb_screenshot()
    print(f"Screenshot saved to: {screenshot_path}")

    with open(CFG_PATH) as f:
        config = json.load(f)

    step_index = 0
    while step_index < len(STEPS):
        key, desc, skippable = STEPS[step_index]

        cal = Calibrator(screenshot_path)
        result = cal.prompt(desc)

        if result == '__retake__':
            print("Re-taking screenshot…")
            screenshot_path = adb_screenshot()
            continue  # redo same step

        if result is None:
            if skippable:
                config[key]['x'] = 0
                config[key]['y'] = 0
                if 'enabled' in config[key]:
                    config[key]['enabled'] = False
                print(f"  Skipped {key}.")
            else:
                print(f"  {key} is required. Re-opening…")
                continue
        else:
            config[key]['x'], config[key]['y'] = result
            if 'enabled' in config[key]:
                config[key]['enabled'] = True
            print(f"  {key}: ({result[0]}, {result[1]})")

        step_index += 1

    with open(CFG_PATH, 'w') as f:
        json.dump(config, f, indent=2)

    print()
    print("✓ Calibration saved to config/gameUI.json")
    print()
    print("Next steps:")
    print("  1. For each item you sell, screenshot its icon from the inventory")
    print("     and save it to: assets/ui-templates/items/<ItemName>.png")
    print("  2. Update config/itemMap.json with your items")
    print("  3. Copy .env.example to .env and fill in your credentials")
    print("  4. Run: npm start")
    print()

    os.unlink(screenshot_path)


if __name__ == '__main__':
    main()
