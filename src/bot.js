import crypto from 'node:crypto';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

const SESSION_LIFETIME_MS = 30 * 60 * 1000;
const QUESTIONS_PER_PAGE = 5;

function ephemeral(content, extra = {}) {
  return { content, flags: MessageFlags.Ephemeral, ...extra };
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
  const menu = new StringSelectMenuBuilder()
    .setCustomId('application:position')
    .setPlaceholder('Choose a position')
    .addOptions(
      config.positions.map((position) => ({
        label: position.name,
        description: position.description || `Apply for ${position.name}`,
        value: position.id,
      })),
    );
  return ephemeral('Choose the position you want to apply for:', {
    components: [new ActionRowBuilder().addComponents(menu)],
  });
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
      const config = await configService.get();

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
