import crypto from 'node:crypto';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { handleReactionRoleCommand } from './reaction-roles.js';
import { handleApplicationBarCommand } from './restrictions.js';

const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const DENIAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const CONFIG_QUESTIONS_PER_PAGE = 20;

function ephemeral(content, extra = {}) {
  return { content, flags: MessageFlags.Ephemeral, ...extra };
}

function isDiscordId(value) {
  return /^\d{17,20}$/.test(value);
}

function grantRoleIds(positionOrRecord) {
  return positionOrRecord.grantRoleIds ?? (positionOrRecord.roleId ? [positionOrRecord.roleId] : []);
}

function removeRoleIds(positionOrRecord) {
  return positionOrRecord.removeRoleIds ?? [];
}

function configuredPositions(config) {
  if (!config.reviewerRoleIds.length || config.reviewerRoleIds.some((id) => !isDiscordId(id))
    || !isDiscordId(config.applicationCategoryId) || !isDiscordId(config.transcriptChannelId)) return [];
  return config.positions.filter((position) => grantRoleIds(position).length
    && grantRoleIds(position).every(isDiscordId) && removeRoleIds(position).every(isDiscordId));
}

function truncate(value, length) {
  if (value.length <= length) return value;
  return `${value.slice(0, length - 1)}…`;
}

function panelEmbed(config, positions) {
  const multiple = positions.length > 1;
  const description = multiple
    ? ['Choose the application you want to submit:', '', ...positions.map((position) => `• **${position.name}** — ${position.description || 'Open this application'}`)].join('\n')
    : positions[0]?.description || config.panel.description;
  return new EmbedBuilder()
    .setColor(config.panel.color)
    .setTitle(multiple ? 'Applications' : positions[0]?.name || config.panel.title)
    .setDescription(truncate(description, 4000))
    .setFooter({ text: multiple ? 'Choose an application below.' : 'Use the button below to begin.' });
}

function panelComponents(positions) {
  const buttons = positions.map((position) => new ButtonBuilder()
    .setCustomId(`application:start:${position.id}`)
    .setLabel(truncate(position.name, 80))
    .setEmoji('📝')
    .setStyle(ButtonStyle.Primary));
  const rows = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(new ActionRowBuilder().addComponents(...buttons.slice(index, index + 5)));
  }
  return rows;
}

function panelPositionPicker(config) {
  const positions = configuredPositions(config);
  if (!positions.length) return ephemeral('Applications are not configured yet. Complete `/setup` first.');
  const menu = new StringSelectMenuBuilder()
    .setCustomId('application:panel-positions')
    .setPlaceholder('Select applications for this panel')
    .setMinValues(1)
    .setMaxValues(positions.length)
    .addOptions(positions.map((position) => ({
      label: position.name,
      description: position.description || `Add ${position.name} to the panel`,
      value: position.id,
    })));
  return ephemeral('Select one or more applications. Each selected application will get its own direct button:', {
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

function positionPicker(config) {
  const positions = configuredPositions(config);
  if (!positions.length) {
    return ephemeral('Applications are not configured yet. A server manager must run `/setup`.');
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId('application:position')
    .setPlaceholder('Choose a position')
    .addOptions(
      positions.map((position) => ({
        label: position.name,
        description: position.description || `Apply for ${position.name}`,
        value: position.id,
      })),
    );
  return ephemeral('Choose the position you want to apply for:', {
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

function setupMainView(config, notice) {
  const reviewerIds = config.reviewerRoleIds.filter(isDiscordId);
  const readyCount = configuredPositions(config).length;
  const positionLines = config.positions.map((position) => {
    const roles = grantRoleIds(position).filter(isDiscordId);
    return `• **${position.name}** — ${roles.length ? `${roles.length} granted role${roles.length === 1 ? '' : 's'}` : 'roles not set'}`;
  }).join('\n');
  const embed = new EmbedBuilder()
    .setColor(readyCount === config.positions.length && reviewerIds.length ? '#57F287' : '#FEE75C')
    .setTitle('Application setup')
    .setDescription([
      `**Reviewer roles:** ${reviewerIds.length ? reviewerIds.map((id) => `<@&${id}>`).join(', ') : 'Not set'}`,
      `**Application category:** ${isDiscordId(config.applicationCategoryId) ? `<#${config.applicationCategoryId}>` : 'Not set'}`,
      `**Transcript channel:** ${isDiscordId(config.transcriptChannelId) ? `<#${config.transcriptChannelId}>` : 'Not set'}`,
      `**Ready positions:** ${readyCount}/${config.positions.length}`,
      '',
      positionLines,
    ].join('\n'))
    .setFooter({ text: 'Only members with Manage Server can use this private setup panel.' });
  const reviewerMenu = new RoleSelectMenuBuilder()
    .setCustomId('setup:reviewers')
    .setPlaceholder('Select staff/reviewer roles')
    .setMinValues(1)
    .setMaxValues(10);
  if (reviewerIds.length) reviewerMenu.setDefaultRoles(...reviewerIds);
  const categoryMenu = new ChannelSelectMenuBuilder()
    .setCustomId('setup:category')
    .setPlaceholder('Select the private applications category')
    .setChannelTypes(ChannelType.GuildCategory)
    .setMinValues(1)
    .setMaxValues(1);
  if (isDiscordId(config.applicationCategoryId)) categoryMenu.setDefaultChannels(config.applicationCategoryId);
  const transcriptMenu = new ChannelSelectMenuBuilder()
    .setCustomId('setup:transcripts')
    .setPlaceholder('Select the transcript archive channel')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);
  if (isDiscordId(config.transcriptChannelId)) transcriptMenu.setDefaultChannels(config.transcriptChannelId);
  const positionMenu = new StringSelectMenuBuilder()
    .setCustomId('setup:position')
    .setPlaceholder('Choose a position to configure')
    .addOptions(config.positions.map((position) => ({
      label: position.name,
      description: grantRoleIds(position).length && grantRoleIds(position).every(isDiscordId) ? 'Approval roles configured' : 'Role setup required',
      value: position.id,
    })));
  return {
    content: notice || null,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(reviewerMenu),
      new ActionRowBuilder().addComponents(categoryMenu),
      new ActionRowBuilder().addComponents(transcriptMenu),
      new ActionRowBuilder().addComponents(positionMenu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('setup:add-position').setLabel('Add position').setStyle(ButtonStyle.Success),
      ),
    ],
  };
}

function setupPositionView(config, position, confirmDelete = false, notice) {
  const grantedRoles = grantRoleIds(position).filter(isDiscordId);
  const removedRoles = removeRoleIds(position).filter(isDiscordId);
  const roleIsSet = grantedRoles.length > 0;
  const embed = new EmbedBuilder()
    .setColor(confirmDelete ? '#ED4245' : roleIsSet ? '#57F287' : '#FEE75C')
    .setTitle(confirmDelete ? `Delete ${position.name}?` : `Set up ${position.name}`)
    .setDescription(confirmDelete
      ? 'This removes the position and its questions. Existing submitted applications remain in history.'
      : [
          position.description,
          '',
          `**Roles granted on approval:** ${roleIsSet ? grantedRoles.map((id) => `<@&${id}>`).join(', ') : 'Not set'}`,
          `**Roles removed on approval:** ${removedRoles.length ? removedRoles.map((id) => `<@&${id}>`).join(', ') : 'None'}`,
        ].join('\n'));
  const components = [];
  if (confirmDelete) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`setup:confirm-delete:${position.id}`).setLabel('Confirm delete').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`setup:open:${position.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    ));
  } else {
    const grantRoleMenu = new RoleSelectMenuBuilder()
      .setCustomId(`setup:grant-roles:${position.id}`)
      .setPlaceholder('Select roles granted on approval')
      .setMinValues(1)
      .setMaxValues(25);
    if (grantedRoles.length) grantRoleMenu.setDefaultRoles(...grantedRoles);
    const removeRoleMenu = new RoleSelectMenuBuilder()
      .setCustomId(`setup:remove-roles:${position.id}`)
      .setPlaceholder('Select roles removed on approval (optional)')
      .setMinValues(0)
      .setMaxValues(25);
    if (removedRoles.length) removeRoleMenu.setDefaultRoles(...removedRoles);
    components.push(
      new ActionRowBuilder().addComponents(grantRoleMenu),
      new ActionRowBuilder().addComponents(removeRoleMenu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`setup:edit-position:${position.id}`).setLabel('Edit details').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`setup:delete-position:${position.id}`).setLabel('Delete position').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('setup:home').setLabel('Back').setStyle(ButtonStyle.Secondary),
      ),
    );
  }
  return { content: notice || null, embeds: [embed], components };
}

function positionDetailsModal(position) {
  const editing = Boolean(position);
  const modal = new ModalBuilder()
    .setCustomId(editing ? `setup:modal-edit:${position.id}` : 'setup:modal-add')
    .setTitle(editing ? 'Edit application position' : 'Add application position');
  const name = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Position name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  const description = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Short description')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  if (position) {
    name.setValue(position.name);
    description.setValue(position.description);
  }
  return modal.addComponents(
    new ActionRowBuilder().addComponents(name),
    new ActionRowBuilder().addComponents(description),
  );
}

function uniquePositionId(name, positions) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 26) || 'position';
  let id = base;
  let suffix = 2;
  while (positions.some((position) => position.id === id)) id = `${base.slice(0, 28)}-${suffix++}`;
  return id;
}

function configPositionPicker(config, notice) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('cfg:position')
    .setPlaceholder('Choose a position to configure')
    .addOptions(config.positions.map((position) => ({
      label: position.name,
      description: `${position.questions.length} question${position.questions.length === 1 ? '' : 's'}`,
      value: position.id,
    })));
  const embed = new EmbedBuilder()
    .setColor(config.panel.color)
    .setTitle('Application question manager')
    .setDescription('Choose a position. You can add, edit, reorder, or delete its questions entirely from Discord.');
  return {
    content: notice || null,
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
  };
}

function configPositionView(config, position, requestedPage = 0, notice) {
  const pageCount = Math.max(1, Math.ceil(position.questions.length / CONFIG_QUESTIONS_PER_PAGE));
  const page = Math.max(0, Math.min(requestedPage, pageCount - 1));
  const start = page * CONFIG_QUESTIONS_PER_PAGE;
  const questions = position.questions.slice(start, start + CONFIG_QUESTIONS_PER_PAGE);
  const list = questions.map((question, index) => {
    const required = question.required ? 'required' : 'optional';
    return `**${start + index + 1}.** ${question.label} — ${question.style}, ${required}`;
  }).join('\n');
  const embed = new EmbedBuilder()
    .setColor(config.panel.color)
    .setTitle(`${position.name}: questions`)
    .setDescription(list || 'This position does not have any questions yet.')
    .setFooter({ text: `Page ${page + 1}/${pageCount} • ${position.questions.length} total` });
  const components = [];
  if (questions.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`cfg:qselect:${position.id}:${page}`)
        .setPlaceholder('Choose a question to manage')
        .addOptions(questions.map((question, index) => ({
          label: truncate(`${start + index + 1}. ${question.label}`, 100),
          description: `${question.style} • ${question.required ? 'required' : 'optional'}`,
          value: question.id,
        }))),
    ));
  }
  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cfg:add:${position.id}:${page}`).setLabel('Add question').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`cfg:qpage:${position.id}:${page - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`cfg:qpage:${position.id}:${page + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page >= pageCount - 1),
    new ButtonBuilder().setCustomId('cfg:positions').setLabel('Positions').setStyle(ButtonStyle.Secondary),
  ));
  return { content: notice || null, embeds: [embed], components };
}

function configQuestionView(config, position, question, page, confirmDelete = false) {
  const index = position.questions.findIndex((item) => item.id === question.id);
  const min = question.minLength ?? 0;
  const max = question.maxLength ?? (question.style === 'short' ? 400 : 4000);
  const embed = new EmbedBuilder()
    .setColor(confirmDelete ? '#ED4245' : config.panel.color)
    .setTitle(confirmDelete ? 'Delete this question?' : `Question ${index + 1}: ${question.label}`)
    .addFields(
      { name: 'Type', value: question.style, inline: true },
      { name: 'Required', value: question.required ? 'Yes' : 'No', inline: true },
      { name: 'Character limits', value: `${min}-${max}`, inline: true },
      { name: 'Placeholder', value: question.placeholder || 'None' },
    );
  if (confirmDelete) embed.setDescription('This permanently removes the question for future applications. Applications already submitted are not changed.');
  const buttons = confirmDelete
    ? [
        new ButtonBuilder().setCustomId(`cfg:cd:${position.id}:${question.id}:${page}`).setLabel('Confirm delete').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`cfg:x:${position.id}:${question.id}:${page}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ]
    : [
        new ButtonBuilder().setCustomId(`cfg:e:${position.id}:${question.id}:${page}`).setLabel('Edit').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`cfg:m:${position.id}:${question.id}:up:${page}`).setLabel('Move up').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
        new ButtonBuilder().setCustomId(`cfg:m:${position.id}:${question.id}:down:${page}`).setLabel('Move down').setStyle(ButtonStyle.Secondary).setDisabled(index === position.questions.length - 1),
        new ButtonBuilder().setCustomId(`cfg:d:${position.id}:${question.id}:${page}`).setLabel('Delete').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`cfg:qpage:${position.id}:${page}`).setLabel('Back').setStyle(ButtonStyle.Secondary),
      ];
  return { content: null, embeds: [embed], components: [new ActionRowBuilder().addComponents(...buttons)] };
}

function questionModal(position, question, page) {
  const editing = Boolean(question);
  const modal = new ModalBuilder()
    .setCustomId(editing ? `cfg:me:${position.id}:${question.id}:${page}` : `cfg:ma:${position.id}:${page}`)
    .setTitle(editing ? 'Edit application question' : 'Add application question');
  const values = {
    label: question?.label ?? '',
    type: question?.style ?? 'paragraph',
    required: question ? (question.required ? 'yes' : 'no') : 'yes',
    limits: question ? `${question.minLength ?? 0}-${question.maxLength ?? (question.style === 'short' ? 400 : 4000)}` : '0-1000',
    placeholder: question?.placeholder ?? '',
  };
  const labelInput = new TextInputBuilder().setCustomId('label').setLabel('Question').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(100);
  if (values.label) labelInput.setValue(values.label);
  const inputs = [
    labelInput,
    new TextInputBuilder().setCustomId('type').setLabel('Type: short or paragraph').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(9).setValue(values.type),
    new TextInputBuilder().setCustomId('required').setLabel('Required? yes or no').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setValue(values.required),
    new TextInputBuilder().setCustomId('limits').setLabel('Character limits (example: 10-1000)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(9).setValue(values.limits),
    new TextInputBuilder().setCustomId('placeholder').setLabel('Example/placeholder (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100),
  ];
  if (values.placeholder) inputs[4].setValue(values.placeholder);
  for (const input of inputs) modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function questionFromModal(interaction, existingQuestion, currentQuestions) {
  const label = interaction.fields.getTextInputValue('label').trim();
  const style = interaction.fields.getTextInputValue('type').trim().toLowerCase();
  const requiredText = interaction.fields.getTextInputValue('required').trim().toLowerCase();
  const limitsText = interaction.fields.getTextInputValue('limits').trim();
  const placeholder = interaction.fields.getTextInputValue('placeholder').trim();
  if (!['short', 'paragraph'].includes(style)) throw new Error('Question type must be `short` or `paragraph`.');
  if (!['yes', 'no'].includes(requiredText)) throw new Error('Required must be `yes` or `no`.');
  const limits = /^(\d{1,4})\s*-\s*(\d{1,4})$/.exec(limitsText);
  if (!limits) throw new Error('Character limits must use the format `minimum-maximum`, such as `10-1000`.');
  const minLength = Number(limits[1]);
  const maxLength = Number(limits[2]);
  if (minLength > maxLength || maxLength > 4000) throw new Error('Character limits must be ordered and cannot exceed 4000.');
  let id = existingQuestion?.id;
  if (!id) {
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 44) || 'question';
    id = base;
    let suffix = 2;
    while (currentQuestions.some((question) => question.id === id)) id = `${base.slice(0, 46)}-${suffix++}`;
  }
  return { id, label, style, required: requiredText === 'yes', minLength, maxLength, ...(placeholder ? { placeholder } : {}) };
}

export function dmQuestionPayload(session) {
  const question = session.position.questions[session.questionIndex];
  const minimum = question.minLength ?? 0;
  const maximum = question.maxLength ?? (question.style === 'short' ? 400 : 4000);
  const requirements = [
    question.required ? 'Required' : 'Optional',
    minimum ? `${minimum}-${maximum} characters` : `Up to ${maximum} characters`,
  ].join(' • ');
  const embed = new EmbedBuilder()
    .setColor(session.config.panel.color)
    .setAuthor({ name: session.guildName })
    .setTitle(`${session.position.name} • Question ${session.questionIndex + 1}/${session.position.questions.length}`)
    .setDescription(question.label)
    .addFields({ name: 'Answer requirements', value: requirements })
    .setFooter({ text: 'Reply directly to this DM • Type “back” to revise • Type “cancel” to stop' });
  if (question.placeholder) embed.addFields({ name: 'Example', value: question.placeholder });
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

function reviewPayload(record, config) {
  const position = config.positions.find((item) => item.id === record.positionId);
  const color = record.status === 'approved' ? '#57F287' : record.status === 'denied' ? '#ED4245' : config.panel.color;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${position?.name ?? record.positionName} application`)
    .setDescription(`Application **${record.id}** from <@${record.userId}>`)
    .addFields(
      { name: 'Status', value: record.status.toUpperCase(), inline: true },
      { name: 'Submitted', value: `<t:${Math.floor(new Date(record.createdAt).getTime() / 1000)}:R>`, inline: true },
    )
    .setTimestamp(new Date(record.createdAt));

  if (record.decidedBy) embed.addFields({ name: 'Reviewed by', value: `<@${record.decidedBy}>`, inline: true });
  if (record.denialReason) embed.addFields({ name: 'Reason', value: truncate(record.denialReason, 1024) });

  const components = record.status === 'pending'
    ? [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`application:approve:${record.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`application:deny:${record.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
        ),
      ]
    : [];
  return { embeds: [embed], components };
}

function answerEmbeds(record, color) {
  return record.answers.map((answer, index) => new EmbedBuilder()
    .setColor(color)
    .setTitle(`Question ${index + 1}`)
    .setDescription(`**${answer.question}**\n\n${answer.value || '*No answer provided.*'}`));
}

function batchEmbeds(embeds, characterLimit = 5500) {
  const batches = [];
  let current = [];
  let characters = 0;
  for (const embed of embeds) {
    const data = embed.toJSON();
    const length = (data.title?.length ?? 0)
      + (data.description?.length ?? 0)
      + (data.fields ?? []).reduce((total, field) => total + field.name.length + field.value.length, 0);
    if (current.length && (current.length >= 10 || characters + length > characterLimit)) {
      batches.push(current);
      current = [];
      characters = 0;
    }
    current.push(embed);
    characters += length;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function fetchChannelMessages(channel, limit = 1000) {
  const messages = [];
  let before;
  while (messages.length < limit) {
    const batch = await channel.messages.fetch({ limit: Math.min(100, limit - messages.length), ...(before ? { before } : {}) });
    if (!batch.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeDiscordMarkdown(value) {
  return String(value ?? '').replace(/([\\`*_{}\[\]()<>#+\-.!|>~])/g, '\\$1');
}

function splitDiscordText(value, limit = 3900) {
  const chunks = [];
  let remaining = value;
  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf('\n', limit);
    if (splitAt < Math.floor(limit * 0.5)) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, '');
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function discordTranscriptMessage(message) {
  const author = escapeDiscordMarkdown(message.author?.tag ?? 'Unknown user');
  const authorId = escapeDiscordMarkdown(message.author?.id ?? 'unknown');
  const timestamp = Math.floor(message.createdTimestamp / 1000);
  const parts = [`**${author}** \`${authorId}\` • <t:${timestamp}:F>`];
  if (message.content) parts.push(escapeDiscordMarkdown(message.content));
  for (const embed of message.embeds ?? []) {
    const embedParts = [];
    if (embed.author?.name) embedParts.push(`**${escapeDiscordMarkdown(embed.author.name)}**`);
    if (embed.title) embedParts.push(`**${escapeDiscordMarkdown(embed.title)}**`);
    if (embed.description) embedParts.push(escapeDiscordMarkdown(embed.description));
    for (const field of embed.fields ?? []) {
      embedParts.push(`**${escapeDiscordMarkdown(field.name)}**\n${escapeDiscordMarkdown(field.value)}`);
    }
    if (embed.footer?.text) embedParts.push(`_${escapeDiscordMarkdown(embed.footer.text)}_`);
    if (embedParts.length) parts.push(embedParts.join('\n'));
  }
  for (const attachment of message.attachments?.values?.() ?? []) {
    parts.push(`📎 [${escapeDiscordMarkdown(attachment.name ?? 'Attachment')}](${attachment.url})`);
  }
  return parts.join('\n');
}

export function buildDiscordTranscriptPages(messages) {
  if (!messages.length) return ['_No messages were found in the application channel._'];
  const pages = [];
  let current = '';
  for (const message of messages) {
    for (const chunk of splitDiscordText(discordTranscriptMessage(message))) {
      const candidate = current ? `${current}\n\n${chunk}` : chunk;
      if (candidate.length > 3900 && current) {
        pages.push(current);
        current = chunk;
      } else {
        current = candidate;
      }
    }
  }
  if (current) pages.push(current);
  return pages;
}

async function postDiscordTranscriptPages(channel, pages, record) {
  for (const [index, page] of pages.entries()) {
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(record.status === 'approved' ? '#57F287' : '#ED4245')
        .setTitle(`Transcript • Page ${index + 1} of ${pages.length}`)
        .setDescription(page)
        .setFooter({ text: `${record.positionName} • ${record.id}` })],
      allowedMentions: { parse: [] },
    });
  }
}

function renderTranscriptEmbed(embed) {
  const fields = (embed.fields ?? []).map((field) => `
    <div class="embed-field">
      <strong>${escapeHtml(field.name)}</strong>
      <div>${escapeHtml(field.value)}</div>
    </div>`).join('');
  return `<div class="discord-embed">
    ${embed.author?.name ? `<div class="embed-author">${escapeHtml(embed.author.name)}</div>` : ''}
    ${embed.title ? `<div class="embed-title">${escapeHtml(embed.title)}</div>` : ''}
    ${embed.description ? `<div class="embed-description">${escapeHtml(embed.description)}</div>` : ''}
    ${fields ? `<div class="embed-fields">${fields}</div>` : ''}
    ${embed.footer?.text ? `<div class="embed-footer">${escapeHtml(embed.footer.text)}</div>` : ''}
  </div>`;
}

function renderTranscriptMessage(message) {
  const author = message.author?.tag ?? 'Unknown user';
  const authorId = message.author?.id ?? 'unknown';
  const avatar = message.author?.displayAvatarURL?.({ extension: 'png', size: 64 }) ?? '';
  const timestamp = new Date(message.createdTimestamp).toISOString();
  const embeds = [...(message.embeds ?? [])].map(renderTranscriptEmbed).join('');
  const attachments = [...(message.attachments?.values?.() ?? [])].map((attachment) => {
    const link = `<a href="${escapeHtml(attachment.url)}" target="_blank" rel="noreferrer">${escapeHtml(attachment.name ?? 'Attachment')}</a>`;
    const preview = attachment.contentType?.startsWith('image/')
      ? `<img class="attachment-preview" src="${escapeHtml(attachment.url)}" alt="${escapeHtml(attachment.name ?? 'Image attachment')}">`
      : '';
    return `<div class="attachment">📎 ${link}${preview}</div>`;
  }).join('');
  return `<article class="message">
    <div class="avatar">${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : escapeHtml(author.slice(0, 1).toUpperCase())}</div>
    <div class="message-body">
      <div class="message-header">
        <strong>${escapeHtml(author)}</strong>
        <span class="user-id">${escapeHtml(authorId)}</span>
        <time datetime="${timestamp}">${escapeHtml(timestamp.replace('T', ' ').replace('.000Z', ' UTC'))}</time>
      </div>
      ${message.content ? `<div class="message-content">${escapeHtml(message.content)}</div>` : ''}
      ${embeds}
      ${attachments}
    </div>
  </article>`;
}

export function buildTranscriptHtml(record, messages, channelName = 'application', omittedCount = 0) {
  const approved = record.status === 'approved';
  const reason = record.denialReason
    ? `<div class="reason"><strong>Decision reason</strong><div>${escapeHtml(record.denialReason)}</div></div>`
    : '';
  const messageHtml = messages.map(renderTranscriptMessage).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(record.positionName)} — ${escapeHtml(record.id)}</title>
  <style>
    :root{color-scheme:dark;--bg:#111214;--panel:#1e1f22;--panel2:#2b2d31;--text:#dbdee1;--muted:#949ba4;--line:#3f4147;--accent:#5865f2;--approved:#23a559;--denied:#f23f42}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}.container{max-width:1100px;margin:0 auto;padding:36px 20px 60px}
    .hero,.transcript{background:var(--panel);border:1px solid #292b2f;border-radius:14px;box-shadow:0 10px 35px #0005}.hero{padding:26px;margin-bottom:24px;border-left:6px solid ${approved ? 'var(--approved)' : 'var(--denied)'}}
    h1{font-size:26px;margin:0 0 6px}.subtitle{color:var(--muted);margin-bottom:22px}.status{display:inline-block;padding:5px 11px;border-radius:999px;font-weight:700;background:${approved ? 'var(--approved)' : 'var(--denied)'};color:white;text-transform:uppercase;font-size:12px;letter-spacing:.08em}
    .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:22px}.meta-item{background:var(--panel2);border-radius:8px;padding:12px}.meta-item span{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}.reason{background:#2b2022;border:1px solid #5b292d;border-radius:8px;padding:14px;margin-top:16px}.reason strong{display:block;margin-bottom:5px}
    .transcript-title{padding:18px 22px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:16px;align-items:center}.transcript-title h2{font-size:18px;margin:0}.count{color:var(--muted)}
    .message{display:flex;gap:14px;padding:16px 22px}.message:hover{background:#242529}.message+.message{border-top:1px solid #2a2c30}.avatar{width:42px;height:42px;flex:0 0 42px;border-radius:50%;background:var(--accent);display:grid;place-items:center;font-weight:700;overflow:hidden}.avatar img{width:100%;height:100%;object-fit:cover}.message-body{min-width:0;flex:1}.message-header{display:flex;gap:9px;align-items:baseline;flex-wrap:wrap}.message-header time,.user-id{font-size:12px;color:var(--muted)}.message-content,.embed-description,.embed-field div{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:5px}
    .discord-embed{max-width:720px;background:var(--panel2);border-left:4px solid var(--accent);border-radius:4px;padding:12px 14px;margin-top:10px}.embed-author,.embed-footer{font-size:12px;color:var(--muted)}.embed-title{font-weight:700;margin:4px 0}.embed-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:10px}.embed-field strong{display:block}.attachment{margin-top:8px}.attachment a{color:#00a8fc;text-decoration:none}.attachment-preview{display:block;max-width:min(560px,100%);max-height:420px;border-radius:8px;margin-top:8px}.omitted{padding:12px;text-align:center;color:var(--muted);background:#25262a}
    footer{text-align:center;color:var(--muted);font-size:12px;margin-top:18px}@media(max-width:600px){.container{padding:16px 8px}.message{padding:14px 12px}.hero{padding:18px}}
  </style>
</head>
<body><main class="container">
  <section class="hero">
    <span class="status">${escapeHtml(record.status)}</span>
    <h1>${escapeHtml(record.positionName)}</h1>
    <div class="subtitle">Application ${escapeHtml(record.id)} • ${escapeHtml(record.guildName)}</div>
    <div class="meta">
      <div class="meta-item"><span>Applicant</span>${escapeHtml(record.username)} (${escapeHtml(record.userId)})</div>
      <div class="meta-item"><span>Reviewer</span>${escapeHtml(record.decidedBy)}</div>
      <div class="meta-item"><span>Submitted</span>${escapeHtml(record.createdAt)}</div>
      <div class="meta-item"><span>Decided</span>${escapeHtml(record.decidedAt)}</div>
      <div class="meta-item"><span>Channel</span>#${escapeHtml(channelName)}</div>
      <div class="meta-item"><span>Messages</span>${messages.length}${omittedCount ? ` shown • ${omittedCount} omitted` : ''}</div>
    </div>${reason}
  </section>
  <section class="transcript">
    <div class="transcript-title"><h2>Conversation transcript</h2><span class="count">Oldest to newest</span></div>
    ${omittedCount ? `<div class="omitted">${omittedCount} older messages were omitted to keep the archive within Discord's upload limit.</div>` : ''}
    ${messageHtml || '<div class="omitted">No messages were found.</div>'}
  </section>
  <footer>Generated by Legion Roleplay Applications • ${escapeHtml(new Date().toISOString())}</footer>
</main></body></html>`;
}

async function createTranscript(guild, record, config, logger) {
  const applicationChannel = await guild.channels.fetch(record.reviewChannelId);
  const transcriptChannel = await guild.channels.fetch(record.transcriptChannelId ?? config.transcriptChannelId);
  if (!applicationChannel?.isTextBased() || !transcriptChannel?.isTextBased()) throw new Error('Application or transcript channel is unavailable.');
  const messages = await fetchChannelMessages(applicationChannel);
  let includedMessages = messages;
  let omittedCount = 0;
  const maxBytes = 7_500_000;
  let html = buildTranscriptHtml(record, includedMessages, applicationChannel.name, omittedCount);
  while (Buffer.byteLength(html, 'utf8') > maxBytes && includedMessages.length > 1) {
    const removeCount = Math.max(1, Math.ceil(includedMessages.length * 0.1));
    includedMessages = includedMessages.slice(removeCount);
    omittedCount += removeCount;
    html = buildTranscriptHtml(record, includedMessages, applicationChannel.name, omittedCount);
  }
  if (Buffer.byteLength(html, 'utf8') > maxBytes) throw new Error('Transcript is too large to upload safely.');
  const file = new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `transcript-${record.id}.html` });
  const embed = new EmbedBuilder()
    .setColor(record.status === 'approved' ? '#57F287' : '#ED4245')
    .setTitle(`${record.positionName} — ${record.status.toUpperCase()}`)
    .setDescription(`Archived application **${record.id}** from <@${record.userId}>`)
    .addFields(
      { name: 'Applicant', value: `<@${record.userId}>`, inline: true },
      { name: 'Reviewer', value: `<@${record.decidedBy}>`, inline: true },
      { name: 'Messages', value: omittedCount ? `${includedMessages.length} archived (${omittedCount} omitted)` : String(messages.length), inline: true },
      { name: 'Submitted', value: `<t:${Math.floor(new Date(record.createdAt).getTime() / 1000)}:f>`, inline: true },
      { name: 'Decided', value: `<t:${Math.floor(new Date(record.decidedAt).getTime() / 1000)}:f>`, inline: true },
    )
    .setTimestamp(new Date(record.decidedAt));
  if (record.denialReason) embed.addFields({ name: 'Reason', value: truncate(record.denialReason, 1024) });
  const archiveMessage = await transcriptChannel.send({ embeds: [embed], files: [file], allowedMentions: { parse: [] } });
  const pages = buildDiscordTranscriptPages(includedMessages);
  let discordTranscriptChannel = transcriptChannel;
  let transcriptThread;
  try {
    transcriptThread = await archiveMessage.startThread({
      name: truncate(`transcript-${record.id}-${record.username}`, 100),
      autoArchiveDuration: 1440,
      reason: `Discord transcript for application ${record.id}`,
    });
    discordTranscriptChannel = transcriptThread;
  } catch (error) {
    logger.warn(`Could not create transcript thread for ${record.id}; posting pages in the archive channel:`, error.message);
  }

  try {
    await postDiscordTranscriptPages(discordTranscriptChannel, pages, record);
  } catch (error) {
    if (!transcriptThread) throw error;
    logger.warn(`Could not post transcript pages in thread for ${record.id}; using the archive channel:`, error.message);
    await transcriptThread.delete('Transcript posting failed; archive channel fallback used').catch(() => {});
    transcriptThread = undefined;
    await postDiscordTranscriptPages(transcriptChannel, pages, record);
  }

  if (transcriptThread) {
    embed.addFields({ name: 'Read in Discord', value: `<#${transcriptThread.id}>`, inline: false });
    await archiveMessage.edit({ embeds: [embed] }).catch((error) => {
      logger.warn(`Could not add transcript thread link for ${record.id}:`, error.message);
    });
  }
  return applicationChannel;
}

function statusEmbed(record) {
  const labels = { pending: 'Pending review', approved: 'Approved', denied: 'Denied' };
  const color = record.status === 'approved' ? '#57F287' : record.status === 'denied' ? '#ED4245' : '#FEE75C';
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('Application Status')
    .setDescription(`Your **${record.positionName}** application is **${labels[record.status] ?? record.status}**.`)
    .addFields({ name: 'Application ID', value: record.id, inline: true });
  if (record.denialReason) embed.addFields({ name: 'Reason', value: truncate(record.denialReason, 1024) });
  return embed;
}

async function notifyApplicant(client, record) {
  const user = await client.users.fetch(record.userId);
  const approved = record.status === 'approved';
  const embed = new EmbedBuilder()
    .setColor(approved ? '#57F287' : '#ED4245')
    .setTitle(approved ? 'Application Approved' : 'Application Denied')
    .setDescription(`Your **${record.positionName}** application in **${record.guildName}** was **${record.status}**.`)
    .setTimestamp(new Date(record.decidedAt));
  if (record.denialReason) embed.addFields({ name: 'Reason', value: truncate(record.denialReason, 1024) });
  await user.send({ embeds: [embed] });
}

export async function applyApprovalRoleChanges(member, record, auditReason, saveDecision, logger = console) {
  const rolesToGrant = grantRoleIds(record);
  const rolesToRemove = removeRoleIds(record);
  const newlyGranted = rolesToGrant.filter((roleId) => !member.roles.cache.has(roleId));
  const newlyRemoved = rolesToRemove.filter((roleId) => member.roles.cache.has(roleId));
  let updated;
  try {
    if (rolesToGrant.length) await member.roles.add(rolesToGrant, auditReason);
    if (rolesToRemove.length) await member.roles.remove(rolesToRemove, auditReason);
    updated = await saveDecision();
    if (!updated) throw new Error('The application was already decided before the approval could be saved.');
  } catch (error) {
    if (newlyGranted.length) await member.roles.remove(newlyGranted, `Rollback failed approval ${record.id}`).catch((rollbackError) => logger.error('Could not roll back granted roles:', rollbackError));
    if (newlyRemoved.length) await member.roles.add(newlyRemoved, `Rollback failed approval ${record.id}`).catch((rollbackError) => logger.error('Could not restore removed roles:', rollbackError));
    throw error;
  }
  return { updated, rolesToGrant, rolesToRemove };
}

export function attachBotHandlers(client, {
  configService,
  store,
  reactionRoleStore,
  restrictionStore = { getActive: async () => null },
  logger = console,
}) {
  const sessions = new Map();
  const processing = new Set();

  function cleanSessions() {
    const cutoff = Date.now() - SESSION_LIFETIME_MS;
    for (const [token, session] of sessions) if (session.updatedAt < cutoff) sessions.delete(token);
  }

  function sessionForUser(userId) {
    cleanSessions();
    return [...sessions.values()].find((session) => session.userId === userId);
  }

  function isReviewer(interaction, config) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
      || config.reviewerRoleIds.some((roleId) => interaction.member?.roles?.cache?.has(roleId));
  }

  function isConfigManager(interaction) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
  }

  async function applicationBlock(guildId, userId, now = Date.now()) {
    const bar = await restrictionStore.getActive(guildId, userId, now);
    if (bar) return { type: 'bar', record: bar };
    const denial = await store.latestDeniedForUser?.(guildId, userId);
    if (!denial) return null;
    const decidedAt = Date.parse(denial.decidedAt);
    if (!Number.isFinite(decidedAt)) return null;
    const expiresAt = decidedAt + DENIAL_COOLDOWN_MS;
    if (expiresAt <= now) return null;
    return { type: 'cooldown', expiresAt, denial };
  }

  function applicationBlockPayload(block) {
    if (block.type === 'bar') {
      const duration = block.record.expiresAt === null
        ? 'Permanent'
        : `<t:${Math.floor(Date.parse(block.record.expiresAt) / 1000)}:F> (<t:${Math.floor(Date.parse(block.record.expiresAt) / 1000)}:R>)`;
      return {
        embeds: [new EmbedBuilder()
          .setColor('#ED4245')
          .setTitle('Applications Restricted')
          .setDescription('You are currently barred from submitting applications in this server.')
          .addFields({ name: 'Restriction ends', value: duration }, { name: 'Reason', value: block.record.reason || 'No reason provided.' })],
        flags: MessageFlags.Ephemeral,
      };
    }
    const timestamp = Math.floor(block.expiresAt / 1000);
    return {
      embeds: [new EmbedBuilder()
        .setColor('#FEE75C')
        .setTitle('Application Cooldown')
        .setDescription(`You must wait 24 hours after a denied application before applying again. You can submit another application <t:${timestamp}:R>.`)
        .addFields({ name: 'Cooldown ends', value: `<t:${timestamp}:F>` })],
      flags: MessageFlags.Ephemeral,
    };
  }

  async function startApplication(interaction, config, positionId) {
    const block = await applicationBlock(interaction.guildId, interaction.user.id);
    if (block) {
      await interaction.reply(applicationBlockPayload(block));
      return;
    }
    if (!config.allowMultiplePendingApplications && await store.hasPending(interaction.guildId, interaction.user.id)) {
      await interaction.reply(ephemeral('You already have an application awaiting review. Use `/status` to check it.'));
      return;
    }
    const position = config.positions.find((item) => item.id === positionId);
    if (!position) {
      await interaction.reply(ephemeral('That position is no longer available. Please start again.'));
      return;
    }
    if (!grantRoleIds(position).length || !grantRoleIds(position).every(isDiscordId) || !removeRoleIds(position).every(isDiscordId)
      || !isDiscordId(config.applicationCategoryId) || !isDiscordId(config.transcriptChannelId)
      || config.reviewerRoleIds.some((id) => !isDiscordId(id))) {
      await interaction.reply(ephemeral('That application is not fully configured yet. A server manager must run `/setup`.'));
      return;
    }
    if (sessionForUser(interaction.user.id)) {
      await interaction.reply(ephemeral('You already have an unfinished application interview in your DMs. Finish it or type `cancel` there before starting another.'));
      return;
    }
    const token = crypto.randomBytes(9).toString('base64url');
    const session = {
      token,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      guildName: interaction.guild?.name ?? 'Discord server',
      positionId,
      position: structuredClone(position),
      config: structuredClone(config),
      answers: {},
      questionIndex: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      processing: false,
    };
    sessions.set(token, session);
    try {
      await interaction.user.send(dmQuestionPayload(session));
    } catch (error) {
      sessions.delete(token);
      logger.warn(`Could not start DM application for ${interaction.user.id}:`, error.message);
      await interaction.reply(ephemeral('I could not DM you. Enable direct messages from server members, then press the application button again.'));
      return;
    }
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('Application Started in DMs')
        .setDescription(`I sent you the first **${position.name}** question. Reply to the bot's DM to continue through all ${position.questions.length} questions.`)
        .setFooter({ text: 'Your answers remain private from other applicants.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  async function submitApplicationFromDm(message, session) {
    const { config, position } = session;
    const guild = await client.guilds.fetch(session.guildId);
    const record = {
      id: crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase(),
      guildId: session.guildId,
      guildName: guild.name,
      userId: message.author.id,
      username: message.author.tag,
      positionId: position.id,
      positionName: position.name,
      grantRoleIds: [...grantRoleIds(position)],
      removeRoleIds: [...removeRoleIds(position)],
      transcriptChannelId: config.transcriptChannelId,
      answers: position.questions.map((question) => ({ question: question.label, value: session.answers[question.id] ?? '' })),
      status: 'pending',
      createdAt: new Date().toISOString(),
      decidedAt: null,
      decidedBy: null,
    };

    const safeName = message.author.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'applicant';
    const staffPermissions = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks,
    ];
    const reviewChannel = await guild.channels.create({
      name: `application-${safeName}-${record.id.toLowerCase()}`,
      type: ChannelType.GuildText,
      parent: config.applicationCategoryId,
      topic: `${position.name} • ${message.author.tag} • ${record.id}`,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        ...config.reviewerRoleIds.map((roleId) => ({ id: roleId, allow: staffPermissions })),
        {
          id: client.user.id,
          allow: [...staffPermissions, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages],
        },
      ],
      reason: `Private channel for application ${record.id}`,
    });
    record.reviewChannelId = reviewChannel.id;
    const reviewMessage = await reviewChannel.send({
      content: config.reviewerRoleIds.map((roleId) => `<@&${roleId}>`).join(' '),
      allowedMentions: { roles: config.reviewerRoleIds },
      ...reviewPayload(record, config),
    });
    record.reviewMessageId = reviewMessage.id;
    for (const embeds of batchEmbeds(answerEmbeds(record, config.panel.color))) {
      await reviewChannel.send({ embeds, allowedMentions: { parse: [] } });
    }
    await store.create(record);
    sessions.delete(session.token);
    return record;
  }

  async function finalizeApplicationChannel(interaction, record, config, decisionMessage) {
    let channel;
    try {
      const guild = await client.guilds.fetch(record.guildId);
      channel = await createTranscript(guild, record, config, logger);
    } catch (error) {
      logger.error(`Transcript failed for ${record.id}:`, error);
      await interaction.editReply({ content: `${decisionMessage} The transcript failed, so the application channel was not deleted. Check the bot logs.` });
      return;
    }
    await interaction.editReply({ content: `${decisionMessage} Transcript saved. This application channel will now be deleted.` });
    try {
      await channel.delete(`Application ${record.id} ${record.status}; transcript archived`);
    } catch (error) {
      logger.error(`Channel deletion failed for ${record.id}:`, error);
      await interaction.editReply({ content: `${decisionMessage} The transcript was saved, but channel deletion failed. Check the bot logs.` });
    }
  }

  async function approve(interaction, config, record) {
    const member = await interaction.guild.members.fetch(record.userId);
    const auditReason = `Application ${record.id} approved by ${interaction.user.tag}`;
    const { updated, rolesToGrant, rolesToRemove } = await applyApprovalRoleChanges(member, record, auditReason, () => store.decide(record.id, {
        status: 'approved',
        decidedAt: new Date().toISOString(),
        decidedBy: interaction.user.id,
      }), logger);
    await interaction.message.edit(reviewPayload(updated, config));
    const changes = [
      rolesToGrant.length ? `Granted ${rolesToGrant.map((roleId) => `<@&${roleId}>`).join(', ')}` : null,
      rolesToRemove.length ? `Removed ${rolesToRemove.map((roleId) => `<@&${roleId}>`).join(', ')}` : null,
    ].filter(Boolean).join(' • ');
    await finalizeApplicationChannel(interaction, updated, config, `Approved **${record.id}**. ${changes}.`);
    notifyApplicant(client, updated).catch((error) => logger.warn('Could not DM approved applicant:', error.message));
  }

  async function deny(interaction, config, record, reason) {
    const updated = await store.decide(record.id, {
      status: 'denied',
      denialReason: reason,
      decidedAt: new Date().toISOString(),
      decidedBy: interaction.user.id,
    });
    const channel = await interaction.guild.channels.fetch(record.reviewChannelId);
    const message = await channel.messages.fetch(record.reviewMessageId);
    await message.edit(reviewPayload(updated, config));
    await finalizeApplicationChannel(interaction, updated, config, `Denied application **${record.id}**.`);
    notifyApplicant(client, updated).catch((error) => logger.warn('Could not DM denied applicant:', error.message));
  }

  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.inGuild()) return;
      const config = await configService.get({ allowPlaceholders: true });

      if ((interaction.isMessageComponent() || interaction.isModalSubmit()) && interaction.customId.startsWith('setup:')) {
        if (!isConfigManager(interaction)) {
          await interaction.reply(ephemeral('You need the **Manage Server** permission to configure applications.'));
          return;
        }

        if (interaction.isButton() && interaction.customId === 'setup:home') {
          await interaction.update(setupMainView(config));
          return;
        }

        if (interaction.isRoleSelectMenu() && interaction.customId === 'setup:reviewers') {
          const next = await configService.update((draft) => {
            draft.reviewerRoleIds = interaction.values;
          }, { allowPlaceholders: true });
          await interaction.update(setupMainView(next, 'Reviewer roles saved.'));
          return;
        }

        if (interaction.isChannelSelectMenu() && interaction.customId === 'setup:category') {
          const next = await configService.update((draft) => {
            draft.applicationCategoryId = interaction.values[0];
          }, { allowPlaceholders: true });
          await interaction.update(setupMainView(next, 'Application category saved.'));
          return;
        }

        if (interaction.isChannelSelectMenu() && interaction.customId === 'setup:transcripts') {
          const next = await configService.update((draft) => {
            draft.transcriptChannelId = interaction.values[0];
          }, { allowPlaceholders: true });
          await interaction.update(setupMainView(next, 'Transcript channel saved.'));
          return;
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'setup:position') {
          const position = config.positions.find((item) => item.id === interaction.values[0]);
          if (!position) throw new Error('That position no longer exists.');
          await interaction.update(setupPositionView(config, position));
          return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('setup:open:')) {
          const position = config.positions.find((item) => item.id === interaction.customId.split(':')[2]);
          if (!position) throw new Error('That position no longer exists.');
          await interaction.update(setupPositionView(config, position));
          return;
        }

        if (interaction.isRoleSelectMenu() && /^setup:(grant|remove)-roles:/.test(interaction.customId)) {
          const removing = interaction.customId.startsWith('setup:remove-roles:');
          const positionId = interaction.customId.split(':')[2];
          const next = await configService.update((draft) => {
            const position = draft.positions.find((item) => item.id === positionId);
            if (!position) throw new Error('That position no longer exists.');
            if (removing) position.removeRoleIds = interaction.values;
            else position.grantRoleIds = interaction.values;
          }, { allowPlaceholders: true });
          const position = next.positions.find((item) => item.id === positionId);
          await interaction.update(setupPositionView(next, position, false, removing ? 'Roles removed on approval saved.' : 'Roles granted on approval saved.'));
          return;
        }

        if (interaction.isButton() && interaction.customId === 'setup:add-position') {
          if (config.positions.length >= 25) {
            await interaction.reply(ephemeral('Discord supports at most 25 positions in the application selector.'));
            return;
          }
          await interaction.showModal(positionDetailsModal(null));
          return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('setup:edit-position:')) {
          const position = config.positions.find((item) => item.id === interaction.customId.split(':')[2]);
          if (!position) throw new Error('That position no longer exists.');
          await interaction.showModal(positionDetailsModal(position));
          return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('setup:delete-position:')) {
          const position = config.positions.find((item) => item.id === interaction.customId.split(':')[2]);
          if (!position) throw new Error('That position no longer exists.');
          if (config.positions.length === 1) {
            await interaction.reply(ephemeral('At least one application position must remain.'));
            return;
          }
          await interaction.update(setupPositionView(config, position, true));
          return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('setup:confirm-delete:')) {
          const positionId = interaction.customId.split(':')[2];
          const next = await configService.update((draft) => {
            if (draft.positions.length === 1) throw new Error('At least one position must remain.');
            const index = draft.positions.findIndex((item) => item.id === positionId);
            if (index === -1) throw new Error('That position no longer exists.');
            draft.positions.splice(index, 1);
          }, { allowPlaceholders: true });
          await interaction.update(setupMainView(next, 'Position deleted.'));
          return;
        }

        if (interaction.isModalSubmit() && /^setup:modal-(add|edit)/.test(interaction.customId)) {
          const editing = interaction.customId.startsWith('setup:modal-edit:');
          const positionId = editing ? interaction.customId.split(':')[2] : null;
          const name = interaction.fields.getTextInputValue('name').trim();
          const description = interaction.fields.getTextInputValue('description').trim();
          try {
            const next = await configService.update((draft) => {
              if (editing) {
                const position = draft.positions.find((item) => item.id === positionId);
                if (!position) throw new Error('That position no longer exists.');
                position.name = name;
                position.description = description;
              } else {
                if (draft.positions.length >= 25) throw new Error('The 25-position limit has been reached.');
                draft.positions.push({
                  id: uniquePositionId(name, draft.positions),
                  name,
                  description,
                  grantRoleIds: ['PUT_POSITION_ROLE_ID_HERE'],
                  removeRoleIds: [],
                  questions: [{
                    id: 'character-name',
                    label: "What is your character's name?",
                    style: 'short',
                    required: true,
                    maxLength: 100,
                  }],
                });
              }
            }, { allowPlaceholders: true });
            const position = editing
              ? next.positions.find((item) => item.id === positionId)
              : next.positions.at(-1);
            await interaction.reply({
              ...setupPositionView(next, position, false, editing ? 'Position updated.' : 'Position added. Now select its approval roles.'),
              flags: MessageFlags.Ephemeral,
            });
          } catch (error) {
            await interaction.reply(ephemeral(`Could not save the position: ${error.message}`));
          }
          return;
        }
      }

      if ((interaction.isMessageComponent() || interaction.isModalSubmit()) && interaction.customId.startsWith('cfg:')) {
        if (!isConfigManager(interaction)) {
          await interaction.reply(ephemeral('You need the **Manage Server** permission to change application questions.'));
          return;
        }

        if (interaction.isButton() && interaction.customId === 'cfg:positions') {
          await interaction.update(configPositionPicker(config));
          return;
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'cfg:position') {
          const position = config.positions.find((item) => item.id === interaction.values[0]);
          if (!position) throw new Error('That position no longer exists.');
          await interaction.update(configPositionView(config, position));
          return;
        }

        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('cfg:qselect:')) {
          const [, , positionId, pageText] = interaction.customId.split(':');
          const position = config.positions.find((item) => item.id === positionId);
          const question = position?.questions.find((item) => item.id === interaction.values[0]);
          if (!position || !question) throw new Error('That question no longer exists.');
          await interaction.update(configQuestionView(config, position, question, Number(pageText)));
          return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('cfg:qpage:')) {
          const [, , positionId, pageText] = interaction.customId.split(':');
          const position = config.positions.find((item) => item.id === positionId);
          if (!position) throw new Error('That position no longer exists.');
          await interaction.update(configPositionView(config, position, Number(pageText)));
          return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('cfg:add:')) {
          const [, , positionId, pageText] = interaction.customId.split(':');
          const position = config.positions.find((item) => item.id === positionId);
          if (!position) throw new Error('That position no longer exists.');
          await interaction.showModal(questionModal(position, null, Number(pageText)));
          return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('cfg:e:')) {
          const [, , positionId, questionId, pageText] = interaction.customId.split(':');
          const position = config.positions.find((item) => item.id === positionId);
          const question = position?.questions.find((item) => item.id === questionId);
          if (!position || !question) throw new Error('That question no longer exists.');
          await interaction.showModal(questionModal(position, question, Number(pageText)));
          return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('cfg:x:')) {
          const [, , positionId, questionId, pageText] = interaction.customId.split(':');
          const position = config.positions.find((item) => item.id === positionId);
          const question = position?.questions.find((item) => item.id === questionId);
          if (!position || !question) throw new Error('That question no longer exists.');
          await interaction.update(configQuestionView(config, position, question, Number(pageText)));
          return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('cfg:d:')) {
          const [, , positionId, questionId, pageText] = interaction.customId.split(':');
          const position = config.positions.find((item) => item.id === positionId);
          const question = position?.questions.find((item) => item.id === questionId);
          if (!position || !question) throw new Error('That question no longer exists.');
          if (position.questions.length === 1) {
            await interaction.reply(ephemeral('A position must keep at least one question. Add a replacement before deleting this one.'));
            return;
          }
          await interaction.update(configQuestionView(config, position, question, Number(pageText), true));
          return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('cfg:cd:')) {
          const [, , positionId, questionId, pageText] = interaction.customId.split(':');
          const next = await configService.update((draft) => {
            const position = draft.positions.find((item) => item.id === positionId);
            if (!position || position.questions.length === 1) throw new Error('This question cannot be deleted.');
            const index = position.questions.findIndex((item) => item.id === questionId);
            if (index === -1) throw new Error('That question no longer exists.');
            position.questions.splice(index, 1);
          }, { allowPlaceholders: true });
          const position = next.positions.find((item) => item.id === positionId);
          await interaction.update(configPositionView(next, position, Number(pageText), 'Question deleted.'));
          return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('cfg:m:')) {
          const [, , positionId, questionId, direction, pageText] = interaction.customId.split(':');
          const next = await configService.update((draft) => {
            const position = draft.positions.find((item) => item.id === positionId);
            if (!position) throw new Error('That position no longer exists.');
            const index = position.questions.findIndex((item) => item.id === questionId);
            const target = direction === 'up' ? index - 1 : index + 1;
            if (index === -1 || target < 0 || target >= position.questions.length) throw new Error('That question cannot move in that direction.');
            [position.questions[index], position.questions[target]] = [position.questions[target], position.questions[index]];
          }, { allowPlaceholders: true });
          const position = next.positions.find((item) => item.id === positionId);
          const question = position.questions.find((item) => item.id === questionId);
          const newPage = Math.floor(position.questions.indexOf(question) / CONFIG_QUESTIONS_PER_PAGE);
          await interaction.update(configQuestionView(next, position, question, newPage));
          return;
        }

        if (interaction.isModalSubmit() && /^cfg:m[ae]:/.test(interaction.customId)) {
          const [operation, positionId, questionIdOrPage, editPage] = interaction.customId.slice(4).split(':');
          const editing = operation === 'me';
          const questionId = editing ? questionIdOrPage : null;
          const requestedPage = Number(editing ? editPage : questionIdOrPage);
          try {
            const next = await configService.update((draft) => {
              const position = draft.positions.find((item) => item.id === positionId);
              if (!position) throw new Error('That position no longer exists.');
              const index = editing ? position.questions.findIndex((item) => item.id === questionId) : -1;
              if (editing && index === -1) throw new Error('That question no longer exists.');
              const question = questionFromModal(interaction, editing ? position.questions[index] : null, position.questions);
              if (editing) position.questions[index] = question;
              else position.questions.push(question);
            }, { allowPlaceholders: true });
            const position = next.positions.find((item) => item.id === positionId);
            const page = editing ? requestedPage : Math.floor((position.questions.length - 1) / CONFIG_QUESTIONS_PER_PAGE);
            await interaction.reply({
              ...configPositionView(next, position, page, editing ? 'Question updated.' : 'Question added.'),
              flags: MessageFlags.Ephemeral,
            });
          } catch (error) {
            await interaction.reply(ephemeral(`Could not save the question: ${error.message}`));
          }
          return;
        }
      }

      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'apply') {
          await interaction.reply(positionPicker(config));
        } else if (interaction.commandName === 'status') {
          const record = await store.latestForUser(interaction.guildId, interaction.user.id);
          await interaction.reply(record
            ? { embeds: [statusEmbed(record)], flags: MessageFlags.Ephemeral }
            : ephemeral('You have not submitted an application yet.'));
        } else if (interaction.commandName === 'panel') {
          if (!interaction.channel?.isTextBased()) return;
          await interaction.reply(panelPositionPicker(config));
        } else if (interaction.commandName === 'questions') {
          if (!isConfigManager(interaction)) {
            await interaction.reply(ephemeral('You need the **Manage Server** permission to change application questions.'));
            return;
          }
          await interaction.reply({ ...configPositionPicker(config), flags: MessageFlags.Ephemeral });
        } else if (interaction.commandName === 'setup') {
          if (!isConfigManager(interaction)) {
            await interaction.reply(ephemeral('You need the **Manage Server** permission to configure applications.'));
            return;
          }
          await interaction.reply({ ...setupMainView(config), flags: MessageFlags.Ephemeral });
        } else if (interaction.commandName === 'message') {
          if (!isReviewer(interaction, config)) {
            await interaction.reply(ephemeral('You do not have permission to message applicants.'));
            return;
          }
          const record = await store.pendingForChannel(interaction.guildId, interaction.channelId);
          if (!record) {
            await interaction.reply(ephemeral('Use this command inside an open application channel.'));
            return;
          }
          const content = interaction.options.getString('message', true);
          try {
            const applicant = await client.users.fetch(record.userId);
            await applicant.send({
              embeds: [new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle(`Message from ${interaction.guild.name} Application Staff`)
                .setDescription(content)
                .setFooter({ text: 'Reply to this DM to send your response privately to application staff.' })
                .setTimestamp()],
            });
          } catch (error) {
            logger.warn(`Could not DM applicant for ${record.id}:`, error.message);
            await interaction.reply(ephemeral('The applicant could not be DMed. They may have server DMs disabled or have blocked the bot.'));
            return;
          }
          await interaction.channel.send({
            embeds: [new EmbedBuilder()
              .setColor('#5865F2')
              .setAuthor({ name: `Staff DM sent by ${interaction.user.tag}` })
              .setDescription(content)
              .setTimestamp()],
            allowedMentions: { parse: [] },
          });
          await interaction.reply(ephemeral('Message sent to the applicant by DM.'));
        } else if (interaction.commandName === 'roles') {
          await handleReactionRoleCommand(interaction, reactionRoleStore);
        } else if (interaction.commandName === 'bar') {
          if (!isConfigManager(interaction)) {
            await interaction.reply(ephemeral('You need the **Manage Server** permission to manage application bars.'));
            return;
          }
          try {
            await handleApplicationBarCommand(interaction, restrictionStore);
          } catch (error) {
            logger.warn('Could not manage application bar:', error.message);
            await interaction.reply(ephemeral(`Could not manage the application bar: ${error.message}`));
          }
        }
        return;
      }

      if (interaction.isStringSelectMenu() && interaction.customId === 'application:position') {
        await startApplication(interaction, config, interaction.values[0]);
        return;
      }

      if (interaction.isStringSelectMenu() && interaction.customId === 'application:panel-positions') {
        if (!isConfigManager(interaction)) {
          await interaction.reply(ephemeral('You need the **Manage Server** permission to post application panels.'));
          return;
        }
        const available = new Map(configuredPositions(config).map((position) => [position.id, position]));
        const positions = interaction.values.map((id) => available.get(id)).filter(Boolean);
        if (!positions.length || !interaction.channel?.isTextBased()) {
          await interaction.update({ content: 'Those applications are no longer available. Run `/panel` again.', components: [] });
          return;
        }
        await interaction.channel.send({ embeds: [panelEmbed(config, positions)], components: panelComponents(positions) });
        await interaction.update({ content: `Application panel posted with ${positions.length} direct button${positions.length === 1 ? '' : 's'}.`, components: [] });
        return;
      }

      if (interaction.isButton() && interaction.customId === 'application:start') {
        await interaction.reply(positionPicker(config));
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith('application:start:')) {
        await startApplication(interaction, config, interaction.customId.slice('application:start:'.length));
        return;
      }

      if (interaction.isButton() && /^application:(approve|deny):/.test(interaction.customId)) {
        if (!isReviewer(interaction, config)) {
          await interaction.reply(ephemeral('You do not have permission to review applications.'));
          return;
        }
        const [, action, id] = interaction.customId.split(':');
        const record = await store.get(id);
        if (!record || record.status !== 'pending') {
          await interaction.reply(ephemeral('This application has already been reviewed or no longer exists.'));
          return;
        }
        if (action === 'deny') {
          const input = new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Reason for denial')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMinLength(3)
            .setMaxLength(1000);
          const modal = new ModalBuilder()
            .setCustomId(`application:deny-reason:${id}`)
            .setTitle('Deny application')
            .addComponents(new ActionRowBuilder().addComponents(input));
          await interaction.showModal(modal);
          return;
        }
        if (processing.has(id)) {
          await interaction.reply(ephemeral('Another reviewer is already processing this application.'));
          return;
        }
        processing.add(id);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          await approve(interaction, config, record);
        } finally {
          processing.delete(id);
        }
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('application:deny-reason:')) {
        if (!isReviewer(interaction, config)) {
          await interaction.reply(ephemeral('You do not have permission to review applications.'));
          return;
        }
        const id = interaction.customId.split(':')[2];
        if (processing.has(id)) {
          await interaction.reply(ephemeral('Another reviewer is already processing this application.'));
          return;
        }
        const record = await store.get(id);
        if (!record || record.status !== 'pending') {
          await interaction.reply(ephemeral('This application has already been reviewed or no longer exists.'));
          return;
        }
        processing.add(id);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          await deny(interaction, config, record, interaction.fields.getTextInputValue('reason'));
        } finally {
          processing.delete(id);
        }
      }
    } catch (error) {
      logger.error('Interaction failed:', error);
      const response = ephemeral('Something went wrong while processing that action. Check the bot logs for details.');
      if (interaction.deferred) await interaction.editReply({ content: response.content }).catch(() => {});
      else if (interaction.replied) await interaction.followUp(response).catch(() => {});
      else await interaction.reply(response).catch(() => {});
    }
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot || message.guild) return;
    try {
      const session = sessionForUser(message.author.id);
      if (session) {
        const block = await applicationBlock(session.guildId, message.author.id);
        if (block) {
          sessions.delete(session.token);
          const payload = applicationBlockPayload(block);
          delete payload.flags;
          payload.embeds[0].setDescription(block.type === 'bar'
            ? 'Your unfinished application interview was closed because you are currently barred from applying.'
            : 'Your unfinished application interview was closed because a 24-hour denial cooldown is active.');
          await message.reply(payload);
          return;
        }
        if (session.processing) {
          await message.reply({
            embeds: [new EmbedBuilder()
              .setColor('#FEE75C')
              .setTitle('Please Wait')
              .setDescription('I am still saving your previous answer.')],
          });
          return;
        }
        session.processing = true;
        try {
          const command = message.content.trim().toLowerCase();
          if (command === 'cancel') {
            sessions.delete(session.token);
            await message.reply({
              embeds: [new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('Application Cancelled')
                .setDescription(`Your unfinished **${session.position.name}** application was discarded.`)],
            });
            return;
          }
          if (command === 'back') {
            if (session.questionIndex === 0) {
              await message.reply({
                embeds: [new EmbedBuilder()
                  .setColor('#FEE75C')
                  .setTitle('Already at the First Question')
                  .setDescription('Reply with your answer, or type `cancel` to stop.')],
              });
              return;
            }
            session.questionIndex -= 1;
            delete session.answers[session.position.questions[session.questionIndex].id];
            session.updatedAt = Date.now();
            await message.reply(dmQuestionPayload(session));
            return;
          }

          const question = session.position.questions[session.questionIndex];
          const attachmentLines = [...message.attachments.values()].map((attachment) => `[Attachment: ${attachment.name}](${attachment.url})`);
          const answer = [message.content.trim() || null, ...attachmentLines].filter(Boolean).join('\n');
          const minimum = question.minLength ?? 0;
          const maximum = question.maxLength ?? (question.style === 'short' ? 400 : 4000);
          if (!answer && question.required) {
            await message.reply({
              embeds: [new EmbedBuilder().setColor('#ED4245').setTitle('Answer Required').setDescription('Please reply with an answer to continue.')],
            });
            return;
          }
          if (answer && answer.length < minimum) {
            await message.reply({
              embeds: [new EmbedBuilder().setColor('#ED4245').setTitle('Answer Too Short').setDescription(`Please use at least ${minimum} characters. Your answer has ${answer.length}.`)],
            });
            return;
          }
          if (answer.length > maximum) {
            await message.reply({
              embeds: [new EmbedBuilder().setColor('#ED4245').setTitle('Answer Too Long').setDescription(`Please use no more than ${maximum} characters. Your answer has ${answer.length}.`)],
            });
            return;
          }

          session.answers[question.id] = answer;
          session.updatedAt = Date.now();
          if (session.questionIndex + 1 < session.position.questions.length) {
            session.questionIndex += 1;
            try {
              await message.reply(dmQuestionPayload(session));
            } catch (error) {
              session.questionIndex -= 1;
              delete session.answers[question.id];
              throw error;
            }
            return;
          }

          const record = await submitApplicationFromDm(message, session);
          await message.reply({
            embeds: [new EmbedBuilder()
              .setColor('#57F287')
              .setTitle('Application Submitted')
              .setDescription('Your answers were sent privately to the review team. Staff can contact you through this DM if they need more information, and you will receive the final decision here.')
              .addFields({ name: 'Application', value: record.positionName, inline: true }, { name: 'Application ID', value: record.id, inline: true })],
          }).catch((error) => logger.warn(`Application ${record.id} was submitted, but its confirmation DM failed:`, error.message));
          return;
        } catch (error) {
          logger.error(`Could not process DM application for ${message.author.id}:`, error);
          await message.reply({
            embeds: [new EmbedBuilder()
              .setColor('#ED4245')
              .setTitle('Answer Not Saved')
              .setDescription('Something went wrong while saving your answer. Your interview is still open; please try sending the answer again.')],
          }).catch(() => {});
          return;
        } finally {
          session.processing = false;
        }
      }

      const record = await store.latestPendingForUser(message.author.id);
      if (!record) {
        await message.reply({
          embeds: [new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('No Open Application')
            .setDescription('You do not have an open application to reply to.')],
        });
        return;
      }
      const applicationChannel = await client.channels.fetch(record.reviewChannelId);
      if (!applicationChannel?.isTextBased()) {
        await message.reply({
          embeds: [new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('Message Not Delivered')
            .setDescription('Your application is unavailable. Please contact server staff directly.')],
        });
        return;
      }
      const attachmentLines = [...message.attachments.values()].map((attachment) => `[Attachment: ${attachment.name}](${attachment.url})`);
      const description = [message.content || null, ...attachmentLines].filter(Boolean).join('\n') || '*Empty message*';
      await applicationChannel.send({
        embeds: [new EmbedBuilder()
          .setColor('#FEE75C')
          .setAuthor({ name: `DM reply from ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
          .setDescription(truncate(description, 4000))
          .setTimestamp(message.createdAt)],
        allowedMentions: { parse: [] },
      });
      await message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#57F287')
          .setTitle('Message Delivered')
          .setDescription('Your reply was sent privately to the application staff.')],
      });
    } catch (error) {
      logger.error('Could not relay applicant DM:', error);
      await message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ED4245')
          .setTitle('Message Not Delivered')
          .setDescription('Your message could not be delivered. Please try again later.')],
      }).catch(() => {});
    }
  });
}
