import { mkdir, open, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { MAP_BYTES, mapFilename, mapDimensions, mapMime, validateMapImage } from './map-safety.mjs';
import { publicResponse, responseBytes } from './public-download.mjs';

export const mapKey = name => String(name ?? '').toLowerCase().replace(/[^a-z]/g, '');
const aliases = { nightharborw: 'nightharbor', nightharbore: 'nightharbor', wyrmsbanetomb: 'tombofthelastwyrmsbane', evergrove: 'evershadeweald' };
export const mapZoneKey = name => aliases[mapKey(name)] ?? mapKey(name);
const text = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function parseMaps(data) {
  if (!data || !Array.isArray(data.zones) || !data.zones.length || data.zones.length > 128
      || !Array.isArray(data.categories) || data.categories.length > 64) throw new Error('Invalid or oversized map catalogue.');
  const keys = new Set(), images = new Set(), zones = [];
  const categories = data.categories.filter(c => c && typeof c.id === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(c.id))
    .map(c => ({ id: c.id, name: text(c.name, 80) || c.id, color: /^#[a-f\d]{6}$/i.test(c.color) ? c.color : '#d4b779' }));
  for (const z of data.zones) {
    const key = mapZoneKey(text(z?.name, 100));
    if (!key || !mapFilename(z?.image) || !mapDimensions(z.width, z.height) || keys.has(key) || images.has(z.image.toLowerCase())) continue;
    if (z.markers !== undefined && (!Array.isArray(z.markers) || z.markers.length > 5000)) throw new Error('Too many map markers.');
    const markers = (z.markers ?? []).filter(m => m && Number.isFinite(m.x) && Number.isFinite(m.y)
      && m.x >= 0 && m.x <= z.width && m.y >= 0 && m.y <= z.height)
      .map(m => ({ x: m.x, y: m.y, label: text(m.label, 200), category: text(m.category, 40), notes: text(m.notes, 3000) }));
    zones.push({ key, name: text(z.name, 100), image: z.image, width: z.width, height: z.height,
      source: text(z.source, 500) || 'Community wiki map via MnMdb', markers });
    keys.add(key); images.add(z.image.toLowerCase());
  }
  if (!zones.length) throw new Error('The map catalogue has no supported maps.');
  return { generatedAt: text(data.generatedAt, 80) || null, categories, zones };
}

export async function limitedFile(filename, maxBytes) {
  const handle = await open(filename, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error('Cached file is larger than allowed.');
    const buffer = Buffer.alloc(info.size + 1); let size = 0;
    while (size < buffer.length) { const r = await handle.read(buffer, size, buffer.length - size, null); if (!r.bytesRead) break; size += r.bytesRead; }
    if (size > info.size) throw new Error('Cached file changed while reading.');
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

export class MapCache {
  constructor(directory, fetcher = fetch) {
    this.directory = directory; this.fetcher = fetcher; this.catalogue = null; this.cachedAt = 0;
    this.pins = []; this.integrity = new Map(); this.online = false; this.generation = 0;
    this.controller = new AbortController(); this.pendingImages = new Map();
  }
  async json(name, limit) { return JSON.parse((await limitedFile(path.join(this.directory, name), limit)).toString('utf8')); }
  async write(name, data) {
    await mkdir(this.directory, { recursive: true });
    const target = path.join(this.directory, name), temp = target + '.' + randomUUID() + '.tmp';
    try { await writeFile(temp, data, { flag: 'wx' }); await rename(temp, target); }
    finally { await rm(temp, { force: true }).catch(() => {}); }
  }
  async load() {
    try { const saved = await this.json('catalogue.json', 2_000_000); this.catalogue = parseMaps(saved.catalogue); this.cachedAt = Number.isFinite(saved.cachedAt) ? saved.cachedAt : 0; }
    catch (error) { if (error.code !== 'ENOENT') this.cacheError = 'Invalid map catalogue cache was ignored.'; }
    try {
      const saved = await this.json('integrity.json', 100_000);
      if (saved.version === 1 && Array.isArray(saved.images) && saved.images.length <= 128)
        for (const i of saved.images) if (mapFilename(i?.name) && /^[a-f0-9]{64}$/.test(i.sha256)
            && Number.isSafeInteger(i.size) && i.size > 0 && i.size <= MAP_BYTES) this.integrity.set(i.name, { sha256: i.sha256, size: i.size });
    } catch { /* Old, unverified images are never served. */ }
    try { this.online = (await this.json('network.json', 1000)).enabled === true; } catch { this.online = false; }
    try {
      const saved = await this.json('pins.json', 2_000_000);
      if (!Array.isArray(saved) || saved.length > 5000) throw new Error('Invalid pins.');
      this.pins = saved.filter(p => p && typeof p.id === 'string' && mapFilename(p.image) && typeof p.zone === 'string'
        && Number.isFinite(p.x) && Number.isFinite(p.y) && typeof p.label === 'string').map(p => ({
          id: text(p.id, 100), zone: text(p.zone, 100), image: p.image, x: p.x, y: p.y, label: text(p.label, 200), category: text(p.category, 40) }));
    } catch (error) { if (error.code !== 'ENOENT') this.pinError = 'Saved private map pins could not be read; they have been left untouched.'; }
    return this;
  }
  async setOnline(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Choose whether map downloads are enabled.');
    // Disable immediately and cancel pending fetches before saving the choice.
    if (!enabled) { this.online = false; this.generation++; this.controller.abort(); }
    await this.write('network.json', JSON.stringify({ enabled }));
    if (enabled && !this.online) { this.controller = new AbortController(); this.generation++; this.online = true; }
    return { online: this.online };
  }
  assertOnline(generation = this.generation) {
    if (!this.online || generation !== this.generation) throw new Error('Map downloads are off. Enable downloads to fetch community maps.');
  }
  async fetchBytes(url, maxBytes, mime) {
    this.assertOnline();
    const response = await publicResponse(this.fetcher, url, { accept: mime, signal: this.controller.signal });
    return responseBytes(response, maxBytes, mime);
  }
  async list() {
    if (this.pendingList) return this.pendingList;
    this.pendingList = this.refreshList().finally(() => { this.pendingList = null; }); return this.pendingList;
  }
  async refreshList() {
    let error = this.cacheError ?? '';
    if (this.online && (!this.catalogue || Date.now() - this.cachedAt > 7 * 86400000)
        && (!this.lastAttempt || Date.now() - this.lastAttempt > 60000)) {
      const generation = this.generation; this.lastAttempt = Date.now();
      try {
        const catalogue = parseMaps(JSON.parse((await this.fetchBytes('https://mnm-db.com/maps.json', 2_000_000, 'application/json')).toString('utf8')));
        this.assertOnline(generation);
        const cachedAt = Date.now(); await this.write('catalogue.json', JSON.stringify({ catalogue, cachedAt }));
        this.catalogue = catalogue; this.cachedAt = cachedAt; this.cacheError = ''; error = '';
      } catch (e) { error = e.message; }
    }
    return { catalogue: this.catalogue, error, online: this.online, pinError: this.pinError ?? '', cachedAt: this.cachedAt };
  }
  async cachedImage(zone) {
    const proof = this.integrity.get(zone.image);
    if (!proof) throw new Error('This saved map has no integrity record. Download a new copy before opening it.');
    const bytes = await limitedFile(path.join(this.directory, zone.image), MAP_BYTES);
    if (bytes.length !== proof.size || digest(bytes) !== proof.sha256) throw new Error('This saved map failed its integrity check. Try downloading it again.');
    validateMapImage(bytes, zone.image, zone); return bytes;
  }
  async ensureImage(zone) {
    try { await this.cachedImage(zone); return; } catch (error) { if (!this.online) throw new Error(error.message + ' Map downloads are off.'); }
    if (this.pendingImages.has(zone.image)) return this.pendingImages.get(zone.image);
    const generation = this.generation;
    // Serialize image commits so parallel requests cannot lose integrity records.
    const pending = (this.imageQueue ?? Promise.resolve()).catch(() => {}).then(async () => {
      this.assertOnline(generation);
      const bytes = await this.fetchBytes('https://mnm-db.com/maps/' + zone.image, MAP_BYTES, mapMime(zone.image));
      validateMapImage(bytes, zone.image, zone); this.assertOnline(generation);
      await this.write(zone.image, bytes);
      const integrity = new Map(this.integrity); integrity.set(zone.image, { sha256: digest(bytes), size: bytes.length });
      await this.write('integrity.json', JSON.stringify({ version: 1, images: [...integrity].map(([name, proof]) => ({ name, ...proof })) }));
      this.integrity = integrity;
    }).finally(() => this.pendingImages.delete(zone.image));
    this.pendingImages.set(zone.image, pending); this.imageQueue = pending; return pending;
  }
  async zone(key) {
    if (typeof key !== 'string' || key.length > 100) throw new Error('Choose a known map.');
    const zone = this.catalogue?.zones.find(z => z.key === mapZoneKey(key));
    if (!zone || !mapFilename(zone.image)) throw new Error('No provider map is available for this zone.');
    await this.ensureImage(zone);
    return { ...zone, imageUrl: 'app://maps/' + zone.image,
      pins: this.pins.filter(p => p.zone === zone.key && p.image === zone.image), pinError: this.pinError ?? '' };
  }
  async image(name) {
    const zone = mapFilename(name) && this.catalogue?.zones.find(z => z.image === name);
    if (!zone) throw new Error('Unknown map image.');
    return this.cachedImage(zone);
  }
  async savePin(input) {
    if (this.pinError) throw new Error(this.pinError);
    const zone = this.catalogue?.zones.find(z => z.key === input?.zone);
    if (!zone || !Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.y < 0 || input.x > zone.width || input.y > zone.height)
      throw new Error('Choose a position on the current map.');
    if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 200) throw new Error('Name the pin (maximum 200 characters).');
    if (this.pins.length >= 5000) throw new Error('The private pin limit has been reached.');
    const pin = { id: randomUUID(), zone: zone.key, image: zone.image, x: input.x, y: input.y, label: input.label.trim(), category: text(input.category, 40) || 'misc' };
    this.pins.push(pin); await this.savePins(); return pin;
  }
  async removePin(id) { if (this.pinError) throw new Error(this.pinError); this.pins = this.pins.filter(p => p.id !== id); await this.savePins(); }
  async savePins() { await this.write('pins.json', JSON.stringify(this.pins)); }
}
