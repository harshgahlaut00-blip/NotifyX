'use strict';

const http = require('http');
const { config } = require('../config');
const log = require('../utils/logger').child({ mod: 'http' });
const db = require('../database/pool');
const historyRepo = require('../database/repositories/history');

/**
 * Minimal health-check + platform-webhook HTTP server. No framework — this bot only ever needs
 * a couple of routes, and dependency-free means Docker's HEALTHCHECK works out of the box.
 */
function createHttpServer({ isReady }) {
  const routes = new Map(); // pathname → (req, res, url) => void

  const route = (pathname, handler) => routes.set(pathname, handler);

  async function handleHealth(req, res) {
    const dbOk = await db.ping();
    const ok = dbOk && isReady();
    const body = JSON.stringify({
      status: ok ? 'ok' : 'starting',
      discord: isReady(),
      database: dbOk,
      queueDepth: dbOk ? Number((await historyRepo.queueDepth()).n) : null,
      uptimeSeconds: Math.round(process.uptime()),
    });
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }).end(body);
  }

  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (url.pathname === '/health' || url.pathname === '/healthz') return handleHealth(req, res);
    if (url.pathname === '/') return res.writeHead(200, { 'content-type': 'text/plain' }).end('NotifyX is running.');
    const handler = routes.get(url.pathname);
    if (handler) return handler(req, res, url);
    res.writeHead(404).end('not found');
    return undefined;
  });

  server.on('error', (err) => log.error({ err }, 'HTTP server error'));

  return {
    route,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.http.port, config.http.host, () => {
          log.info({ port: config.http.port, host: config.http.host }, 'health server listening');
          resolve();
        });
      }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

module.exports = { createHttpServer };
