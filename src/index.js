'use strict';

const config       = require('./config');
const eldorado     = require('./eldorado/client');
const bridge       = require('./roblox/bridge');
const { processOrder } = require('./pipeline/processor');
const state        = require('./state');
const controller   = require('./controller');
const log          = require('./logger');

async function poll() {
  if (controller.isPaused()) {
    log.debug('[Poll] Paused — skipping tick.');
    return;
  }

  controller.setLastPoll(new Date());

  let orders;
  try {
    orders = await eldorado.getNewOrders();
  } catch (err) {
    log.error(`[Poll] Failed to fetch orders: ${err.message}`);
    return;
  }

  const newOrders = orders.filter(o => !state.isProcessed(o.orderId) && !state.isFailed(o.orderId));

  if (newOrders.length === 0) {
    log.debug('[Poll] No new orders.');
    return;
  }

  log.info(`[Poll] ${newOrders.length} new order(s) found.`);

  // Sequential — the game client can only do one mail at a time
  for (const order of newOrders) {
    await processOrder(order).catch(err =>
      log.error(`[Poll] Unhandled error on order ${order.orderId}: ${err.message}`)
    );
  }
}

async function main() {
  log.info('=== Auto-Delivery System starting ===');

  // Start the Roblox bridge server immediately so the in-game Lua script
  // can connect right away (it doesn't wait for the first order).
  if (!config.dryRun) {
    bridge.start();
  }

  await eldorado.init();

  // Start Discord bot if configured (non-blocking — bot failure won't stop delivery)
  if (config.discord.token) {
    try {
      const { startBot } = require('./discord/bot');
      await startBot();
      log.info('[Discord] Bot online.');
    } catch (err) {
      log.warn(`[Discord] Bot failed to start: ${err.message} — continuing without Discord.`);
    }
  } else {
    log.info('[Discord] No DISCORD_TOKEN set — running without Discord bot.');
  }

  // Run one poll immediately, then on interval
  await poll();
  const timer = setInterval(poll, config.pollIntervalMs);

  async function shutdown(sig) {
    log.info(`Received ${sig} — shutting down…`);
    clearInterval(timer);
    bridge.shutdown();
    await eldorado.shutdown();
    process.exit(0);
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('Fatal startup error:', err.message);
  process.exit(1);
});
