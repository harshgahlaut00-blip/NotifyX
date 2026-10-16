'use strict';

const db = require('../database/pool');
const { config } = require('../config');
const log = require('../utils/logger').child({ mod: 'subscriptions' });
const { UserError } = require('../utils/errors');
const { slugifyChannelName } = require('../utils/text');
const { ChannelType } = require('../utils/discord');
const platforms = require('../platforms');
const guildsRepo = require('../database/repositories/guilds');
const accountsRepo = require('../database/repositories/accounts');
const subscriptionsRepo = require('../database/repositories/subscriptions');
const rulesRepo = require('../database/repositories/rules');
const { baselineAccount } = require('../workers/poller');
const { checkPostingPermissions, canManageChannels } = require('./permissions');

/** Creates a text channel for one followed account inside a category. */
async function createChannelInCategory(guild, category, account, reason) {
  if (!(await canManageChannels(guild))) {
    throw new UserError('I need the **Manage Channels** permission to create a channel in a category. Grant it, or pick an existing channel instead.');
  }
  if (category.type !== ChannelType.GuildCategory) throw new UserError('That is not a category.');
  const channel = await guild.channels.create({
    name: slugifyChannelName(account.name),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `New videos and streams from ${account.name}`.slice(0, 1024),
    reason: reason || 'NotifyX: dedicated notification channel',
  });
  return channel;
}

async function assertCanPost(channel, roleId) {
  const { missing, warnings } = await checkPostingPermissions(channel, { roleId });
  if (missing.length) {
    throw new UserError(`I cannot post in <#${channel.id}>. Missing permissions: **${missing.join('**, **')}**.\nFix the channel/category permissions for my role and try again.`);
  }
  return warnings;
}

/**
 * Follows an account in a guild.
 *   opts = { channel?: GuildChannel, category?: CategoryChannel, role?: Role, events?: { video, live, upcoming } }
 * Returns { subscription, account, destination, createdChannel, warnings, baselinedItems }.
 */
async function addSubscription({ platformId, input, guild, userId, opts = {} }) {
  const platform = platforms.get(platformId);
  if (!platform) throw new UserError('That platform is not supported.');
  if (!platform.isConfigured()) throw new UserError('Monitoring for this platform is not configured — the bot owner must add the API key.');

  const guildRow = await guildsRepo.ensure(guild.id, guild.name);
  const count = await subscriptionsRepo.countByGuild(guild.id);
  if (count >= config.limits.maxChannelsPerGuild) {
    throw new UserError(`This server already follows the maximum of **${config.limits.maxChannelsPerGuild}** channels. Remove one first.`);
  }

  const resolved = await platform.resolveAccount(input);
  const account = await accountsRepo.upsert(resolved);
  if (await subscriptionsRepo.findByGuildAccount(guild.id, account.id)) {
    throw new UserError(`**${account.name}** is already followed in this server. Use \`/youtube config\` to change it.`);
  }

  // ── decide where notifications go (precedence: explicit channel > explicit category > default category > default channel)
  const roleId = opts.role?.id || guildRow.default_role_id || null;
  let destination = opts.channel || null;
  let category = opts.category || null;
  if (!destination && !category && guildRow.default_category_id) category = guild.channels.cache.get(guildRow.default_category_id) || null;
  if (!destination && !category && !guildRow.default_channel_id) {
    throw new UserError('No notification channel is set. Run `/setup` first, or pass `discord_channel:` (or `category:`) to this command.');
  }

  const warnings = [];
  if (destination) warnings.push(...(await assertCanPost(destination, roleId)));
  else if (!category) {
    const def = guild.channels.cache.get(guildRow.default_channel_id);
    if (def) warnings.push(...(await assertCanPost(def, roleId)));
  } else if (!(await canManageChannels(guild))) {
    throw new UserError('I need the **Manage Channels** permission to create a channel in a category. Grant it, or pass `discord_channel:` instead.');
  }

  // ── baseline: remember what already exists so old videos are never announced
  let baselinedItems = null;
  if (!account.baselined_at) {
    try {
      baselinedItems = await baselineAccount(platform, account);
    } catch (err) {
      log.warn({ err: err.message, account: account.id }, 'baseline failed');
      throw err instanceof UserError ? err : new UserError('I could not read that channel’s recent uploads right now. Please try again in a minute.');
    }
  }

  let createdChannel = false;
  if (!destination && category) {
    destination = await createChannelInCategory(guild, category, account, `NotifyX: /youtube add by ${userId}`);
    createdChannel = true;
    warnings.push(...(await assertCanPost(destination, roleId)));
  }

  const enabled = { video: true, live: true, upcoming: true, ...(opts.events || {}) };
  let subscription;
  try {
    subscription = await db.tx(async (conn) => {
      const sub = await subscriptionsRepo.create({ guildId: guild.id, accountId: account.id, createdBy: userId }, conn);
      if (!sub) throw new UserError('That channel is already followed in this server.');
      await rulesRepo.createMany(
        sub.id,
        platform.eventOrder.map((event_type) => ({
          event_type,
          enabled: enabled[event_type] !== false,
          channel_id: destination?.id ?? null,
          category_id: category?.id ?? null,
          role_id: opts.role?.id ?? null,
        })),
        conn,
      );
      return sub;
    });
  } catch (err) {
    if (createdChannel) await destination.delete('NotifyX: rolling back failed /youtube add').catch(() => {});
    throw err;
  }

  platform.subscribePush?.(account).catch((err) => log.warn({ err: err.message }, 'push subscription failed'));
  return { subscription, account: await accountsRepo.getById(account.id), destination, createdChannel, warnings, baselinedItems, guildRow };
}

async function removeSubscription(sub) {
  await subscriptionsRepo.remove(sub.id);
  const orphan = await accountsRepo.deleteIfOrphan(sub.account_id);
  if (orphan) {
    const platform = platforms.get(orphan.platform);
    platform?.unsubscribePush?.(orphan).catch(() => {});
  }
}

/** Resolves the `channel:` command argument (autocomplete id, or typed text) to a subscription of this guild. */
async function resolveSubscription(guildId, value) {
  const v = String(value || '').trim();
  if (/^\d{1,15}$/.test(v)) {
    const byId = await subscriptionsRepo.getForGuild(Number(v), guildId);
    if (byId) return byId;
  }
  const [match] = await subscriptionsRepo.search(guildId, v, 1);
  if (!match) throw new UserError('I could not find that channel in this server’s list. Use the suggestions while typing, or check `/youtube list`.');
  return match;
}

/** Applies a Discord channel/category choice to a rule (used by the config panel). Returns { patch, warnings, created }. */
async function applyDestination({ guild, picked, account, roleId, reason }) {
  if (picked.type === ChannelType.GuildCategory) {
    const channel = await createChannelInCategory(guild, picked, account, reason);
    const warnings = await assertCanPost(channel, roleId);
    return { patch: { channel_id: channel.id, category_id: picked.id }, warnings, created: channel };
  }
  const warnings = await assertCanPost(picked, roleId);
  return { patch: { channel_id: picked.id }, warnings, created: null };
}

module.exports = { addSubscription, removeSubscription, resolveSubscription, applyDestination, createChannelInCategory, assertCanPost };
