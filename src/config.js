'use strict';

require('dotenv').config();

const REQUIRED = [
  'ELDORADO_EMAIL',
  'ELDORADO_PASSWORD',
];

for (const key of REQUIRED) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}\nCopy .env.example to .env and fill it in.`);
  }
}

module.exports = Object.freeze({
  eldorado: {
    email:    process.env.ELDORADO_EMAIL,
    password: process.env.ELDORADO_PASSWORD,
    cookies:  process.env.ELDORADO_COOKIES ? JSON.parse(process.env.ELDORADO_COOKIES) : [],
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
