'use strict';

const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const { UserError } = require('../utils/errors');
const { ChannelType } = require('../utils/discord');

const THREAD_TYPES = new Set([ChannelType.AnnouncementThread, ChannelType.PublicThread, ChannelType.PrivateThread]);

const PRETTY = {
  ViewChannel: 'View Channel',
  SendMessages: 'Send Messages',
  SendMessagesInThreads: 'Send Messages in Threads',
  EmbedLinks: 'Embed Links',
  ManageChannels: 'Manage Channels',
  MentionEveryone: 'Mention @everyone, @here and All Roles',
  UseExternalEmojis: 'Use External Emojis',
  ManageGuild: 'Manage Server',
};

const prettyPermission = (name) => PRETTY[name] || String(name).replace(/([a-z])([A-Z])/g, '$1 $2');
const names = (bits) => new PermissionsBitField(bits).toArray().map(prettyPermission);

/** Users need "Manage Server" (or Administrator) to configure NotifyX. */
function requireManager(interaction) {
  if (!interaction.inGuild()) throw new UserError('NotifyX can only be used inside a server.');
  const perms = interaction.memberPermissions;
  if (!perms || !perms.has(PermissionFlagsBits.ManageGuild)) {
    throw new UserError('You need the **Manage Server** permission to do that.');
  }
}

async function botMember(guild) {
  return guild.members.me ?? guild.members.fetchMe();
}

/**
 * What the bot is missing to post a notification in `channel`.
 * Returns { missing: string[] (blocking), warnings: string[] (non-blocking) }.
 */
async function checkPostingPermissions(channel, { roleId = null } = {}) {
  const me = await botMember(channel.guild);
  const perms = channel.permissionsFor(me);
  if (!perms) return { missing: ['View Channel'], warnings: [] };

  const isThread = THREAD_TYPES.has(channel.type);
  const required = [PermissionFlagsBits.ViewChannel, isThread ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
  const missing = names(perms.missing(required));

  const warnings = [];
  if (roleId && !perms.has(PermissionFlagsBits.MentionEveryone)) {
    const role = channel.guild.roles.cache.get(roleId);
    if (roleId === channel.guild.id || (role && !role.mentionable)) {
      warnings.push('The role is not mentionable and I lack **Mention @everyone, @here and All Roles** — it will not be pinged.');
    }
  }
  return { missing, warnings };
}

async function canManageChannels(guild) {
  const me = await botMember(guild);
  return me.permissions.has(PermissionFlagsBits.ManageChannels);
}

module.exports = { PermissionFlagsBits, requireManager, checkPostingPermissions, canManageChannels, botMember, prettyPermission, THREAD_TYPES };
