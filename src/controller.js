'use strict';

/**
 * Shared runtime state. Both the polling loop and the Discord bot
 * read/write through here so they stay in sync in the same process.
 */

let _paused    = false;
let _startedAt = new Date();
let _lastPoll  = null;
let _mode      = null;          // 'api' | 'playwright' — set by eldorado/client
let _notifyFn  = null;          // Discord notification callback, set by discord/bot

module.exports = {
  isPaused:   ()  => _paused,
  pause:      ()  => { _paused = true; },
  resume:     ()  => { _paused = false; },
  setLastPoll:(t) => { _lastPoll = t; },
  setMode:    (m) => { _mode = m; },
  setNotifier:(fn)=> { _notifyFn = fn; },

  getStatus: () => ({
    paused:    _paused,
    startedAt: _startedAt,
    lastPoll:  _lastPoll,
    mode:      _mode,
  }),

  /** Sends a message to the configured Discord notification channel (no-op if Discord not running). */
  notify: async (message) => {
    if (_notifyFn) {
      try { await _notifyFn(message); } catch { /* non-fatal */ }
    }
  },
};
