import { open } from 'node:fs/promises';
import path from 'node:path';

export function zoneFromLines(text) {
  let zone = null;
  for (const match of text.matchAll(/Start zoning process to\s+([A-Za-z][A-Za-z0-9_-]*)/g)) zone = match[1];
  return zone;
}

// Reads only Player.log, read-only. Extracts a zone token; unrelated lines are
// discarded, never parsed into events, saved, uploaded or used for sessions.
export class ZoneLog {
  constructor(root) { this.filename = path.join(root, 'Player.log'); this.offset = 0; this.carry = ''; this.zone = null; }
  async refresh() {
    let handle;
    try {
      handle = await open(this.filename, 'r'); const info = await handle.stat();
      const identity = `${info.ino}:${info.birthtimeMs}`;
      const reset = this.identity !== identity || info.size < this.offset || (info.size === this.offset && this.stamp !== info.mtimeMs);
      if (reset) { this.offset = Math.max(0, info.size - 512_000); this.carry = ''; this.zone = null; }
      this.identity = identity; this.stamp = info.mtimeMs;
      if (info.size > this.offset) {
        const start = Math.max(this.offset, info.size - 2_000_000), buffer = Buffer.alloc(info.size - start);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start); this.offset = start + bytesRead;
        const text = (start === this.offset - bytesRead && start > 0 && reset ? '' : this.carry) + buffer.subarray(0, bytesRead).toString('utf8');
        const end = text.lastIndexOf('\n');
        if (end >= 0) {
          const found = zoneFromLines(text.slice(0, end)); if (found) this.zone = found;
          this.carry = text.slice(end + 1).slice(-500);
        } else this.carry = text.slice(-500);
      }
      return { zone: this.zone, source: 'Player.log', error: '' };
    } catch (error) {
      return { zone: null, source: 'Player.log', error: error.code === 'ENOENT' ? '' : 'Player.log is temporarily unreadable; using the ledger zone.' };
    } finally { await handle?.close(); }
  }
}
