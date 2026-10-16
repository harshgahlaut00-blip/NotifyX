'use strict';

/**
 * Decides which notification events a newly fetched item triggers.
 *
 *   prev — the stored content row before this fetch (null when the item was never seen)
 *   item — the freshly normalised item
 *
 * Rules
 *   • unseen published video           → "video"      (only if it is younger than maxAgeMs — never flood old uploads)
 *   • unseen scheduled stream          → "upcoming"
 *   • unseen stream that is live       → "live"       (only if it started within maxAgeMs)
 *   • known scheduled stream now live  → "live"
 *   • everything else (edits, ended streams, finished VODs, re-checks) → nothing
 * Duplicate delivery is impossible regardless: notification_history has a UNIQUE constraint.
 */
function detectEvents(prev, item, { now = new Date(), maxAgeMs = 48 * 3600 * 1000 } = {}) {
  const age = (date) => (date ? now.getTime() - new Date(date).getTime() : 0);

  if (!prev) {
    switch (item.state) {
      case 'published':
        return age(item.publishedAt) <= maxAgeMs ? ['video'] : [];
      case 'upcoming':
        // A schedule that lapsed long ago and never went live is abandoned — don't announce it.
        return item.scheduledStartAt && age(item.scheduledStartAt) > maxAgeMs ? [] : ['upcoming'];
      case 'live':
        return age(item.actualStartAt || item.publishedAt) <= maxAgeMs ? ['live'] : [];
      default:
        return [];
    }
  }

  if (prev.state === 'upcoming' && item.state === 'live') return ['live'];
  return [];
}

module.exports = { detectEvents };
