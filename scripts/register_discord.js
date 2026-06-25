#!/usr/bin/env node
'use strict';

/**
 * Registers Discord slash commands for the bot.
 * Run this ONCE after adding/changing commands.
 *
 * Usage:
 *   node scripts/register_discord.js
 *
 * Requires DISCORD_TOKEN, DISCORD_CLIENT_ID (and optionally DISCORD_GUILD_ID)
 * to be set in your .env file.
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { COMMANDS }     = require('../src/discord/bot');

const token    = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId  = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error('ERROR: DISCORD_TOKEN and DISCORD_CLIENT_ID must be set in .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`Registering ${COMMANDS.length} slash command(s)…`);

    const route = guildId
      ? Routes.applicationGuildCommands(clientId, guildId)   // guild-specific (instant)
      : Routes.applicationCommands(clientId);                 // global (up to 1 hour to propagate)

    const data = await rest.put(route, { body: COMMANDS });
    console.log(`✓ Registered ${data.length} command(s) ${guildId ? `to guild ${guildId}` : 'globally'}.`);

    if (!guildId) {
      console.log('  Note: global commands can take up to 1 hour to appear in Discord.');
      console.log('  Add DISCORD_GUILD_ID to .env for instant registration during development.');
    }
  } catch (err) {
    console.error('Failed to register commands:', err.message);
    process.exit(1);
  }
})();
