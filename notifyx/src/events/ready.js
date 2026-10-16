'use strict';

const { Events, ActivityType } = require('discord.js');
const log = require('../utils/logger').child({ mod: 'discord' });
const guildsRepo = require('../database/repositories/guilds');
const runtime = require('../services/runtime');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    log.info({ tag: client.user.tag, guilds: client.guilds.cache.size }, 'Discord client ready');
    try {
      const ids = [...client.guilds.cache.keys()];
      await Promise.all(ids.map((id) => guildsRepo.ensure(id, client.guilds.cache.get(id)?.name)));
      await guildsRepo.markMissingAsLeft(ids);
    } catch (err) {
      log.warn({ err }, 'could not reconcile guild list on startup');
    }
    client.user.setPresence({ activities: [{ name: 'YouTube channels · /help', type: ActivityType.Watching }], status: 'online' });
    runtime.ready = true;
  },
};
