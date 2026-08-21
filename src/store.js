import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class ApplicationStore {
  constructor(filePath = path.resolve('data/applications.json')) {
    this.filePath = filePath;
    this.loaded = false;
    this.records = [];
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (this.loaded) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const data = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!Array.isArray(data)) throw new Error('Stored application data must be an array.');
      this.records = data;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    this.loaded = true;
  }

  async save() {
    const operation = async () => {
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.records, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, this.filePath);
    };
    this.writeQueue = this.writeQueue.then(operation, operation);
    await this.writeQueue;
  }

  async create(record) {
    await this.load();
    this.records.push(record);
    await this.save();
    return record;
  }

  async get(id) {
    await this.load();
    return this.records.find((record) => record.id === id) ?? null;
  }

  async latestForUser(guildId, userId) {
    await this.load();
    return [...this.records].reverse().find((record) => record.guildId === guildId && record.userId === userId) ?? null;
  }

  async hasPending(guildId, userId) {
    await this.load();
    return this.records.some((record) => record.guildId === guildId && record.userId === userId && record.status === 'pending');
  }

  async decide(id, decision) {
    await this.load();
    const record = this.records.find((item) => item.id === id);
    if (!record || record.status !== 'pending') return null;
    Object.assign(record, decision);
    await this.save();
    return record;
  }
}
