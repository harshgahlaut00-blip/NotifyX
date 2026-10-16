'use strict';

const { EMOJI_DEFAULTS, EMOJI_KEYS } = require('../config/emojis');

/**
 * Emoji system. Resolution order for every emoji key:
 *   1. per-server override (/settings emoji set …)      — guilds.emoji_overrides
 *   2. bot-wide override from the environment (EMOJI_*)  — config.emojiOverrides
 *   3. built-in Unicode fallback                          — config/emojis.js
 * A custom emoji is only used when the bot can actually see it; otherwise the next level applies,
 * so a deleted / inaccessible custom emoji can never break a notification.
 */

const CUSTOM_RE = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,21})>$/;
const UNICODE_RE =
  /^(?=.*[\p{Extended_Pictographic}\p{Regional_Indicator}])[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200D\uFE0F\u20E3]{1,16}$/u;

/** Parses user input into { type:'custom', id, name, animated, text } | { type:'unicode', text } | null. */
function parseEmoji(input) {
  const v = String(input ?? '').trim();
  if (!v) return null;
  const m = CUSTOM_RE.exec(v);
  if (m) return { type: 'custom', animated: m[1] === 'a', name: m[2], id: m[3], text: v };
  if (UNICODE_RE.test(v)) return { type: 'unicode', text: v };
  return null;
}

/** Can this emoji be rendered by the bot right now? `client` may be null (then customs are assumed visible). */
function isUsable(parsed, client) {
  if (!parsed) return false;
  if (parsed.type === 'unicode') return true;
  if (!client) return true;
  return client.emojis?.cache?.has(parsed.id) ?? false;
}

function createEmojiResolver({ getOverrides = () => ({}), getClient = () => null } = {}) {
  /** Returns a parsed emoji for `key` (never null: the Unicode fallback always exists). */
  function resolve(key, guildRow = null) {
    const client = getClient();
    const candidates = [guildRow?.emoji_overrides?.[key], getOverrides()?.[key]];
    for (const raw of candidates) {
      const parsed = parseEmoji(raw);
      if (parsed && isUsable(parsed, client)) return parsed;
    }
    const fallback = EMOJI_DEFAULTS[key]?.fallback ?? '❔';
    return { type: 'unicode', text: fallback };
  }

  /** Text form for message content, embed text and labels. */
  const text = (key, guildRow) => resolve(key, guildRow).text;

  /** Object form for buttons / select options. */
  function component(key, guildRow) {
    const e = resolve(key, guildRow);
    return e.type === 'custom' ? { id: e.id, name: e.name, animated: e.animated } : { name: e.text };
  }

  return { resolve, text, component };
}

module.exports = { parseEmoji, isUsable, createEmojiResolver, EMOJI_KEYS, EMOJI_DEFAULTS };
