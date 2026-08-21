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

const SESSION_LIFETIME_MS = 30 * 60 * 1000;
const QUESTIONS_PER_PAGE = 5;
const CONFIG_QUESTIONS_PER_PAGE = 20;

function ephemeral(content, extra = {}) {
  return { content, flags: MessageFlags.Ephemeral, ...extra };
}

function isDiscordId(value) {
  return /^\d{17,20}$/.test(value);
}

function configuredPositions(config) {
  if (!config.reviewerRoleIds.length || config.reviewerRoleIds.some((id) => !isDiscordId(id))) return [];
  return config.positions.filter((position) => isDiscordId(position.roleId) && isDiscordId(position.reviewChannelId));
}

function truncate(value, length) {
  if (value.length <= length) return value;
  return `${value.slice(0, length - 1)}…`;
}

function panelEmbed(config) {
  return new EmbedBuilder()
    .setColor(config.panel.color)
    .setTitle(config.panel.title)
    .setDescription(config.panel.description)
    .setFooter({ text: 'Use the button below to begin.' });
}

function panelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('application:start')
        .setLabel('Apply now')
        .setEmoji('📝')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function positionPicker(config) {
  const positions = configuredPositions(config);
  if (!positions.length) {
    return ephemeral('Applications are not configured yet. A server manager must run `/application-setup`.');
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
    const role = isDiscordId(position.roleId) ? `<@&${position.roleId}>` : 'role not set';
    const channel = isDiscordId(position.reviewChannelId) ? `<#${position.reviewChannelId}>` : 'channel not set';
    return `• **${position.name}** — ${role}, ${channel}`;
  }).join('\n');
  const embed = new EmbedBuilder()
    .setColor(readyCount === config.positions.length && reviewerIds.length ? '#57F287' : '#FEE75C')
    .setTitle('Application setup')
    .setDescription([
      `**Reviewer roles:** ${reviewerIds.length ? reviewerIds.map((id) => `<@&${id}>`).join(', ') : 'Not set'}`,
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
  const positionMenu = new StringSelectMenuBuilder()
    .setCustomId('setup:position')
    .setPlaceholder('Choose a position to configure')
    .addOptions(config.positions.map((position) => ({
      label: position.name,
      description: isDiscordId(position.roleId) && isDiscordId(position.reviewChannelId) ? 'Configured' : 'Setup required',
      value: position.id,
    })));
  return {
    content: notice || null,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(reviewerMenu),
      new ActionRowBuilder().addComponents(positionMenu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('setup:add-position').setLabel('Add position').setStyle(ButtonStyle.Success),
      ),
    ],
  };
}

function setupPositionView(config, position, confirmDelete = false, notice) {
  const roleIsSet = isDiscordId(position.roleId);
  const channelIsSet = isDiscordId(position.reviewChannelId);
  const embed = new EmbedBuilder()
    .setColor(confirmDelete ? '#ED4245' : roleIsSet && channelIsSet ? '#57F287' : '#FEE75C')
    .setTitle(confirmDelete ? `Delete ${position.name}?` : `Set up ${position.name}`)
    .setDescription(confirmDelete
      ? 'This removes the position and its questions. Existing submitted applications remain in history.'
      : `${position.description}\n\n**Granted role:** ${roleIsSet ? `<@&${position.roleId}>` : 'Not set'}\n**Review channel:** ${channelIsSet ? `<#${position.reviewChannelId}>` : 'Not set'}`);
  const components = [];
  if (confirmDelete) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`setup:confirm-delete:${position.id}`).setLabel('Confirm delete').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`setup:open:${position.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    ));
  } else {
    const roleMenu = new RoleSelectMenuBuilder()
      .setCustomId(`setup:role:${position.id}`)
      .setPlaceholder('Select the role granted on approval')
      .setMinValues(1)
      .setMaxValues(1);
    if (roleIsSet) roleMenu.setDefaultRoles(position.roleId);
    const channelMenu = new ChannelSelectMenuBuilder()
      .setCustomId(`setup:channel:${position.id}`)
      .setPlaceholder('Select the staff review channel')
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1);
    if (channelIsSet) channelMenu.setDefaultChannels(position.reviewChannelId);
    components.push(
      new ActionRowBuilder().addComponents(roleMenu),
      new ActionRowBuilder().addComponents(channelMenu),
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
  const labelInput = new TextInputBuilder().setCustomId('label').setLabel('Question').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(45);
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

function modalFor(session, position, page) {
  const questions = position.questions.slice(page * QUESTIONS_PER_PAGE, (page + 1) * QUESTIONS_PER_PAGE);
  const pageCount = Math.ceil(position.questions.length / QUESTIONS_PER_PAGE);
  const modal = new ModalBuilder()
    .setCustomId(`application:modal:${session.token}:${page}`)
    .setTitle(truncate(`${position.name} (${page + 1}/${pageCount})`, 45));

  for (const question of questions) {
    const input = new TextInputBuilder()
      .setCustomId(question.id)
      .setLabel(question.label)
      .setStyle(question.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(question.required)
      .setMinLength(question.minLength ?? 0)
      .setMaxLength(question.maxLength ?? (question.style === 'short' ? 400 : 4000));
    if (question.placeholder) input.setPlaceholder(question.placeholder);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
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

function answersAttachment(record) {
  const lines = [
    `Application: ${record.id}`,
    `Applicant: ${record.username} (${record.userId})`,
    `Position: ${record.positionName}`,
    `Submitted: ${record.createdAt}`,
    '',
  ];
  for (const answer of record.answers) lines.push(answer.question, answer.value || '(No answer)', '');
  return new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), { name: `application-${record.id}.txt` });
}

function statusMessage(record) {
  const labels = { pending: 'Pending review', approved: 'Approved', denied: 'Denied' };
  let message = `Your latest application (**${record.id}**, ${record.positionName}) is **${labels[record.status] ?? record.status}**.`;
  if (record.denialReason) message += `\nReason: ${record.denialReason}`;
  return message;
}

async function notifyApplicant(client, record) {
  const user = await client.users.fetch(record.userId);
  const verb = record.status === 'approved' ? 'approved' : 'denied';
  let content = `Your **${record.positionName}** application in **${record.guildName}** was **${verb}**.`;
  if (record.denialReason) content += `\nReason: ${record.denialReason}`;
  await user.send(content);
}

export function attachBotHandlers(client, { configService, store, logger = console }) {
  const sessions = new Map();
  const processing = new Set();

  function cleanSessions() {
    const cutoff = Date.now() - SESSION_LIFETIME_MS;
    for (const [token, session] of sessions) if (session.createdAt < cutoff) sessions.delete(token);
  }

  function isReviewer(interaction, config) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
      || config.reviewerRoleIds.some((roleId) => interaction.member?.roles?.cache?.has(roleId));
  }

  function isConfigManager(interaction) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
  }

  async function startApplication(interaction, config, positionId) {
    if (!config.allowMultiplePendingApplications && await store.hasPending(interaction.guildId, interaction.user.id)) {
      await interaction.reply(ephemeral('You already have an application awaiting review. Use `/application-status` to check it.'));
      return;
    }
    const position = config.positions.find((item) => item.id === positionId);
    if (!position) {
      await interaction.reply(ephemeral('That position is no longer available. Please start again.'));
      return;
    }
    cleanSessions();
    const token = crypto.randomBytes(9).toString('base64url');
    const session = {
      token,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      positionId,
      position: structuredClone(position),
      answers: {},
      createdAt: Date.now(),
    };
    sessions.set(token, session);
    await interaction.showModal(modalFor(session, position, 0));
  }

  async function submitApplication(interaction, config, session, position) {
    const record = {
      id: crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase(),
      guildId: interaction.guildId,
      guildName: interaction.guild.name,
      userId: interaction.user.id,
      username: interaction.user.tag,
      positionId: position.id,
      positionName: position.name,
      roleId: position.roleId,
      reviewChannelId: position.reviewChannelId,
      answers: position.questions.map((question) => ({ question: question.label, value: session.answers[question.id] ?? '' })),
      status: 'pending',
      createdAt: new Date().toISOString(),
      decidedAt: null,
      decidedBy: null,
    };

    const reviewChannel = await interaction.guild.channels.fetch(position.reviewChannelId);
    if (!reviewChannel?.isTextBased()) throw new Error(`Review channel ${position.reviewChannelId} is not a text channel.`);
    const reviewMessage = await reviewChannel.send({
      content: config.reviewerRoleIds.map((roleId) => `<@&${roleId}>`).join(' '),
      allowedMentions: { roles: config.reviewerRoleIds },
      ...reviewPayload(record, config),
      files: [answersAttachment(record)],
    });
    record.reviewMessageId = reviewMessage.id;
    await store.create(record);
    sessions.delete(session.token);
    await interaction.reply(ephemeral(`Application **${record.id}** submitted successfully. Use \`/application-status\` to check it.`));
  }

  async function handleModalPage(interaction, config, token, page) {
    const session = sessions.get(token);
    if (!session || session.userId !== interaction.user.id || session.guildId !== interaction.guildId) {
      await interaction.reply(ephemeral('This application session expired. Run `/apply` to start again.'));
      return;
    }
    const position = session.position;
    if (!position) {
      sessions.delete(token);
      await interaction.reply(ephemeral('That position is no longer available.'));
      return;
    }
    const pageQuestions = position.questions.slice(page * QUESTIONS_PER_PAGE, (page + 1) * QUESTIONS_PER_PAGE);
    for (const question of pageQuestions) session.answers[question.id] = interaction.fields.getTextInputValue(question.id);
    const nextPage = page + 1;
    if (nextPage < Math.ceil(position.questions.length / QUESTIONS_PER_PAGE)) {
      const button = new ButtonBuilder()
        .setCustomId(`application:continue:${token}:${nextPage}`)
        .setLabel(`Continue (${nextPage + 1}/${Math.ceil(position.questions.length / QUESTIONS_PER_PAGE)})`)
        .setStyle(ButtonStyle.Primary);
      await interaction.reply(ephemeral('Your answers were saved. Continue to the next page:', {
        components: [new ActionRowBuilder().addComponents(button)],
      }));
      return;
    }
    await submitApplication(interaction, config, session, position);
  }

  async function approve(interaction, config, record) {
    const member = await interaction.guild.members.fetch(record.userId);
    await member.roles.add(record.roleId, `Application ${record.id} approved by ${interaction.user.tag}`);
    const updated = await store.decide(record.id, {
      status: 'approved',
      decidedAt: new Date().toISOString(),
      decidedBy: interaction.user.id,
    });
    await interaction.message.edit(reviewPayload(updated, config));
    await interaction.editReply({ content: `Approved **${record.id}** and granted <@&${record.roleId}>.` });
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
    await interaction.reply(ephemeral(`Denied application **${record.id}**.`));
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

        if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('setup:role:')) {
          const positionId = interaction.customId.split(':')[2];
          const next = await configService.update((draft) => {
            const position = draft.positions.find((item) => item.id === positionId);
            if (!position) throw new Error('That position no longer exists.');
            position.roleId = interaction.values[0];
          }, { allowPlaceholders: true });
          const position = next.positions.find((item) => item.id === positionId);
          await interaction.update(setupPositionView(next, position, false, 'Granted role saved.'));
          return;
        }

        if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('setup:channel:')) {
          const positionId = interaction.customId.split(':')[2];
          const next = await configService.update((draft) => {
            const position = draft.positions.find((item) => item.id === positionId);
            if (!position) throw new Error('That position no longer exists.');
            position.reviewChannelId = interaction.values[0];
          }, { allowPlaceholders: true });
          const position = next.positions.find((item) => item.id === positionId);
          await interaction.update(setupPositionView(next, position, false, 'Review channel saved.'));
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
                  roleId: 'PUT_POSITION_ROLE_ID_HERE',
                  reviewChannelId: 'PUT_REVIEW_CHANNEL_ID_HERE',
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
              ...setupPositionView(next, position, false, editing ? 'Position updated.' : 'Position added. Now select its role and review channel.'),
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
        } else if (interaction.commandName === 'application-status') {
          const record = await store.latestForUser(interaction.guildId, interaction.user.id);
          await interaction.reply(ephemeral(record ? statusMessage(record) : 'You have not submitted an application yet.'));
        } else if (interaction.commandName === 'application-panel') {
          if (!interaction.channel?.isTextBased()) return;
          await interaction.channel.send({ embeds: [panelEmbed(config)], components: panelComponents() });
          await interaction.reply(ephemeral('Application panel posted.'));
        } else if (interaction.commandName === 'application-config') {
          if (!isConfigManager(interaction)) {
            await interaction.reply(ephemeral('You need the **Manage Server** permission to change application questions.'));
            return;
          }
          await interaction.reply({ ...configPositionPicker(config), flags: MessageFlags.Ephemeral });
        } else if (interaction.commandName === 'application-setup') {
          if (!isConfigManager(interaction)) {
            await interaction.reply(ephemeral('You need the **Manage Server** permission to configure applications.'));
            return;
          }
          await interaction.reply({ ...setupMainView(config), flags: MessageFlags.Ephemeral });
        }
        return;
      }

      if (interaction.isStringSelectMenu() && interaction.customId === 'application:position') {
        await startApplication(interaction, config, interaction.values[0]);
        return;
      }

      if (interaction.isButton() && interaction.customId === 'application:start') {
        await interaction.reply(positionPicker(config));
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith('application:continue:')) {
        const [, , token, pageText] = interaction.customId.split(':');
        const session = sessions.get(token);
        const position = session?.position;
        if (!session || session.userId !== interaction.user.id || !position) {
          await interaction.reply(ephemeral('This application session expired. Run `/apply` to start again.'));
          return;
        }
        await interaction.showModal(modalFor(session, position, Number(pageText)));
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('application:modal:')) {
        const [, , token, pageText] = interaction.customId.split(':');
        await handleModalPage(interaction, config, token, Number(pageText));
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
}
