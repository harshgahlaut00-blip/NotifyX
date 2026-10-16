'use strict';

require('dotenv').config(); // never overrides variables already set by the hosting panel

const crypto = require('crypto');
const { EMOJI_KEYS } = require('./emojis');

const env = process.env;

const str = (name, def) => {
  const v = env[name];
  return v === undefined || String(v).trim() === '' ? def : String(v).trim();
};
const int = (name, def, min = -Infinity, max = Infinity) => {
  const raw = str(name);
  if (raw === undefined) return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const bool = (name, def) => {
  const raw = str(name);
  return raw === undefined ? def : ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
};

const publicUrl = (str('PUBLIC_URL', 'https://notifyx-relay.harshgahlaut00.workers.dev') || '').replace(/\/+$/, '');
const token = str('DISCORD_TOKEN');

const emojiOverrides = {};
for (const key of EMOJI_KEYS) {
  const v = str(`EMOJI_${key.toUpperCase()}`);
  if (v) emojiOverrides[key] = v;
}

const config = {
  env: str('NODE_ENV', 'production'),
  discord: {
    token,
    clientId: str('DISCORD_CLIENT_ID'),
    devGuildId: str('DISCORD_DEV_GUILD_ID'),
    commandSync: (str('COMMAND_SYNC', 'auto') || 'auto').toLowerCase(),
  },
  db: {
    type: 'json',
  },
  youtube: {
    apiKey: str('YOUTUBE_API_KEY'),
    pollIntervalSeconds: int('YOUTUBE_POLL_INTERVAL_SECONDS', 30, 30, 86400),
    liveCheckIntervalSeconds: int('YOUTUBE_LIVE_CHECK_INTERVAL_SECONDS', 60, 15, 3600),
    discovery: ['auto', 'rss', 'api'].includes((str('YOUTUBE_DISCOVERY', 'auto') || '').toLowerCase()) ? str('YOUTUBE_DISCOVERY', 'auto').toLowerCase() : 'auto',
    websub: {
      callbackUrl: publicUrl ? `${publicUrl}/websub/youtube` : null,
      // Derived from the bot token when not provided, so it is stable across restarts.
      secret:
        str('WEBSUB_SECRET') ||
        (token ? crypto.createHmac('sha256', token).update('notifyx-websub').digest('hex') : null),
    },
  },
  notifications: {
    // WebSub pushes trigger the notifier immediately; these are safety-net loop timings.
    notifierIntervalMs: int('NOTIFIER_INTERVAL_MS', 10000, 1000, 60000),
    notifierInitialDelayMs: int('NOTIFIER_INITIAL_DELAY_MS', 500, 0, 10000),
    notifierConcurrency: int('NOTIFIER_CONCURRENCY', 8, 1, 20),
    notifierBatch: int('NOTIFIER_BATCH', 25, 1, 100),
  },
  limits: {
    maxChannelsPerGuild: int('MAX_CHANNELS_PER_GUILD', 25, 1, 200),
    maxNotificationAgeHours: int('MAX_NOTIFICATION_AGE_HOURS', 48, 1, 24 * 30),
    historyRetentionDays: int('HISTORY_RETENTION_DAYS', 90, 1, 3650),
    leftGuildRetentionDays: int('LEFT_GUILD_RETENTION_DAYS', 30, 1, 3650),
    deliveryMaxAttempts: 6,
  },
  http: {
    enabled: bool('HTTP_ENABLED', true),
    port: int('PORT', int('SERVER_PORT', 3000, 1, 65535), 1, 65535),
    host: str('HTTP_HOST', '0.0.0.0'),
  },
  log: {
    level: (str('LOG_LEVEL', 'info') || 'info').toLowerCase(),
    pretty: bool('LOG_PRETTY', false),
    file: str('LOG_FILE'),
  },
  emojiOverrides,
};

/** Returns { errors, warnings } — errors stop the bot from starting. */
function validateConfig() {
  const errors = [];
  const warnings = [];
  if (!config.discord.token) errors.push('DISCORD_TOKEN is missing. Set it in your .env file or hosting-panel variables.');
  if (!config.youtube.apiKey) {
    warnings.push('YOUTUBE_API_KEY is not set — /youtube add and monitoring are disabled until you add one.');
  }
  if (!['auto', 'force', 'off'].includes(config.discord.commandSync)) {
    warnings.push(`COMMAND_SYNC="${config.discord.commandSync}" is invalid; using "auto".`);
    config.discord.commandSync = 'auto';
  }
  if (config.youtube.websub.callbackUrl && !/^https:\/\//i.test(config.youtube.websub.callbackUrl)) {
    warnings.push("PUBLIC_URL should be https:// — YouTube's hub may refuse plain-http callbacks.");
  }
  return { errors, warnings };
}

module.exports = { config, validateConfig };
