'use strict';

const { config } = require('../config');
const log = require('../utils/logger').child({ mod: 'notifier' });
const { createLoop, mapLimit } = require('../utils/loop');
const { backoffMs } = require('../utils/time');
const platforms = require('../platforms');
const runtime = require('../services/runtime');
const { checkPostingPermissions } = require('../services/permissions');
const historyRepo = require('../database/repositories/history');
const contentRepo = require('../database/repositories/content');
const subscriptionsRepo = require('../database/repositories/subscriptions');
const rulesRepo = require('../database/repositories/rules');
const guildsRepo = require('../database/repositories/guilds');
const { buildNotification } = require('./builder');

const BATCH = config.notifications.notifierBatch;
const CONCURRENCY = config.notifications.notifierConcurrency;

// Discord error codes we react to specifically.
const UNKNOWN_CHANNEL = 10003;
const MISSING_ACCESS = 50001;
const MISSING_PERMISSIONS = 50013;

/** Thrown inside deliver() to end a delivery with a specific outcome. */
class Outcome extends Error {
  constructor(kind, message, retryInSeconds = null) {
    super(message);
    this.kind = kind; // 'skip' | 'fail'
    this.retryInSeconds = retryInSeconds;
  }
}

const skip = (why) => new Outcome('skip', why);
const fail = (why, retryInSeconds = null) => new Outcome('fail', why, retryInSeconds);

// Permission problems are usually fixed by a human: retry rarely (2m, 10m, 30m, 2h, 6h).
const PERMISSION_RETRY = [120, 600, 1800, 7200, 21600];
const permissionRetry = (attempts) => PERMISSION_RETRY[attempts - 1] ?? null;
const transientRetry = (attempts) => Math.round(backoffMs(attempts, 10_000, 15 * 60_000) / 1000);

async function resolveChannel(client, guildId, channelId) {
  let channel = client.channels.cache.get(channelId);
  if (!channel) {
    try {
      channel = await client.channels.fetch(channelId);
    } catch (err) {
      if (err.code === UNKNOWN_CHANNEL) {
        await Promise.all([rulesRepo.clearChannelRefs(guildId, channelId), guildsRepo.clearChannelRefs(guildId, channelId)]);
        throw fail('The notification channel no longer exists — falling back to the server default.', 5);
      }
      if (err.code === MISSING_ACCESS) throw fail('I cannot see the notification channel (Missing Access).', null);
      throw err;
    }
  }
  if (!channel || !channel.guildId || channel.guildId !== guildId || typeof channel.send !== 'function') {
    throw fail('The configured destination is not a valid text channel of this server.');
  }
  return channel;
}

/** Delivers one claimed history row. Throws Outcome for expected results; anything else is a transient error. */
async function deliver(row, attemptsMade) {
  const client = runtime.client;
  const [content, sub, rule, guild] = await Promise.all([
    contentRepo.getById(row.content_id),
    subscriptionsRepo.get(row.subscription_id),
    rulesRepo.getBySubEvent(row.subscription_id, row.event_type),
    guildsRepo.get(row.guild_id),
  ]);

  if (!content || !sub || !rule || !guild) throw skip('Subscription or content no longer exists.');
  if (guild.left_at) throw skip('The bot left this server.');
  if (!guild.notifications_enabled) throw skip('Notifications are paused for this server.');
  if (!sub.enabled || !rule.enabled) throw skip('This notification was disabled.');

  const ageMs = Date.now() - new Date(row.created_at).getTime();
  if (ageMs > config.limits.maxNotificationAgeHours * 3600 * 1000) throw skip('Expired before it could be delivered.');
  if (row.event_type === 'upcoming' && content.state !== 'upcoming') throw skip('Superseded — the stream already started or ended.');
  if (row.event_type === 'live' && content.state !== 'live') throw skip('The stream had already ended.');

  const platform = platforms.get(sub.platform);
  if (!platform) throw skip(`Platform "${sub.platform}" is not available.`);

  const channelId = rule.channel_id || guild.default_channel_id;
  if (!channelId) {
    throw fail('No notification channel is set. Use /setup or /youtube config, then run /notifications retry.');
  }
  if (!client?.guilds.cache.has(row.guild_id)) throw skip('The bot is not in this server.');

  const channel = await resolveChannel(client, row.guild_id, channelId);
  const roleId = rule.role_id || guild.default_role_id;
  const { missing } = await checkPostingPermissions(channel, { roleId });
  if (missing.length) throw fail(`Missing permissions in #${channel.name}: ${missing.join(', ')}.`, permissionRetry(attemptsMade));

  const account = { name: sub.account_name, url: sub.account_url, avatar_url: sub.avatar_url, handle: sub.handle };
  const payload = buildNotification({ platform, eventType: row.event_type, rule, guild, account, content, emoji: runtime.emoji });

  let message;
  try {
    message = await channel.send(payload);
  } catch (err) {
    if (err.code === MISSING_PERMISSIONS || err.code === MISSING_ACCESS) {
      throw fail(`Discord refused the message in #${channel.name} (${err.code === MISSING_ACCESS ? 'Missing Access' : 'Missing Permissions'}).`, permissionRetry(attemptsMade));
    }
    if (err.code === UNKNOWN_CHANNEL) {
      await Promise.all([rulesRepo.clearChannelRefs(row.guild_id, channelId), guildsRepo.clearChannelRefs(row.guild_id, channelId)]);
      throw fail('The notification channel was deleted — falling back to the server default.', 5);
    }
    if (err.code === 50035) throw fail(`Discord rejected the message content: ${String(err.message).slice(0, 200)}`);
    throw err;
  }
  await historyRepo.markSent(row.id, channel.id, message.id);
  log.info({ guild: row.guild_id, event: row.event_type, history: row.id, channel: channel.id }, 'notification sent');
}

async function handleRow(row) {
  const attempts = row.attempts; // already incremented by claim()
  const exhausted = attempts >= config.limits.deliveryMaxAttempts;
  try {
    await deliver(row, attempts);
  } catch (err) {
    if (err instanceof Outcome) {
      if (err.kind === 'skip') return historyRepo.markSkipped(row.id, err.message);
      return historyRepo.markFailed(row.id, err.message, exhausted ? null : err.retryInSeconds);
    }
    log.warn({ err, history: row.id, attempts }, 'delivery attempt failed');
    return historyRepo.markFailed(row.id, `Unexpected error: ${err.message}`, exhausted ? null : transientRetry(attempts));
  }
  return undefined;
}

function createNotifier() {
  async function tick() {
    if (!runtime.ready) return;
    for (let i = 0; i < 20; i += 1) {
      const rows = await historyRepo.claim(BATCH);
      if (!rows.length) return;
      await mapLimit(rows, CONCURRENCY, (row) =>
        handleRow(row).catch((err) => log.error({ err, history: row.id }, 'could not record delivery result')),
      );
      if (rows.length < BATCH) return;
    }
  }

  return createLoop({
    name: 'notifier',
    intervalMs: config.notifications.notifierIntervalMs,
    fn: tick,
    log,
    initialDelayMs: config.notifications.notifierInitialDelayMs,
  });
}

module.exports = { createNotifier };
