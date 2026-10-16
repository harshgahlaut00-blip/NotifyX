'use strict';

const { config } = require('../config');
const log = require('../utils/logger').child({ mod: 'maintenance' });
const { createLoop } = require('../utils/loop');
const platforms = require('../platforms');
const guildsRepo = require('../database/repositories/guilds');
const accountsRepo = require('../database/repositories/accounts');
const contentRepo = require('../database/repositories/content');
const historyRepo = require('../database/repositories/history');

/** Hourly housekeeping: retention, orphans, platform lease renewals. */
function createMaintenance() {
  async function tick() {
    const l = config.limits;
    const results = await Promise.allSettled([
      guildsRepo.purgeLeft(l.leftGuildRetentionDays),
      historyRepo.purgeOld(l.historyRetentionDays),
      contentRepo.purgeOld(l.historyRetentionDays),
      accountsRepo.purgeOrphans(),
    ]);
    for (const r of results) if (r.status === 'rejected') log.warn({ err: r.reason?.message }, 'cleanup step failed');

    for (const platform of platforms.all()) {
      try {
        await platform.maintain?.();
      } catch (err) {
        log.warn({ err: err.message, platform: platform.id }, 'platform maintenance failed');
      }
    }
    log.debug('maintenance finished');
  }
  return createLoop({ name: 'maintenance', intervalMs: 3600_000, fn: tick, log, initialDelayMs: 60_000 });
}

module.exports = { createMaintenance };
