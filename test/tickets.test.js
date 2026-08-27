import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { commands } from '../src/commands.js';
import { attachTicketHandlers, TicketStore, ticketPanelPayload } from '../src/tickets.js';

test('ticket command exposes customizable panel and destination options', () => {
  const command = commands.find((item) => item.name === 'tickets');
  const create = command.options.find((item) => item.name === 'create');
  assert.deepEqual(create.options.map((item) => item.name), [
    'panel-channel',
    'ticket-category',
    'name',
    'description',
    'button-name',
    'support-role',
  ]);
});

test('ticket panels render their configured name, description, and button label', () => {
  const payload = ticketPanelPayload({ id: 'panel-id', name: 'General Support', description: 'Ask us for help.', buttonName: 'Get Help' });
  assert.equal(payload.embeds[0].data.title, 'General Support');
  assert.equal(payload.embeds[0].data.description, 'Ask us for help.');
  assert.equal(payload.components[0].components[0].data.label, 'Get Help');
  assert.equal(payload.components[0].components[0].data.custom_id, 'ticket:open:panel-id');
});

test('ticket panels and open ticket state persist across store instances', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tickets-'));
  const file = path.join(directory, 'tickets.json');
  const first = new TicketStore(file);
  await first.addPanel({ id: 'panel', guildId: 'guild', categoryId: 'category' });
  await first.createTicket({ id: 'ticket', panelId: 'panel', guildId: 'guild', channelId: 'channel', userId: 'user', status: 'open' });

  const recovered = new TicketStore(file);
  assert.equal((await recovered.getPanel('panel')).categoryId, 'category');
  assert.equal((await recovered.findOpen('panel', 'user')).channelId, 'channel');
  assert.equal((await recovered.findOpenByChannel('guild', 'channel')).id, 'ticket');
  await recovered.closeTicket('ticket', 'staff');
  assert.equal(await new TicketStore(file).findOpen('panel', 'user'), null);
});

test('a ticket button creates a private channel in its configured category', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ticket-open-flow-'));
  const store = new TicketStore(path.join(directory, 'tickets.json'));
  const handlers = [];
  const client = { user: { id: '999999999999999999' }, on: (event, callback) => { if (event === 'interactionCreate') handlers.push(callback); } };
  attachTicketHandlers(client, {
    store,
    configService: { get: async () => ({ reviewerRoleIds: ['777777777777777777'] }) },
    logger: console,
  });

  let panelPayload;
  const panelChannel = {
    id: '222222222222222222',
    guildId: '111111111111111111',
    isTextBased: () => true,
    send: async (payload) => {
      panelPayload = payload;
      return { id: '333333333333333333', delete: async () => {} };
    },
  };
  const category = { id: '444444444444444444', guildId: '111111111111111111', type: ChannelType.GuildCategory, name: 'Tickets' };
  const optionValues = {
    'panel-channel': panelChannel,
    'ticket-category': category,
    name: 'Support',
    description: 'Open a private support ticket.',
    'button-name': 'Open Support Ticket',
  };
  let createResponse;
  await handlers[0]({
    commandName: 'tickets',
    guildId: '111111111111111111',
    guild: { roles: { everyone: { id: '111111111111111111' } } },
    user: { id: '555555555555555555' },
    memberPermissions: { has: (permission) => permission === PermissionFlagsBits.ManageGuild },
    options: {
      getSubcommand: () => 'create',
      getChannel: (name) => optionValues[name],
      getString: (name) => optionValues[name] ?? null,
      getRole: () => null,
    },
    inGuild: () => true,
    isChatInputCommand: () => true,
    isButton: () => false,
    deferReply: async () => {},
    editReply: async (payload) => { createResponse = payload; },
  });
  const panelId = panelPayload.components[0].components[0].data.custom_id.split(':')[2];
  assert.match(createResponse.content, /Ticket panel created/);

  let channelOptions;
  let welcomePayload;
  let openResponse;
  const ticketChannel = {
    id: '666666666666666666',
    send: async (payload) => { welcomePayload = payload; },
    delete: async () => {},
  };
  const guild = {
    roles: { everyone: { id: '111111111111111111' } },
    channels: {
      fetch: async () => null,
      create: async (options) => { channelOptions = options; return ticketChannel; },
    },
  };
  await handlers[0]({
    customId: `ticket:open:${panelId}`,
    guildId: '111111111111111111',
    guild,
    client,
    user: { id: '888888888888888888', username: 'Test User', tag: 'test-user' },
    inGuild: () => true,
    isChatInputCommand: () => false,
    isButton: () => true,
    deferReply: async () => {},
    editReply: async (payload) => { openResponse = payload; },
  });

  assert.equal(channelOptions.parent, category.id);
  assert.equal(channelOptions.type, ChannelType.GuildText);
  assert.ok(channelOptions.permissionOverwrites.some((overwrite) => overwrite.id === '888888888888888888'));
  assert.ok(channelOptions.permissionOverwrites.some((overwrite) => overwrite.id === '777777777777777777'));
  assert.match(welcomePayload.embeds[0].data.title, /Support/);
  assert.match(openResponse.content, /private ticket is ready/);
  assert.equal((await store.findOpen(panelId, '888888888888888888')).channelId, ticketChannel.id);
});
