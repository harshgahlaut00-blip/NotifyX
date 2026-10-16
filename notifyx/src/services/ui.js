'use strict';

const { EPHEMERAL } = require('../utils/discord');
const runtime = require('./runtime');

const COLORS = { brand: 0x5b8cff, success: 0x22c55e, error: 0xef4444, warning: 0xf59e0b, neutral: 0x2b2d31 };
const KIND_EMOJI = { success: 'success', error: 'error', warning: 'warning', info: 'info' };
const KIND_COLOR = { success: COLORS.success, error: COLORS.error, warning: COLORS.warning, info: COLORS.brand };

/** A small one-line status embed: notice('success', 'Saved.') */
function notice(kind, text, guildRow = null) {
  const icon = runtime.emoji.text(KIND_EMOJI[kind] || 'info', guildRow);
  return { embeds: [{ color: KIND_COLOR[kind] || COLORS.brand, description: `${icon} ${text}` }] };
}

const ephemeralNotice = (kind, text, guildRow) => ({ ...notice(kind, text, guildRow), flags: EPHEMERAL });

const channelMention = (id) => (id ? `<#${id}>` : null);
const roleMention = (id, guildId) => (id ? (id === guildId ? '@everyone' : `<@&${id}>`) : null);

/** "on" / "off" pill using the configurable success/error emoji. */
const onOff = (value, guildRow) => `${runtime.emoji.text(value ? 'success' : 'error', guildRow)} ${value ? 'Enabled' : 'Disabled'}`;

module.exports = { COLORS, notice, ephemeralNotice, channelMention, roleMention, onOff };
