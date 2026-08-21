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
  record.reviewChannelId = 'channel';
  await store.save();
  assert.equal((await store.pendingForChannel('guild', 'channel')).id, 'TEST123');
  assert.equal((await store.latestPendingForUser('user')).id, 'TEST123');

  const decided = await store.decide('TEST123', { status: 'approved', decidedBy: 'reviewer' });
  assert.equal(decided.status, 'approved');
  assert.equal(await store.hasPending('guild', 'user'), false);
  assert.equal(await store.decide('TEST123', { status: 'denied' }), null);

  await store.create({ id: 'DENIED1', guildId: 'guild', userId: 'user', status: 'denied', decidedAt: '2026-08-21T12:00:00.000Z' });
  assert.equal((await store.latestDeniedForUser('guild', 'user')).id, 'DENIED1');

  const persisted = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(persisted[0].status, 'approved');
});
