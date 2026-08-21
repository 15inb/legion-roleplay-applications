import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { attachBotHandlers } from '../src/bot.js';

test('long Legion questions render in modal label descriptions without truncation', async () => {
  const config = JSON.parse(await readFile('config/applications.json', 'utf8'));
  config.reviewerRoleIds = ['123456789012345678'];
  config.applicationCategoryId = '123456789012345678';
  config.transcriptChannelId = '123456789012345678';
  config.positions[0].roleId = '123456789012345678';
  let handler;
  let modal;
  const client = { on: (event, callback) => { if (event === 'interactionCreate') handler = callback; } };
  attachBotHandlers(client, {
    configService: { get: async () => config },
    store: { hasPending: async () => false },
    logger: console,
  });
  const interaction = {
    customId: 'application:position',
    values: ['legionnaire-application'],
    user: { id: 'user' },
    guildId: 'guild',
    inGuild: () => true,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    showModal: async (value) => { modal = value; },
  };

  await handler(interaction);
  const payload = modal.toJSON();
  assert.equal(payload.components.length, 5);
  assert.equal(payload.components[1].description, config.positions[0].questions[1].label);
  assert.equal(payload.components[3].description, config.positions[0].questions[3].label);
});

test('application setup renders reviewer, category, transcript, and position controls', async () => {
  const config = JSON.parse(await readFile('config/applications.json', 'utf8'));
  let handler;
  let response;
  const client = { on: (event, callback) => { if (event === 'interactionCreate') handler = callback; } };
  attachBotHandlers(client, {
    configService: { get: async () => config },
    store: {},
    logger: console,
  });
  const interaction = {
    customId: '',
    commandName: 'application-setup',
    memberPermissions: { has: () => true },
    inGuild: () => true,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => true,
    reply: async (payload) => { response = payload; },
  };

  await handler(interaction);
  assert.equal(response.components.length, 5);
  for (const row of response.components) assert.doesNotThrow(() => row.toJSON());
});

test('a completed application creates and stores a private review channel', async () => {
  const config = JSON.parse(await readFile('config/applications.json', 'utf8'));
  config.reviewerRoleIds = ['123456789012345678'];
  config.applicationCategoryId = '223456789012345678';
  config.transcriptChannelId = '323456789012345678';
  config.positions[0].roleId = '423456789012345678';
  let handler;
  let modal;
  let channelOptions;
  let stored;
  const reviewChannel = {
    id: '523456789012345678',
    send: async () => ({ id: '623456789012345678' }),
  };
  const client = {
    user: { id: '723456789012345678' },
    on: (event, callback) => { if (event === 'interactionCreate') handler = callback; },
  };
  attachBotHandlers(client, {
    configService: { get: async () => config },
    store: {
      hasPending: async () => false,
      create: async (record) => { stored = record; },
    },
    logger: console,
  });
  const common = {
    guildId: '823456789012345678',
    user: { id: '923456789012345678', username: 'Test Applicant', tag: 'test-applicant' },
    guild: {
      name: 'Test Guild',
      roles: { everyone: { id: '823456789012345678' } },
      channels: {
        create: async (options) => { channelOptions = options; return reviewChannel; },
      },
    },
    inGuild: () => true,
    isChatInputCommand: () => false,
    isButton: () => false,
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => false,
  };
  await handler({
    ...common,
    customId: 'application:position',
    values: ['legionnaire-application'],
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isStringSelectMenu: () => true,
    showModal: async (value) => { modal = value; },
  });
  const token = modal.data.custom_id.split(':')[2];
  const submitPage = async (page) => handler({
    ...common,
    customId: `application:modal:${token}:${page}`,
    isMessageComponent: () => false,
    isModalSubmit: () => true,
    isStringSelectMenu: () => false,
    fields: { getTextInputValue: (id) => `Answer for ${id}` },
    reply: async () => {},
  });
  await submitPage(0);
  await submitPage(1);

  assert.equal(channelOptions.parent, config.applicationCategoryId);
  assert.match(channelOptions.name, /^application-test-applicant-/);
  assert.ok(!channelOptions.permissionOverwrites.some((overwrite) => overwrite.id === common.user.id));
  assert.ok(channelOptions.permissionOverwrites.some((overwrite) => overwrite.id === config.reviewerRoleIds[0]));
  assert.equal(stored.reviewChannelId, reviewChannel.id);
  assert.equal(stored.transcriptChannelId, config.transcriptChannelId);
  assert.equal(stored.answers.length, 8);
});

test('applicant DM replies relay into the hidden application channel', async () => {
  const handlers = {};
  let relayed;
  let confirmation;
  const applicationChannel = {
    isTextBased: () => true,
    send: async (payload) => { relayed = payload; },
  };
  const client = {
    on: (event, callback) => { handlers[event] = callback; },
    channels: { fetch: async () => applicationChannel },
  };
  attachBotHandlers(client, {
    configService: {},
    store: {
      latestPendingForUser: async () => ({ reviewChannelId: 'channel', id: 'APPLICATION' }),
    },
    logger: console,
  });
  await handlers.messageCreate({
    author: {
      bot: false,
      id: 'user',
      tag: 'applicant',
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    },
    guild: null,
    content: 'Here is my response.',
    attachments: new Map(),
    createdAt: new Date('2026-08-21T12:00:00Z'),
    reply: async (content) => { confirmation = content; },
  });

  assert.match(relayed.embeds[0].data.description, /Here is my response/);
  assert.match(confirmation, /sent privately/);
});
