import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { attachBotHandlers } from '../src/bot.js';
import { ApplicationSessionStore, INTERVIEW_SESSION_LIFETIME_MS } from '../src/sessions.js';

test('unfinished application sessions survive a store restart and reset processing state', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'application-sessions-'));
  const file = path.join(directory, 'sessions.json');
  const firstStore = new ApplicationSessionStore(file);
  const session = {
    token: 'resume-token',
    guildId: 'guild',
    userId: 'user',
    questionIndex: 1,
    answers: { first: 'Saved answer' },
    updatedAt: Date.now(),
    processing: true,
  };

  await firstStore.upsert(session);
  const recovered = await new ApplicationSessionStore(file).listActive();

  assert.equal(recovered[0].questionIndex, 1);
  assert.equal(recovered[0].answers.first, 'Saved answer');
  assert.equal(recovered[0].processing, false);
  assert.equal(JSON.parse(await readFile(file, 'utf8'))[0].processing, false);
});

test('expired unfinished application sessions are removed during recovery', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'expired-application-sessions-'));
  const file = path.join(directory, 'sessions.json');
  const store = new ApplicationSessionStore(file);
  await store.upsert({
    token: 'expired-token',
    guildId: 'guild',
    userId: 'user',
    updatedAt: Date.now() - INTERVIEW_SESSION_LIFETIME_MS - 1,
  });

  assert.deepEqual(await new ApplicationSessionStore(file).listActive(), []);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), []);
});

test('a recovered DM interview continues from its saved question', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'resumed-dm-interview-'));
  const sessionStore = new ApplicationSessionStore(path.join(directory, 'sessions.json'));
  const config = JSON.parse(await readFile('config/applications.json', 'utf8'));
  const position = config.positions[0];
  await sessionStore.upsert({
    token: 'resume-token',
    userId: 'user',
    guildId: 'guild',
    guildName: 'Test Guild',
    positionId: position.id,
    position,
    config,
    answers: { [position.questions[0].id]: 'Previously saved answer' },
    questionIndex: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    processing: false,
  });

  const handlers = {};
  const client = { on: (event, callback) => { handlers[event] = callback; } };
  attachBotHandlers(client, {
    configService: { get: async () => config },
    store: { latestDeniedForUser: async () => null },
    sessionStore: new ApplicationSessionStore(sessionStore.filePath),
    logger: console,
  });
  let reply;
  await handlers.messageCreate({
    author: { bot: false, id: 'user' },
    guild: null,
    content: 'Answer after restart',
    attachments: new Map(),
    reply: async (payload) => { reply = payload; },
  });

  assert.match(reply.embeds[0].data.title, /Question 3\/8/);
  const persisted = await new ApplicationSessionStore(sessionStore.filePath).listActive();
  assert.equal(persisted[0].questionIndex, 2);
  assert.equal(persisted[0].answers[position.questions[0].id], 'Previously saved answer');
  assert.equal(persisted[0].answers[position.questions[1].id], 'Answer after restart');
});
