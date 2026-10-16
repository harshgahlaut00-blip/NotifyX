'use strict';

const crypto = require('crypto');
const { REST, Routes } = require('discord.js');
const { config } = require('../config');
const log = require('../utils/logger').child({ mod: 'deploy' });
const commands = require('../commands');
const botState = require('../database/repositories/botState');

const STATE_KEY = 'commands_hash';

const hashOf = (payload) => crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

/**
 * Registers slash commands with Discord, respecting COMMAND_SYNC:
 *   auto  — register only when the command set changed since last boot (default; fast restarts)
 *   force — always register, even if unchanged
 *   off   — never register automatically (use `npm run deploy-commands` manually)
 */
async function syncCommands() {
  if (config.discord.commandSync === 'off') {
    log.info('COMMAND_SYNC=off — skipping automatic command registration');
    return;
  }
  commands.loadAll();
  const payload = commands.toJSON();
  const hash = hashOf(payload);

  if (config.discord.commandSync === 'auto') {
    const previous = await botState.get(STATE_KEY).catch(() => null);
    if (previous === hash) {
      log.info({ commands: payload.length }, 'command definitions unchanged — skipping registration');
      return;
    }
  }

  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  const target = config.discord.devGuildId
    ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.devGuildId)
    : Routes.applicationCommands(config.discord.clientId);

  await rest.put(target, { body: payload });
  await botState.set(STATE_KEY, hash);
  log.info({ commands: payload.length, scope: config.discord.devGuildId ? 'guild' : 'global' }, 'slash commands registered');
}

module.exports = { syncCommands, hashOf };
