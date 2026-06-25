#!/usr/bin/env python3
"""
calibrate.py — Interactive tool to set UI tap coordinates in config/gameUI.json.

Takes a screenshot of your Mac screen, opens it, and lets you click each
UI element to record its coordinates.

Usage:
    python3 scripts/calibrate.py

Requirements:
    - Roblox open on your Mac, inside Grow a Garden 2 with the mail panel visible
    - pip3 install -r requirements.txt
"""

import json
import os
import sys
import time

try:
    import pyautogui
    from PIL import Image
    import tkinter as tk
    from tkinter import messagebox
    from PIL import ImageTk
except ImportError as e:
    sys.stderr.write(f"Missing dependency: {e}. Run: pip3 install -r requirements.txt\n")
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT  = os.path.dirname(SCRIPT_DIR)
CFG_PATH   = os.path.join(REPO_ROOT, 'config', 'gameUI.json')

STEPS = [
    ('mailbox_object',       'the MAILBOX OBJECT in the game world (the physical mailbox)', False),
    ('mailbox_view_option',  "'Mailbox View' in the context menu (open it first)",          False),
    ('mail_button',          "the 'Mail' button inside the Your Mailbox panel",             False),
    ('username_search_field',"the USERNAME SEARCH FIELD where you type the recipient",      False),
    ('first_search_result',  "the FIRST RESULT in the autocomplete player list",            False),
    ('send_button',          "the green SEND button on the inventory/compose screen",       False),
    ('close_button',         "the X / CLOSE button to dismiss the panel (skip if none)",   True),
]


def take_screenshot():
    img = pyautogui.screenshot()
    path = '/tmp/gag2_calibrate.png'
    img.save(path)
    return path


class Calibrator:
    def __init__(self, screenshot_path):
        self.image       = Image.open(screenshot_path)
        self.orig_w, self.orig_h = self.image.size
        self.scale       = min(900 / self.orig_h, 1400 / self.orig_w, 1.0)
        self.disp_w      = int(self.orig_w * self.scale)
        self.disp_h      = int(self.orig_h * self.scale)
        self.result      = None

        self.root = tk.Tk()
        self.root.title("Calibration — click the element, then Confirm")
        self.root.resizable(False, False)

        resized    = self.image.resize((self.disp_w, self.disp_h), Image.LANCZOS)
        self.photo = ImageTk.PhotoImage(resized)

        self.canvas = tk.Canvas(self.root, width=self.disp_w, height=self.disp_h, cursor='crosshair')
        self.canvas.pack()
        self.canvas.create_image(0, 0, anchor='nw', image=self.photo)
        self.canvas.bind('<Button-1>', self._on_click)

        self.label = tk.Label(self.root, text="", wraplength=self.disp_w - 20, pady=6, font=('Arial', 13))
        self.label.pack()

        btn_frame = tk.Frame(self.root)
        btn_frame.pack(pady=6)
        tk.Button(btn_frame, text='Confirm',             width=12, command=self._confirm).pack(side='left', padx=4)
        tk.Button(btn_frame, text='Re-take screenshot',  width=18, command=self._retake).pack(side='left', padx=4)
        tk.Button(btn_frame, text='Skip (optional only)',width=18, command=self._skip).pack(side='left', padx=4)

        self._marker  = None
        self._clicked = None

    def _on_click(self, event):
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
            self.root.quit()
            self.root.destroy()
        else:
            messagebox.showwarning("No point", "Click on the element first, then Confirm.")

    def _retake(self):
        self.result = '__retake__'
        self.root.quit()
        self.root.destroy()

    def _skip(self):
        self.result = '__skip__'
        self.root.quit()
        self.root.destroy()

    def prompt(self, instruction):
        self.label.config(text=f"Click on:  {instruction}")
        self._clicked = None
        self.root.mainloop()
        return self.result


def main():
    print("=" * 60)
    print("  Grow a Garden 2 — UI Calibration")
    print("=" * 60)
    print()
    print("Instructions:")
    print("  1. Switch to Roblox and open the mail panel so all")
    print("     buttons are visible on screen.")
    print("  2. Switch back here and press ENTER.")
    print("  3. A window will open with your screen — click each element.")
    print()
    input("Press ENTER when Roblox mail panel is visible… ")

    print("Taking screenshot in 3 seconds — switch to Roblox now!")
    time.sleep(3)
    screenshot_path = take_screenshot()
    print(f"Screenshot taken.")

    with open(CFG_PATH) as f:
        config = json.load(f)

    step_index = 0
    while step_index < len(STEPS):
        key, desc, skippable = STEPS[step_index]

        cal    = Calibrator(screenshot_path)
        result = cal.prompt(desc)

        if result == '__retake__':
            print("Re-taking screenshot in 3 seconds — switch to Roblox!")
            time.sleep(3)
            screenshot_path = take_screenshot()
            continue

        if result == '__skip__' or result is None:
            if skippable:
                config[key]['x'] = 0
                config[key]['y'] = 0
                if 'enabled' in config[key]:
                    config[key]['enabled'] = False
                print(f"  Skipped {key}.")
            else:
                print(f"  {key} is required — please click it.")
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
    print("Calibration saved to config/gameUI.json")
    print()
    print("Next steps:")
    print("  1. For each item you sell, screenshot its icon from the")
    print("     inventory and save to: assets/ui-templates/items/<ItemName>.png")
    print("  2. Update config/itemMap.json with your Eldorado → in-game item names")
    print("  3. Run: npm start")


if __name__ == '__main__':
    main()
