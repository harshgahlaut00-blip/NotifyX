'use strict';

const { Events, MessageFlags } = require('discord.js');
const log = require('../utils/logger').child({ mod: 'interaction' });
const commands = require('../commands');
const { UserError } = require('../utils/errors');
const { parseId } = require('../utils/discord');
const { notice } = require('../services/ui');

const EPHEMERAL = MessageFlags?.Ephemeral ?? 64;

/** Every command that owns component/modal custom_ids "nx:<namespace>:…" advertises its namespace. */
function findByNamespace(namespace) {
  return commands.all().find((c) => c.namespace === namespace);
}

async function respondError(interaction, err) {
  const message = err instanceof UserError ? err.message : 'Something went wrong. Please try again.';
  if (!(err instanceof UserError)) log.error({ err, interactionId: interaction.id }, 'interaction handler threw');
  const payload = { ...notice('error', message), flags: EPHEMERAL };
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply(payload);
  } catch (replyErr) {
    log.warn({ err: replyErr.message }, 'could not deliver error reply');
  }
}

async function handleChatInput(interaction) {
  const command = commands.get(interaction.commandName);
  if (!command) {
    await interaction.reply({ ...notice('error', 'This command is not available right now.'), flags: EPHEMERAL });
    return;
  }
  await command.execute(interaction);
}

async function handleAutocomplete(interaction) {
  const command = commands.get(interaction.commandName);
  try {
    if (command?.autocomplete) await command.autocomplete(interaction);
    else await interaction.respond([]);
  } catch (err) {
    log.warn({ err: err.message }, 'autocomplete failed');
    await interaction.respond([]).catch(() => {});
  }
}

async function handleComponentOrModal(interaction, kind) {
  const parsed = parseId(interaction.customId);
  if (!parsed) return;
  const command = findByNamespace(parsed.namespace);
  if (!command?.[kind]) {
    await respondError(interaction, new UserError('This control has expired. Please run the command again.'));
    return;
  }
  await command[kind](interaction, parsed.args);
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) return await handleChatInput(interaction);
      if (interaction.isAutocomplete()) return await handleAutocomplete(interaction);
      if (interaction.isMessageComponent()) return await handleComponentOrModal(interaction, 'component');
      if (interaction.isModalSubmit()) return await handleComponentOrModal(interaction, 'modal');
      return undefined;
    } catch (err) {
      return respondError(interaction, err);
    }
  },
};
