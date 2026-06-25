'use strict';

/**
 * Attempts to use Eldorado's undocumented /seller-api/ endpoints.
 * Returns null from probe() if the API is unavailable — the client
 * facade will fall back to the Playwright scraper in that case.
 */

const axios = require('axios');
const config = require('../config');
const log    = require('../logger');

const http = axios.create({
  baseURL: 'https://eldorado.gg',
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; AutoDelivery/1.0)',
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Attach session cookies if provided in config
if (config.eldorado.cookies.length) {
  const cookieStr = config.eldorado.cookies
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
  http.defaults.headers.common['Cookie'] = cookieStr;
}

/**
 * Checks whether the internal seller API is accessible.
 * @returns {Promise<boolean>}
 */
async function probe() {
  try {
    const res = await http.get('/seller-api/orders', { params: { status: 'pending' } });
    // Validate that the response looks like an order list
    if (res.status === 200 && Array.isArray(res.data?.orders ?? res.data)) {
      log.info('[Eldorado API] Internal API available — using API mode.');
      return true;
    }
  } catch (err) {
    log.debug(`[Eldorado API] Probe failed (${err.message}) — will use Playwright fallback.`);
  }
  return false;
}

/**
 * @returns {Promise<import('./types').Order[]>}
 */
async function getOrders() {
  const res = await http.get('/seller-api/orders', { params: { status: 'pending' } });
  const raw = Array.isArray(res.data) ? res.data : res.data.orders;
  return raw.map(normalise);
}

async function markDelivered(orderId) {
  await http.post(`/seller-api/orders/${orderId}/deliver`);
}

async function sendMessage(orderId, message) {
  await http.post(`/seller-api/orders/${orderId}/message`, { message });
}

/** Normalises a raw API order object into our internal Order shape */
function normalise(raw) {
  return {
    orderId:       String(raw.id ?? raw.orderId),
    buyerUsername: raw.buyerUsername ?? raw.buyer?.username ?? '',
    itemName:      raw.itemName ?? raw.item?.name ?? '',
    quantity:      Number(raw.quantity ?? raw.amount ?? 1),
    status:        raw.status ?? 'pending',
    createdAt:     raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
  };
}

module.exports = { probe, getOrders, markDelivered, sendMessage };
