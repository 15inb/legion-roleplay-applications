import crypto from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export class TicketStore {
  constructor(filePath = path.resolve('data/tickets.json')) {
    this.filePath = filePath;
    this.loaded = false;
    this.panels = [];
    this.tickets = [];
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (this.loaded) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!parsed || !Array.isArray(parsed.panels) || !Array.isArray(parsed.tickets)) {
        throw new Error('Ticket data must contain panel and ticket arrays.');
      }
      this.panels = parsed.panels.map((panel) => ({
        ...panel,
        accessRoleIds: panel.accessRoleIds ?? panel.staffRoleIds ?? [],
      }));
      this.tickets = parsed.tickets.map((ticket) => ({
        ...ticket,
        accessRoleIds: ticket.accessRoleIds ?? ticket.staffRoleIds ?? [],
      }));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    this.loaded = true;
  }

  async save() {
    const operation = async () => {
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify({ panels: this.panels, tickets: this.tickets }, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, this.filePath);
    };
    this.writeQueue = this.writeQueue.then(operation, operation);
    await this.writeQueue;
  }

  async addPanel(panel) {
    await this.load();
    this.panels.push(panel);
    await this.save();
    return panel;
  }

  async getPanel(id) {
    await this.load();
    return this.panels.find((panel) => panel.id === id) ?? null;
  }

  async createTicket(ticket) {
    await this.load();
    this.tickets.push(ticket);
    await this.save();
    return ticket;
  }

  async findOpen(panelId, userId) {
    await this.load();
    return this.tickets.find((ticket) => ticket.panelId === panelId && ticket.userId === userId && ticket.status === 'open') ?? null;
  }

  async findOpenByChannel(guildId, channelId) {
    await this.load();
    return this.tickets.find((ticket) => ticket.guildId === guildId && ticket.channelId === channelId && ticket.status === 'open') ?? null;
  }

  async closeTicket(id, closedBy, reason = 'closed') {
    await this.load();
    const ticket = this.tickets.find((record) => record.id === id && record.status === 'open');
    if (!ticket) return null;
    Object.assign(ticket, { status: 'closed', closedAt: new Date().toISOString(), closedBy, closeReason: reason });
    await this.save();
    return ticket;
  }

  async removeTicket(id) {
    await this.load();
    const index = this.tickets.findIndex((ticket) => ticket.id === id);
    if (index === -1) return null;
    const [removed] = this.tickets.splice(index, 1);
    await this.save();
    return removed;
  }
}

export function ticketPanelPayload(panel) {
  return {
    embeds: [new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle(panel.name)
      .setDescription(panel.description)
      .setFooter({ text: 'Press the button below to open a private ticket.' })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:open:${panel.id}`)
        .setLabel(panel.buttonName)
        .setEmoji('🎫')
        .setStyle(ButtonStyle.Primary),
    )],
    allowedMentions: { parse: [] },
  };
}

function ticketControls(ticket) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket:close:${ticket.id}`).setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
}

function closeConfirmation(ticket) {
  return {
    content: 'Are you sure you want to permanently close and delete this ticket channel?',
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ticket:confirm-close:${ticket.id}`).setLabel('Close Ticket').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ticket:cancel-close').setLabel('Keep Open').setStyle(ButtonStyle.Secondary),
    )],
    flags: MessageFlags.Ephemeral,
  };
}

function canCloseTicket(interaction, ticket) {
  return interaction.user.id === ticket.userId
    || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    || ticket.accessRoleIds.some((roleId) => interaction.member?.roles?.cache?.has(roleId));
}

function safeChannelName(username, ticketId) {
  const safeName = username.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'member';
  return `ticket-${safeName}-${ticketId.toLowerCase()}`;
}

async function createTicketPanel(interaction, store) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error('You need the Manage Server permission to create ticket panels.');
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const panelChannel = interaction.options.getChannel('panel-channel', true);
  const category = interaction.options.getChannel('ticket-category', true);
  const accessRole = interaction.options.getRole('access-role', true);
  if (accessRole.id === interaction.guild.roles.everyone.id) throw new Error('The @everyone role cannot be used as a private ticket access role.');
  if (!panelChannel.isTextBased() || panelChannel.guildId !== interaction.guildId) throw new Error('The panel channel must be a text channel in this server.');
  if (category.type !== ChannelType.GuildCategory || category.guildId !== interaction.guildId) throw new Error('The ticket destination must be a category in this server.');

  const panel = {
    id: crypto.randomBytes(8).toString('hex'),
    guildId: interaction.guildId,
    panelChannelId: panelChannel.id,
    categoryId: category.id,
    name: interaction.options.getString('name', true).trim(),
    description: interaction.options.getString('description', true).trim(),
    buttonName: interaction.options.getString('button-name')?.trim() || 'Open Ticket',
    accessRoleIds: [accessRole.id],
    createdAt: new Date().toISOString(),
    createdBy: interaction.user.id,
  };
  const message = await panelChannel.send(ticketPanelPayload(panel));
  try {
    panel.messageId = message.id;
    await store.addPanel(panel);
  } catch (error) {
    await message.delete().catch(() => {});
    throw error;
  }
  await interaction.editReply({ content: `Ticket panel created in <#${panelChannel.id}>. New tickets will be created under **${category.name}**.` });
}

async function showTicketDescriptionModal(interaction) {
  const panelId = interaction.customId.split(':')[2];
  const description = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Describe this roleplay ticket')
    .setPlaceholder('Explain the scene, request, or roleplay situation…')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(1)
    .setMaxLength(2000)
    .setRequired(true);
  const modal = new ModalBuilder()
    .setCustomId(`ticket:create:${panelId}`)
    .setTitle('Open Roleplay Ticket')
    .addComponents(new ActionRowBuilder().addComponents(description));
  await interaction.showModal(modal);
}

async function openTicket(interaction, store) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const panelId = interaction.customId.split(':')[2];
  const panel = await store.getPanel(panelId);
  if (!panel || panel.guildId !== interaction.guildId) throw new Error('This ticket panel is no longer configured.');
  const existing = await store.findOpen(panel.id, interaction.user.id);
  if (existing) {
    const existingChannel = await interaction.guild.channels.fetch(existing.channelId).catch(() => null);
    if (existingChannel) {
      await interaction.editReply({ content: `You already have an open ticket from this panel: <#${existing.channelId}>.` });
      return;
    }
    await store.closeTicket(existing.id, interaction.client.user.id, 'channel-missing');
  }

  const ticket = {
    id: crypto.randomBytes(5).toString('hex').toUpperCase(),
    panelId: panel.id,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    username: interaction.user.tag,
    description: interaction.fields.getTextInputValue('description').trim(),
    accessRoleIds: panel.accessRoleIds,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  const memberPermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
  ];
  const channel = await interaction.guild.channels.create({
    name: safeChannelName(interaction.user.username, ticket.id),
    type: ChannelType.GuildText,
    parent: panel.categoryId,
    topic: `${ticket.description}\n— ${panel.name} • ${interaction.user.tag} • ${ticket.id}`.slice(0, 1024),
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: memberPermissions },
      ...panel.accessRoleIds.map((roleId) => ({ id: roleId, allow: memberPermissions })),
      { id: interaction.client.user.id, allow: [...memberPermissions, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
    ],
    reason: `Ticket ${ticket.id} opened by ${interaction.user.tag}`,
  });
  ticket.channelId = channel.id;
  await store.createTicket(ticket);
  try {
    await channel.send({
      content: [`<@${ticket.userId}>`, ...ticket.accessRoleIds.map((roleId) => `<@&${roleId}>`)].join(' '),
      embeds: [new EmbedBuilder()
        .setColor('#57F287')
        .setTitle(panel.name)
        .setDescription(ticket.description)
        .addFields(
          { name: 'Opened by', value: `<@${ticket.userId}>`, inline: true },
          { name: 'Ticket ID', value: ticket.id, inline: true },
        )
        .setFooter({ text: 'Use this private channel for the roleplay associated with this ticket.' })
        .setTimestamp()],
      components: [ticketControls(ticket)],
      allowedMentions: { users: [ticket.userId], roles: ticket.accessRoleIds },
    });
  } catch (error) {
    await store.removeTicket(ticket.id);
    await channel.delete('Ticket creation failed').catch(() => {});
    throw error;
  }
  await interaction.editReply({ content: `Your private ticket is ready: <#${channel.id}>.` });
}

async function requestTicketClose(interaction, store) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ticket = await store.findOpenByChannel(interaction.guildId, interaction.channelId);
  if (!ticket) throw new Error('Use this inside an open ticket channel.');
  if (!canCloseTicket(interaction, ticket)) throw new Error('Only the ticket opener or configured roleplay ticket role can close this ticket.');
  const { flags: _flags, ...payload } = closeConfirmation(ticket);
  await interaction.editReply(payload);
}

async function confirmTicketClose(interaction, store) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ticketId = interaction.customId.split(':')[2];
  const ticket = await store.findOpenByChannel(interaction.guildId, interaction.channelId);
  if (!ticket || ticket.id !== ticketId) throw new Error('This ticket is already closed or no longer exists.');
  if (!canCloseTicket(interaction, ticket)) throw new Error('Only the ticket opener or configured roleplay ticket role can close this ticket.');
  await interaction.editReply({ content: 'Closing this ticket…' });
  await interaction.channel.delete(`Ticket ${ticket.id} closed by ${interaction.user.tag}`);
  await store.closeTicket(ticket.id, interaction.user.id);
}

export function attachTicketHandlers(client, { store, logger = console }) {
  const openingTickets = new Set();
  client.on('interactionCreate', async (interaction) => {
    const isTicketCommand = interaction.isChatInputCommand() && interaction.commandName === 'tickets';
    const isTicketButton = interaction.isButton() && interaction.customId.startsWith('ticket:');
    const isTicketModal = interaction.isModalSubmit() && interaction.customId.startsWith('ticket:create:');
    if (!isTicketCommand && !isTicketButton && !isTicketModal) return;
    try {
      if (!interaction.inGuild()) throw new Error('Tickets can only be used inside a server.');
      if (isTicketCommand) {
        if (interaction.options.getSubcommand() === 'create') await createTicketPanel(interaction, store);
        else await requestTicketClose(interaction, store);
        return;
      }
      if (interaction.customId.startsWith('ticket:open:')) {
        await showTicketDescriptionModal(interaction);
      } else if (interaction.customId.startsWith('ticket:create:')) {
        const openingKey = `${interaction.customId}:${interaction.user.id}`;
        if (openingTickets.has(openingKey)) {
          await interaction.reply({ content: 'Your ticket is already being created. Please wait.', flags: MessageFlags.Ephemeral });
          return;
        }
        openingTickets.add(openingKey);
        try {
          await openTicket(interaction, store);
        } finally {
          openingTickets.delete(openingKey);
        }
      }
      else if (interaction.customId.startsWith('ticket:close:')) await requestTicketClose(interaction, store);
      else if (interaction.customId.startsWith('ticket:confirm-close:')) await confirmTicketClose(interaction, store);
      else if (interaction.customId === 'ticket:cancel-close') await interaction.update({ content: 'Ticket kept open.', components: [] });
    } catch (error) {
      logger.error('Ticket interaction failed:', error);
      const payload = { content: `Could not complete that ticket action: ${error.message}`, flags: MessageFlags.Ephemeral };
      if (interaction.deferred) await interaction.editReply({ content: payload.content }).catch(() => {});
      else if (interaction.replied) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  });
}
