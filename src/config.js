'use strict';

require('dotenv').config();

// Email/password only required when not using cookie-based auth
const hasCookies = !!process.env.ELDORADO_COOKIES;
if (!hasCookies) {
  for (const key of ['ELDORADO_EMAIL', 'ELDORADO_PASSWORD']) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}\nEither set ELDORADO_EMAIL + ELDORADO_PASSWORD, or set ELDORADO_COOKIES (for Google/social login).`);
    }
  }
}

module.exports = Object.freeze({
  eldorado: {
    email:    process.env.ELDORADO_EMAIL,
    password: process.env.ELDORADO_PASSWORD,
    cookies:  (() => {
      const raw = process.env.ELDORADO_COOKIES;
      if (!raw) return [];
      try { return JSON.parse(raw); }
      catch { throw new Error('ELDORADO_COOKIES is not valid JSON. Wrap the value in single quotes in .env and ensure it is on one line.'); }
    })(),
  },
  discord: {
    token:     process.env.DISCORD_TOKEN      || '',
    channelId: process.env.DISCORD_CHANNEL_ID || '',
  },
  adbSerial:       process.env.ADB_DEVICE_SERIAL || '',
  dryRun:          process.env.DRY_RUN === 'true',
  pollIntervalMs:  parseInt(process.env.POLL_INTERVAL_MS  || '45000', 10),
  mailSendWaitMs:  parseInt(process.env.MAIL_SEND_WAIT_MS || '4000',  10),
  stateFilePath:   process.env.STATE_FILE_PATH || './data/state.json',
  logLevel:        process.env.LOG_LEVEL || 'info',
});
