'use strict';

const { Events } = require('discord.js');
const log = require('../utils/logger').child({ mod: 'discord' });
const guildsRepo = require('../database/repositories/guilds');

module.exports = {
  name: Events.GuildDelete,
  async execute(guild) {
    if (guild.available === false) return; // outage, not an actual removal
    await guildsRepo.markLeft(guild.id);
    log.info({ guild: guild.id, name: guild.name }, 'left / removed from a server');
  },
};
