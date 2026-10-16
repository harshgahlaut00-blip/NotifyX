'use strict';

const { config } = require('../config');
const log = require('../utils/logger').child({ mod: 'live-tracker' });
const { createLoop } = require('../utils/loop');
const { QuotaError } = require('../utils/errors');
const platforms = require('../platforms');
const contentRepo = require('../database/repositories/content');
const accountsRepo = require('../database/repositories/accounts');
const { ingest } = require('../notifications/ingest');

const ABANDON_AFTER_MS = 3 * 24 * 3600 * 1000;

/**
 * Re-checks streams that are "upcoming" or "live" and turns state changes into notifications
 * (upcoming → live). Items that disappeared (deleted / cancelled / private) are closed.
 */
async function trackPlatform(platform) {
  const tracked = await contentRepo.listTrackedDue(platform.id, 200);
  if (!tracked.length) return;

  let items;
  try {
    items = await platform.fetchItems(tracked.map((t) => t.external_id));
  } catch (err) {
    if (err instanceof QuotaError) return; // logged by the poller; retried automatically after the reset
    throw err;
  }
  const byId = new Map(items.map((i) => [i.externalId, i]));
  const accountCache = new Map();

  for (const row of tracked) {
    try {
      const item = byId.get(row.external_id);
      if (!item) {
        await contentRepo.setState(row.id, 'ended');
        continue;
      }
      if (!accountCache.has(row.account_id)) accountCache.set(row.account_id, await accountsRepo.getById(row.account_id));
      const account = accountCache.get(row.account_id);
      if (!account) continue;

      // A schedule that passed days ago without going live is abandoned: stop polling it.
      if (item.state === 'upcoming' && item.scheduledStartAt && Date.now() - item.scheduledStartAt.getTime() > ABANDON_AFTER_MS) {
        await contentRepo.setState(row.id, 'ended');
        continue;
      }
      await ingest(account, item);
    } catch (err) {
      log.warn({ err: err.message, content: row.id }, 'could not refresh tracked item');
    }
  }
}

function createLiveTracker() {
  async function tick() {
    for (const platform of platforms.all()) {
      if (platform.isConfigured && !platform.isConfigured()) continue;
      try {
        await trackPlatform(platform);
      } catch (err) {
        log.warn({ err: err.message, platform: platform.id }, 'live tracking failed');
      }
    }
  }
  return createLoop({ name: 'live-tracker', intervalMs: config.youtube.liveCheckIntervalSeconds * 1000, fn: tick, log, initialDelayMs: 10_000 });
}

module.exports = { createLiveTracker };
