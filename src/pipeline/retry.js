'use strict';

const log = require('../logger');

/**
 * Runs fn() up to `attempts` times with exponential backoff.
 *
 * @param {() => Promise<any>} fn
 * @param {{ attempts?: number, delayMs?: number, backoffFactor?: number, label?: string }} opts
 */
async function withRetry(fn, { attempts = 3, delayMs = 3000, backoffFactor = 2, label = 'operation' } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const wait = delayMs * Math.pow(backoffFactor, i);
      log.warn(`[Retry] ${label} failed (attempt ${i + 1}/${attempts}): ${err.message}. Retrying in ${wait}ms…`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr.message}`);
}

module.exports = { withRetry };
