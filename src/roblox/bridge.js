'use strict';

/**
 * Local HTTP bridge between Node.js and the in-game Lua delivery script.
 *
 * The Lua script (scripts/deliver.lua) polls GET /next-order every few
 * seconds. When Node.js has an order ready it returns the JSON payload.
 * The Lua script delivers the mail then calls POST /complete.
 *
 * Only one order is in-flight at a time — the bridge serialises them.
 */

const http = require('http');
const log  = require('../logger');

const PORT = parseInt(process.env.BRIDGE_PORT || '7890', 10);

let _server   = null;
let _pending  = null;   // { order, resolve, reject, timer }

function _startServer() {
  if (_server) return;

  _server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/next-order') {
      if (_pending) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(_pending.order));
      } else {
        res.writeHead(204);
        res.end();
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/complete') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        res.writeHead(200);
        res.end('ok');

        if (!_pending) return;
        let data;
        try { data = JSON.parse(body); } catch { data = { success: false, error: 'bad JSON from Lua' }; }

        const { resolve, reject, timer } = _pending;
        clearTimeout(timer);
        _pending = null;

        if (data.success) {
          resolve();
        } else {
          reject(new Error(data.error || 'Lua delivery failed'));
        }
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200);
      res.end('pong');
      return;
    }

    res.writeHead(404);
    res.end();
  });

  _server.listen(PORT, '127.0.0.1', () => {
    log.info(`[Bridge] Listening on http://127.0.0.1:${PORT} — inject scripts/deliver.lua in Roblox`);
  });

  _server.on('error', err => {
    log.error(`[Bridge] Server error: ${err.message}`);
  });
}

/**
 * Queue an order for the Lua script to pick up.
 * Resolves when Lua reports success, rejects on failure or timeout.
 *
 * @param {{ username: string, item: string, quantity: number }} order
 * @param {number} [timeoutMs=300000]  5 minutes default
 */
function sendOrder(order, timeoutMs = 300_000) {
  _startServer();

  return new Promise((resolve, reject) => {
    if (_pending) {
      reject(new Error('Bridge already has an order in-flight'));
      return;
    }

    const timer = setTimeout(() => {
      _pending = null;
      reject(new Error(`Lua delivery timed out after ${timeoutMs / 1000}s — is the Lua script running?`));
    }, timeoutMs);

    _pending = { order, resolve, reject, timer };
    log.debug(`[Bridge] Order queued for Lua: ${order.quantity}× ${order.item} → @${order.username}`);
  });
}

function shutdown() {
  if (_server) {
    _server.close();
    _server = null;
  }
  if (_pending) {
    clearTimeout(_pending.timer);
    _pending.reject(new Error('Bridge shut down'));
    _pending = null;
  }
}

module.exports = { sendOrder, shutdown, PORT };
