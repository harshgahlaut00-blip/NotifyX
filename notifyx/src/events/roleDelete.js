'use strict';

const { Events } = require('discord.js');
const log = require('../utils/logger').child({ mod: 'discord' });
const guildsRepo = require('../database/repositories/guilds');
const rulesRepo = require('../database/repositories/rules');

module.exports = {
  name: Events.GuildRoleDelete,
  async execute(role) {
    try {
      await Promise.all([guildsRepo.clearRoleRefs(role.guild.id, role.id), rulesRepo.clearRoleRefs(role.guild.id, role.id)]);
    } catch (err) {
      log.warn({ err, role: role.id }, 'could not clear role references');
    }
  },
};
