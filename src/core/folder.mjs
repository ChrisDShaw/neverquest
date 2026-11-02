import { readdir, stat, lstat, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseLedger, mergeLedgers } from './ledger.mjs';

export const defaultRoot = () => path.join(os.homedir(), 'AppData', 'LocalLow', 'Niche Worlds Cult', 'Monsters and Memories');
const isLedger = name => /_(Character|Social)_/i.test(name) && /\.json$/i.test(name);

async function ledgerFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter(e => e.isFile() && isLedger(e.name)).map(e => path.join(directory, e.name));
  const archive = entries.find(e => e.isDirectory() && e.name.toLowerCase() === 'archive');
  if (archive) {
    const archivePath = path.join(directory, archive.name);
    for (const entry of await readdir(archivePath, { withFileTypes: true }))
      if (entry.isFile() && isLedger(entry.name)) files.push(path.join(archivePath, entry.name));
  }
  return files;
}

export class LedgerFolder {
  #cache = new Map();
  #pending;
  constructor(directory) { this.directory = path.resolve(directory); }
  refresh() {
    // A slow disk must not allow the polling interval to race another refresh.
    if (!this.#pending) this.#pending = this.#refresh().finally(() => { this.#pending = undefined; });
    return this.#pending;
  }
  async #refresh() {
    const problems = [];
    try {
      const files = await ledgerFiles(this.directory);
      for (const file of files) {
        try {
          const info = await stat(file, { bigint: true });
          const signature = `${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
          if (this.#cache.get(file)?.signature === signature) continue;
          // r is read-only, and Node's Windows file sharing allows the game to keep writing.
          const handle = await open(file, 'r');
          let json;
          try { json = await handle.readFile('utf8'); } finally { await handle.close(); }
          const parsed = parseLedger(json.replace(/^\uFEFF/, ''), /_Social_/i.test(path.basename(file)));
          this.#cache.set(file, { signature, ...parsed });
        } catch (error) {
          problems.push(`${path.basename(file)}: ${error instanceof SyntaxError ? 'incomplete or invalid JSON; retrying' : error.message}`);
        }
      }
      const present = new Set(files);
      // During rotation the old file may disappear before the new archive is readable.
      if (!problems.length)
        for (const file of this.#cache.keys()) if (!present.has(file)) this.#cache.delete(file);
    } catch (error) {
      // Keep every last good file when a folder or its archive is temporarily unavailable.
      problems.push(`Cannot read ledger folder: ${error.message}`);
    }
    const cached = [...this.#cache.values()];
    return {
      events: mergeLedgers(cached), files: cached.length,
      invalidRows: cached.reduce((sum, f) => sum + f.invalidRows, 0), problems
    };
  }
}

export async function resolveLedgerFolder(selected) {
  const full = path.resolve(selected);
  const info = await lstat(full);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Choose a regular Ledger or character folder.');
  if (path.basename(full).toLowerCase() === 'ledger') return full;
  const children = await readdir(full, { withFileTypes: true });
  const ledger = children.find(e => e.isDirectory() && e.name.toLowerCase() === 'ledger');
  if (ledger) return path.join(full, ledger.name);
  // Also support an exported folder with ledger files directly inside it.
  if (children.some(e => e.isFile() && isLedger(e.name))) return full;
  throw new Error('No ledger found. Choose one character’s folder, or its Ledger folder.');
}

export async function findCharacters(root = defaultRoot()) {
  const sources = [];
  let servers;
  try { servers = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  for (const server of servers.filter(e => e.isDirectory())) {
    for (const character of await readdir(path.join(root, server.name), { withFileTypes: true })) {
      if (!character.isDirectory()) continue;
      const directory = path.join(root, server.name, character.name, 'Ledger');
      try {
        const files = await ledgerFiles(directory);
        const times = await Promise.all(files.map(f => stat(f).then(s => s.mtimeMs)));
        sources.push({ directory, character: character.name, server: server.name, lastActive: Math.max(0, ...times) });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return sources.sort((a, b) => b.lastActive - a.lastActive);
}

export async function latestLedgerWrite(directory) {
  const files = await ledgerFiles(directory);
  let latest = 0;
  for (const file of files) latest = Math.max(latest, (await stat(file)).mtimeMs);
  return latest;
}
