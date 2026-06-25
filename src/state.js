'use strict';

const fs   = require('fs');
const path = require('path');
const config = require('./config');

const FILE = path.resolve(config.stateFilePath);
const TMP  = FILE + '.tmp';

// Ensure the data directory exists
fs.mkdirSync(path.dirname(FILE), { recursive: true });

let _state = { processed: {}, failed: {} };

if (fs.existsSync(FILE)) {
  try {
    _state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    // Corrupted state file — start fresh but keep the bad file as a backup
    fs.copyFileSync(FILE, FILE + '.bak');
  }
}

function _save() {
  fs.writeFileSync(TMP, JSON.stringify(_state, null, 2));
  fs.renameSync(TMP, FILE); // atomic on most filesystems
}

function isProcessed(orderId) {
  return orderId in _state.processed;
}

function isFailed(orderId) {
  return orderId in _state.failed;
}

function markProcessed(orderId, meta = {}) {
  _state.processed[orderId] = { completedAt: new Date().toISOString(), ...meta };
  _save();
}

function markFailed(orderId, reason) {
  _state.failed[orderId] = { failedAt: new Date().toISOString(), reason };
  _save();
}

function clearFailed(orderId) {
  delete _state.failed[orderId];
  _save();
}

// Returns raw state object — used by Discord bot for listing orders
function _raw() {
  return _state;
}

module.exports = { isProcessed, isFailed, markProcessed, markFailed, clearFailed, _raw };
