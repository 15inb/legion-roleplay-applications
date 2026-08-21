import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConfigService, validateConfig } from '../src/config.js';

test('the included example configuration is structurally valid', async () => {
  const config = JSON.parse(await readFile('config/applications.json', 'utf8'));
  assert.equal(validateConfig(config, { allowPlaceholders: true }), config);
});

test('duplicate position IDs are rejected', async () => {
  const config = JSON.parse(await readFile('config/applications.json', 'utf8'));
  config.positions.push(structuredClone(config.positions[0]));
  assert.throws(() => validateConfig(config, { allowPlaceholders: true }), /duplicated/);
});

test('invalid question lengths are rejected', async () => {
  const config = JSON.parse(await readFile('config/applications.json', 'utf8'));
  config.positions[0].questions[0].maxLength = 5000;
  assert.throws(() => validateConfig(config, { allowPlaceholders: true }), /maxLength/);
});

test('ConfigService persists validated Discord-side edits', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'roleplay-config-'));
  const file = path.join(directory, 'applications.json');
  const config = JSON.parse(await readFile('config/applications.json', 'utf8'));
  config.reviewerRoleIds = ['123456789012345678'];
  for (const position of config.positions) {
    position.roleId = '123456789012345678';
    position.reviewChannelId = '123456789012345678';
  }
  await writeFile(file, JSON.stringify(config), 'utf8');
  const service = new ConfigService(file);

  const updated = await service.update((draft) => {
    draft.positions[0].questions[0].label = 'Updated from Discord?';
  });

  assert.equal(updated.positions[0].questions[0].label, 'Updated from Discord?');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).positions[0].questions[0].label, 'Updated from Discord?');
});

test('ConfigService permits gradual Discord setup while placeholders remain', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'roleplay-setup-'));
  const file = path.join(directory, 'applications.json');
  const config = JSON.parse(await readFile('config/applications.json', 'utf8'));
  await writeFile(file, JSON.stringify(config), 'utf8');
  const service = new ConfigService(file);

  await service.get({ allowPlaceholders: true });
  const partiallyConfigured = await service.update((draft) => {
    draft.reviewerRoleIds = ['123456789012345678'];
  }, { allowPlaceholders: true });

  assert.deepEqual(partiallyConfigured.reviewerRoleIds, ['123456789012345678']);
  assert.match(partiallyConfigured.positions[0].roleId, /^PUT_/);
});

test('ConfigService seeds an untracked runtime settings file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'roleplay-seed-'));
  const runtimeFile = path.join(directory, 'data', 'settings.json');
  const seedFile = path.join(directory, 'applications.json');
  const seed = await readFile('config/applications.json', 'utf8');
  await writeFile(seedFile, seed, 'utf8');
  const service = new ConfigService(runtimeFile, seedFile);

  const config = await service.get({ allowPlaceholders: true });

  assert.equal(config.positions.length, 1);
  assert.equal(config.positions[0].name, 'Legionnaire Application');
  assert.equal(JSON.parse(await readFile(runtimeFile, 'utf8')).positions[0].questions.length, 8);
});
