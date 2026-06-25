#!/usr/bin/env node
'use strict';

/**
 * Test runner — processes a fake Eldorado order through the full pipeline.
 *
 * By default runs in DRY_RUN mode (no actual ADB taps, no Eldorado API calls).
 * Set DRY_RUN=false to perform real delivery.
 *
 * Usage:
 *   npm run test:order
 *   npm run test:order -- --username PlayerName --item "Moonpetal" --qty 3
 *   DRY_RUN=false npm run test:order -- --username RealPlayer --item "Moonpetal" --qty 1
 */

// Default to dry-run for the test script
if (process.env.DRY_RUN === undefined) process.env.DRY_RUN = 'true';

require('dotenv').config();

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : fallback;
}

const username = getArg('username', 'TestPlayer123');
const item     = getArg('item',     Object.keys(require('../../config/itemMap.json'))[0] ?? 'TestItem');
const qty      = parseInt(getArg('qty', '1'), 10);
const dryRun   = process.env.DRY_RUN !== 'false';

const log = require('../logger');

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       Auto-Delivery System — Test Run        ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Username : @${username}`);
  console.log(`  Item     : ${item}`);
  console.log(`  Quantity : ${qty}`);
  console.log(`  Mode     : ${dryRun ? '🧪 DRY RUN (no real taps/API calls)' : '🚀 LIVE (real delivery)'}`);
  console.log('');

  if (!dryRun) {
    console.log('  ⚠️  LIVE mode — this will actually send in-game mail and mark orders on Eldorado.');
    console.log('     Press Ctrl+C within 5 seconds to cancel.');
    console.log('');
    await new Promise(r => setTimeout(r, 5000));
  }

  // Mock the Eldorado client in dry-run mode so we don't hit the real API
  if (dryRun) {
    const eldorado = require('../eldorado/client');
    eldorado.init         = async () => { log.info('[Test] Eldorado init skipped (dry run)'); };
    eldorado.markDelivered = async (id) => { log.info(`[Test] Would mark order ${id} delivered on Eldorado`); };
    eldorado.sendMessage   = async (id, msg) => { log.info(`[Test] Would send buyer message for ${id}: "${msg}"`); };
    eldorado.shutdown      = async () => {};
  } else {
    await require('../eldorado/client').init();
  }

  const { processOrder } = require('../pipeline/processor');

  const fakeOrder = {
    orderId:       `test-${Date.now()}`,
    buyerUsername: username,
    itemName:      item,
    quantity:      qty,
    status:        'pending',
    createdAt:     new Date().toISOString(),
  };

  log.info(`[Test] Injecting fake order: ${JSON.stringify(fakeOrder)}`);
  console.log('');

  try {
    await processOrder(fakeOrder);
    console.log('');
    console.log('✅ Test order completed successfully.');
  } catch (err) {
    console.log('');
    console.error(`❌ Test order failed: ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
