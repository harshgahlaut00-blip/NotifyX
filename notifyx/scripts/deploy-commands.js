#!/usr/bin/env node
'use strict';

/** Registers slash commands immediately, ignoring COMMAND_SYNC. Useful right after editing a command. */
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { config, validateConfig } = require('../src/config');
const log = require('../src/utils/logger');
const commands = require('../src/commands');
const { hashOf } = require('../src/services/deploy');
const botState = require('../src/database/repositories/botState');
const db = require('../src/database/pool');

(async () => {
  const { errors } = validateConfig();
  if (errors.length) {
    for (const e of errors) log.fatal(e);
    process.exit(1);
  }
  if (!config.discord.clientId) {
    log.fatal('DISCORD_CLIENT_ID is required to register commands.');
    process.exit(1);
  }

  commands.loadAll();
  const payload = commands.toJSON();
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  const target = config.discord.devGuildId
    ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.devGuildId)
    : Routes.applicationCommands(config.discord.clientId);

  await rest.put(target, { body: payload });
  try {
    await db.waitForDatabase(3, 1000);
    await botState.set('commands_hash', hashOf(payload));
  } catch {
    /* not fatal — the running bot will just re-register once more on its next boot */
  }
  log.info({ commands: payload.length, scope: config.discord.devGuildId ? `guild ${config.discord.devGuildId}` : 'global' }, 'commands registered');
  await db.close().catch(() => {});
  process.exit(0);
})().catch((err) => {
  console.error('[fatal] command registration failed:', err);
  process.exit(1);
});
