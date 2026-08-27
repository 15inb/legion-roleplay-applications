import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const INTERVIEW_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;

export class ApplicationSessionStore {
  constructor(filePath = path.resolve('data/application-sessions.json')) {
    this.filePath = filePath;
    this.loaded = false;
    this.records = [];
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (this.loaded) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('Stored application sessions must be an array.');
      this.records = parsed.filter((session) => session && typeof session.token === 'string')
        .map((session) => ({ ...session, processing: false }));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    this.loaded = true;
  }

  async save() {
    const operation = async () => {
      const temporaryPath = `${this.filePath}.tmp`;
      const persisted = this.records.map((session) => ({ ...session, processing: false }));
      await writeFile(temporaryPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, this.filePath);
    };
    this.writeQueue = this.writeQueue.then(operation, operation);
    await this.writeQueue;
  }

  async listActive(now = Date.now()) {
    await this.load();
    const cutoff = now - INTERVIEW_SESSION_LIFETIME_MS;
    const before = this.records.length;
    this.records = this.records.filter((session) => Number.isFinite(session.updatedAt) && session.updatedAt >= cutoff);
    if (this.records.length !== before) await this.save();
    return this.records;
  }

  async upsert(session) {
    await this.load();
    const index = this.records.findIndex((record) => record.token === session.token);
    if (index === -1) this.records.push(session);
    else this.records[index] = session;
    await this.save();
    return session;
  }

  async remove(token) {
    await this.load();
    const index = this.records.findIndex((session) => session.token === token);
    if (index === -1) return null;
    const [removed] = this.records.splice(index, 1);
    await this.save();
    return removed;
  }
}
