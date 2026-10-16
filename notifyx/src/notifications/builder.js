'use strict';

const { renderTemplate, truncate, parseColor, isHttpUrl, cleanDescription, formatDuration, discordTime } = require('../utils/text');
const { LIMITS, ButtonStyle, row, button } = require('../utils/discord');

/** Placeholders usable in messages and embed text (shown by /help topic:placeholders). */
const PLACEHOLDERS = [
  ['{channel}', 'Name of the YouTube channel'],
  ['{title}', 'Video / stream title'],
  ['{url}', 'Link to the video / stream'],
  ['{description}', 'Start of the video description (max 300 characters)'],
  ['{channel_url}', 'Link to the channel'],
  ['{thumbnail}', 'Thumbnail image URL'],
  ['{duration}', 'Video length, e.g. 12:34'],
  ['{published}', 'Publish time (full date), shown in each viewer’s timezone'],
  ['{published_relative}', 'Publish time, relative — “2 minutes ago”'],
  ['{scheduled}', 'Scheduled start of a stream (full date)'],
  ['{scheduled_relative}', 'Scheduled start, relative — “in 3 hours”'],
  ['{started}', 'When the stream went live (full date)'],
  ['{started_relative}', 'When the stream went live, relative'],
  ['{video_id}', 'The video ID'],
  ['{type}', 'Event name — “New video”, “Livestream”, “Upcoming stream”'],
  ['{emoji}', 'The emoji configured for this event type'],
  ['{role}', 'Mention of the configured role (added automatically if you leave it out)'],
  ['{server}', 'Your server name'],
  ['{platform}', 'The platform name, e.g. YouTube'],
];

const validUrl = (u) => (u && isHttpUrl(u) ? String(u) : undefined);

function buildVars({ platform, eventDef, guild, account, content, emoji, roleMention }) {
  const rel = (d) => discordTime(d, 'R');
  const full = (d) => discordTime(d, 'F');
  return {
    channel: account.name || '',
    channel_url: account.url || '',
    title: content.title || '',
    url: content.url || '',
    description: cleanDescription(content.description, 300),
    thumbnail: content.thumbnail_url ?? content.thumbnailUrl ?? '',
    duration: formatDuration(content.duration_seconds ?? content.durationSeconds),
    published: full(content.published_at ?? content.publishedAt),
    published_relative: rel(content.published_at ?? content.publishedAt),
    scheduled: full(content.scheduled_start_at ?? content.scheduledStartAt),
    scheduled_relative: rel(content.scheduled_start_at ?? content.scheduledStartAt),
    started: full(content.actual_start_at ?? content.actualStartAt),
    started_relative: rel(content.actual_start_at ?? content.actualStartAt),
    video_id: content.external_id ?? content.externalId ?? '',
    type: eventDef.label,
    emoji: emoji.text(eventDef.emoji, guild),
    role: roleMention,
    server: guild?.name || '',
    platform: platform.label,
  };
}

/** Field values: the timestamp that best represents the event. */
function eventTime(eventType, c) {
  const pick = (a, b) => c[a] ?? c[b] ?? null;
  const published = pick('published_at', 'publishedAt');
  const scheduled = pick('scheduled_start_at', 'scheduledStartAt');
  const started = pick('actual_start_at', 'actualStartAt');
  if (eventType === 'live') return started || published;
  if (eventType === 'upcoming') return scheduled || published;
  return published;
}

/** Keeps an embed under Discord's 6000-character total by shortening its description. */
function fitEmbed(embed) {
  const size = () =>
    (embed.title?.length || 0) + (embed.description?.length || 0) + (embed.footer?.text?.length || 0) + (embed.author?.name?.length || 0) +
    (embed.fields || []).reduce((n, f) => n + f.name.length + f.value.length, 0);
  const over = size() - LIMITS.embedTotal;
  if (over > 0 && embed.description) embed.description = truncate(embed.description, Math.max(0, embed.description.length - over - 1));
  return embed;
}

/**
 * Builds the complete Discord message payload for one notification.
 *
 *  platform   — platform module (labels + default templates)
 *  eventType  — 'video' | 'live' | 'upcoming'
 *  rule       — notification_rules row (NULL = default, '' = explicitly empty)
 *  guild      — guilds row (default role, emoji overrides, name)
 *  account    — platform_accounts row
 *  content    — content_items row or a normalised item
 *  emoji      — services/emoji resolver
 *  preview    — never ping anyone
 */
function buildNotification({ platform, eventType, rule, guild, account, content, emoji, preview = false, testBanner = null }) {
  const eventDef = platform.eventTypes[eventType];
  if (!eventDef) throw new Error(`Unknown event type "${eventType}" for ${platform.id}`);
  const r = rule || {};

  const roleId = r.role_id || guild?.default_role_id || null;
  const everyone = Boolean(roleId && guild && roleId === guild.guild_id);
  const roleMention = roleId ? (everyone ? '@everyone' : `<@&${roleId}>`) : '';
  const vars = buildVars({ platform, eventDef, guild, account, content, emoji, roleMention });

  // ── message text
  const template = r.message ?? eventDef.message;
  let text = renderTemplate(template, vars).trim();
  if (roleMention && !/\{role\}/i.test(template)) text = `${roleMention} ${text}`.trim();
  if (testBanner) text = `${testBanner}\n${text}`.trim();
  text = truncate(text, LIMITS.content);

  // ── embed
  const embed = { color: parseColor(r.embed_color) ?? eventDef.color };
  const author = { name: truncate(account.name || platform.label, LIMITS.embedAuthor) };
  if (validUrl(account.url)) author.url = account.url;
  const icon = validUrl(account.avatar_url ?? account.avatarUrl);
  if (icon) author.icon_url = icon;
  embed.author = author;

  const title = renderTemplate(r.embed_title ?? eventDef.title, vars).trim();
  if (title) embed.title = truncate(title, LIMITS.embedTitle);
  if (title && validUrl(vars.url)) embed.url = vars.url;

  const description = renderTemplate(r.embed_description ?? eventDef.description, vars).trim();
  if (description) embed.description = truncate(description, LIMITS.embedDescription);

  const fields = [];
  const dur = vars.duration;
  if (eventType === 'video') {
    if (dur) fields.push({ name: 'Duration', value: dur, inline: true });
    if (vars.published) fields.push({ name: 'Published', value: vars.published_relative, inline: true });
  } else if (eventType === 'upcoming' && vars.scheduled) {
    fields.push({ name: `${emoji.text('calendar', guild)} Starts`, value: `${vars.scheduled}\n${vars.scheduled_relative}`, inline: true });
  } else if (eventType === 'live' && vars.started) {
    fields.push({ name: 'Started', value: vars.started_relative, inline: true });
  }
  if (fields.length) embed.fields = fields.map((f) => ({ ...f, name: truncate(f.name, LIMITS.fieldName), value: truncate(f.value, LIMITS.fieldValue) }));

  const footer = r.footer_text ?? `${platform.label} • NotifyX`;
  const footerText = renderTemplate(footer, vars).trim();
  if (footerText) embed.footer = { text: truncate(footerText, LIMITS.embedFooter) };

  if (r.show_timestamp !== false) {
    const t = eventTime(eventType, content);
    embed.timestamp = (t ? new Date(t) : new Date()).toISOString();
  }

  const imageUrl = validUrl(r.custom_image_url) || validUrl(vars.thumbnail);
  const mode = r.image_mode || 'large';
  if (imageUrl && mode === 'large') embed.image = { url: imageUrl };
  else if (imageUrl && mode === 'small') embed.thumbnail = { url: imageUrl };

  // ── buttons
  const buttons = [];
  const watchLabel = r.button_label ?? eventDef.watchLabel;
  if (watchLabel && validUrl(vars.url)) buttons.push(button({ label: watchLabel, url: vars.url, emoji: emoji.component('watch', guild) }));
  const channelLabel = r.channel_button_label ?? 'Channel';
  if (channelLabel && validUrl(vars.channel_url)) buttons.push(button({ label: channelLabel, url: vars.channel_url, emoji: emoji.component('channel', guild) }));
  if (r.custom_button_label && validUrl(r.custom_button_url)) buttons.push(button({ label: r.custom_button_label, url: r.custom_button_url }));

  const payload = {
    embeds: [fitEmbed(embed)],
    allowedMentions: preview || !roleId ? { parse: [] } : everyone ? { parse: ['everyone'] } : { roles: [roleId] },
  };
  if (text) payload.content = text;
  if (buttons.length) payload.components = [row(buttons)];
  return payload;
}

/** Stand-in content for previews when an account has no stored content yet. */
function sampleContent(eventType, account, now = new Date()) {
  const base = {
    external_id: 'sample',
    title: 'Your video title appears here',
    description: 'The beginning of the video description shows up here, so viewers get a quick idea of what to expect.',
    url: 'https://www.youtube.com/',
    thumbnail_url: account.avatar_url || null,
    duration_seconds: 754,
    published_at: now,
    scheduled_start_at: null,
    actual_start_at: null,
  };
  if (eventType === 'live') return { ...base, title: 'Your livestream title appears here', duration_seconds: null, actual_start_at: now };
  if (eventType === 'upcoming') return { ...base, title: 'Your upcoming stream title appears here', duration_seconds: null, scheduled_start_at: new Date(now.getTime() + 3 * 3600 * 1000) };
  return base;
}

module.exports = { buildNotification, sampleContent, PLACEHOLDERS, ButtonStyle };
