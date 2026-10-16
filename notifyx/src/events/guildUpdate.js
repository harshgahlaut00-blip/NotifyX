'use strict';

const { Events } = require('discord.js');
const guildsRepo = require('../database/repositories/guilds');

module.exports = {
  name: Events.GuildUpdate,
  async execute(oldGuild, newGuild) {
    if (oldGuild.name !== newGuild.name) await guildsRepo.ensure(newGuild.id, newGuild.name).catch(() => {});
  },
};
