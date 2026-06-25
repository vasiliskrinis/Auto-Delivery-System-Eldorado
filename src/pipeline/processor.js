'use strict';

const path       = require('path');
const eldorado   = require('../eldorado/client');
const deliver    = require('../roblox/deliver');
const state      = require('../state');
const controller = require('../controller');
const log        = require('../logger');
const { withRetry } = require('./retry');

const itemMap = require(path.resolve(__dirname, '../../config/itemMap.json'));

// Prevents the same order from being processed twice if a slow delivery
// overlaps with the next poll tick.
const inFlight = new Set();

/**
 * End-to-end pipeline for a single order.
 * @param {{ orderId: string, buyerUsername: string, itemName: string, quantity: number }} order
 */
async function processOrder(order) {
  const { orderId, buyerUsername, itemName, quantity } = order;

  if (inFlight.has(orderId)) return;
  inFlight.add(orderId);

  try {
    log.info(`[Order ${orderId}] Starting — ${quantity}× "${itemName}" → @${buyerUsername}`);

    // 1. Resolve item name to in-game name
    const inGameItem = itemMap[itemName];
    if (!inGameItem) {
      log.error(`[Order ${orderId}] Unknown item "${itemName}" — not in itemMap.json. Marking failed.`);
      state.markFailed(orderId, `unknown_item: ${itemName}`);
      await _notifyBuyer(orderId, 'Sorry, there was a problem processing your order. Our team will contact you shortly.');
      return;
    }

    // 2. Send in-game mail via Roblox automation
    await withRetry(
      () => deliver.sendMail(buyerUsername, inGameItem, quantity),
      { attempts: 3, delayMs: 10000, backoffFactor: 2, label: `deliver mail [${orderId}]` }
    );
    log.info(`[Order ${orderId}] Mail delivered to @${buyerUsername}.`);

    // 3. Mark order as delivered on Eldorado
    await withRetry(
      () => eldorado.markDelivered(orderId),
      { attempts: 3, delayMs: 3000, backoffFactor: 2, label: `markDelivered [${orderId}]` }
    ).catch(err => {
      // Non-fatal — delivery already happened; log for manual follow-up
      log.error(`[Order ${orderId}] Could not mark delivered on Eldorado: ${err.message}`);
    });

    // 4. Send buyer confirmation message
    await _notifyBuyer(
      orderId,
      `✅ Your ${quantity}× ${itemName} ha${quantity === 1 ? 's' : 've'} been sent to your in-game mailbox in Grow a Garden 2! Check your mailbox and enjoy. Thank you for your purchase! 🌱`
    );

    // 5. Persist success
    state.markProcessed(orderId, { item: itemName, quantity, buyer: buyerUsername });
    log.info(`[Order ${orderId}] Complete.`);
    await controller.notify(`✅ **Order ${orderId}** delivered\n\`${quantity}× ${itemName}\` → \`@${buyerUsername}\``);

  } catch (err) {
    log.error(`[Order ${orderId}] Failed: ${err.message}`);
    state.markFailed(orderId, err.message);
    await controller.notify(`❌ **Order ${orderId}** failed\n\`${quantity}× ${itemName}\` → \`@${buyerUsername}\`\nReason: ${err.message}`);
    await _notifyBuyer(
      orderId,
      'There was an issue delivering your order. Please contact us and we will resolve it manually as soon as possible.'
    ).catch(() => {});
  } finally {
    inFlight.delete(orderId);
  }
}

async function _notifyBuyer(orderId, message) {
  await withRetry(
    () => eldorado.sendMessage(orderId, message),
    { attempts: 2, delayMs: 2000, backoffFactor: 1, label: `sendMessage [${orderId}]` }
  );
}

module.exports = { processOrder };
