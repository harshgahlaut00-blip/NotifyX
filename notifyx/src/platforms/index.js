'use strict';

/**
 * Platform registry.
 *
 * A platform (YouTube today; Twitch, Instagram, TikTok… later) is a module implementing:
 *
 *   id, label, brandColor, eventTypes{}, eventOrder[]          — metadata + default message templates
 *   isConfigured(): boolean
 *   resolveAccount(input): Promise<{ platform, externalId, name, handle, url, avatarUrl, metadata }>
 *   discover(account): Promise<string[]>                       — ids of recent items (cheap)
 *   fetchItems(ids): Promise<NormalizedContent[]>              — full details of items
 *   start(ctx) / stop() / maintain()                           — optional lifecycle hooks
 *   hasActivePush / subscribePush / unsubscribePush            — optional push support
 *
 * NormalizedContent: { externalId, kind, state, title, description, url, thumbnailUrl, durationSeconds,
 *                      publishedAt, scheduledStartAt, actualStartAt, actualEndAt }
 *
 * Everything else — database, workers, Discord delivery, commands — is platform-independent and
 * only talks to this interface. To add a platform: implement it, `register()` it below, and add a
 * slash command that calls services/subscriptions.js with the new platform id.
 */

const registry = new Map();

function register(platform) {
  for (const key of ['id', 'label', 'eventTypes', 'eventOrder', 'resolveAccount', 'discover', 'fetchItems']) {
    if (platform[key] === undefined) throw new Error(`Platform "${platform.id || '?'}" is missing "${key}"`);
  }
  registry.set(platform.id, platform);
  return platform;
}

const get = (id) => registry.get(id) || null;
const all = () => [...registry.values()];

register(require('./youtube'));

module.exports = { register, get, all };
