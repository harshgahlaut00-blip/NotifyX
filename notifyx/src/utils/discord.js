'use strict';

/**
 * Small, dependency-free helpers around Discord's raw API shapes.
 *
 * NotifyX builds messages, buttons, menus and modals as plain API JSON. discord.js accepts
 * that everywhere, and it keeps message building testable without a Discord connection.
 */

const ComponentType = { ActionRow: 1, Button: 2, StringSelect: 3, TextInput: 4, UserSelect: 5, RoleSelect: 6, MentionableSelect: 7, ChannelSelect: 8 };
const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5 };
const TextInputStyle = { Short: 1, Paragraph: 2 };
const OptionType = { Subcommand: 1, SubcommandGroup: 2, String: 3, Integer: 4, Boolean: 5, User: 6, Channel: 7, Role: 8, Mentionable: 9, Number: 10 };
const ChannelType = {
  GuildText: 0,
  GuildVoice: 2,
  GuildCategory: 4,
  GuildAnnouncement: 5,
  AnnouncementThread: 10,
  PublicThread: 11,
  PrivateThread: 12,
};
const EPHEMERAL = 64; // MessageFlags.Ephemeral

/** Channel types a notification can be posted in. */
const TEXT_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

/** Discord's hard limits for the pieces we build. */
const LIMITS = {
  content: 2000,
  embedTitle: 256,
  embedDescription: 4096,
  embedFooter: 2048,
  embedAuthor: 256,
  fieldName: 256,
  fieldValue: 1024,
  buttonLabel: 80,
  embedTotal: 6000,
};

const row = (...components) => ({ type: ComponentType.ActionRow, components: components.flat().filter(Boolean) });

/** Normalises an emoji ({id,name,animated} | unicode string | undefined) for a component. */
function componentEmoji(emoji) {
  if (!emoji) return undefined;
  if (typeof emoji === 'string') return { name: emoji };
  return emoji;
}

const button = ({ customId, label, style = ButtonStyle.Secondary, emoji, disabled = false, url }) => {
  const b = { type: ComponentType.Button, style: url ? ButtonStyle.Link : style };
  if (label) b.label = String(label).slice(0, LIMITS.buttonLabel);
  const e = componentEmoji(emoji);
  if (e) b.emoji = e;
  if (url) b.url = url;
  else b.custom_id = customId;
  if (disabled) b.disabled = true;
  return b;
};

/** Ephemeral message payload helper. */
const ephemeral = (payload = {}) => ({ ...payload, flags: EPHEMERAL });

/** custom_id helpers: "nx:<namespace>:<part>:<part>…" (max 100 chars in Discord). */
const makeId = (namespace, ...parts) => ['nx', namespace, ...parts].join(':').slice(0, 100);
const parseId = (customId) => {
  const [prefix, namespace, ...args] = String(customId).split(':');
  return prefix === 'nx' && namespace ? { namespace, args } : null;
};

module.exports = {
  ComponentType,
  ButtonStyle,
  TextInputStyle,
  OptionType,
  ChannelType,
  EPHEMERAL,
  TEXT_CHANNEL_TYPES,
  LIMITS,
  row,
  button,
  componentEmoji,
  ephemeral,
  makeId,
  parseId,
};
