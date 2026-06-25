'use strict';

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const config     = require('../config');
const controller = require('../controller');
const state      = require('../state');
const log        = require('../logger');

// ── Slash command definitions ─────────────────────────────────────────────────

const COMMANDS = [
  new SlashCommandBuilder()
    .setName('eldstatus')
    .setDescription('Show the bot status: running/paused, uptime, last poll, Eldorado mode'),

  new SlashCommandBuilder()
    .setName('eldorders')
    .setDescription('List recently processed orders')
    .addIntegerOption(o => o.setName('count').setDescription('How many to show (default 5)').setMinValue(1).setMaxValue(20)),

  new SlashCommandBuilder()
    .setName('eldfailed')
    .setDescription('List failed orders that need attention'),

  new SlashCommandBuilder()
    .setName('eldretry')
    .setDescription('Retry a failed order')
    .addStringOption(o => o.setName('order_id').setDescription('Order ID from /eldfailed').setRequired(true)),

  new SlashCommandBuilder()
    .setName('eldpause')
    .setDescription('Pause automatic order polling'),

  new SlashCommandBuilder()
    .setName('eldresume')
    .setDescription('Resume automatic order polling'),

  new SlashCommandBuilder()
    .setName('elddeliver')
    .setDescription('Manually trigger a delivery (real — actually sends in-game mail)')
    .addStringOption(o => o.setName('username').setDescription('Roblox @username of the buyer').setRequired(true))
    .addStringOption(o => o.setName('item').setDescription('Item name (must match itemMap.json)').setRequired(true))
    .addIntegerOption(o => o.setName('qty').setDescription('Quantity to send').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName('eldtestdeliver')
    .setDescription('Dry-run delivery — logs all steps without actually tapping the game')
    .addStringOption(o => o.setName('username').setDescription('Roblox @username').setRequired(true))
    .addStringOption(o => o.setName('item').setDescription('Item name').setRequired(true))
    .addIntegerOption(o => o.setName('qty').setDescription('Quantity').setRequired(true).setMinValue(1)),
].map(c => c.toJSON());


// ── Bot setup ─────────────────────────────────────────────────────────────────

let client       = null;
let notifyChannel = null;

async function startBot() {
  client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('ready', async () => {
    log.info(`[Discord] Logged in as ${client.user.tag}`);

    // Cache the notification channel
    if (config.discord.channelId) {
      notifyChannel = await client.channels.fetch(config.discord.channelId).catch(() => null);
      if (notifyChannel) {
        log.info(`[Discord] Notification channel: #${notifyChannel.name}`);
      }
    }

    // Wire up the controller notifier
    controller.setNotifier(async (message) => {
      if (notifyChannel) {
        await notifyChannel.send(message).catch(err =>
          log.warn(`[Discord] Failed to send notification: ${err.message}`)
        );
      }
    });
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      await handleCommand(interaction);
    } catch (err) {
      log.error(`[Discord] Command error (${interaction.commandName}): ${err.message}`);
      const msg = { content: `❌ Error: ${err.message}`, ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    }
  });

  await client.login(config.discord.token);
}


// ── Command handlers ──────────────────────────────────────────────────────────

async function handleCommand(interaction) {
  switch (interaction.commandName) {

    case 'eldstatus': {
      const s = controller.getStatus();
      const uptimeMs = Date.now() - s.startedAt.getTime();
      const uptime   = _formatDuration(uptimeMs);
      const lastPoll = s.lastPoll ? `<t:${Math.floor(s.lastPoll / 1000)}:R>` : 'Not yet';

      const embed = new EmbedBuilder()
        .setTitle('Auto-Delivery System — Status')
        .setColor(s.paused ? 0xFFA500 : 0x00C853)
        .addFields(
          { name: 'State',      value: s.paused ? '⏸️ Paused' : '▶️ Running',       inline: true },
          { name: 'Uptime',     value: uptime,                                       inline: true },
          { name: 'Eldorado',   value: s.mode ?? 'initialising',                    inline: true },
          { name: 'Last poll',  value: lastPoll,                                     inline: true },
          { name: 'Poll every', value: `${config.pollIntervalMs / 1000}s`,           inline: true },
          { name: 'Dry run',    value: config.dryRun ? '✅ Yes' : '❌ No',           inline: true },
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      break;
    }

    case 'eldorders': {
      const count   = interaction.options.getInteger('count') ?? 5;
      const entries = Object.entries(state._raw().processed).slice(-count).reverse();

      if (entries.length === 0) {
        return interaction.reply({ content: 'No processed orders yet.', ephemeral: true });
      }

      const lines = entries.map(([id, d]) =>
        `\`${id}\` — **${d.quantity}× ${d.item}** → \`@${d.buyer}\` <t:${Math.floor(new Date(d.completedAt).getTime() / 1000)}:R>`
      );

      const embed = new EmbedBuilder()
        .setTitle(`Last ${entries.length} processed order(s)`)
        .setColor(0x2196F3)
        .setDescription(lines.join('\n'))
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      break;
    }

    case 'eldfailed': {
      const entries = Object.entries(state._raw().failed);

      if (entries.length === 0) {
        return interaction.reply({ content: '✅ No failed orders.', ephemeral: true });
      }

      const lines = entries.map(([id, d]) =>
        `\`${id}\` — ${d.reason} <t:${Math.floor(new Date(d.failedAt).getTime() / 1000)}:R>`
      );

      const embed = new EmbedBuilder()
        .setTitle(`${entries.length} failed order(s)`)
        .setColor(0xF44336)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Use /retry <order_id> to requeue one.' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      break;
    }

    case 'eldretry': {
      const orderId = interaction.options.getString('order_id');
      if (!state.isFailed(orderId)) {
        return interaction.reply({ content: `Order \`${orderId}\` is not in the failed list.`, ephemeral: true });
      }
      state.clearFailed(orderId);
      await interaction.reply(`♻️ Order \`${orderId}\` removed from failed list — it will be retried on the next poll.`);
      break;
    }

    case 'eldpause': {
      if (controller.isPaused()) {
        return interaction.reply({ content: 'Already paused.', ephemeral: true });
      }
      controller.pause();
      log.info('[Discord] Polling paused by Discord command.');
      await interaction.reply('⏸️ Polling paused. Use `/resume` to start again.');
      break;
    }

    case 'eldresume': {
      if (!controller.isPaused()) {
        return interaction.reply({ content: 'Already running.', ephemeral: true });
      }
      controller.resume();
      log.info('[Discord] Polling resumed by Discord command.');
      await interaction.reply('▶️ Polling resumed.');
      break;
    }

    case 'elddeliver':
    case 'eldtestdeliver': {
      const username = interaction.options.getString('username');
      const item     = interaction.options.getString('item');
      const qty      = interaction.options.getInteger('qty');
      const isDryRun = interaction.commandName === 'eldtestdeliver';

      await interaction.deferReply();

      const { processOrder } = require('../pipeline/processor');
      const fakeOrder = {
        orderId:       `discord-${Date.now()}`,
        buyerUsername: username,
        itemName:      item,
        quantity:      qty,
        status:        'pending',
        createdAt:     new Date().toISOString(),
        _dryRun:       isDryRun,
      };

      const prevDryRun = process.env.DRY_RUN;
      if (isDryRun) process.env.DRY_RUN = 'true';

      try {
        await processOrder(fakeOrder);
        const label = isDryRun ? '🧪 Dry-run' : '📬 Manual delivery';
        await interaction.editReply(`${label} complete: **${qty}× ${item}** → \`@${username}\``);
      } catch (err) {
        await interaction.editReply(`❌ Failed: ${err.message}`);
      } finally {
        if (isDryRun) process.env.DRY_RUN = prevDryRun ?? '';
      }
      break;
    }

    default:
      await interaction.reply({ content: `Unknown command: ${interaction.commandName}`, ephemeral: true });
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


module.exports = { startBot, COMMANDS };
