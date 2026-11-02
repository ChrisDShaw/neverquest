import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import path from 'node:path';

export const emptyData = () => ({ version: 1, revision: 0, sources: [], sessions: [], goals: [], knowledge: [],
  notes: [], bookmarks: [], labels: [], alerts: [], timers: [], sounds: [], profiles: {}, preferences: { follow: false } });

export class LocalStore {
  constructor(directory = null) { this.directory = directory; this.data = emptyData(); this.queue = Promise.resolve(); }
  async load() {
    if (!this.directory) return this;
    await mkdir(this.directory, { recursive: true });
    const filename = path.join(this.directory, 'collection.json');
    try {
      const parsed = JSON.parse(await readFile(filename, 'utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.sources) || !Array.isArray(parsed.sessions))
        throw new Error('Unsupported or damaged collection format');
      this.data = { ...emptyData(), ...parsed };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // Never replace unreadable history with an empty collection.
        throw new Error(`We couldn’t read your saved history. Your saved file has been left untouched. Details: ${error.message}`);
      }
    }
    return this;
  }
  async save() {
    this.data.revision++;
    if (!this.directory) return;
    const text = JSON.stringify(this.data);
    const filename = path.join(this.directory, 'collection.json');
    const operation = this.queue.catch(() => {}).then(async () => {
      await mkdir(this.directory, { recursive: true });
      const temporary = `${filename}.tmp`;
      await writeFile(temporary, text, { mode: 0o600 });
      try { await copyFile(filename, `${filename}.bak`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await rename(temporary, filename);
    });
    this.queue = operation;
    await operation;
  }
}
