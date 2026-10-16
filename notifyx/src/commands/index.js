'use strict';

/**
 * Slash command registry.
 * Each module in this folder (and commands/youtube/) exports:
 *   { data: SlashCommandBuilder|raw JSON, execute(interaction), autocomplete?(interaction),
 *     component?(interaction, args), modal?(interaction, args) }
 * `component`/`modal` handle button/select/modal custom_ids of the form "nx:<name>:...".
 */

const fs = require('fs');
const path = require('path');

const commands = new Map();

function load(file) {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const mod = require(file);
  if (!mod?.data?.name) throw new Error(`Command file ${file} does not export { data }`);
  commands.set(mod.data.name, mod);
}

function loadAll() {
  // Only the top-level *.js files are commands. Subdirectories (e.g. commands/youtube/) hold
  // internal helper modules for a command — required directly by it, never auto-loaded here.
  commands.clear();
  const root = __dirname;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'index.js') load(path.join(root, entry.name));
  }
  return commands;
}

const get = (name) => commands.get(name);
const all = () => [...commands.values()];
const toJSON = () => all().map((c) => (typeof c.data.toJSON === 'function' ? c.data.toJSON() : c.data));

module.exports = { loadAll, get, all, toJSON, commands };
