'use strict';

/**
 * Triggers in-game Gag2 mail delivery via the Lua bridge.
 * The Lua script (scripts/deliver.lua) must be running inside Roblox
 * before any orders are processed.
 */

const bridge = require('./bridge');
const log    = require('../logger');
const config = require('../config');

/**
 * @param {string} recipientUsername
 * @param {string} itemName           - Exact in-game item name
 * @param {number} quantity
 * @returns {Promise<void>}
 */
function sendMail(recipientUsername, itemName, quantity) {
  if (config.dryRun || process.env.DRY_RUN === 'true') {
    log.info(`[Roblox] DRY RUN — would mail ${quantity}× ${itemName} to @${recipientUsername}`);
    return Promise.resolve();
  }

  log.debug(`[Roblox] Queuing mail: ${quantity}× ${itemName} → @${recipientUsername}`);
  return bridge.sendOrder({ username: recipientUsername, item: itemName, quantity });
}

module.exports = { sendMail };
