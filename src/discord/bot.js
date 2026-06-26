'use strict';

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const config     = require('../config');
const controller = require('../controller');
const state      = require('../state');
const log        = require('../logger');

const PREFIX = 'eld ';

// ── Bot setup ─────────────────────────────────────────────────────────────────

let client        = null;
let notifyChannel = null;

async function startBot() {
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,   // requires privileged intent in Dev Portal
    ],
  });

  client.once('ready', async () => {
    log.info(`[Discord] Logged in as ${client.user.tag}`);

    if (config.discord.channelId) {
      notifyChannel = await client.channels.fetch(config.discord.channelId).catch(() => null);
      if (notifyChannel) log.info(`[Discord] Notification channel: #${notifyChannel.name}`);
    }

    controller.setNotifier(async (message) => {
      if (notifyChannel) {
        await notifyChannel.send(message).catch(err =>
          log.warn(`[Discord] Failed to send notification: ${err.message}`)
        );
      }
    });
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.toLowerCase().startsWith(PREFIX)) return;

    const parts   = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const command = parts[0]?.toLowerCase();
    const args    = parts.slice(1);

    try {
      await handleCommand(message, command, args);
    } catch (err) {
      log.error(`[Discord] Command error (${command}): ${err.message}`);
      await message.reply(`❌ Error: ${err.message}`).catch(() => {});
    }
  });

  await client.login(config.discord.token);
}


// ── Command handlers ──────────────────────────────────────────────────────────

async function handleCommand(message, command, args) {
  switch (command) {

    case 'status': {
      const s       = controller.getStatus();
      const uptime  = _formatDuration(Date.now() - s.startedAt.getTime());
      const lastPoll = s.lastPoll
        ? `<t:${Math.floor(s.lastPoll.getTime() / 1000)}:R>`
        : 'Not yet';

      const embed = new EmbedBuilder()
        .setTitle('Auto-Delivery System — Status')
        .setColor(s.paused ? 0xFFA500 : 0x00C853)
        .addFields(
          { name: 'State',      value: s.paused ? '⏸️ Paused' : '▶️ Running',     inline: true },
          { name: 'Uptime',     value: uptime,                                     inline: true },
          { name: 'Eldorado',   value: s.mode ?? 'initialising',                  inline: true },
          { name: 'Last poll',  value: lastPoll,                                   inline: true },
          { name: 'Poll every', value: `${config.pollIntervalMs / 1000}s`,         inline: true },
          { name: 'Dry run',    value: config.dryRun ? '✅ Yes' : '❌ No',         inline: true },
        )
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      break;
    }

    case 'orders': {
      const count   = parseInt(args[0], 10) || 5;
      const entries = Object.entries(state._raw().processed).slice(-count).reverse();

      if (entries.length === 0) {
        return message.reply('No processed orders yet.');
      }

      const lines = entries.map(([id, d]) =>
        `\`${id}\` — **${d.quantity}× ${d.item}** → \`@${d.buyer}\` <t:${Math.floor(new Date(d.completedAt).getTime() / 1000)}:R>`
      );

      const embed = new EmbedBuilder()
        .setTitle(`Last ${entries.length} processed order(s)`)
        .setColor(0x2196F3)
        .setDescription(lines.join('\n'))
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      break;
    }

    case 'failed': {
      const entries = Object.entries(state._raw().failed);

      if (entries.length === 0) {
        return message.reply('✅ No failed orders.');
      }

      const lines = entries.map(([id, d]) =>
        `\`${id}\` — ${d.reason} <t:${Math.floor(new Date(d.failedAt).getTime() / 1000)}:R>`
      );

      const embed = new EmbedBuilder()
        .setTitle(`${entries.length} failed order(s)`)
        .setColor(0xF44336)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Use: eld retry <order_id>' })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      break;
    }

    case 'retry': {
      const orderId = args[0];
      if (!orderId) return message.reply('Usage: `eld retry <order_id>`');
      if (!state.isFailed(orderId)) {
        return message.reply(`Order \`${orderId}\` is not in the failed list.`);
      }
      state.clearFailed(orderId);
      await message.reply(`♻️ Order \`${orderId}\` removed from failed list — will retry on next poll.`);
      break;
    }

    case 'pause': {
      if (controller.isPaused()) return message.reply('Already paused.');
      controller.pause();
      log.info('[Discord] Polling paused.');
      await message.reply('⏸️ Polling paused. Type `eld resume` to start again.');
      break;
    }

    case 'resume': {
      if (!controller.isPaused()) return message.reply('Already running.');
      controller.resume();
      log.info('[Discord] Polling resumed.');
      await message.reply('▶️ Polling resumed.');
      break;
    }

    // eld deliver <username> <qty> <item name...>
    case 'deliver':
    case 'testdeliver': {
      const isDryRun = command === 'testdeliver';

      // args: [username, qty, ...itemNameParts]
      const username = args[0];
      const qty      = parseInt(args[1], 10);
      const item     = args.slice(2).join(' ');

      if (!username || !qty || !item) {
        return message.reply(
          `Usage: \`eld ${command} <username> <qty> <item name>\`\n` +
          `Example: \`eld ${command} PlayerName 5 Rainbow Petal Sunflower\``
        );
      }
      if (isNaN(qty) || qty < 1) {
        return message.reply('Quantity must be a positive number.');
      }

      const reply = await message.reply(
        `${isDryRun ? '🧪 Testing' : '📬 Delivering'} **${qty}× ${item}** → \`@${username}\`…`
      );

      const { processOrder } = require('../pipeline/processor');
      const fakeOrder = {
        orderId:       `discord-${Date.now()}`,
        buyerUsername: username,
        itemName:      item,
        quantity:      qty,
        status:        'pending',
        createdAt:     new Date().toISOString(),
      };

      // testdeliver: do real screen automation but skip Eldorado API calls
      // deliver: do everything for real
      if (isDryRun) {
        const eldorado = require('../eldorado/client');
        eldorado._testStubs = {
          markDelivered: eldorado.markDelivered,
          sendMessage:   eldorado.sendMessage,
        };
        eldorado.markDelivered = async (id) => log.info(`[Test] Skipping markDelivered for ${id}`);
        eldorado.sendMessage   = async (id, msg) => log.info(`[Test] Skipping sendMessage for ${id}`);
      }

      try {
        await processOrder(fakeOrder);
        await reply.edit(
          `${isDryRun ? '🧪 Test complete' : '✅ Delivered'}: **${qty}× ${item}** → \`@${username}\``
        );
      } catch (err) {
        await reply.edit(`❌ Failed: ${err.message}`);
      } finally {
        if (isDryRun) {
          const eldorado = require('../eldorado/client');
          if (eldorado._testStubs) {
            eldorado.markDelivered = eldorado._testStubs.markDelivered;
            eldorado.sendMessage   = eldorado._testStubs.sendMessage;
            delete eldorado._testStubs;
          }
        }
      }
      break;
    }

    // eld scrape — navigate to the orders page and dump HTML + screenshot
    // Lets you trigger a debug dump while the orders page is visible so we
    // can inspect the DOM structure and fix the selectors.
    case 'scrape': {
      await message.reply('📸 Navigating to the Eldorado orders page and taking a snapshot…');
      const eldorado = require('../eldorado/client');
      const result = await eldorado.dumpPage({ navigate: true });
      if (!result) {
        return message.reply('❌ Dump failed — check the server logs.');
      }

      const fs = require('fs');
      const pngExists = fs.existsSync(result.pngPath);

      if (pngExists) {
        const { AttachmentBuilder } = require('discord.js');
        const attachment = new AttachmentBuilder(result.pngPath, { name: 'eldorado-page.png' });
        await message.reply({
          content: `📸 **Eldorado page snapshot**\nURL: \`${result.url}\`\nHTML also saved to \`data/eldorado-debug.html\``,
          files: [attachment],
        });
      } else {
        await message.reply(`📸 Dump done — URL: \`${result.url}\`\nFiles saved to \`data/eldorado-debug.*\``);
      }
      break;
    }

    case 'help': {
      const embed = new EmbedBuilder()
        .setTitle('Auto-Delivery Bot — Commands')
        .setColor(0x7289DA)
        .setDescription('All commands start with `eld `')
        .addFields(
          { name: 'eld status',                          value: 'Show bot status, uptime, last poll' },
          { name: 'eld orders [count]',                  value: 'List recent completed orders (default 5)' },
          { name: 'eld failed',                          value: 'List failed orders' },
          { name: 'eld retry <order_id>',                value: 'Re-queue a failed order' },
          { name: 'eld pause / eld resume',              value: 'Stop or start the Eldorado polling loop' },
          { name: 'eld deliver <user> <qty> <item>',     value: 'Manually trigger a real delivery' },
          { name: 'eld testdeliver <user> <qty> <item>', value: 'Dry-run delivery (no real taps)' },
          { name: 'eld scrape',                          value: 'Screenshot the Eldorado orders page for debugging' },
          { name: 'eld help',                            value: 'Show this message' },
        );

      await message.reply({ embeds: [embed] });
      break;
    }

    default:
      await message.reply(`Unknown command \`${command}\`. Type \`eld help\` for a list.`);
  }
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function _formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m ${s % 60}s`;
}


module.exports = { startBot };
