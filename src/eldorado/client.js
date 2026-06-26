'use strict';

/**
 * Eldorado facade — probes the internal API at startup and routes all
 * subsequent calls to either api.js (fast) or scraper.js (fallback).
 */

const api     = require('./api');
const scraper = require('./scraper');
const log     = require('../logger');

let mode = null; // 'api' | 'playwright' — set once at startup

async function init() {
  const apiAvailable = await api.probe();
  mode = apiAvailable ? 'api' : 'playwright';
  if (mode === 'playwright') {
    log.info('[Eldorado] Using Playwright scraper mode.');
  }
}

function _backend() {
  if (!mode) throw new Error('Eldorado client not initialised — call init() first.');
  return mode === 'api' ? api : scraper;
}

async function getNewOrders()           { return _backend().getOrders(); }
async function markDelivered(orderId)   { return _backend().markDelivered(orderId); }
async function sendMessage(orderId, msg){ return _backend().sendMessage(orderId, msg); }
async function shutdown()               { return scraper.shutdown(); }
async function dumpPage(opts)           { return scraper.dumpPage(opts); }

module.exports = { init, getNewOrders, markDelivered, sendMessage, shutdown, dumpPage };
