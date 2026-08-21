import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { attachBotHandlers } from '../src/bot.js';

test('long Legion questions render in modal label descriptions without truncation', async () => {
  const config = JSON.parse(await readFile('config/applications.json', 'utf8'));
  config.reviewerRoleIds = ['123456789012345678'];
  config.positions[0].roleId = '123456789012345678';
  config.positions[0].reviewChannelId = '123456789012345678';
  let handler;
  let modal;
  const client = { on: (_event, callback) => { handler = callback; } };
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
