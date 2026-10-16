'use strict';

const { config } = require('../config');
const log = require('../utils/logger').child({ mod: 'poller' });
const { createLoop, mapLimit } = require('../utils/loop');
const { jitter, backoffMs } = require('../utils/time');
const { QuotaError } = require('../utils/errors');
const platforms = require('../platforms');
const accountsRepo = require('../database/repositories/accounts');
const contentRepo = require('../database/repositories/content');
const { ingest } = require('../notifications/ingest');

const BATCH = 30;
const CONCURRENCY = 3;
const quotaLogged = new Map(); // platform → last log time (keeps the log readable during an outage)

/** Seconds until an account should be looked at again. */
function nextIntervalSeconds(platform, account) {
  const base = config.youtube.pollIntervalSeconds;
  // When push notifications are healthy the poll is only a safety net.
  const relaxed = platform.hasActivePush?.(account) ? Math.max(base * 4, 900) : base;
  return Math.round(jitter(relaxed, 0.15));
}

/** Checks one account: discover recent ids → fetch details of unseen ones → store + enqueue. */
async function pollAccount(platform, account) {
  try {
    const ids = await platform.discover(account);
    const known = new Set((ids.length ? await contentRepo.getMany(account.id, ids) : []).map((r) => r.external_id));
    const unseen = ids.filter((id) => !known.has(id));

    let created = 0;
    if (unseen.length) {
      const items = await platform.fetchItems(unseen);
      for (const item of items) {
        const { enqueued } = await ingest(account, item);
        created += enqueued;
      }
    }
    await accountsRepo.markChecked(account.id, nextIntervalSeconds(platform, account));
    if (unseen.length) log.debug({ account: account.id, name: account.name, unseen: unseen.length, notifications: created }, 'account polled');
  } catch (err) {
    if (err instanceof QuotaError) {
      const last = quotaLogged.get(platform.id) || 0;
      if (Date.now() - last > 30 * 60_000) {
        log.warn({ platform: platform.id, resetAt: err.resetAt }, 'API quota exhausted — new-item detection is paused until it resets');
        quotaLogged.set(platform.id, Date.now());
      }
      const wait = Math.min(1800, Math.max(60, Math.round((err.resetAt.getTime() - Date.now()) / 1000)));
      await accountsRepo.defer(account.id, wait, 'API quota exhausted — retrying later');
      return;
    }
    const retry = Math.round(backoffMs(account.consecutive_failures, 30_000, 3_600_000) / 1000);
    log.warn({ err: err.message, account: account.id, name: account.name, retryInSeconds: retry }, 'polling failed');
    await accountsRepo.markFailed(account.id, err.message, retry);
  }
}

/**
 * Baseline: records an account's current recent items WITHOUT notifying, so that only content
 * published after the channel was added is announced. Called when a channel is first added.
 */
async function baselineAccount(platform, account) {
  const ids = await platform.discover(account);
  const items = await platform.fetchItems(ids);
  for (const item of items) await ingest(account, item, { baseline: true });
  await accountsRepo.markBaselined(account.id);
  await accountsRepo.markChecked(account.id, nextIntervalSeconds(platform, account));
  return items.length;
}

function createPoller() {
  async function tick() {
    for (const platform of platforms.all()) {
      if (platform.isConfigured && !platform.isConfigured()) continue;
      // Drain everything that is due, in batches (large installs may have hundreds of channels).
      for (let i = 0; i < 20; i += 1) {
        const due = await accountsRepo.listDue(platform.id, BATCH);
        if (!due.length) break;
        await mapLimit(due, CONCURRENCY, (account) => pollAccount(platform, account));
        if (due.length < BATCH) break;
      }
    }
  }
  return createLoop({ name: 'poller', intervalMs: 10_000, fn: tick, log, initialDelayMs: 1_000 });
}

module.exports = { createPoller, baselineAccount, pollAccount };
