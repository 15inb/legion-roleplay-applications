import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { emojiKeyFromInput, ReactionRoleStore } from '../src/reaction-roles.js';

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
