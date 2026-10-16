'use strict';

const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { UserError } = require('../utils/errors');
const { ephemeralNotice, notice, onOff, channelMention } = require('../services/ui');
const { requireManager } = require('../services/permissions');
const runtime = require('../services/runtime');
const platforms = require('../platforms');
const guildsRepo = require('../database/repositories/guilds');
const subscriptionsRepo = require('../database/repositories/subscriptions');
const rulesRepo = require('../database/repositories/rules');
const { addSubscription, removeSubscription, resolveSubscription } = require('../services/subscriptions');
const { sendTest } = require('../services/notify');
const panel = require('./youtube/panel');

const PLATFORM_ID = 'youtube';

const data = new SlashCommandBuilder()
  .setName('youtube')
  .setDescription('Follow YouTube channels and manage their notifications')
  .setDMPermission(false)
  .setDefaultMemberPermissions(0)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Follow a YouTube channel in this server')
      .addStringOption((o) => o.setName('channel').setDescription('Channel URL, @handle, channel ID, or a video link').setRequired(true))
      .addChannelOption((o) => o.setName('discord_channel').setDescription('Post notifications in this channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addChannelOption((o) => o.setName('category').setDescription('Create a dedicated channel inside this category').addChannelTypes(ChannelType.GuildCategory))
      .addRoleOption((o) => o.setName('role').setDescription('Role to ping (leave empty for the server default)'))
      .addBooleanOption((o) => o.setName('videos').setDescription('Notify on new videos (default: on)'))
      .addBooleanOption((o) => o.setName('live').setDescription('Notify when going live (default: on)'))
      .addBooleanOption((o) => o.setName('upcoming').setDescription('Notify on scheduled streams (default: on)')),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Stop following a YouTube channel')
      .addStringOption((o) => o.setName('channel').setDescription('The followed channel').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) => s.setName('list').setDescription('List YouTube channels followed in this server'))
  .addSubcommand((s) =>
    s
      .setName('config')
      .setDescription('Configure notifications for a followed channel')
      .addStringOption((o) => o.setName('channel').setDescription('The followed channel').setRequired(true).setAutocomplete(true))
      .addStringOption((o) =>
        o
          .setName('event')
          .setDescription('Which notification to edit')
          .setRequired(true)
          .addChoices({ name: 'New video', value: 'video' }, { name: 'Livestream', value: 'live' }, { name: 'Upcoming stream', value: 'upcoming' }),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('test')
      .setDescription('Send a real test notification to its configured channel')
      .addStringOption((o) => o.setName('channel').setDescription('The followed channel').setRequired(true).setAutocomplete(true))
      .addStringOption((o) =>
        o
          .setName('event')
          .setDescription('Which notification to test')
          .setRequired(true)
          .addChoices({ name: 'New video', value: 'video' }, { name: 'Livestream', value: 'live' }, { name: 'Upcoming stream', value: 'upcoming' }),
      ),
  )
  .addSubcommand((s) => s.setName('channels').setDescription('Show where each followed channel’s notifications are configured to go'));

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'channel') return interaction.respond([]);
  const rows = await subscriptionsRepo.search(interaction.guildId, focused.value, 20);
  await interaction.respond(rows.map((r) => ({ name: `${r.account_name}${r.handle ? ` (${r.handle})` : ''}`.slice(0, 100), value: String(r.id) })));
}

async function cmdAdd(interaction) {
  requireManager(interaction);
  await interaction.deferReply({ flags: 64 });
  const input = interaction.options.getString('channel', true);
  const opts = {
    channel: interaction.options.getChannel('discord_channel') || undefined,
    category: interaction.options.getChannel('category') || undefined,
    role: interaction.options.getRole('role') || undefined,
    events: {
      video: interaction.options.getBoolean('videos'),
      live: interaction.options.getBoolean('live'),
      upcoming: interaction.options.getBoolean('upcoming'),
    },
  };
  for (const k of Object.keys(opts.events)) if (opts.events[k] === null) delete opts.events[k];

  const result = await addSubscription({ platformId: PLATFORM_ID, input, guild: interaction.guild, userId: interaction.user.id, opts });
  const dest = result.destination ? channelMention(result.destination.id) : channelMention(result.guildRow.default_channel_id) || `<#${result.guildRow.default_category_id}> (category)`;
  const lines = [
    `${runtime.emoji.text('success', result.guildRow)} Now following **${result.account.name}**.`,
    `**Notifications go to:** ${dest}${result.createdChannel ? ' _(created)_' : ''}`,
  ];
  if (result.baselinedItems !== null) lines.push(`Checked existing uploads (${result.baselinedItems} found) — only new activity from now on will be announced.`);
  if (result.warnings.length) lines.push('', `⚠️ ${result.warnings.join('\n⚠️ ')}`);
  await interaction.editReply(notice(result.warnings.length ? 'warning' : 'success', lines.join('\n')));
}

async function cmdRemove(interaction) {
  requireManager(interaction);
  const sub = await resolveSubscription(interaction.guildId, interaction.options.getString('channel', true));
  await removeSubscription(sub);
  await interaction.reply(ephemeralNotice('success', `Stopped following **${sub.account_name}**.`));
}

async function cmdList(interaction) {
  const rows = await subscriptionsRepo.listByGuild(interaction.guildId);
  if (!rows.length) {
    await interaction.reply(ephemeralNotice('info', 'No YouTube channels are followed yet. Use `/youtube add` to follow one.'));
    return;
  }
  const guildRow = await guildsRepo.get(interaction.guildId);
  const lines = rows.map((r) => {
    const status = r.enabled ? '' : ' _(disabled)_';
    const health = r.consecutive_failures >= 3 ? ` ${runtime.emoji.text('warning', guildRow)} having trouble — see \`/youtube channels\`` : '';
    return `${runtime.emoji.text('channel', guildRow)} **${r.account_name}**${r.handle ? ` (${r.handle})` : ''}${status}${health}`;
  });
  const { config } = require('../config');
  await interaction.reply(ephemeralNotice('info', `**Followed YouTube channels (${rows.length}/${config.limits.maxChannelsPerGuild})**\n${lines.join('\n')}`));
}

async function cmdChannels(interaction) {
  const [rows, guildRow] = await Promise.all([subscriptionsRepo.listByGuild(interaction.guildId), guildsRepo.get(interaction.guildId)]);
  if (!rows.length) {
    await interaction.reply(ephemeralNotice('info', 'No YouTube channels are followed yet.'));
    return;
  }
  const platform = platforms.get(PLATFORM_ID);
  const lines = [];
  for (const sub of rows) {
    const rules = await rulesRepo.listBySubscriptions([sub.id]);
    const dests = platform.eventOrder
      .map((eventType) => {
        const r = rules.find((x) => x.event_type === eventType);
        if (!r || !r.enabled) return null;
        const chId = r.channel_id || guildRow.default_channel_id;
        return `${platform.eventTypes[eventType].label}: ${chId ? channelMention(chId) : '_unset_'}`;
      })
      .filter(Boolean);
    lines.push(`**${sub.account_name}** — ${dests.join(' · ') || '_all disabled_'}`);
  }
  await interaction.reply(ephemeralNotice('info', lines.join('\n')));
}

async function cmdConfig(interaction) {
  requireManager(interaction);
  const sub = await resolveSubscription(interaction.guildId, interaction.options.getString('channel', true));
  const eventType = interaction.options.getString('event', true);
  await interaction.reply({ ...(await panel.buildPanel(sub.id, interaction.guildId, eventType)), flags: 64 });
}

async function cmdTest(interaction) {
  requireManager(interaction);
  await interaction.deferReply({ flags: 64 });
  const sub = await resolveSubscription(interaction.guildId, interaction.options.getString('channel', true));
  const eventType = interaction.options.getString('event', true);
  const { channel } = await sendTest(sub, eventType, interaction.user.id);
  await interaction.editReply(notice('success', `Test notification sent to <#${channel.id}>.`));
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'add') return cmdAdd(interaction);
  if (sub === 'remove') return cmdRemove(interaction);
  if (sub === 'list') return cmdList(interaction);
  if (sub === 'config') return cmdConfig(interaction);
  if (sub === 'test') return cmdTest(interaction);
  if (sub === 'channels') return cmdChannels(interaction);
  throw new UserError('Unknown subcommand.');
}

/** Handles component/modal interactions whose custom_id starts with "nx:ytcfg:…". */
const component = (interaction, args) => panel.dispatch(interaction, args);
const modal = (interaction, args) => panel.dispatch(interaction, args);

module.exports = { data, execute, autocomplete, component, modal, namespace: panel.NS };
