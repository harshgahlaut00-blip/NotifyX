'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { UserError } = require('../utils/errors');
const { requireManager } = require('../services/permissions');
const { ephemeralNotice, onOff } = require('../services/ui');
const { parseEmoji, EMOJI_KEYS, EMOJI_DEFAULTS } = require('../services/emoji');
const runtime = require('../services/runtime');
const guildsRepo = require('../database/repositories/guilds');

const EMOJI_CHOICES = EMOJI_KEYS.map((key) => ({ name: EMOJI_DEFAULTS[key].label, value: key }));

const data = new SlashCommandBuilder()
  .setName('settings')
  .setDescription('Server-wide NotifyX settings')
  .setDMPermission(false)
  .setDefaultMemberPermissions(0)
  .addSubcommand((s) => s.setName('view').setDescription('Show the current settings for this server'))
  .addSubcommand((s) => s.setName('toggle').setDescription('Turn all notifications on/off for this server').addBooleanOption((o) => o.setName('enabled').setDescription('Enabled?').setRequired(true)))
  .addSubcommandGroup((g) =>
    g
      .setName('emoji')
      .setDescription('Customize the emoji NotifyX uses')
      .addSubcommand((s) =>
        s
          .setName('set')
          .setDescription('Set a custom emoji for this server')
          .addStringOption((o) => o.setName('key').setDescription('Which emoji').setRequired(true).addChoices(...EMOJI_CHOICES))
          .addStringOption((o) => o.setName('emoji').setDescription('A server emoji or a Unicode emoji').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('reset')
          .setDescription('Reset an emoji to the default')
          .addStringOption((o) => o.setName('key').setDescription('Which emoji').setRequired(true).addChoices(...EMOJI_CHOICES)),
      )
      .addSubcommand((s) => s.setName('list').setDescription('Show every configurable emoji and its current value')),
  );

async function cmdView(interaction) {
  const row = await guildsRepo.ensure(interaction.guild.id, interaction.guild.name);
  const lines = [
    `**Notifications:** ${onOff(row.notifications_enabled, row)}`,
    `**Default channel:** ${row.default_channel_id ? `<#${row.default_channel_id}>` : '_not set_'}`,
    `**Default category:** ${row.default_category_id ? `<#${row.default_category_id}>` : '_not set_'}`,
    `**Default role:** ${row.default_role_id ? (row.default_role_id === row.guild_id ? '@everyone' : `<@&${row.default_role_id}>`) : '_none_'}`,
    `Use \`/setup\` to change these, or \`/settings emoji\` to customize emoji.`,
  ];
  await interaction.reply(ephemeralNotice('info', lines.join('\n')));
}

async function cmdToggle(interaction) {
  requireManager(interaction);
  const enabled = interaction.options.getBoolean('enabled', true);
  await guildsRepo.ensure(interaction.guild.id, interaction.guild.name);
  await guildsRepo.update(interaction.guild.id, { notifications_enabled: enabled });
  await interaction.reply(ephemeralNotice('success', `Notifications are now ${enabled ? '**enabled**' : '**disabled**'} for this server.`));
}

async function cmdEmojiSet(interaction) {
  requireManager(interaction);
  const key = interaction.options.getString('key', true);
  const input = interaction.options.getString('emoji', true);
  const parsed = parseEmoji(input);
  if (!parsed) throw new UserError('That does not look like an emoji. Use a Unicode emoji or pick one from this server (type `:` to see the picker).');
  if (parsed.type === 'custom' && !interaction.guild.emojis.cache.has(parsed.id)) {
    throw new UserError('I can only use an emoji that belongs to this server.');
  }
  await guildsRepo.ensure(interaction.guild.id, interaction.guild.name);
  await guildsRepo.setEmoji(interaction.guild.id, key, parsed.text);
  await interaction.reply(ephemeralNotice('success', `${parsed.text} set as the **${EMOJI_DEFAULTS[key].label}** emoji.`));
}

async function cmdEmojiReset(interaction) {
  requireManager(interaction);
  const key = interaction.options.getString('key', true);
  await guildsRepo.clearEmoji(interaction.guild.id, key);
  await interaction.reply(ephemeralNotice('success', `**${EMOJI_DEFAULTS[key].label}** reset to the default ${EMOJI_DEFAULTS[key].fallback}.`));
}

async function cmdEmojiList(interaction) {
  const row = await guildsRepo.ensure(interaction.guild.id, interaction.guild.name);
  const lines = EMOJI_KEYS.map((key) => `${runtime.emoji.text(key, row)} — **${EMOJI_DEFAULTS[key].label}**`);
  await interaction.reply(ephemeralNotice('info', lines.join('\n')));
}

async function execute(interaction) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  if (group === 'emoji') {
    if (sub === 'set') return cmdEmojiSet(interaction);
    if (sub === 'reset') return cmdEmojiReset(interaction);
    if (sub === 'list') return cmdEmojiList(interaction);
  }
  if (sub === 'view') return cmdView(interaction);
  if (sub === 'toggle') return cmdToggle(interaction);
  throw new UserError('Unknown subcommand.');
}

module.exports = { data, execute };
