#!/usr/bin/env bash
# launch_roblox.sh — Starts Xvfb (virtual display) and Roblox (via Sober),
# then joins Grow a Garden 2.
#
# Run this ONCE before starting the bot, then leave it running in a tmux/screen
# session. The bot itself does not start Roblox automatically.
#
# Usage:
#   bash scripts/launch_roblox.sh
#
# Requires: Xvfb, Sober (flatpak run org.vinegarhq.Sober), x11vnc (optional)

set -e

DISPLAY_NUM="${DISPLAY_NUM:-:99}"
SCREEN_RES="${SCREEN_RES:-1920x1080x24}"
PLACE_ID="${ROBLOX_PLACE_ID}"

if [ -z "$PLACE_ID" ]; then
  echo "ERROR: Set ROBLOX_PLACE_ID in your environment or .env file."
  exit 1
fi

# ── Start virtual display ─────────────────────────────────────────────────────
echo "[launch] Starting Xvfb on display $DISPLAY_NUM…"
Xvfb "$DISPLAY_NUM" -screen 0 "$SCREEN_RES" &
XVFB_PID=$!
export DISPLAY="$DISPLAY_NUM"
sleep 2

# ── Optional: start VNC so you can visually check the game ───────────────────
# Uncomment if x11vnc is installed. Connect with a VNC viewer to port 5900.
# x11vnc -display "$DISPLAY_NUM" -nopw -listen localhost -xkb &

# ── Launch Roblox and join the game ──────────────────────────────────────────
ROBLOX_URL="roblox://experiences/start?placeId=${PLACE_ID}"
echo "[launch] Opening Grow a Garden 2 (place $PLACE_ID)…"

# Sober (recommended Roblox client for Linux):
flatpak run org.vinegarhq.Sober "$ROBLOX_URL" &
ROBLOX_PID=$!

echo "[launch] Roblox PID: $ROBLOX_PID"
echo "[launch] Wait for the game to fully load before running the bot."
echo ""
echo "To see the screen: install x11vnc and uncomment the VNC line in this script."
echo "To stop:           kill $ROBLOX_PID && kill $XVFB_PID"
echo ""

# Keep the script alive so the PIDs stay visible
wait $ROBLOX_PID
