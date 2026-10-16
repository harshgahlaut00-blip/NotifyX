#!/usr/bin/env node
'use strict';

/** Prints an OAuth2 invite URL with the exact scopes/permissions NotifyX needs. */
require('dotenv').config();
const { PermissionsBitField } = require('discord.js');
const { config } = require('../src/config');

if (!config.discord.clientId) {
  console.error('Set DISCORD_CLIENT_ID in your .env first.');
  process.exit(1);
}

// View Channel, Send Messages, Send Messages in Threads, Embed Links, Mention @everyone/roles,
// Use External Emojis, Manage Channels (only needed for the optional "post in a category" feature).
const permissions = new PermissionsBitField([
  'ViewChannel',
  'SendMessages',
  'SendMessagesInThreads',
  'EmbedLinks',
  'MentionEveryone',
  'UseExternalEmojis',
  'ManageChannels',
]).bitfield.toString();

const url = `https://discord.com/oauth2/authorize?client_id=${config.discord.clientId}&scope=bot%20applications.commands&permissions=${permissions}`;
console.log(url);
