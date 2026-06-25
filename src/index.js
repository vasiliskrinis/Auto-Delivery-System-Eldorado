'use strict';

const config    = require('./config');
const eldorado  = require('./eldorado/client');
const { processOrder } = require('./pipeline/processor');
const state     = require('./state');
const log       = require('./logger');

async function poll() {
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

  // Process orders sequentially — the Roblox game client can only do one
  // delivery at a time (one mail UI at a time).
  for (const order of newOrders) {
    await processOrder(order).catch(err =>
      log.error(`[Poll] Unhandled error on order ${order.orderId}: ${err.message}`)
    );
  }
}

async function main() {
  log.info('=== Auto-Delivery System starting ===');

  await eldorado.init();

  // Run once immediately, then on interval
  await poll();
  const timer = setInterval(poll, config.pollIntervalMs);

  // Graceful shutdown
  async function shutdown(sig) {
    log.info(`Received ${sig} — shutting down…`);
    clearInterval(timer);
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
