# Auto-Delivery System — Eldorado × Grow a Garden 2

Monitors your Eldorado.gg shop for new orders and automatically delivers Gag2 items to buyers via the in-game mailbox in Grow a Garden 2 on Roblox. Built for a Linux VPS using Waydroid (Android on Linux) + ADB.

---

## How it works

```
Eldorado order placed
        ↓
Bot polls Eldorado every ~45 s
        ↓
New order found → extracts buyer's Roblox username + item + qty
        ↓
Python script controls Roblox (via ADB) on the Android/Waydroid screen:
  1. Tap mailbox → Mailbox View
  2. Tap Mail → type username → select player
  3. Tap item in inventory → Send
        ↓
Order marked delivered on Eldorado
        ↓
Buyer receives confirmation message on Eldorado
```

---

## Requirements

| Requirement | Notes |
|---|---|
| Linux VPS | Ubuntu 22.04+ recommended |
| Node.js ≥ 18 | `apt install nodejs` |
| Python 3.10+ | `apt install python3 python3-pip` |
| ADB | `apt install adb` |
| Waydroid | Android container — see setup below |
| Roblox APK | Install into Waydroid |

---

## Setup

### 1. Clone and install dependencies

```bash
git clone <this-repo>
cd Auto-Delivery-System-Eldorado
npm install
pip3 install -r requirements.txt
```

### 2. Install Waydroid (Android on Linux)

Follow the official guide: https://docs.waydro.id/usage/install-on-desktop-platforms

Quick install on Ubuntu:
```bash
sudo apt install curl lzip
curl https://repo.waydro.id | sudo bash
sudo apt install waydroid
sudo waydroid init
```

### 3. Install Roblox in Waydroid

Download the Roblox APK (from the official Roblox site or APKMirror), then:

```bash
waydroid app install /path/to/Roblox.apk
```

### 4. Launch the bot account in Roblox

```bash
bash scripts/launch_waydroid.sh
```

- Log in with a **dedicated bot account** (not your personal account)
- Join **Grow a Garden 2**
- Walk to the mailbox and open the mail panel

### 5. Calibrate the UI

While the mail panel is open on screen:

```bash
python3 scripts/calibrate.py
```

This takes a screenshot of the Waydroid screen, opens an image window, and asks you to click each button/field. Coordinates are saved to `config/gameUI.json` automatically.

> **Note:** If the VPS has no desktop, use X11 forwarding (`ssh -X user@vps`) or connect via VNC before running calibrate.py — it needs a display to show the screenshot.

### 6. Add item template images

For each item you sell, the bot needs a reference PNG of its icon:

1. Take a screenshot of the inventory screen showing the item:
   ```bash
   adb exec-out screencap -p > screen.png
   ```
2. Crop just the item icon (no background, no quantity badge) — about 80×80 px
3. Save it as: `assets/ui-templates/items/<ExactItemName>.png`

The `<ExactItemName>` must match exactly what you put in `config/itemMap.json`.

### 7. Configure items

Edit `config/itemMap.json` — map your Eldorado listing name → in-game item name:

```json
{
  "Rainbow Petal Sunflower": "Rainbow Petal Sunflower",
  "Moonpetal x10": "Moonpetal"
}
```

### 8. Configure credentials

```bash
cp .env.example .env
nano .env
```

Fill in:
- `ELDORADO_EMAIL` / `ELDORADO_PASSWORD` — your Eldorado seller login
- `ROBLOSECURITY` — your bot account's `.ROBLOSECURITY` cookie (from browser DevTools after logging in on roblox.com)

### 9. Start the bot

```bash
npm start
```

The bot will immediately poll Eldorado, then repeat every `POLL_INTERVAL_MS` milliseconds.

---

## Configuration reference

### `.env`

| Variable | Default | Description |
|---|---|---|
| `ELDORADO_EMAIL` | — | Eldorado login email |
| `ELDORADO_PASSWORD` | — | Eldorado login password |
| `ELDORADO_COOKIES` | — | Optional: browser cookies JSON (speeds up login) |
| `ROBLOSECURITY` | — | Bot account's Roblox session cookie |
| `POLL_INTERVAL_MS` | `45000` | How often to check for new orders (ms) |
| `MAIL_SEND_WAIT_MS` | `4000` | Wait after tapping Send for animation (ms) |
| `STATE_FILE_PATH` | `./data/state.json` | Where to store order state |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

### `config/itemMap.json`

Maps Eldorado item names → in-game item names. Add one line per item you sell.

### `config/gameUI.json`

Auto-populated by `calibrate.py`. You can also edit coordinates manually.
The `timings` section lets you slow down or speed up each step if the game
animations are faster/slower on your device.

---

## Adding new items

1. Add a line to `config/itemMap.json`
2. Save a template PNG to `assets/ui-templates/items/<ItemName>.png`
3. No restart needed — the bot reads these files on each order

---

## Keeping it running

Use `tmux` so the bot keeps running after you disconnect from SSH:

```bash
tmux new -s bot
npm start
# Ctrl+B then D to detach
# tmux attach -t bot   to re-attach later
```

---

## Troubleshooting

**"No ADB device found"**
Run `adb devices`. If empty, start Waydroid: `waydroid session start`.

**"UI coordinates not calibrated"**
Run `python3 scripts/calibrate.py` and complete all steps.

**"Item not found in inventory"**
- Make sure `assets/ui-templates/items/<ItemName>.png` exists
- The template must match the item icon at the current screen resolution
- Re-crop the template if the game UI scaled differently after an update

**"Eldorado: Using Playwright scraper mode"**
This means Eldorado's internal API wasn't detected and the bot is scraping the dashboard. This is normal — it still works.

**Bot marks an order failed but delivery went through**
Check `data/state.json`. Remove the order from the `"failed"` block to allow a retry, or add it to the `"processed"` block to prevent retrying.

---

## Warnings

**Roblox automation** — Automating a Roblox account violates Roblox's Terms of Use. Use a dedicated bot account only. Account suspension is a real risk.

**Session expiry** — `.ROBLOSECURITY` and Eldorado session cookies expire in 1–2 days. Refresh them regularly.

**Bot must stay in-game** — The bot account must remain in Grow a Garden 2, near the mailbox, at all times. If it disconnects, deliveries will fail until you rejoin manually.