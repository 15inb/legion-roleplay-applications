import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildReactionRoleEmbed,
  emojiKeyFromInput,
  handleReactionRoleCommand,
  ReactionRoleStore,
} from '../src/reaction-roles.js';

test('reaction-role mappings persist, replace, and remove cleanly', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'reaction-roles-'));
  const file = path.join(directory, 'reaction-roles.json');
  const store = new ReactionRoleStore(file);
  const mapping = {
    guildId: 'guild',
    channelId: 'channel',
    messageId: 'message',
    roleId: 'role-1',
    emoji: '🛡️',
    emojiKey: '🛡️',
  };
  await store.add(mapping);
  await store.add({ ...mapping, roleId: 'role-2' });

  assert.equal((await store.list('guild')).length, 1);
  assert.equal((await store.find('guild', 'message', '🛡️')).roleId, 'role-2');
  assert.equal((await store.remove('guild', 'message', '🛡️')).roleId, 'role-2');
  assert.equal(await store.find('guild', 'message', '🛡️'), null);
});

test('custom emoji mentions normalize to their Discord emoji ID', () => {
  assert.equal(emojiKeyFromInput('<:legion:123456789012345678>'), '123456789012345678');
  assert.equal(emojiKeyFromInput('✅'), '✅');
});

test('one reaction-role panel can be created with multiple roles', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'reaction-roles-multiple-'));
  const store = new ReactionRoleStore(path.join(directory, 'reaction-roles.json'));
  const roles = {
    role: { id: 'role-1', name: 'Legionnaire', managed: false, comparePositionTo: () => -1 },
    'role-2': { id: 'role-2', name: 'Officer', managed: false, comparePositionTo: () => -1 },
  };
  const strings = { emoji: '🛡️', 'emoji-2': '⚔️', title: 'Choose your roles', description: 'React below.' };
  const reactions = [];
  let sent;
  let response;
  const message = {
    id: 'message',
    url: 'https://discord.com/channels/guild/channel/message',
    react: async (emoji) => { reactions.push(emoji); },
    delete: async () => {},
  };
  const channel = { id: 'channel', isTextBased: () => true, send: async (payload) => { sent = payload; return message; } };
  await handleReactionRoleCommand({
    guildId: 'guild',
    guild: { members: { me: { roles: { highest: {} } } } },
    options: {
      getSubcommand: () => 'create',
      getChannel: () => channel,
      getRole: (name) => roles[name],
      getString: (name) => strings[name],
    },
    reply: async (payload) => { response = payload; },
  }, store);

  assert.deepEqual(reactions, ['🛡️', '⚔️']);
  assert.equal((await store.listForMessage('guild', 'message')).length, 2);
  assert.match(sent.embeds[0].data.fields[0].value, /<@&role-1>/);
  assert.match(sent.embeds[0].data.fields[0].value, /<@&role-2>/);
  assert.match(response.content, /Reaction-role panel created/);
});

test('reaction-role embeds clearly list every mapping', () => {
  const embed = buildReactionRoleEmbed({ title: 'Roles', description: 'Choose.' }, [
    { emoji: '🛡️', roleId: 'role-1' },
    { emoji: '⚔️', roleId: 'role-2' },
  ]).toJSON();
  assert.match(embed.fields[0].value, /🛡️  →  <@&role-1>/);
  assert.match(embed.fields[0].value, /⚔️  →  <@&role-2>/);
  assert.match(embed.footer.text, /Remove it to remove the role/);
});
