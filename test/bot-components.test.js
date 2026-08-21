import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { attachBotHandlers, buildDiscordTranscriptPages, buildTranscriptHtml } from '../src/bot.js';

test('Discord transcript pages stay within embed limits and escape user markdown', () => {
  const messages = Array.from({ length: 12 }, (_, index) => ({
    author: { tag: `Applicant_${index}`, id: String(1000 + index) },
    createdTimestamp: new Date('2026-08-21T12:30:00.000Z').getTime() + index,
    content: `${'A long answer *with markdown* and @everyone. '.repeat(18)} ${index}`,
    embeds: [{ title: `Question ${index + 1}`, description: 'An embedded question.' }],
    attachments: new Map(),
  }));

  const pages = buildDiscordTranscriptPages(messages);
  assert.ok(pages.length > 1);
  assert.ok(pages.every((page) => page.length <= 3900));
  assert.match(pages.join('\n'), /\\\*with markdown\\\*/);
  assert.match(pages.join('\n'), /Question 1/);
  assert.match(pages.join('\n'), /@everyone/);
});

test('HTML transcripts are readable, complete, and escape untrusted content', () => {
  const html = buildTranscriptHtml({
    id: 'LEGION-001',
    status: 'denied',
    positionName: 'Legionnaire Application',
    guildName: 'Imperial Legion',
    username: 'Test Applicant',
    userId: '123456789012345678',
    decidedBy: '223456789012345678',
    createdAt: '2026-08-21T12:00:00.000Z',
    decidedAt: '2026-08-21T13:00:00.000Z',
    denialReason: '<script>unsafe reason</script>',
  }, [{
    author: {
      tag: 'test-applicant',
      id: '123456789012345678',
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    },
    createdTimestamp: new Date('2026-08-21T12:30:00.000Z').getTime(),
    content: '<script>alert("unsafe")</script> Here is my response.',
    embeds: [{
      title: 'Question 1',
      description: 'Why do you want to join?',
      fields: [{ name: 'Answer', value: 'To serve the Empire.' }],
    }],
    attachments: new Map([['attachment', {
      name: 'proof.png',
      url: 'https://cdn.discordapp.com/attachments/proof.png',
      contentType: 'image/png',
    }]]),
  }], 'application-test-applicant', 2);

  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Conversation transcript/);
  assert.match(html, /Question 1/);
  assert.match(html, /To serve the Empire\./);
  assert.match(html, /proof\.png/);
  assert.match(html, /attachment-preview/);
  assert.match(html, /2 older messages were omitted/);
  assert.match(html, /&lt;script&gt;unsafe reason&lt;\/script&gt;/);
  assert.match(html, /&lt;script&gt;alert\(&quot;unsafe&quot;\)&lt;\/script&gt;/);
  assert.ok(!html.includes('<script>'));
});

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
    commandName: 'setup',
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
  const channelMessages = [];
  const reviewChannel = {
    id: '523456789012345678',
    send: async (payload) => { channelMessages.push(payload); return { id: '623456789012345678' }; },
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
  assert.ok(channelMessages.slice(1).some((payload) => payload.embeds?.[0]?.data?.title === 'Question 1'));
  assert.ok(channelMessages.every((payload) => !payload.files));
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
  assert.match(confirmation.embeds[0].data.description, /sent privately/);
});
