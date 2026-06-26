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

  // Restore session cookies if available.
  // Sanitize sameSite to valid Playwright values (browser exporters may use
  // non-standard strings like "no_restriction", "unspecified", or empty).
  if (config.eldorado.cookies.length) {
    const VALID_SAMESITE = new Set(['Strict', 'Lax', 'None']);
    const cookies = config.eldorado.cookies.map(c => {
      const ss = c.sameSite ? c.sameSite.charAt(0).toUpperCase() + c.sameSite.slice(1).toLowerCase() : '';
      return { ...c, sameSite: VALID_SAMESITE.has(ss) ? ss : 'None' };
    });
    await ctx.addCookies(cookies);
  }

  page = await ctx.newPage();
  await _ensureLoggedIn();
}

const ORDERS_URL = process.env.ELDORADO_ORDERS_URL || 'https://eldorado.gg/dashboard/sales';

// 'networkidle' never settles on Eldorado (live analytics/websockets), which
// caused 30s timeouts. Use 'domcontentloaded' + a short settle pause instead.
async function _goto(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500);
}

async function _ensureLoggedIn() {
  await _goto(ORDERS_URL);

  // If redirected to login, perform credential login (only works for
  // email/password accounts; Google-OAuth users rely on ELDORADO_COOKIES).
  if (page.url().includes('/login') || page.url().includes('/signin')) {
    if (!config.eldorado.email || !config.eldorado.password) {
      throw new Error(
        'Not logged in to Eldorado and no email/password set. Your ELDORADO_COOKIES ' +
        'have likely expired — re-export them from your browser (Cookie-Editor) and update .env.'
      );
    }
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
    await _goto(ORDERS_URL);
  } catch {
    // Stale context — reinitialise
    log.warn('[Eldorado Scraper] Page stale, reinitialising…');
    await shutdown();
    await _init();
    await _goto(ORDERS_URL);
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

  if (orders.length === 0 && process.env.ELDORADO_DEBUG === 'true') {
    await _dumpPage();
  }

  return orders.filter(o => o.orderId && o.status === 'pending');
}

/**
 * Saves the current page HTML + a screenshot so we can identify the real
 * order DOM structure. Enable with ELDORADO_DEBUG=true in .env.
 */
async function _dumpPage() {
  try {
    const fs = require('fs');
    const html = await page.content();
    fs.writeFileSync('./data/eldorado-debug.html', html);
    await page.screenshot({ path: './data/eldorado-debug.png', fullPage: true });
    log.warn(`[Eldorado Scraper] No orders parsed. Dumped page to data/eldorado-debug.html and .png (url: ${page.url()})`);
  } catch (err) {
    log.warn(`[Eldorado Scraper] Debug dump failed: ${err.message}`);
  }
}

async function markDelivered(orderId) {
  if (!page) await _init();
  // Navigate to the specific order and click the deliver button
  await _goto(`${ORDERS_URL}/${orderId}`);
  const deliverBtn = page.locator('button:has-text("Deliver"), button:has-text("Mark as delivered"), [data-action="deliver"]');
  await deliverBtn.click();
  await page.waitForTimeout(1500);
}

async function sendMessage(orderId, message) {
  if (!page) await _init();
  await _goto(`${ORDERS_URL}/${orderId}`);
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
