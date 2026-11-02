// A zone change clears the old map immediately. Only the latest request may
// publish an image, including when an earlier download finishes out of order.
export class MapLoader {
  constructor(fetchZone, changed) {
    this.fetchZone = fetchZone; this.changed = changed; this.generation = 0;
    this.state = { phase: 'empty', key: '', zone: null, title: 'No zone detected', detail: 'Choose a map or follow your zone.' };
  }
  publish(state) { this.state = state; this.changed(state); }
  clear(title, detail, key = '') {
    this.generation++;
    this.publish({ phase: 'empty', key, zone: null, title, detail });
  }
  async load(key, { online = false, name = key } = {}) {
    const generation = ++this.generation;
    this.publish({ phase: 'loading', key, zone: null, title: 'Loading map…', detail: name });
    try {
      const zone = await this.fetchZone(key);
      if (generation !== this.generation) return;
      this.publish({ phase: 'ready', key, zone, title: '', detail: '' });
    } catch (error) {
      if (generation !== this.generation) return;
      this.publish({ phase: online ? 'error' : 'missing', key, zone: null,
        title: online ? 'Map unavailable' : 'No cached map found',
        detail: online ? `${name} · ${error.message}` : `${name} · map downloads are off.` });
    }
  }
}
