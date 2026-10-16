'use strict';

const { config } = require('../../config');
const log = require('../../utils/logger').child({ mod: 'youtube' });
const accountsRepo = require('../../database/repositories/accounts');
const botState = require('../../database/repositories/botState');
const { UserError, ApiError, QuotaError } = require('../../utils/errors');
const { YouTubeApi } = require('./api');
const { createWebSub } = require('./websub');
const { parseChannelInput, normalizeVideo, parseFeed, uploadsPlaylistId } = require('./normalize');
const { ingest } = require('../../notifications/ingest');

const QUOTA_KEY = 'quota_blocked_until:youtube';

/**
 * Event types of this platform. `emoji` is a key of config/emojis.js. Templates use the
 * {placeholders} documented in notifications/placeholders.js.
 */
const EVENT_TYPES = {
  video: {
    id: 'video',
    label: 'New video',
    emoji: 'video',
    color: 0xff0033,
    watchLabel: 'Watch Video',
    message: '{role} {emoji} **{channel}** just uploaded a new video!',
    title: '{title}',
    description: '{description}',
  },
  live: {
    id: 'live',
    label: 'Livestream',
    emoji: 'live',
    color: 0xff2d55,
    watchLabel: 'Watch Live',
    message: '{role} {emoji} **{channel}** is live now!',
    title: '{title}',
    description: '{description}',
  },
  upcoming: {
    id: 'upcoming',
    label: 'Upcoming stream',
    emoji: 'upcoming',
    color: 0xf59e0b,
    watchLabel: 'View Stream',
    message: '{role} {emoji} **{channel}** scheduled a stream — starting {scheduled_relative}!',
    title: '{title}',
    description: '{description}',
  },
};

const api = new YouTubeApi({
  apiKey: config.youtube.apiKey,
  log,
  onQuotaExhausted: (resetAt) => {
    log.error({ resetAt }, 'YouTube API quota exhausted — API calls paused until it resets');
    botState.set(QUOTA_KEY, resetAt.toISOString()).catch(() => {});
  },
});

let websub = null;
let started = false;

const channelUrl = (externalId, handle) => (handle ? `https://www.youtube.com/${handle.startsWith('@') ? handle : `@${handle}`}` : `https://www.youtube.com/channel/${externalId}`);

function accountFromChannel(item) {
  const sn = item.snippet || {};
  const handle = sn.customUrl && sn.customUrl.startsWith('@') ? sn.customUrl : null;
  const thumbs = sn.thumbnails || {};
  return {
    platform: 'youtube',
    externalId: item.id,
    name: sn.title || item.id,
    handle,
    url: channelUrl(item.id, handle),
    avatarUrl: (thumbs.medium || thumbs.high || thumbs.default || {}).url || null,
    metadata: { uploadsPlaylistId: uploadsPlaylistId(item.id) },
  };
}

/**
 * The fast path: a WebSub push already tells us exactly which video changed, so instead of waiting
 * for the next poll to re-scan the whole channel, we fetch just that video's details and enqueue
 * its notification immediately — this is what makes delivery near-instant (typically single-digit
 * seconds after upload / going live) instead of bounded by YOUTUBE_POLL_INTERVAL_SECONDS.
 * Falls back to `wakeAccount` (a normal, slightly-delayed poll) if anything here fails.
 */
async function handlePushEntries(entries, wakeAccount) {
  const byChannel = new Map();
  for (const e of entries) {
    if (!byChannel.has(e.channelId)) byChannel.set(e.channelId, []);
    byChannel.get(e.channelId).push(e.videoId);
  }

  await Promise.all(
    [...byChannel.entries()].map(async ([channelId, videoIds]) => {
      const account = await accountsRepo.getByExternal('youtube', channelId).catch(() => null);
      if (!account) return; // not followed anywhere — nothing to do
      try {
        const items = await platform.fetchItems(videoIds);
        for (const item of items) await ingest(account, item);
        // Push is doing the real-time work here; relax the routine poll for this account.
        await accountsRepo.markChecked(account.id, Math.max(config.youtube.pollIntervalSeconds * 4, 900));
        log.debug({ account: account.id, videos: videoIds.length }, 'processed push instantly');
      } catch (err) {
        log.warn({ err: err.message, account: account.id }, 'instant push processing failed — falling back to a normal poll');
        wakeAccount('youtube', channelId);
      }
    }),
  );
}

const platform = {
  id: 'youtube',
  label: 'YouTube',
  brandColor: 0xff0000,
  eventTypes: EVENT_TYPES,
  eventOrder: ['video', 'live', 'upcoming'],
  inputHelp: 'a channel URL, an @handle, a channel ID (UC…) or any video URL of the channel',

  get api() {
    return api;
  },

  isConfigured: () => api.configured,

  status() {
    return {
      configured: api.configured,
      quotaResetAt: api.quotaResetAt,
      discovery: config.youtube.discovery,
      push: Boolean(websub?.enabled),
    };
  },

  /** Turns whatever the user typed into a stored-account description. Throws UserError with a helpful message. */
  async resolveAccount(input) {
    if (!api.configured) throw new UserError('YouTube monitoring is not configured yet — the bot owner must set `YOUTUBE_API_KEY`.');
    const parsed = parseChannelInput(input);
    if (!parsed) {
      throw new UserError('I could not understand that. Send a channel URL, an `@handle`, a channel ID (`UC…`) or a video link.');
    }
    try {
      let items = [];
      if (parsed.type === 'id') items = await api.channels({ id: parsed.value });
      else if (parsed.type === 'handle') items = await api.channels({ forHandle: parsed.value });
      else if (parsed.type === 'username') items = await api.channels({ forUsername: parsed.value });
      else if (parsed.type === 'video') {
        const [video] = await api.videos([parsed.value]);
        if (video?.snippet?.channelId) items = await api.channels({ id: video.snippet.channelId });
      }
      if (!items.length) {
        throw new UserError(
          parsed.type === 'handle' || parsed.type === 'username'
            ? 'I could not find a YouTube channel with that name. Try the full channel URL or the channel ID (`UC…`).'
            : 'I could not find that YouTube channel.',
        );
      }
      return accountFromChannel(items[0]);
    } catch (err) {
      if (err instanceof UserError) throw err;
      if (err instanceof QuotaError) throw new UserError('The YouTube API quota is used up for today. Please try again after it resets.');
      if (err instanceof ApiError) throw new UserError(err.reason === 'keyInvalid' || err.reason === 'accessNotConfigured' || err.reason === 'keyRestricted' ? `${err.message} (Tell the bot owner.)` : 'YouTube did not answer properly. Please try again in a moment.');
      throw err;
    }
  },

  /**
   * Cheap discovery: the IDs of an account's most recent uploads (newest first).
   * Uses the public Atom feed (costs no API quota) and falls back to the API's uploads playlist.
   */
  async discover(account) {
    const mode = config.youtube.discovery;
    if (mode !== 'api') {
      try {
        const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(account.external_id)}`, {
          headers: { accept: 'application/atom+xml, application/xml, text/xml' },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return [...new Set(parseFeed(await res.text()).map((e) => e.videoId))];
        if (mode === 'rss') throw new ApiError(`YouTube feed answered ${res.status}.`, { status: res.status, retryable: res.status >= 500 });
        log.debug({ status: res.status, account: account.id }, 'feed unavailable, using API discovery');
      } catch (err) {
        if (mode === 'rss') throw err instanceof ApiError ? err : new ApiError('Could not reach the YouTube feed.', { retryable: true });
        log.debug({ account: account.id, reason: err.name }, 'feed failed, using API discovery');
      }
    }
    const playlistId = account.metadata?.uploadsPlaylistId || uploadsPlaylistId(account.external_id);
    return api.playlistVideoIds(playlistId, 15);
  },

  /** Full details (normalised) for a list of video IDs. Unknown / deleted / private IDs are simply absent. */
  async fetchItems(ids) {
    if (!ids.length) return [];
    return (await api.videos(ids)).map(normalizeVideo);
  },

  itemUrl: (externalId) => `https://www.youtube.com/watch?v=${externalId}`,

  async start({ http, wakeAccount }) {
    if (started) return;
    started = true;
    try {
      const until = await botState.get(QUOTA_KEY);
      if (until && new Date(until) > new Date()) api.blockUntil(new Date(until));
    } catch (err) {
      log.warn({ err }, 'could not restore quota state');
    }
    websub = createWebSub({
      callbackUrl: config.http.enabled ? config.youtube.websub.callbackUrl : null,
      secret: config.youtube.websub.secret,
      accounts: accountsRepo,
      log,
      onPush: (entries) => handlePushEntries(entries, wakeAccount).catch((err) => log.warn({ err: err.message }, 'push handling failed')),
    });
    if (websub.enabled && http) {
      http.route('/websub/youtube', (req, res, url) => websub.handle(req, res, url));
      log.info({ callback: config.youtube.websub.callbackUrl }, 'YouTube push notifications (WebSub) enabled');

      // Re-establish/refresh push subscriptions immediately after startup instead of waiting
      // for the hourly maintenance worker. This keeps existing channels on the fast path.
      queueMicrotask(async () => {
        try {
          const due = await accountsRepo.listForPushRenewal('youtube', 24);
          for (const account of due) {
            try {
              await websub.subscribe(account);
            } catch (err) {
              log.warn({ err: err.message, account: account.id }, 'startup WebSub subscription refresh failed');
            }
          }
          if (due.length) log.info({ accounts: due.length }, 'startup WebSub subscription refresh complete');
        } catch (err) {
          log.warn({ err: err.message }, 'startup WebSub subscription refresh could not run');
        }
      });
    } else {
      log.info('YouTube push notifications disabled (set PUBLIC_URL to enable); using polling only');
    }
  },

  async stop() {
    started = false;
  },

  /** Whether push is currently delivering for this account (lets the poller relax its interval). */
  hasActivePush: (account) => Boolean(websub?.enabled && account.push_expires_at && new Date(account.push_expires_at) > new Date()),

  subscribePush: (account) => (websub?.enabled ? websub.subscribe(account) : Promise.resolve()),
  unsubscribePush: (account) => (websub?.enabled ? websub.unsubscribe(account) : Promise.resolve()),

  /** Hourly housekeeping: renew expiring WebSub leases. */
  async maintain() {
    if (!websub?.enabled) return;
    const due = await accountsRepo.listForPushRenewal('youtube', 24);
    for (const account of due) {
      try {
        await websub.subscribe(account);
      } catch (err) {
        log.warn({ err: err.message, account: account.id }, 'WebSub renewal failed');
      }
    }
  },
};

module.exports = platform;
module.exports.EVENT_TYPES = EVENT_TYPES;
