import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ApplicationStore } from '../src/store.js';

test('applications persist and can be decided once', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'roleplay-applications-'));
  const file = path.join(directory, 'applications.json');
  const store = new ApplicationStore(file);
  const record = { id: 'TEST123', guildId: 'guild', userId: 'user', status: 'pending' };

  await store.create(record);
  assert.equal(await store.hasPending('guild', 'user'), true);
  assert.equal((await store.latestForUser('guild', 'user')).id, 'TEST123');

  const decided = await store.decide('TEST123', { status: 'approved', decidedBy: 'reviewer' });
  assert.equal(decided.status, 'approved');
  assert.equal(await store.hasPending('guild', 'user'), false);
  assert.equal(await store.decide('TEST123', { status: 'denied' }), null);

  const persisted = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(persisted[0].status, 'approved');
});
