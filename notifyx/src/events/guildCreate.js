'use strict';

const { Events } = require('discord.js');
const log = require('../utils/logger').child({ mod: 'discord' });
const guildsRepo = require('../database/repositories/guilds');

module.exports = {
  name: Events.GuildCreate,
  async execute(guild) {
    await guildsRepo.ensure(guild.id, guild.name);
    log.info({ guild: guild.id, name: guild.name, members: guild.memberCount }, 'joined a server');
  },
};
