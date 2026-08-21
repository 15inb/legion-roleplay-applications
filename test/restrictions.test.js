import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ApplicationRestrictionStore, parseRestrictionDuration } from '../src/restrictions.js';

test('restriction durations support combined units and permanent bars', () => {
  const now = Date.parse('2026-08-21T12:00:00.000Z');
  assert.equal(parseRestrictionDuration('1d 12h', now).expiresAt, '2026-08-23T00:00:00.000Z');
  assert.equal(parseRestrictionDuration('30s', now).expiresAt, '2026-08-21T12:00:30.000Z');
  assert.equal(parseRestrictionDuration('permanent', now).expiresAt, null);
  assert.throws(() => parseRestrictionDuration('tomorrow', now), /Duration must look like/);
  assert.throws(() => parseRestrictionDuration('0h', now), /at least one second/);
});

test('timed and permanent application bars persist and expired bars clean themselves up', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'application-bars-'));
  const file = path.join(directory, 'application-bars.json');
  const store = new ApplicationRestrictionStore(file);
  const now = Date.parse('2026-08-21T12:00:00.000Z');

  await store.upsert({ guildId: 'guild', userId: 'timed', expiresAt: new Date(now + 60_000).toISOString(), reason: 'Wait.', createdBy: 'staff' });
  await store.upsert({ guildId: 'guild', userId: 'permanent', expiresAt: null, reason: 'Permanent.', createdBy: 'staff' });
  assert.equal((await store.getActive('guild', 'timed', now)).reason, 'Wait.');
  assert.equal((await store.getActive('guild', 'permanent', now + 10_000_000)).expiresAt, null);
  assert.equal(await store.getActive('guild', 'timed', now + 60_001), null);
  assert.deepEqual((await store.listActive('guild', now + 60_001)).map((record) => record.userId), ['permanent']);

  const persisted = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(persisted.map((record) => record.userId), ['permanent']);
  assert.equal((await store.remove('guild', 'permanent')).userId, 'permanent');
  assert.equal(await store.remove('guild', 'missing'), null);
});
