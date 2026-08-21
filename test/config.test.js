import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateConfig } from '../src/config.js';

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
