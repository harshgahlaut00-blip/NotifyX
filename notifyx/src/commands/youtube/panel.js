'use strict';

const { UserError } = require('../../utils/errors');
const { parseTemplateInput, parseColor, isHttpUrl } = require('../../utils/text');
const { makeId, row, button, ButtonStyle, ComponentType, TextInputStyle, ChannelType, TEXT_CHANNEL_TYPES } = require('../../utils/discord');
const { notice, onOff } = require('../../services/ui');
const runtime = require('../../services/runtime');
const platforms = require('../../platforms');
const subscriptionsRepo = require('../../database/repositories/subscriptions');
const rulesRepo = require('../../database/repositories/rules');
const guildsRepo = require('../../database/repositories/guilds');
const templatesRepo = require('../../database/repositories/templates');
const { buildPreview } = require('../../services/notify');
const { assertCanPost } = require('../../services/subscriptions');

const NS = 'ytcfg';

async function loadState(subscriptionId, guildId, eventType) {
  const sub = await subscriptionsRepo.getForGuild(subscriptionId, guildId);
  if (!sub) throw new UserError('That followed channel no longer exists.');
  const rule = await rulesRepo.getBySubEvent(subscriptionId, eventType);
  const guildRow = await guildsRepo.get(guildId);
  const platform = platforms.get(sub.platform);
  return { sub, rule, guildRow, platform };
}

function summaryLines({ sub, rule, guildRow, platform }) {
  const eventDef = platform.eventTypes[rule.event_type];
  const channelId = rule.channel_id || guildRow.default_channel_id;
  const roleId = rule.role_id || guildRow.default_role_id;
  return [
    `${runtime.emoji.text(eventDef.emoji, guildRow)} **${eventDef.label}** for **${sub.account_name}**`,
    `${onOff(rule.enabled, guildRow)}`,
    `**Channel:** ${channelId ? `<#${channelId}>` : '_not set — configure /setup_'}${rule.channel_id ? '' : ' _(server default)_'}`,
    `**Role:** ${roleId ? (roleId === guildRow.guild_id ? '@everyone' : `<@&${roleId}>`) : '_none_'}${rule.role_id ? '' : roleId ? ' _(server default)_' : ''}`,
    `**Message:** ${rule.message === null ? '_default_' : rule.message === '' ? '_(none)_' : `\`${rule.message.slice(0, 60)}${rule.message.length > 60 ? '…' : ''}\``}`,
    `**Embed title:** ${rule.embed_title === null ? '_default_' : rule.embed_title === '' ? '_(none)_' : `\`${rule.embed_title.slice(0, 40)}\``}`,
    `**Embed color:** ${rule.embed_color || `_default_`}`,
    `**Image:** ${rule.image_mode} ${rule.custom_image_url ? `(custom: ${rule.custom_image_url})` : ''}`,
    `**Buttons:** ${[rule.button_label ?? eventDef.watchLabel, rule.channel_button_label ?? 'Channel', rule.custom_button_label].filter(Boolean).join(', ') || '_none_'}`,
  ];
}

function components(subId, eventType, rule, canManageChannels) {
  const id = (action) => makeId(NS, subId, eventType, action);
  return [
    row(
      button({ customId: id('toggle'), label: rule.enabled ? 'Disable' : 'Enable', style: rule.enabled ? ButtonStyle.Danger : ButtonStyle.Success }),
      button({ customId: id('text'), label: 'Edit Message', style: ButtonStyle.Secondary }),
      button({ customId: id('embed'), label: 'Edit Embed', style: ButtonStyle.Secondary }),
      button({ customId: id('buttons'), label: 'Edit Buttons', style: ButtonStyle.Secondary }),
      button({ customId: id('reset'), label: 'Reset to Default', style: ButtonStyle.Secondary }),
    ),
    row({
      type: ComponentType.ChannelSelect,
      custom_id: id('channel'),
      placeholder: 'Change destination channel…',
      channel_types: [...TEXT_CHANNEL_TYPES, ChannelType.GuildCategory],
      min_values: 0,
      max_values: 1,
    }),
    row({ type: ComponentType.RoleSelect, custom_id: id('role'), placeholder: 'Change role to ping…', min_values: 0, max_values: 1 }),
    row(
      button({ customId: id('preview'), label: 'Preview', style: ButtonStyle.Primary }),
      button({ customId: id('test'), label: 'Send Test', style: ButtonStyle.Primary }),
      button({ customId: id('save-template'), label: 'Save as Template', style: ButtonStyle.Secondary }),
      button({ customId: id('load-template'), label: 'Load Template', style: ButtonStyle.Secondary }),
    ),
  ];
}

async function buildPanel(subscriptionId, guildId, eventType) {
  const state = await loadState(subscriptionId, guildId, eventType);
  return {
    embeds: [{ color: 0x5b8cff, description: summaryLines(state).join('\n') }],
    components: components(subscriptionId, eventType, state.rule, true),
  };
}

// ── component handlers ────────────────────────────────────────────────────

async function handleToggle(interaction, subId, eventType) {
  const rule = await rulesRepo.getBySubEvent(subId, eventType);
  await rulesRepo.update(rule.id, { enabled: !rule.enabled });
  await interaction.update(await buildPanel(subId, interaction.guildId, eventType));
}

async function handleReset(interaction, subId, eventType) {
  const rule = await rulesRepo.getBySubEvent(subId, eventType);
  await rulesRepo.update(rule.id, {
    message: null,
    embed_title: null,
    embed_description: null,
    embed_color: null,
    image_mode: 'large',
    custom_image_url: null,
    footer_text: null,
    button_label: null,
    channel_button_label: null,
    custom_button_label: null,
    custom_button_url: null,
  });
  await interaction.update(await buildPanel(subId, interaction.guildId, eventType));
}

async function handleChannelSelect(interaction, subId, eventType) {
  const picked = interaction.values[0] ? interaction.channels.first() : null;
  const rule = await rulesRepo.getBySubEvent(subId, eventType);
  if (!picked) {
    await rulesRepo.update(rule.id, { channel_id: null, category_id: null });
    await interaction.update(await buildPanel(subId, interaction.guildId, eventType));
    return;
  }
  const sub = await subscriptionsRepo.getForGuild(subId, interaction.guildId);
  const guildRow = await guildsRepo.get(interaction.guildId);
  const roleId = rule.role_id || guildRow.default_role_id;
  try {
    const { patch, warnings } = await require('../../services/subscriptions').applyDestination({
      guild: interaction.guild,
      picked,
      account: { name: sub.account_name },
      roleId,
      reason: `NotifyX: /youtube config by ${interaction.user.id}`,
    });
    await rulesRepo.update(rule.id, patch);
    await interaction.update(await buildPanel(subId, interaction.guildId, eventType));
    if (warnings.length) await interaction.followUp({ ...notice('warning', warnings.join('\n')), flags: 64 });
  } catch (err) {
    if (err instanceof UserError) await interaction.reply({ ...notice('error', err.message), flags: 64 });
    else throw err;
  }
}

async function handleRoleSelect(interaction, subId, eventType) {
  const roleId = interaction.values[0] || null;
  const rule = await rulesRepo.getBySubEvent(subId, eventType);
  await rulesRepo.update(rule.id, { role_id: roleId });
  await interaction.update(await buildPanel(subId, interaction.guildId, eventType));
}

async function handlePreview(interaction, subId, eventType) {
  const sub = await subscriptionsRepo.getForGuild(subId, interaction.guildId);
  const { payload, isSample } = await buildPreview(sub, eventType);
  const msg = isSample ? { content: '_No stored video yet — showing sample data._', ...payload } : payload;
  await interaction.reply({ ...msg, flags: 64 });
}

async function handleTest(interaction, subId, eventType) {
  await interaction.deferReply({ flags: 64 });
  const sub = await subscriptionsRepo.getForGuild(subId, interaction.guildId);
  try {
    const { channel } = await require('../../services/notify').sendTest(sub, eventType, interaction.user.id);
    await interaction.editReply(notice('success', `Test notification sent to <#${channel.id}>.`));
  } catch (err) {
    if (err instanceof UserError) await interaction.editReply(notice('error', err.message));
    else throw err;
  }
}

const TEMPLATE_MODAL_FIELDS = { name: 'name' };

function textModal(id, title, fields) {
  return {
    custom_id: id,
    title: title.slice(0, 45),
    components: fields.map((f) =>
      row({
        type: ComponentType.TextInput,
        custom_id: f.key,
        label: f.label.slice(0, 45),
        style: f.style || TextInputStyle.Short,
        required: false,
        max_length: f.maxLength || 4000,
        value: f.value ? String(f.value).slice(0, f.maxLength || 4000) : undefined,
        placeholder: f.placeholder,
      }),
    ),
  };
}

async function openTextModal(interaction, subId, eventType) {
  const rule = await rulesRepo.getBySubEvent(subId, eventType);
  await interaction.showModal(
    textModal(makeId(NS, subId, eventType, 'text-submit'), 'Edit Message', [
      { key: 'message', label: 'Message (blank=default, - =none)', style: TextInputStyle.Paragraph, value: rule.message, maxLength: 1800, placeholder: 'Leave blank to use the default, or "-" for no message text.' },
    ]),
  );
}

async function openEmbedModal(interaction, subId, eventType) {
  const rule = await rulesRepo.getBySubEvent(subId, eventType);
  await interaction.showModal(
    textModal(makeId(NS, subId, eventType, 'embed-submit'), 'Edit Embed', [
      { key: 'title', label: 'Embed title (blank=default, - =none)', value: rule.embed_title, maxLength: 250 },
      { key: 'description', label: 'Embed description (blank=default, - =none)', style: TextInputStyle.Paragraph, value: rule.embed_description, maxLength: 3900 },
      { key: 'color', label: 'Color hex, e.g. #5B8CFF (blank=default)', value: rule.embed_color, maxLength: 7 },
      { key: 'image_mode', label: 'Image: large / small / none', value: rule.image_mode, maxLength: 10 },
      { key: 'image_url', label: 'Custom image URL (blank=video thumbnail)', value: rule.custom_image_url, maxLength: 500 },
    ]),
  );
}

async function openButtonsModal(interaction, subId, eventType) {
  const rule = await rulesRepo.getBySubEvent(subId, eventType);
  await interaction.showModal(
    textModal(makeId(NS, subId, eventType, 'buttons-submit'), 'Edit Buttons', [
      { key: 'watch_label', label: 'Watch button label (blank=default, - =hide)', value: rule.button_label, maxLength: 80 },
      { key: 'channel_label', label: 'Channel button label (blank=default, - =hide)', value: rule.channel_button_label, maxLength: 80 },
      { key: 'custom_label', label: 'Extra button label (optional)', value: rule.custom_button_label, maxLength: 80 },
      { key: 'custom_url', label: 'Extra button URL (required if label set)', value: rule.custom_button_url, maxLength: 500 },
    ]),
  );
}

async function submitTextModal(interaction, subId, eventType) {
  const message = parseTemplateInput(interaction.fields.getTextInputValue('message'));
  const rule = await rulesRepo.getBySubEvent(subId, eventType);
  await rulesRepo.update(rule.id, { message });
  await interaction.update(await buildPanel(subId, interaction.guildId, eventType));
}

async function submitEmbedModal(interaction, subId, eventType) {
  const get = (k) => interaction.fields.getTextInputValue(k);
  const patch = {
    embed_title: parseTemplateInput(get('title')),
    embed_description: parseTemplateInput(get('description')),
  };
  const colorRaw = get('color').trim();
  if (colorRaw) {
    if (parseColor(colorRaw) === null) throw new UserError('That is not a valid hex color, e.g. `#5B8CFF`.');
    patch.embed_color = colorRaw;
  } else patch.embed_color = null;
  const mode = get('image_mode').trim().toLowerCase();
  if (mode) {
    if (!['large', 'small', 'none'].includes(mode)) throw new UserError('Image mode must be `large`, `small` or `none`.');
    patch.image_mode = mode;
  }
  const imageUrl = get('image_url').trim();
  if (imageUrl && !isHttpUrl(imageUrl)) throw new UserError('The custom image URL must be a valid http(s) link.');
  patch.custom_image_url = imageUrl || null;

  const rule = await rulesRepo.getBySubEvent(subId, eventType);
  await rulesRepo.update(rule.id, patch);
  await interaction.update(await buildPanel(subId, interaction.guildId, eventType));
}

async function submitButtonsModal(interaction, subId, eventType) {
  const get = (k) => interaction.fields.getTextInputValue(k);
  const customUrl = get('custom_url').trim();
  const customLabel = get('custom_label').trim();
  if (customLabel && customUrl && !isHttpUrl(customUrl)) throw new UserError('The extra button URL must be a valid http(s) link.');
  const patch = {
    button_label: parseTemplateInput(get('watch_label')),
    channel_button_label: parseTemplateInput(get('channel_label')),
    custom_button_label: customLabel || null,
    custom_button_url: customLabel && customUrl ? customUrl : null,
  };
  const rule = await rulesRepo.getBySubEvent(subId, eventType);
  await rulesRepo.update(rule.id, patch);
  await interaction.update(await buildPanel(subId, interaction.guildId, eventType));
}

async function handleSaveTemplate(interaction, subId, eventType) {
  await interaction.showModal(textModal(makeId(NS, subId, eventType, 'template-save-submit'), 'Save as Template', [{ key: 'name', label: 'Template name' }]));
}

async function submitSaveTemplate(interaction, subId, eventType) {
  const name = interaction.fields.getTextInputValue('name').trim();
  if (!name) throw new UserError('Give the template a name.');
  const rule = await rulesRepo.getBySubEvent(subId, eventType);
  const config = Object.fromEntries(rulesRepo.DESIGN_FIELDS.map((f) => [f, rule[f]]));
  await templatesRepo.save({ guildId: interaction.guildId, name, eventType, config, createdBy: interaction.user.id });
  await interaction.reply({ ...notice('success', `Saved as template **${name}**. Apply it to any channel’s ${eventType} notifications with \`/youtube config\` → Load Template.`), flags: 64 });
}

async function handleLoadTemplate(interaction, subId, eventType) {
  const templates = await templatesRepo.list(interaction.guildId, eventType);
  if (!templates.length) {
    await interaction.reply({ ...notice('info', 'No templates saved yet for this event type. Use **Save as Template** first.'), flags: 64 });
    return;
  }
  await interaction.reply({
    ...({ content: 'Choose a template to apply:' }),
    flags: 64,
    components: [
      row({
        type: ComponentType.StringSelect,
        custom_id: makeId(NS, subId, eventType, 'template-pick'),
        options: templates.slice(0, 25).map((t) => ({ label: t.name.slice(0, 100), value: String(t.id) })),
      }),
    ],
  });
}

async function submitLoadTemplate(interaction, subId, eventType) {
  const templateId = Number(interaction.values[0]);
  const template = await templatesRepo.getById(interaction.guildId, templateId);
  if (!template) throw new UserError('That template no longer exists.');
  const rule = await rulesRepo.getBySubEvent(subId, eventType);
  await rulesRepo.update(rule.id, template.config);
  await interaction.update(await buildPanel(subId, interaction.guildId, eventType));
}

const ACTIONS = {
  toggle: handleToggle,
  reset: handleReset,
  channel: handleChannelSelect,
  role: handleRoleSelect,
  preview: handlePreview,
  test: handleTest,
  text: openTextModal,
  embed: openEmbedModal,
  buttons: openButtonsModal,
  'save-template': handleSaveTemplate,
  'load-template': handleLoadTemplate,
  'text-submit': submitTextModal,
  'embed-submit': submitEmbedModal,
  'buttons-submit': submitButtonsModal,
  'template-save-submit': submitSaveTemplate,
  'template-pick': submitLoadTemplate,
};

/** Dispatches a component/modal interaction whose custom_id is "nx:ytcfg:<subId>:<event>:<action>". */
async function dispatch(interaction, args) {
  const [subId, eventType, action] = args;
  const handler = ACTIONS[action];
  if (!handler) throw new UserError('This control has expired. Run `/youtube config` again.');
  await handler(interaction, Number(subId), eventType);
}

module.exports = { NS, buildPanel, dispatch };
