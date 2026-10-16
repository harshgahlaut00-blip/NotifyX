'use strict';

/**
 * Every emoji NotifyX renders. `fallback` is a Unicode emoji that always exists,
 * so nothing ever depends on a custom emoji being present.
 */
const EMOJI_DEFAULTS = {
  video: { fallback: '🎬', label: 'New video' },
  live: { fallback: '🔴', label: 'Livestream' },
  upcoming: { fallback: '⏰', label: 'Upcoming stream' },
  watch: { fallback: '▶️', label: 'Watch button' },
  channel: { fallback: '📺', label: 'Channel button' },
  calendar: { fallback: '📅', label: 'Schedule' },
  success: { fallback: '✅', label: 'Enabled / success' },
  error: { fallback: '❌', label: 'Disabled / error' },
  warning: { fallback: '⚠️', label: 'Warning' },
  info: { fallback: 'ℹ️', label: 'Info' },
  settings: { fallback: '⚙️', label: 'Settings' },
};

const EMOJI_KEYS = Object.keys(EMOJI_DEFAULTS);

module.exports = { EMOJI_DEFAULTS, EMOJI_KEYS };
