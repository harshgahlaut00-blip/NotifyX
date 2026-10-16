'use strict';

const db = require('../database/pool');
const { config } = require('../config');
const contentRepo = require('../database/repositories/content');
const subscriptionsRepo = require('../database/repositories/subscriptions');
const historyRepo = require('../database/repositories/history');
const runtime = require('../services/runtime');
const { detectEvents } = require('./detect');

/**
 * Stores a freshly fetched item and enqueues the notifications it triggers — in ONE transaction,
 * so a crash can never leave an item "seen" but its notifications lost.
 *
 * baseline=true only records the item (used when a channel is first added, so existing videos
 * are never announced).
 */
async function ingest(account, item, { baseline = false } = {}) {
  const maxAgeMs = config.limits.maxNotificationAgeHours * 3600 * 1000;
  const result = await db.tx(async (conn) => {
    const [prev] = await contentRepo.getMany(account.id, [item.externalId], conn);
    const row = await contentRepo.upsert(account.id, item, conn);
    if (baseline) return { row, events: [], enqueued: 0 };

    const events = detectEvents(prev || null, item, { maxAgeMs });
    let enqueued = 0;
    for (const eventType of events) {
      const targets = await subscriptionsRepo.listDeliverable(account.id, eventType, conn);
      for (const t of targets) {
        const created = await historyRepo.enqueue({ guildId: t.guild_id, subscriptionId: t.subscription_id, contentId: row.id, eventType }, conn);
        if (created) enqueued += 1;
      }
    }
    return { row, events, enqueued };
  });
  if (result.enqueued > 0) runtime.notifier?.trigger();
  return result;
}

module.exports = { ingest };
