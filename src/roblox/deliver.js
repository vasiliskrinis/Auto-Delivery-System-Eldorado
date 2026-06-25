'use strict';

/**
 * Sends in-game Gag2 mail by spawning the Python automation script.
 * The Python process controls the running Roblox client via pyautogui.
 */

const { spawn } = require('child_process');
const path      = require('path');
const config    = require('../config');
const log       = require('../logger');

const SCRIPT = path.resolve(__dirname, '../../scripts/deliver.py');

/**
 * @param {string} recipientUsername  - Roblox @username of the buyer
 * @param {string} itemName           - Exact in-game item name
 * @param {number} quantity
 * @returns {Promise<void>}           - Resolves on success, rejects on failure
 */
function sendMail(recipientUsername, itemName, quantity) {
  return new Promise((resolve, reject) => {
    const args = [
      SCRIPT,
      '--username', recipientUsername,
      '--item',     itemName,
      '--qty',      String(quantity),
    ];

    const env = {
      ...process.env,
      MAIL_SEND_WAIT: String(config.mailSendWaitMs),
    };

    log.debug(`[Roblox] Spawning deliver.py for ${recipientUsername} × ${quantity} ${itemName}`);

    const proc = spawn('python3', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    proc.on('close', code => {
      if (stdout.trim()) log.debug(`[deliver.py] ${stdout.trim()}`);
      if (code === 0) {
        resolve();
      } else {
        const reason = stderr.trim() || stdout.trim() || `exit code ${code}`;
        reject(new Error(`deliver.py failed: ${reason}`));
      }
    });

    proc.on('error', err => {
      reject(new Error(`Failed to spawn deliver.py: ${err.message}`));
    });
  });
}

module.exports = { sendMail };
