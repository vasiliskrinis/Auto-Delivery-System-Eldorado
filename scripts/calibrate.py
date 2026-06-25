#!/usr/bin/env python3
"""
calibrate.py — Interactive tool to set UI tap coordinates in config/gameUI.json.

Takes a FRESH screenshot for each UI element so you can navigate the game
to the right state before each capture. This avoids the problem of trying
to see all buttons at once in a single screenshot.

Usage:
    python3.11 scripts/calibrate.py

Requirements:
    - Roblox open on your Mac, inside Grow a Garden 2
    - pip3.11 install -r requirements.txt
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
    sys.stderr.write(f"Missing dependency: {e}. Run: pip3.11 install -r requirements.txt\n")
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT  = os.path.dirname(SCRIPT_DIR)
CFG_PATH   = os.path.join(REPO_ROOT, 'config', 'gameUI.json')

# (config_key, what to set up in Roblox, what to click in the screenshot, skippable)
STEPS = [
    (
        'mailbox_object',
        'Stand next to the MAILBOX in the game world so it is clearly visible.',
        'Click on the MAILBOX OBJECT in the game world.',
        False,
    ),
    (
        'mailbox_view_option',
        'Interact with the mailbox so the context menu appears (with "Mailbox View" option visible).',
        "Click on 'Mailbox View' in the context menu.",
        False,
    ),
    (
        'mail_button',
        'You should see the Your Mailbox panel. Make sure the Mail button is visible.',
        "Click on the 'Mail' button inside the Your Mailbox panel.",
        False,
    ),
    (
        'username_search_field',
        'You should see the mail compose screen with a username search field.',
        'Click on the USERNAME SEARCH FIELD (where you type the recipient name).',
        False,
    ),
    (
        'first_search_result',
        'Type any real username in the search field so the autocomplete list appears.',
        'Click on the FIRST RESULT in the player autocomplete list.',
        False,
    ),
    (
        'inventory_scroll_area',
        'The item inventory grid should now be visible on screen.',
        'Click in the CENTER of the inventory grid (this point is used for scrolling).',
        False,
    ),
    (
        'send_button',
        'Click any item in the inventory so the Send button appears.',
        'Click on the green SEND button.',
        False,
    ),
    (
        'close_button',
        'After sending, a close/X button may appear to dismiss the panel. If not, click Skip.',
        'Click the X / CLOSE button to dismiss the panel.',
        True,
    ),
]


def _take_screenshot(path='/tmp/gag2_calibrate.png'):
    img = pyautogui.screenshot()
    img.save(path)
    return path


def _countdown_screenshot(seconds=3):
    for i in range(seconds, 0, -1):
        print(f"  Screenshot in {i}s… switch to Roblox now!   ", end='\r', flush=True)
        time.sleep(1)
    path = _take_screenshot()
    print("  Screenshot taken.                             ")
    return path


class StepCalibrator:
    def __init__(self, screenshot_path, click_instruction, skippable):
        self.image         = Image.open(screenshot_path)
        self.orig_w, self.orig_h = self.image.size
        self.scale         = min(650 / self.orig_h, 1000 / self.orig_w, 1.0)
        self.disp_w        = int(self.orig_w * self.scale)
        self.disp_h        = int(self.orig_h * self.scale)
        self.click_instruction = click_instruction
        self.skippable     = skippable
        self.result        = None
        self._marker_ids   = []
        self._clicked      = None

        self.root = tk.Tk()
        self.root.title("Calibration — click the element, then Confirm")
        self.root.resizable(False, False)

        resized    = self.image.resize((self.disp_w, self.disp_h), Image.LANCZOS)
        self.photo = ImageTk.PhotoImage(resized)

        self.canvas = tk.Canvas(self.root, width=self.disp_w, height=self.disp_h, cursor='crosshair')
        self.canvas.pack()
        self.canvas.create_image(0, 0, anchor='nw', image=self.photo)
        self.canvas.bind('<Button-1>', self._on_click)

        self.label = tk.Label(
            self.root,
            text=f"👆  {click_instruction}",
            wraplength=self.disp_w - 20,
            pady=8,
            font=('Arial', 13),
            justify='center',
        )
        self.label.pack()

        btn_frame = tk.Frame(self.root)
        btn_frame.pack(pady=6)
        tk.Button(btn_frame, text='Confirm',            width=12, command=self._confirm).pack(side='left', padx=4)
        tk.Button(btn_frame, text='Re-take screenshot', width=18, command=self._retake).pack(side='left', padx=4)
        if skippable:
            tk.Button(btn_frame, text='Skip (optional)', width=15, command=self._skip).pack(side='left', padx=4)

    def _on_click(self, event):
        real_x = int(event.x / self.scale)
        real_y = int(event.y / self.scale)
        self._clicked = (real_x, real_y)
        for mid in self._marker_ids:
            self.canvas.delete(mid)
        self._marker_ids.clear()
        r = 9
        self._marker_ids.append(self.canvas.create_oval(
            event.x - r, event.y - r, event.x + r, event.y + r,
            outline='red', width=3,
        ))
        self._marker_ids.append(self.canvas.create_line(
            event.x - r - 4, event.y, event.x + r + 4, event.y, fill='red', width=2,
        ))
        self._marker_ids.append(self.canvas.create_line(
            event.x, event.y - r - 4, event.x, event.y + r + 4, fill='red', width=2,
        ))
        self._marker_ids.append(self.canvas.create_text(
            event.x + 14, event.y - 2,
            text=f'({real_x}, {real_y})',
            fill='red', font=('Arial', 11, 'bold'), anchor='w',
        ))

    def _confirm(self):
        if self._clicked:
            self.result = self._clicked
            self.root.quit()
            self.root.destroy()
        else:
            messagebox.showwarning('No point selected', 'Click on the element first, then press Confirm.')

    def _retake(self):
        self.result = '__retake__'
        self.root.quit()
        self.root.destroy()

    def _skip(self):
        self.result = '__skip__'
        self.root.quit()
        self.root.destroy()

    def run(self):
        self.root.mainloop()
        return self.result


def main():
    print()
    print("=" * 60)
    print("  Grow a Garden 2 — UI Calibration")
    print("=" * 60)
    print()
    print("Each step takes its own screenshot so you can set up the")
    print("game in the exact state needed before each capture.")
    print()

    with open(CFG_PATH) as f:
        config = json.load(f)

    total      = len(STEPS)
    step_index = 0

    while step_index < total:
        key, setup_instruction, click_instruction, skippable = STEPS[step_index]

        print(f"\n─── Step {step_index + 1}/{total}: {key} {'(optional)' if skippable else ''}")
        print(f"    In Roblox: {setup_instruction}")
        print()
        input("    Press ENTER when ready… ")

        screenshot_path = _countdown_screenshot(3)

        while True:
            cal    = StepCalibrator(screenshot_path, click_instruction, skippable)
            result = cal.run()

            if result == '__retake__':
                print("  Re-taking screenshot…")
                screenshot_path = _countdown_screenshot(3)
                continue

            break

        if result == '__skip__' or result is None:
            if skippable:
                if key not in config:
                    config[key] = {}
                config[key]['x'] = 0
                config[key]['y'] = 0
                if 'enabled' in config.get(key, {}):
                    config[key]['enabled'] = False
                print(f"  Skipped {key}.")
            else:
                print(f"  {key} is required — please try again.")
                continue
        else:
            if key not in config:
                config[key] = {}
            config[key]['x'], config[key]['y'] = result
            if 'enabled' in config.get(key, {}):
                config[key]['enabled'] = True
            print(f"  ✓ {key}: ({result[0]}, {result[1]})")

        step_index += 1

    with open(CFG_PATH, 'w') as f:
        json.dump(config, f, indent=2)

    print()
    print("=" * 60)
    print("  Calibration saved to config/gameUI.json")
    print("=" * 60)
    print()
    print("Next steps:")
    print("  1. Crop each item's icon from a screenshot and save to:")
    print("     assets/ui-templates/items/<ItemName>.png")
    print("  2. Run: npm start")
    print("  3. Test with: eld testdeliver <username> 1 <item name>")
    print()


if __name__ == '__main__':
    main()
