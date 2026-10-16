'use strict';

const { SlashCommandBuilder, ChannelType } = require('discord.js');
const guildsRepo = require('../database/repositories/guilds');
const { requireManager, canManageChannels } = require('../services/permissions');
const { notice, channelMention, roleMention } = require('../services/ui');

const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure this server’s default notification destination')
  .setDMPermission(false)
  .setDefaultMemberPermissions(0)
  .addChannelOption((o) =>
    o.setName('channel').setDescription('Default channel for notifications').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false),
  )
  .addChannelOption((o) =>
    o.setName('category').setDescription('Create a channel per followed YouTube channel inside this category').addChannelTypes(ChannelType.GuildCategory).setRequired(false),
  )
  .addRoleOption((o) => o.setName('role').setDescription('Role to ping by default (leave empty for no ping)').setRequired(false))
  .addBooleanOption((o) => o.setName('enabled').setDescription('Turn notifications on/off for the whole server').setRequired(false));

async function execute(interaction) {
  requireManager(interaction);
  const channel = interaction.options.getChannel('channel');
  const category = interaction.options.getChannel('category');
  const role = interaction.options.getRole('role');
  const enabled = interaction.options.getBoolean('enabled');

  if (category && !(await canManageChannels(interaction.guild))) {
    return interaction.reply({ ...notice('error', 'I need the **Manage Channels** permission to create channels in a category.'), flags: 64 });
  }

  const patch = {};
  if (channel) patch.default_channel_id = channel.id;
  if (category) patch.default_category_id = category.id;
  if (role) patch.default_role_id = role.id;
  if (enabled !== null) patch.notifications_enabled = enabled;

  await guildsRepo.ensure(interaction.guild.id, interaction.guild.name);
  const row = Object.keys(patch).length ? await guildsRepo.update(interaction.guild.id, patch) : await guildsRepo.get(interaction.guild.id);

  const lines = [
    `**Default channel:** ${channelMention(row.default_channel_id) || '_not set_'}`,
    `**Default category:** ${row.default_category_id ? `<#${row.default_category_id}>` : '_not set_'}`,
    `**Default role:** ${roleMention(row.default_role_id, interaction.guild.id) || '_none — no ping_'}`,
    `**Notifications:** ${row.notifications_enabled ? 'Enabled' : 'Disabled'}`,
  ];
  if (!row.default_channel_id && !row.default_category_id) {
    lines.push('', '⚠️ Set a default channel or category before using `/youtube add`, or pass one directly to that command.');
  }
  return interaction.reply({ ...notice('success', `Server setup saved.\n${lines.join('\n')}`), flags: 64 });
}

module.exports = { data, execute };
