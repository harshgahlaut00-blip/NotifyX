'use strict';

const { ApiError, QuotaError } = require('../../utils/errors');
const { sleep, backoffMs, nextPacificMidnight } = require('../../utils/time');

const BASE = 'https://www.googleapis.com/youtube/v3';
const QUOTA_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded']);
const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

/**
 * Minimal YouTube Data API v3 client (uses the global fetch of Node 18+).
 *  - retries transient failures (network, 5xx, 429, rate limits) with exponential backoff
 *  - recognises exhausted daily quota and refuses further calls until it resets (midnight Pacific)
 *  - error messages never contain the request URL, so the API key can not leak into logs
 */
class YouTubeApi {
  constructor({ apiKey, log, fetchImpl = globalThis.fetch, onQuotaExhausted = () => {}, timeoutMs = 15_000 }) {
    this.apiKey = apiKey;
    this.log = log;
    this.fetch = fetchImpl;
    this.onQuotaExhausted = onQuotaExhausted;
    this.timeoutMs = timeoutMs;
    this.blockedUntil = 0;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  get quotaResetAt() {
    return Date.now() < this.blockedUntil ? new Date(this.blockedUntil) : null;
  }

  blockUntil(date) {
    this.blockedUntil = date instanceof Date ? date.getTime() : Number(date) || 0;
  }

  async request(endpoint, params, { attempts = 3 } = {}) {
    if (!this.apiKey) throw new ApiError('YOUTUBE_API_KEY is not configured.', { reason: 'noKey' });
    if (Date.now() < this.blockedUntil) throw new QuotaError(new Date(this.blockedUntil));

    const url = new URL(`${BASE}/${endpoint}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    url.searchParams.set('key', this.apiKey);

    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await sleep(lastError?.retryAfterMs || backoffMs(attempt, 1000, 15_000));
      let res;
      try {
        res = await this.fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (err) {
        lastError = new ApiError(`Could not reach the YouTube API (${err.cause?.code || err.name || 'network error'}).`, {
          reason: 'network',
          retryable: true,
        });
        continue;
      }

      if (res.ok) return res.json();

      const body = await res.json().catch(() => ({}));
      const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
      const message = body?.error?.message || res.statusText || 'request failed';
      const retryAfter = Number(res.headers.get('retry-after'));
      const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : 0;

      if (res.status === 403 && QUOTA_REASONS.has(reason)) {
        const resetAt = nextPacificMidnight();
        this.blockUntil(resetAt);
        this.onQuotaExhausted(resetAt);
        throw new QuotaError(resetAt);
      }
      if ((res.status === 403 && RATE_REASONS.has(reason)) || res.status === 429 || res.status >= 500) {
        lastError = new ApiError(`YouTube API temporarily unavailable (${res.status} ${reason}).`, {
          status: res.status,
          reason,
          retryable: true,
          retryAfterMs,
        });
        continue;
      }
      if (res.status === 400 && /api key/i.test(message)) {
        throw new ApiError('The YouTube API key is invalid. Check YOUTUBE_API_KEY.', { status: 400, reason: 'keyInvalid' });
      }
      if (res.status === 403 && reason === 'accessNotConfigured') {
        throw new ApiError('The YouTube Data API v3 is not enabled for this API key’s Google Cloud project.', {
          status: 403,
          reason,
        });
      }
      if (res.status === 403 && /ip|referer|restrict/i.test(message)) {
        throw new ApiError('The YouTube API key is restricted (IP/referrer) and rejects this server.', { status: 403, reason: 'keyRestricted' });
      }
      throw new ApiError(`YouTube API error ${res.status}${reason ? ` (${reason})` : ''}.`, { status: res.status, reason });
    }
    throw lastError;
  }

  async channels(params) {
    const data = await this.request('channels', { part: 'snippet', maxResults: 1, ...params });
    return data.items || [];
  }

  /** videos.list in batches of 50 ids (1 quota unit per batch). */
  async videos(ids) {
    const unique = [...new Set(ids)];
    const out = [];
    for (let i = 0; i < unique.length; i += 50) {
      const data = await this.request('videos', {
        part: 'snippet,contentDetails,liveStreamingDetails',
        id: unique.slice(i, i + 50).join(','),
        maxResults: 50,
      });
      out.push(...(data.items || []));
    }
    return out;
  }

  /** Newest video ids of an uploads playlist (1 quota unit). */
  async playlistVideoIds(playlistId, max = 15) {
    const data = await this.request('playlistItems', { part: 'contentDetails', playlistId, maxResults: max });
    return (data.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
  }
}

module.exports = { YouTubeApi };
