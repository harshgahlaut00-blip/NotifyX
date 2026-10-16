'use strict';

/** Pure parsing helpers for YouTube data (no network, no config) — unit tested. */

const CHANNEL_ID_RE = /^UC[\w-]{22}$/;
const VIDEO_ID_RE = /^[\w-]{11}$/;
const HANDLE_RE = /^@?[\w.\-]{3,30}$/;

/**
 * Understands what people paste into /youtube add:
 *   UC… channel id · @handle · handle · youtube.com/channel/UC… · /@handle · /user/name · /c/name ·
 *   a video / live / shorts URL (resolved to its channel).
 * Returns { type: 'id'|'handle'|'username'|'video', value } or null.
 */
function parseChannelInput(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (CHANNEL_ID_RE.test(raw)) return { type: 'id', value: raw };
  if (raw.startsWith('@') && HANDLE_RE.test(raw)) return { type: 'handle', value: raw };

  let url = null;
  try {
    const candidate = /^(https?:)?\/\//i.test(raw) ? raw : /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(raw) ? `https://${raw}` : null;
    if (candidate) url = new URL(candidate.startsWith('//') ? `https:${candidate}` : candidate);
  } catch {
    return null;
  }

  if (url) {
    const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
    const parts = url.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
    if (host === 'youtu.be') return VIDEO_ID_RE.test(parts[0] || '') ? { type: 'video', value: parts[0] } : null;
    if (host !== 'youtube.com') return null;
    const [first, second] = parts;
    if (first === 'channel' && CHANNEL_ID_RE.test(second || '')) return { type: 'id', value: second };
    if (first && first.startsWith('@') && HANDLE_RE.test(first)) return { type: 'handle', value: first };
    if (first === 'user' && second) return { type: 'username', value: second };
    if (first === 'c' && second && HANDLE_RE.test(second)) return { type: 'handle', value: `@${second}` }; // best effort
    if (['live', 'shorts', 'embed'].includes(first) && VIDEO_ID_RE.test(second || '')) return { type: 'video', value: second };
    if (first === 'watch' && VIDEO_ID_RE.test(url.searchParams.get('v') || '')) return { type: 'video', value: url.searchParams.get('v') };
    return null;
  }

  if (HANDLE_RE.test(raw)) return { type: 'handle', value: `@${raw}` };
  return null;
}

/** ISO-8601 duration ("PT1H2M3S", "P0D") → seconds, or null when zero/invalid. */
function parseIsoDuration(value) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(value ?? ''));
  if (!m) return null;
  const [, d, h, min, s] = m.map((x) => Number(x || 0));
  const total = d * 86400 + h * 3600 + min * 60 + s;
  return total > 0 ? total : null;
}

const pickThumbnail = (thumbs = {}) =>
  (thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default || {}).url || null;

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * videos.list item → NormalizedContent (the platform-independent shape NotifyX stores):
 *   kind:  'video' | 'stream'
 *   state: 'published' | 'upcoming' | 'live' | 'ended'
 */
function normalizeVideo(item) {
  const sn = item.snippet || {};
  const cd = item.contentDetails || {};
  const ls = item.liveStreamingDetails || null;
  const broadcast = sn.liveBroadcastContent;
  let state = 'published';
  if (broadcast === 'live') state = 'live';
  else if (broadcast === 'upcoming') state = 'upcoming';
  else if (ls) state = 'ended';

  return {
    externalId: item.id,
    accountExternalId: sn.channelId || null,
    accountName: sn.channelTitle || null,
    kind: ls ? 'stream' : 'video',
    state,
    title: sn.title || '(untitled)',
    description: sn.description || '',
    url: `https://www.youtube.com/watch?v=${item.id}`,
    thumbnailUrl: pickThumbnail(sn.thumbnails),
    durationSeconds: parseIsoDuration(cd.duration),
    publishedAt: toDate(sn.publishedAt),
    scheduledStartAt: toDate(ls?.scheduledStartTime),
    actualStartAt: toDate(ls?.actualStartTime),
    actualEndAt: toDate(ls?.actualEndTime),
  };
}

const XML_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };
const decodeXml = (s) => String(s).replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => XML_ENTITIES[m] || m);

/** Parses YouTube's Atom feed into [{ videoId, title, publishedAt }] (newest first, as served). */
function parseFeed(xml) {
  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(String(xml ?? '')))) {
    const block = m[1];
    const id = /<yt:videoId>\s*([\w-]{11})\s*<\/yt:videoId>/.exec(block)?.[1];
    if (!id) continue;
    entries.push({
      videoId: id,
      title: decodeXml(/<title>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? ''),
      publishedAt: toDate(/<published>\s*([^<]+?)\s*<\/published>/.exec(block)?.[1]),
    });
  }
  return entries;
}

/** Channel IDs mentioned in a WebSub push body. */
function parsePushChannelIds(xml) {
  const ids = new Set();
  const re = /<yt:channelId>\s*(UC[\w-]{22})\s*<\/yt:channelId>/g;
  let m;
  while ((m = re.exec(String(xml ?? '')))) ids.add(m[1]);
  return [...ids];
}

/**
 * Full per-entry parse of a WebSub push body: [{ channelId, videoId, title, publishedAt, updatedAt }].
 * This is what makes notifications near-instant — the push already tells us exactly which video
 * changed, so NotifyX can fetch just that video's details instead of waiting for the next poll to
 * re-scan the whole channel.
 */
function parsePushEntries(xml) {
  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(String(xml ?? '')))) {
    const block = m[1];
    const videoId = /<yt:videoId>\s*([\w-]{11})\s*<\/yt:videoId>/.exec(block)?.[1];
    const channelId = /<yt:channelId>\s*(UC[\w-]{22})\s*<\/yt:channelId>/.exec(block)?.[1];
    if (!videoId || !channelId) continue;
    entries.push({
      channelId,
      videoId,
      title: decodeXml(/<title>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? ''),
      publishedAt: toDate(/<published>\s*([^<]+?)\s*<\/published>/.exec(block)?.[1]),
      updatedAt: toDate(/<updated>\s*([^<]+?)\s*<\/updated>/.exec(block)?.[1]),
    });
  }
  return entries;
}

/** "UC…" → uploads playlist id "UU…". */
const uploadsPlaylistId = (channelId) => `UU${String(channelId).slice(2)}`;

module.exports = {
  CHANNEL_ID_RE,
  parseChannelInput,
  parseIsoDuration,
  normalizeVideo,
  parseFeed,
  parsePushChannelIds,
  parsePushEntries,
  uploadsPlaylistId,
};
