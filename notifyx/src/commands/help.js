'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { ephemeralNotice } = require('../services/ui');
const { PLACEHOLDERS } = require('../notifications/builder');
const platforms = require('../platforms');

const TOPICS = {
  overview: {
    label: 'Overview',
    text: [
      '**NotifyX** posts a Discord notification whenever a followed YouTube channel uploads a video, goes live, or schedules a stream.',
      '',
      '**Get started:** `/setup` → `/youtube add channel:<url>`',
      '',
      'Run `/help topic:<name>` for details: `setup`, `youtube`, `settings`, `notifications`, `placeholders`, `instant`.',
    ].join('\n'),
  },
  instant: {
    label: 'Instant notifications',
    text: () => {
      const status = platforms.get('youtube')?.status?.() ?? {};
      const lines = [
        'NotifyX can notify within seconds of a new upload or livestream, instead of waiting for a polling schedule — this needs the bot owner to set `PUBLIC_URL` in its environment (see the README).',
        '',
        `**On this bot:** push delivery is currently **${status.push ? 'ON ⚡' : 'OFF'}**.`,
      ];
      if (!status.push) lines.push('Ask whoever hosts this bot to set `PUBLIC_URL` (a Cloudflare Tunnel, ngrok, or the panel’s own public domain all work) to turn this on.');
      if (status.quotaResetAt) lines.push(`⚠️ New-item detection is paused until the YouTube API quota resets (~${new Date(status.quotaResetAt).toLocaleString()}).`);
      return lines.join('\n');
    },
  },
  setup: {
    label: 'Setup',
    text: [
      '`/setup` sets the server-wide defaults: default channel or category, default role to ping, and whether notifications are enabled at all.',
      'A channel added later without its own destination uses these defaults.',
    ].join('\n'),
  },
  youtube: {
    label: 'YouTube commands',
    text: [
      '`/youtube add channel:<url|@handle|ID>` — follow a channel. Optional: `discord_channel`, `category`, `role`, and per-event toggles.',
      '`/youtube remove channel:<name>` — stop following a channel.',
      '`/youtube list` — list followed channels.',
      '`/youtube channels` — show each channel’s configured destination.',
      '`/youtube config channel:<name> event:<video|live|upcoming>` — opens a panel to edit the message, embed, buttons, destination and role for that notification, preview it, send a real test, or save/load it as a reusable template.',
      '`/youtube test channel:<name> event:<...>` — send a real test notification now.',
    ].join('\n'),
  },
  settings: {
    label: 'Settings',
    text: [
      '`/settings view` — current server settings.',
      '`/settings toggle enabled:<true|false>` — pause/resume all notifications.',
      '`/settings emoji set|reset|list` — customize the emoji NotifyX uses (server emoji or Unicode); falls back automatically if a custom emoji becomes unavailable.',
    ].join('\n'),
  },
  notifications: {
    label: 'Notification history',
    text: ['`/notifications history` — the most recent deliveries.', '`/notifications stats` — a 24-hour summary.', '`/notifications retry` — re-queue anything that failed in the last 24 hours.'].join('\n'),
  },
  placeholders: {
    label: 'Message & embed placeholders',
    text: [
      'Use these inside `/youtube config` → Edit Message / Edit Embed. Leave a field blank to keep the default, or type `-` to make it empty.',
      '',
      ...PLACEHOLDERS.map(([ph, desc]) => `\`${ph}\` — ${desc}`),
    ].join('\n'),
  },
};

const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('How to use NotifyX')
  .addStringOption((o) =>
    o
      .setName('topic')
      .setDescription('Which topic')
      .addChoices(...Object.entries(TOPICS).map(([value, t]) => ({ name: t.label, value }))),
  );

async function execute(interaction) {
  const topic = interaction.options.getString('topic') || 'overview';
  const t = TOPICS[topic] || TOPICS.overview;
  const text = typeof t.text === 'function' ? t.text() : t.text;
  await interaction.reply(ephemeralNotice('info', `**${t.label}**\n${text}`));
}

module.exports = { data, execute, TOPICS };
