import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SNOWFLAKE_OR_PLACEHOLDER = /^(?:\d{17,20}|PUT_[A-Z0-9_]+_HERE)$/;
const POSITION_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const QUESTION_ID = /^[a-z0-9][a-z0-9-]{0,49}$/;

function assert(condition, message) {
  if (!condition) throw new Error(`Configuration error: ${message}`);
}

export function validateConfig(config, { allowPlaceholders = false } = {}) {
  assert(config && typeof config === 'object', 'the root must be an object');
  assert(Array.isArray(config.reviewerRoleIds), 'reviewerRoleIds must be an array');
  assert(config.reviewerRoleIds.length > 0, 'at least one reviewer role is required');
  assert(config.panel && typeof config.panel === 'object', 'panel is required');
  assert(typeof config.panel.title === 'string' && config.panel.title.length <= 256, 'panel.title must be 256 characters or fewer');
  assert(typeof config.panel.description === 'string' && config.panel.description.length <= 4000, 'panel.description must be 4000 characters or fewer');
  assert(/^#[0-9a-f]{6}$/i.test(config.panel.color), 'panel.color must be a hex color such as #5865F2');
  assert(Array.isArray(config.positions) && config.positions.length > 0, 'at least one position is required');
  assert(config.positions.length <= 25, 'Discord select menus support at most 25 positions');

  const placeholders = [];
  const positionIds = new Set();
  for (const [positionIndex, position] of config.positions.entries()) {
    const prefix = `positions[${positionIndex}]`;
    assert(POSITION_ID.test(position.id), `${prefix}.id must be lowercase letters, numbers, or hyphens (max 32)`);
    assert(!positionIds.has(position.id), `${prefix}.id "${position.id}" is duplicated`);
    positionIds.add(position.id);
    assert(typeof position.name === 'string' && position.name.length >= 1 && position.name.length <= 100, `${prefix}.name must be 1-100 characters`);
    assert(typeof position.description === 'string' && position.description.length <= 100, `${prefix}.description must be 100 characters or fewer`);
    for (const field of ['roleId', 'reviewChannelId']) {
      assert(typeof position[field] === 'string' && SNOWFLAKE_OR_PLACEHOLDER.test(position[field]), `${prefix}.${field} must be a Discord ID`);
      if (position[field].startsWith('PUT_')) placeholders.push(`${prefix}.${field}`);
    }
    assert(Array.isArray(position.questions) && position.questions.length > 0, `${prefix}.questions must contain at least one question`);
    const questionIds = new Set();
    for (const [questionIndex, question] of position.questions.entries()) {
      const qPrefix = `${prefix}.questions[${questionIndex}]`;
      assert(QUESTION_ID.test(question.id), `${qPrefix}.id must be lowercase letters, numbers, or hyphens (max 50)`);
      assert(!questionIds.has(question.id), `${qPrefix}.id "${question.id}" is duplicated`);
      questionIds.add(question.id);
      assert(typeof question.label === 'string' && question.label.length >= 1 && question.label.length <= 45, `${qPrefix}.label must be 1-45 characters`);
      assert(['short', 'paragraph'].includes(question.style), `${qPrefix}.style must be "short" or "paragraph"`);
      assert(typeof question.required === 'boolean', `${qPrefix}.required must be true or false`);
      const min = question.minLength ?? 0;
      const max = question.maxLength ?? (question.style === 'short' ? 400 : 4000);
      assert(Number.isInteger(min) && min >= 0 && min <= 4000, `${qPrefix}.minLength must be 0-4000`);
      assert(Number.isInteger(max) && max >= 1 && max <= 4000, `${qPrefix}.maxLength must be 1-4000`);
      assert(min <= max, `${qPrefix}.minLength cannot exceed maxLength`);
      if (question.placeholder !== undefined) assert(typeof question.placeholder === 'string' && question.placeholder.length <= 100, `${qPrefix}.placeholder must be 100 characters or fewer`);
    }
  }

  for (const [index, roleId] of config.reviewerRoleIds.entries()) {
    assert(typeof roleId === 'string' && SNOWFLAKE_OR_PLACEHOLDER.test(roleId), `reviewerRoleIds[${index}] must be a Discord role ID`);
    if (roleId.startsWith('PUT_')) placeholders.push(`reviewerRoleIds[${index}]`);
  }
  if (!allowPlaceholders) assert(placeholders.length === 0, `replace placeholder values: ${placeholders.join(', ')}`);
  return config;
}

export class ConfigService {
  constructor(filePath = path.resolve('config/applications.json')) {
    this.filePath = filePath;
    this.cached = null;
    this.modifiedAt = 0;
    this.writeQueue = Promise.resolve();
  }

  async get(options) {
    const details = await stat(this.filePath);
    if (!this.cached || details.mtimeMs !== this.modifiedAt) {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
      this.cached = validateConfig(parsed, options);
      this.modifiedAt = details.mtimeMs;
    }
    return this.cached;
  }

  async update(mutator) {
    const operation = async () => {
      const current = JSON.parse(await readFile(this.filePath, 'utf8'));
      const next = structuredClone(current);
      await mutator(next);
      validateConfig(next);
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, this.filePath);
      this.cached = next;
      this.modifiedAt = (await stat(this.filePath)).mtimeMs;
      return next;
    };
    this.writeQueue = this.writeQueue.then(operation, operation);
    return this.writeQueue;
  }
}
