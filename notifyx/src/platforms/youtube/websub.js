'use strict';

const crypto = require('crypto');
const { parsePushEntries, CHANNEL_ID_RE } = require('./normalize');

const HUB = 'https://pubsubhubbub.appspot.com/subscribe';
const TOPIC_RE = /^https:\/\/www\.youtube\.com\/xml\/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})$/;
const LEASE_SECONDS = 432_000; // 5 days requested (the hub may grant a different value)
const MAX_BODY = 512 * 1024;

const topicFor = (channelId) => `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function validSignature(secret, body, header) {
  const m = /^sha1=([0-9a-f]{40})$/i.exec(String(header || ''));
  if (!m) return false;
  const expected = crypto.createHmac('sha1', secret).update(body).digest();
  const given = Buffer.from(m[1], 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/**
 * Optional YouTube push notifications (WebSub / PubSubHubbub).
 * A push only *wakes the poller* for that channel — the YouTube API stays the source of truth,
 * so a forged or duplicated push can never create a notification by itself.
 */
/** `onPush(entries)` receives [{ channelId, videoId, title, publishedAt, updatedAt }] — never empty. */
function createWebSub({ callbackUrl, secret, accounts, onPush, log, fetchImpl = globalThis.fetch }) {
  const enabled = Boolean(callbackUrl && secret);

  async function hubRequest(mode, channelId) {
    const body = new URLSearchParams({
      'hub.callback': callbackUrl,
      'hub.topic': topicFor(channelId),
      'hub.verify': 'async',
      'hub.mode': mode,
      'hub.secret': secret,
      'hub.lease_seconds': String(LEASE_SECONDS),
    });
    const res = await fetchImpl(HUB, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status !== 202 && res.status !== 204 && res.status !== 200) {
      throw new Error(`WebSub hub answered ${res.status}`);
    }
  }

  const subscribe = (account) => (enabled && CHANNEL_ID_RE.test(account.external_id) ? hubRequest('subscribe', account.external_id) : Promise.resolve());
  const unsubscribe = (account) => (enabled && CHANNEL_ID_RE.test(account.external_id) ? hubRequest('unsubscribe', account.external_id) : Promise.resolve());

  /** HTTP handler for GET (hub verification) and POST (content push). */
  async function handle(req, res, url) {
    if (!enabled) {
      res.writeHead(404).end();
      return;
    }
    try {
      if (req.method === 'GET') {
        const mode = url.searchParams.get('hub.mode');
        const topic = url.searchParams.get('hub.topic') || '';
        const challenge = url.searchParams.get('hub.challenge');
        const lease = Number(url.searchParams.get('hub.lease_seconds'));
        const m = TOPIC_RE.exec(topic);
        if (!m || !challenge || !['subscribe', 'unsubscribe'].includes(mode)) {
          res.writeHead(404).end();
          return;
        }
        const account = await accounts.getByExternal('youtube', m[1]);
        if (mode === 'subscribe') {
          if (!account) {
            res.writeHead(404).end();
            return;
          }
          const seconds = Number.isFinite(lease) && lease > 0 ? lease : LEASE_SECONDS;
          await accounts.setPushExpiry(account.id, new Date(Date.now() + seconds * 1000));
          log.info({ channelId: m[1], leaseSeconds: seconds }, 'WebSub subscription verified');
        } else if (account) {
          await accounts.setPushExpiry(account.id, null);
        }
        res.writeHead(200, { 'content-type': 'text/plain' }).end(challenge);
        return;
      }

      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!validSignature(secret, body, req.headers['x-hub-signature'])) {
          log.warn('rejected WebSub push with an invalid signature');
          res.writeHead(403).end();
          return;
        }
        // Acknowledge the hub immediately (it retries on anything else) — processing continues after.
        res.writeHead(204).end();
        const entries = parsePushEntries(body.toString('utf8'));
        if (entries.length) onPush(entries);
        return;
      }
      res.writeHead(405, { allow: 'GET, POST' }).end();
    } catch (err) {
      log.warn({ err }, 'WebSub request failed');
      if (!res.headersSent) res.writeHead(400).end();
    }
  }

  return { enabled, subscribe, unsubscribe, handle, topicFor };
}

module.exports = { createWebSub, validSignature, topicFor, TOPIC_RE, LEASE_SECONDS };
