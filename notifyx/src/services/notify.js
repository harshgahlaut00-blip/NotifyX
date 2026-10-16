'use strict';

const { UserError } = require('../utils/errors');
const platforms = require('../platforms');
const runtime = require('./runtime');
const guildsRepo = require('../database/repositories/guilds');
const rulesRepo = require('../database/repositories/rules');
const contentRepo = require('../database/repositories/content');
const { buildNotification, sampleContent } = require('../notifications/builder');
const { assertCanPost } = require('./subscriptions');

const KIND_FOR_EVENT = { video: 'video', live: 'stream', upcoming: 'stream' };

/** Newest stored content of the right kind for an event, else a synthetic sample. */
async function contentFor(sub, eventType) {
  const recent = await contentRepo.latestForAccount(sub.account_id, 30);
  const real = recent.find((c) => c.kind === KIND_FOR_EVENT[eventType]);
  return { content: real || sampleContent(eventType, { avatar_url: sub.avatar_url }), isSample: !real };
}

/** The exact payload a notification would have (never pings anyone). */
async function buildPreview(sub, eventType, { testBanner = null } = {}) {
  const platform = platforms.get(sub.platform);
  const [rule, guildRow] = await Promise.all([rulesRepo.getBySubEvent(sub.id, eventType), guildsRepo.get(sub.guild_id)]);
  if (!rule || !platform) throw new UserError('That notification type does not exist for this channel.');
  const { content, isSample } = await contentFor(sub, eventType);
  const account = { name: sub.account_name, url: sub.account_url, avatar_url: sub.avatar_url, handle: sub.handle };
  const payload = buildNotification({ platform, eventType, rule, guild: guildRow, account, content, emoji: runtime.emoji, preview: true, testBanner });
  return { payload, rule, guildRow, isSample, platform, account, content };
}

/** Sends a clearly-labelled test notification to the real destination channel. */
async function sendTest(sub, eventType, userId) {
  const { rule, guildRow, platform, account, content } = await buildPreview(sub, eventType);
  const channelId = rule.channel_id || guildRow.default_channel_id;
  if (!channelId) throw new UserError('No notification channel is set for this event. Use `/setup` or pick one in `/youtube config`.');
  const channel = runtime.client.channels.cache.get(channelId) || (await runtime.client.channels.fetch(channelId).catch(() => null));
  if (!channel || channel.guildId !== sub.guild_id) throw new UserError('The notification channel no longer exists. Pick a new one in `/youtube config`.');
  const roleId = rule.role_id || guildRow.default_role_id;
  await assertCanPost(channel, roleId);

  const testBanner = `🧪 **Test notification** requested by <@${userId}> — this is what a real one looks like.`;
  const payload = buildNotification({ platform, eventType, rule, guild: guildRow, account, content, emoji: runtime.emoji, preview: true, testBanner });
  const message = await channel.send(payload);
  return { channel, message };
}

module.exports = { buildPreview, sendTest };
