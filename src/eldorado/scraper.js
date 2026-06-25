'use strict';

/**
 * Playwright-based scraper for the Eldorado seller dashboard.
 * Used when the internal API is unavailable.
 * The browser context is created once and reused across all polls.
 */

const { chromium } = require('playwright');
const config = require('../config');
const log    = require('../logger');

let browser = null;
let page    = null;

async function _init() {
  // Use system-installed Chromium if available (e.g. on cloud environments),
  // otherwise let Playwright find its own bundled browser.
  const executablePath = process.env.PLAYWRIGHT_BROWSERS_PATH
    ? require('child_process')
        .execSync('find /opt/pw-browsers -name "chrome-headless-shell" -o -name "chromium" 2>/dev/null | head -1')
        .toString().trim() || undefined
    : undefined;

  browser = await chromium.launch({ headless: true, executablePath });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  });

  // Restore session cookies if available
  if (config.eldorado.cookies.length) {
    await ctx.addCookies(config.eldorado.cookies);
  }

  page = await ctx.newPage();
  await _ensureLoggedIn();
}

async function _ensureLoggedIn() {
  await page.goto('https://eldorado.gg/dashboard/offers', { waitUntil: 'networkidle' });

  // If redirected to login, perform credential login
  if (page.url().includes('/login') || page.url().includes('/signin')) {
    log.info('[Eldorado Scraper] Logging in…');
    await page.fill('input[type="email"], input[name="email"]', config.eldorado.email);
    await page.fill('input[type="password"], input[name="password"]', config.eldorado.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard/**', { timeout: 20000 });
    log.info('[Eldorado Scraper] Login successful.');
  }
}

/**
 * @returns {Promise<import('./types').Order[]>}
 */
async function getOrders() {
  if (!page) await _init();

  try {
    await page.goto('https://eldorado.gg/dashboard/offers', { waitUntil: 'networkidle' });
  } catch {
    // Stale context — reinitialise
    log.warn('[Eldorado Scraper] Page stale, reinitialising…');
    await shutdown();
    await _init();
    await page.goto('https://eldorado.gg/dashboard/offers', { waitUntil: 'networkidle' });
  }

  // Parse pending order rows from the dashboard table
  const orders = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-order-id], tr[data-id], .order-row'));
    return rows.map(row => ({
      orderId:       row.dataset.orderId || row.dataset.id || '',
      buyerUsername: row.querySelector('[data-buyer], .buyer-name')?.textContent?.trim() || '',
      itemName:      row.querySelector('[data-item], .item-name')?.textContent?.trim() || '',
      quantity:      Number(row.querySelector('[data-qty], .quantity')?.textContent?.trim() || '1'),
      status:        row.querySelector('[data-status], .status')?.textContent?.trim()?.toLowerCase() || 'pending',
      createdAt:     row.querySelector('[data-date], .date')?.textContent?.trim() || new Date().toISOString(),
    }));
  });

  return orders.filter(o => o.orderId && o.status === 'pending');
}

async function markDelivered(orderId) {
  if (!page) await _init();
  // Navigate to the specific order and click the deliver button
  await page.goto(`https://eldorado.gg/dashboard/offers/${orderId}`, { waitUntil: 'networkidle' });
  const deliverBtn = page.locator('button:has-text("Deliver"), button:has-text("Mark as delivered"), [data-action="deliver"]');
  await deliverBtn.click();
  await page.waitForTimeout(1500);
}

async function sendMessage(orderId, message) {
  if (!page) await _init();
  await page.goto(`https://eldorado.gg/dashboard/offers/${orderId}`, { waitUntil: 'networkidle' });
  const input = page.locator('textarea[placeholder*="message" i], textarea.chat-input, [data-message-input]');
  await input.fill(message);
  await page.locator('button:has-text("Send"), button[type="submit"]').last().click();
  await page.waitForTimeout(1000);
}

async function shutdown() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
    page    = null;
  }
}

module.exports = { getOrders, markDelivered, sendMessage, shutdown };
