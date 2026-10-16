'use strict';

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { config, validateConfig } = require('./config');
const log = require('./utils/logger');
const db = require('./database/pool');
const { migrate } = require('./database/migrate');
const commands = require('./commands');
const { bindEvents } = require('./events');
const { syncCommands } = require('./services/deploy');
const { createHttpServer } = require('./services/http');
const runtime = require('./services/runtime');
const platforms = require('./platforms');
const { createNotifier } = require('./notifications/notifier');
const { createPoller } = require('./workers/poller');
const { createLiveTracker } = require('./workers/liveTracker');
const { createMaintenance } = require('./workers/maintenance');

let shuttingDown = false;

async function main() {
  const { errors, warnings } = validateConfig();
  for (const w of warnings) log.warn(w);
  if (errors.length) {
    for (const e of errors) log.fatal(e);
    process.exitCode = 1;
    return;
  }

  log.info({ env: config.env }, 'starting NotifyX');

  await db.waitForDatabase();
  await migrate();
  commands.loadAll();
  log.info({ count: commands.all().length }, 'commands loaded');

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    partials: [Partials.Channel],
    allowedMentions: { parse: [] },
  });
  runtime.client = client;
  bindEvents(client);

  const http = createHttpServer({ isReady: () => runtime.ready });
  if (config.http.enabled) {
    await http.listen();
    runtime.http = http;
  } else {
    log.info('HTTP health server disabled (HTTP_ENABLED=false)');
  }

  await client.login(config.discord.token);
  await syncCommands().catch((err) => log.error({ err }, 'slash command registration failed — existing commands (if any) keep working'));

  for (const platform of platforms.all()) {
    await platform.start?.({ http: config.http.enabled ? http : null, wakeAccount: runtime.wakeAccount });
  }

  runtime.notifier = createNotifier();
  runtime.poller = createPoller();
  runtime.liveTracker = createLiveTracker();
  runtime.maintenance = createMaintenance();
  runtime.notifier.start();
  runtime.poller.start();
  runtime.liveTracker.start();
  runtime.maintenance.start();

  log.info('NotifyX is up and monitoring');
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'shutting down');
  const timeout = setTimeout(() => {
    log.warn('graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 15_000);
  timeout.unref();

  try {
    runtime.ready = false;
    await Promise.allSettled([runtime.notifier?.stop(), runtime.poller?.stop(), runtime.liveTracker?.stop(), runtime.maintenance?.stop()]);
    for (const platform of platforms.all()) await platform.stop?.().catch(() => {});
    await runtime.http?.close();
    if (runtime.client) runtime.client.destroy();
    await db.close();
    log.info('shutdown complete');
  } catch (err) {
    log.error({ err }, 'error during shutdown');
  } finally {
    clearTimeout(timeout);
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled promise rejection'));
process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'uncaught exception');
  shutdown('uncaughtException');
});

module.exports = { main };
