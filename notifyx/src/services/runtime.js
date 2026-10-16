'use strict';

const { config } = require('../config');
const { createEmojiResolver } = require('./emoji');
const accountsRepo = require('../database/repositories/accounts');

/**
 * Shared, process-wide handles that are created during startup (src/index.js).
 * Commands, workers and services read them from here instead of passing them around.
 */
const runtime = {
  client: null, // discord.js Client
  notifier: null, // delivery worker
  poller: null, // account polling worker
  liveTracker: null, // upcoming/live re-check worker
  http: null, // HTTP server (health + platform routes)
  ready: false,
  startedAt: Date.now(),

  emoji: null,

  /** A platform says "something changed for this account" (e.g. WebSub push): poll it right away. */
  async wakeAccount(platformId, externalId) {
    try {
      await accountsRepo.wakeByExternal(platformId, externalId);
      runtime.poller?.trigger();
    } catch {
      /* best effort */
    }
  },
};

runtime.emoji = createEmojiResolver({
  getOverrides: () => config.emojiOverrides,
  getClient: () => runtime.client,
});

module.exports = runtime;
