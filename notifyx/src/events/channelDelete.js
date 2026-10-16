'use strict';

const { Events } = require('discord.js');
const log = require('../utils/logger').child({ mod: 'discord' });
const guildsRepo = require('../database/repositories/guilds');
const rulesRepo = require('../database/repositories/rules');

module.exports = {
  name: Events.ChannelDelete,
  async execute(channel) {
    if (!channel.guildId) return;
    try {
      await Promise.all([guildsRepo.clearChannelRefs(channel.guildId, channel.id), rulesRepo.clearChannelRefs(channel.guildId, channel.id)]);
    } catch (err) {
      log.warn({ err, channel: channel.id }, 'could not clear channel references');
    }
  },
};
