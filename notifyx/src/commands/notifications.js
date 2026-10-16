'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { requireManager } = require('../services/permissions');
const { ephemeralNotice } = require('../services/ui');
const { discordTime } = require('../utils/text');
const runtime = require('../services/runtime');
const historyRepo = require('../database/repositories/history');

const STATUS_ICON = { sent: '✅', failed: '❌', skipped: '⏭️', pending: '⏳', sending: '📤' };

const data = new SlashCommandBuilder()
  .setName('notifications')
  .setDescription('Delivery history for this server’s notifications')
  .setDMPermission(false)
  .setDefaultMemberPermissions(0)
  .addSubcommand((s) => s.setName('history').setDescription('Show the most recent notifications'))
  .addSubcommand((s) => s.setName('stats').setDescription('Delivery stats for the last 24 hours'))
  .addSubcommand((s) => s.setName('retry').setDescription('Retry notifications that failed in the last 24 hours'));

async function cmdHistory(interaction) {
  const rows = await historyRepo.recent(interaction.guildId, 10);
  if (!rows.length) {
    await interaction.reply(ephemeralNotice('info', 'No notifications have been sent yet.'));
    return;
  }
  const lines = rows.map((r) => {
    const icon = STATUS_ICON[r.status] || '•';
    const when = discordTime(r.sent_at || r.created_at, 'R');
    const reason = r.status === 'failed' || r.status === 'skipped' ? ` — ${r.error || r.status}` : '';
    return `${icon} **${r.account_name}** — ${r.event_type} — ${when}${reason}`;
  });
  await interaction.reply(ephemeralNotice('info', lines.join('\n')));
}

async function cmdStats(interaction) {
  const rows = await historyRepo.stats(interaction.guildId);
  if (!rows.length) {
    await interaction.reply(ephemeralNotice('info', 'No notifications in the last 24 hours.'));
    return;
  }
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const lines = ['pending', 'sending', 'sent', 'failed', 'skipped']
    .filter((s) => byStatus[s])
    .map((s) => `${STATUS_ICON[s]} **${s}:** ${byStatus[s]}`);
  await interaction.reply(ephemeralNotice('info', `**Last 24 hours**\n${lines.join('\n')}`));
}

async function cmdRetry(interaction) {
  requireManager(interaction);
  await historyRepo.retryFailed(interaction.guildId);
  runtime.notifier?.trigger();
  await interaction.reply(ephemeralNotice('success', 'Failed notifications from the last 24 hours have been re-queued.'));
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'history') return cmdHistory(interaction);
  if (sub === 'stats') return cmdStats(interaction);
  if (sub === 'retry') return cmdRetry(interaction);
  return undefined;
}

module.exports = { data, execute };
