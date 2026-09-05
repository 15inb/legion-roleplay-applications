import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  applyApprovalRoleChanges,
  attachBotHandlers,
  buildDiscordTranscriptPages,
  buildTranscriptHtml,
} from '../src/bot.js';

test('approval can grant and remove multiple roles in one decision', async () => {
  const added = [];
  const removed = [];
  const member = {
    roles: {
      cache: { has: (roleId) => ['remove-1', 'remove-2'].includes(roleId) },
      add: async (roleIds) => { added.push(roleIds); },
      remove: async (roleIds) => { removed.push(roleIds); },
    },
  };
  const record = {
    id: 'APPLICATION',
    grantRoleIds: ['grant-1', 'grant-2'],
    removeRoleIds: ['remove-1', 'remove-2'],
  };
  const saved = { ...record, status: 'approved' };
  const result = await applyApprovalRoleChanges(member, record, 'Approved', async () => saved);

  assert.deepEqual(added, ['grant-1', 'grant-2']);
  assert.deepEqual(removed, ['remove-1', 'remove-2']);
  assert.equal(result.updated, saved);
});

test('approval preserves granted and unrelated roles when the member cache is stale', async () => {
  const cached = new Set(['old-role', 'existing-role']);
  let actual = new Set(cached);
  const member = { roles: {
    cache: cached,
    add: async (roles) => {
      if (Array.isArray(roles)) actual = new Set([...cached, ...roles]);
      else actual.add(roles);
    },
    remove: async (roles) => {
      if (Array.isArray(roles)) actual = new Set([...cached].filter((id) => !roles.includes(id)));
      else actual.delete(roles);
    },
  } };
  const record = { id: 'STALE', grantRoleIds: ['new-1', 'new-2'], removeRoleIds: ['old-role'] };
  await applyApprovalRoleChanges(member, record, 'Approve', async () => ({ status: 'approved' }));
  assert.deepEqual([...actual].sort(), ['existing-role', 'new-1', 'new-2']);

  // A failed decision save restores the original roles without replacing the list.
  actual = new Set(cached);
  await assert.rejects(applyApprovalRoleChanges(member, record, 'Approve', async () => {
    actual.add('concurrent-role');
    throw new Error('Disk unavailable');
  }), /Disk unavailable/);
  assert.deepEqual([...actual].sort(), ['concurrent-role', 'existing-role', 'old-role']);
});

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

test('application interviews begin in DMs with the full question text', async () => {
  const config = JSON.parse(await readFile('config/applications.json', 'utf8'));
  config.reviewerRoleIds = ['123456789012345678'];
  config.applicationCategoryId = '123456789012345678';
  config.transcriptChannelId = '123456789012345678';
  config.positions[0].grantRoleIds = ['123456789012345678'];
  let handler;
  let dm;
  let response;
  const events = [];
  const client = { on: (event, callback) => { if (event === 'interactionCreate') handler = callback; } };
  attachBotHandlers(client, {
    configService: { get: async () => { events.push('config'); return config; } },
    store: { hasPending: async () => false },
    logger: console,
  });
  const interaction = {
    customId: 'application:position',
    values: ['legionnaire-application'],
    user: { id: 'user', send: async (payload) => { dm = payload; } },
    guildId: 'guild',
    guild: { name: 'Test Guild' },
    inGuild: () => true,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    isButton: () => false,
    deferReply: async () => { events.push('defer'); },
    editReply: async (payload) => { response = payload; },
  };

  await handler(interaction);
  assert.deepEqual(events.slice(0, 2), ['defer', 'config']);
  assert.equal(dm.embeds[0].data.description, config.positions[0].questions[0].label);
  assert.match(dm.embeds[0].data.title, /Question 1\/8/);
  assert.match(dm.embeds[0].data.footer.text, /Type “back”/);
  assert.match(response.embeds[0].data.title, /Application Started in DMs/);
});

test('application interviews enforce permanent bars and the 24-hour denial cooldown', async () => {
  const config = JSON.parse(await readFile('config/applications.json', 'utf8'));
  config.reviewerRoleIds = ['123456789012345678'];
  config.applicationCategoryId = '223456789012345678';
  config.transcriptChannelId = '323456789012345678';
  config.positions[0].grantRoleIds = ['423456789012345678'];
  let handler;
  let dmCount = 0;
  const responses = [];
  const client = { on: (event, callback) => { if (event === 'interactionCreate') handler = callback; } };
  attachBotHandlers(client, {
    configService: { get: async () => config },
    store: {
      hasPending: async () => false,
      latestDeniedForUser: async (guildId, userId) => userId === 'cooldown-user'
        ? { decidedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }
        : null,
    },
    restrictionStore: {
      getActive: async (guildId, userId) => userId === 'barred-user'
        ? { expiresAt: null, reason: 'Application access revoked.' }
        : null,
    },
    logger: console,
  });
  const attempt = async (userId) => handler({
    customId: 'application:position',
    values: ['legionnaire-application'],
    user: { id: userId, send: async () => { dmCount += 1; } },
    guildId: 'guild',
    guild: { name: 'Test Guild' },
    inGuild: () => true,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    isButton: () => false,
    deferReply: async () => {},
    editReply: async (payload) => { responses.push(payload); },
  });

  await attempt('barred-user');
  await attempt('cooldown-user');
  assert.equal(dmCount, 0);
  assert.match(responses[0].embeds[0].data.title, /Applications Restricted/);
  assert.match(responses[0].embeds[0].data.fields[1].value, /revoked/);
  assert.match(responses[1].embeds[0].data.title, /Application Cooldown/);
  assert.match(responses[1].embeds[0].data.description, /24 hours/);
});

test('application setup renders reviewer, category, transcript, and position controls', async () => {
  const config = JSON.parse(await readFile('config/applications.json', 'utf8'));
  let handler;
  let response;
  let positionResponse;
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

  await handler({
    customId: 'setup:position',
    values: ['legionnaire-application'],
    memberPermissions: { has: () => true },
    inGuild: () => true,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    isButton: () => false,
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    update: async (payload) => { positionResponse = payload; },
  });
  assert.equal(positionResponse.components[0].components[0].data.custom_id, 'setup:grant-roles:legionnaire-application');
  assert.equal(positionResponse.components[0].components[0].data.max_values, 25);
  assert.equal(positionResponse.components[1].components[0].data.custom_id, 'setup:remove-roles:legionnaire-application');
  assert.equal(positionResponse.components[1].components[0].data.min_values, 0);
});

test('application panels create one direct button for each selected application', async () => {
  const config = JSON.parse(await readFile('config/applications.json', 'utf8'));
  config.reviewerRoleIds = ['123456789012345678'];
  config.applicationCategoryId = '223456789012345678';
  config.transcriptChannelId = '323456789012345678';
  config.positions[0].grantRoleIds = ['423456789012345678'];
  config.positions.push({
    ...structuredClone(config.positions[0]),
    id: 'officer-application',
    name: 'Officer Application',
    description: 'Apply to become an officer.',
    grantRoleIds: ['523456789012345678'],
  });
  let handler;
  let picker;
  let panel;
  let confirmation;
  let directDm;
  let directResponse;
  const channel = { isTextBased: () => true, send: async (payload) => { panel = payload; } };
  const client = { on: (event, callback) => { if (event === 'interactionCreate') handler = callback; } };
  attachBotHandlers(client, {
    configService: { get: async () => config },
    store: { hasPending: async () => false },
    logger: console,
  });

  await handler({
    customId: '',
    commandName: 'panel',
    channel,
    memberPermissions: { has: () => true },
    inGuild: () => true,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => true,
    reply: async (payload) => { picker = payload; },
  });
  assert.equal(picker.components[0].components[0].data.max_values, 2);

  await handler({
    customId: 'application:panel-positions',
    values: ['legionnaire-application', 'officer-application'],
    channel,
    memberPermissions: { has: () => true },
    inGuild: () => true,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    update: async (payload) => { confirmation = payload; },
  });

  const buttons = panel.components.flatMap((row) => row.components).map((button) => button.data);
  assert.deepEqual(buttons.map((button) => button.custom_id), [
    'application:start:legionnaire-application',
    'application:start:officer-application',
  ]);
  assert.match(panel.embeds[0].data.description, /Officer Application/);
  assert.match(confirmation.content, /2 direct buttons/);

  await handler({
    customId: 'application:start:officer-application',
    user: { id: 'applicant', send: async (payload) => { directDm = payload; } },
    guildId: 'guild',
    guild: { name: 'Test Guild' },
    inGuild: () => true,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    isStringSelectMenu: () => false,
    isButton: () => true,
    deferReply: async () => {},
    editReply: async (payload) => { directResponse = payload; },
  });
  assert.match(directDm.embeds[0].data.title, /Officer Application/);
  assert.match(directResponse.embeds[0].data.title, /Application Started in DMs/);
});

test('a completed application creates and stores a private review channel', async () => {
  const config = JSON.parse(await readFile('config/applications.json', 'utf8'));
  config.reviewerRoleIds = ['123456789012345678'];
  config.applicationCategoryId = '223456789012345678';
  config.transcriptChannelId = '323456789012345678';
  config.positions[0].grantRoleIds = ['423456789012345678'];
  config.positions[0].removeRoleIds = ['433456789012345678', '443456789012345678'];
  const handlers = {};
  let channelOptions;
  let stored;
  let startResponse;
  const dmMessages = [];
  const channelMessages = [];
  const reviewChannel = {
    id: '523456789012345678',
    send: async (payload) => { channelMessages.push(payload); return { id: '623456789012345678' }; },
  };
  const guild = {
    name: 'Test Guild',
    roles: { everyone: { id: '823456789012345678' } },
    channels: {
      create: async (options) => { channelOptions = options; return reviewChannel; },
    },
  };
  const client = {
    user: { id: '723456789012345678' },
    guilds: { fetch: async () => guild },
    on: (event, callback) => { handlers[event] = callback; },
  };
  attachBotHandlers(client, {
    configService: { get: async () => config },
    store: {
      hasPending: async () => false,
      create: async (record) => { stored = record; },
    },
    logger: console,
  });
  const applicant = {
    bot: false,
    id: '923456789012345678',
    username: 'Test Applicant',
    tag: 'test-applicant',
    send: async (payload) => { dmMessages.push(payload); },
  };
  const common = {
    guildId: '823456789012345678',
    user: applicant,
    guild,
    inGuild: () => true,
    isChatInputCommand: () => false,
    isButton: () => false,
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => false,
  };
  await handlers.interactionCreate({
    ...common,
    customId: 'application:position',
    values: ['legionnaire-application'],
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isStringSelectMenu: () => true,
    deferReply: async () => {},
    editReply: async (payload) => { startResponse = payload; },
  });
  assert.match(startResponse.embeds[0].data.title, /Application Started in DMs/);
  assert.match(dmMessages[0].embeds[0].data.title, /Question 1\/8/);

  const answerReplies = [];
  for (const [index, question] of config.positions[0].questions.entries()) {
    await handlers.messageCreate({
      author: applicant,
      guild: null,
      content: `Answer for ${question.id}`,
      attachments: new Map(),
      createdAt: new Date('2026-08-21T12:00:00Z'),
      reply: async (payload) => { answerReplies.push(payload); },
    });
    if (index < config.positions[0].questions.length - 1) {
      assert.match(answerReplies[index].embeds[0].data.title, new RegExp(`Question ${index + 2}\\/8`));
    }
  }
  assert.match(answerReplies.at(-1).embeds[0].data.title, /Application Submitted/);

  assert.equal(channelOptions.parent, config.applicationCategoryId);
  assert.match(channelOptions.name, /^application-test-applicant-/);
  assert.ok(!channelOptions.permissionOverwrites.some((overwrite) => overwrite.id === common.user.id));
  assert.ok(channelOptions.permissionOverwrites.some((overwrite) => overwrite.id === config.reviewerRoleIds[0]));
  assert.equal(stored.reviewChannelId, reviewChannel.id);
  assert.equal(stored.transcriptChannelId, config.transcriptChannelId);
  assert.deepEqual(stored.grantRoleIds, ['423456789012345678']);
  assert.deepEqual(stored.removeRoleIds, ['433456789012345678', '443456789012345678']);
  assert.equal(stored.answers.length, 8);
  assert.equal(stored.answers[7].value, 'Answer for acceptance-reason');
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
