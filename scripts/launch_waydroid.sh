#!/usr/bin/env bash
# launch_waydroid.sh — Starts Waydroid (Android on Linux) and opens Roblox.
#
# Run this once before starting the bot. Leave it running in a tmux/screen session.
#
# Requirements:
#   - Waydroid installed: https://docs.waydro.id/usage/install-on-desktop-platforms
#   - Roblox APK installed in Waydroid:
#       waydroid app install <RobloxAndroid.apk>
#
# Usage:
#   bash scripts/launch_waydroid.sh

set -e

echo "[waydroid] Starting Waydroid session…"
waydroid session start &
sleep 5

echo "[waydroid] Launching Roblox…"
# Roblox package name on Android
waydroid app launch com.roblox.client

echo ""
echo "[waydroid] Roblox should now be opening."
echo "  1. Log in to your BOT account (not your personal account)"
echo "  2. Join Grow a Garden 2 and walk to the mailbox"
echo "  3. Once the game is loaded and you are near the mailbox, run:"
echo "       python3 scripts/calibrate.py"
echo "  4. After calibration, start the bot:"
echo "       npm start"
echo ""
echo "To view the screen (VNC):"
echo "  waydroid show-full-ui"
