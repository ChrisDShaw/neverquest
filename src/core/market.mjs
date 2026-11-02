import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { publicResponse, responseBytes } from './public-download.mjs';

export const MARKET_URL = 'https://mnm-db.com/auctions.json';
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const coin = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value)) ? Math.round(value) : null;
const text = value => typeof value === 'string' ? value.slice(0, 2000) : '';
const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

export function parseMarket(json) {
  const root = typeof json === 'string' ? JSON.parse(json) : json;
  if (!root || !Array.isArray(root.listings)) throw new Error('The provider did not return an auction feed.');
  if (root.listings.length > 50000 || (Array.isArray(root.requests) && root.requests.length > 50000)) throw new Error('Auction feed has too many records.');
  const listings = root.listings.filter(l => l && typeof l === 'object' && text(l.item) && text(l.player)).map(l => ({
    server: text(l.server), item: text(l.item), player: text(l.player),
    intent: ['sell', 'buy', 'trade', 'inquiry'].includes(l.intent) ? l.intent : 'unknown',
    price: coin(l.price), unit: coin(l.unit), priceStr: text(l.priceStr), stack: number(l.stack),
    perStack: l.perStack === true, qty: number(l.qty), matched: l.matched === true,
    assumed: l.assumed === true, firstSeen: time(l.seen), count: number(l.count) ?? 1
  }));
  return { generatedAt: time(root.generatedAt), listings,
    requests: Array.isArray(root.requests) ? root.requests.filter(r => r && typeof r === 'object').map(r => ({
      server: text(r.server), player: text(r.player), text: text(r.text), firstSeen: time(r.seen), lastSeen: time(r.lastSeen) })) : [],
    capture: { blindNowMin: number(root.capture?.blindNowMin), lastLinesAt: time(root.capture?.lastLinesAt) },
    servers: [...new Set(listings.map(l => l.server))].sort() };
}

export function marketSummary(feed, server) {
  const groups = new Map();
  for (const l of feed.listings) {
    if (l.server !== server || !l.matched || l.unit === null || !['sell', 'buy'].includes(l.intent)) continue;
    const key = l.item.toLowerCase(), g = groups.get(key) ?? { item: l.item, key, sell: [], buy: [] };
    g[l.intent].push(l.unit); groups.set(key, g);
  }
  return [...groups.values()].map(g => {
    const prices = g.sell.sort((a, b) => a - b), middle = Math.floor(prices.length / 2);
    return { item: g.item, key: g.key, sellers: prices.length, buyers: g.buy.length,
      low: prices[0] ?? null, high: prices.at(-1) ?? null,
      median: prices.length ? prices.length % 2 ? prices[middle] : Math.floor((prices[middle - 1] + prices[middle]) / 2) : null,
      bid: g.buy.length ? Math.max(...g.buy) : null };
  });
}

export class MarketClient {
  constructor(directory, fetcher = fetch) {
    this.directory = directory; this.fetcher = fetcher;
    this.state = { feed: null, history: [], checkedAt: null, triedAt: null, notBefore: 0, etag: '', error: '' };
  }
  async load() {
    try { const cached = JSON.parse(await readFile(path.join(this.directory, 'market.json'), 'utf8')); if (cached.feed?.listings) this.state = { ...this.state, ...cached }; }
    catch { /* Public cache is optional; it never contains private ledger records. */ }
    return this;
  }
  async save() {
    if (!this.directory) return;
    await mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, 'market.json');
    await writeFile(file + '.tmp', JSON.stringify(this.state)); await rename(file + '.tmp', file);
  }
  async get(manual = false, now = Date.now()) {
    if (this.pending) return this.pending;
    const s = this.state;
    const interval = manual ? 10 * 60_000 : 60 * 60_000;
    if (now < s.notBefore || (s.triedAt !== null && now - s.triedAt < interval)
        || (!manual && s.feed?.generatedAt && now - s.feed.generatedAt < 6 * 3_600_000 + 20 * 60_000)) return this.snapshot();
    this.pending = this.download(now).finally(() => { this.pending = null; });
    return this.pending;
  }
  snapshot() { return { ...this.state, source: MARKET_URL, nextManualAt: Math.max(this.state.notBefore, (this.state.triedAt ?? 0) + 600_000) }; }
  async download(now) {
    const s = this.state; s.triedAt = now;
    try {
      const etag = typeof s.etag === 'string' && s.etag.length <= 512 && !/[\r\n]/.test(s.etag) ? s.etag : '';
      const response = await publicResponse(this.fetcher, MARKET_URL, { accept: 'application/json',
        headers: etag ? { 'If-None-Match': etag } : {} });
      if ([429, 503].includes(response.status)) {
        const retry = response.headers.get('retry-after');
        const wait = /^\d+$/.test(retry ?? '') ? Number(retry) * 1000 : Math.max(0, (Date.parse(retry) || 0) - now);
        s.notBefore = now + Math.min(86400000, Math.max(wait, 3600000));
        await response.body?.cancel().catch(() => {});
        throw new Error('The auction provider is limiting requests. The cached feed is retained.');
      }
      if (response.status === 304) { if (!s.feed) throw new Error('Provider returned no data and no cache is available.'); }
      else {
        const feed = parseMarket((await responseBytes(response, 40_000_000, 'application/json')).toString('utf8'));
        if (feed.generatedAt && !s.history.some(h => h.generatedAt === feed.generatedAt)) {
          s.history.push({ generatedAt: feed.generatedAt, servers: Object.fromEntries(feed.servers.map(server => [server, marketSummary(feed, server)])) });
          s.history = s.history.slice(-32);
        }
        s.feed = feed; s.etag = response.headers.get('etag') ?? '';
      }
      s.checkedAt = now; s.error = ''; s.notBefore = 0;
    } catch (error) { s.error = error.message; }
    try { await this.save(); } catch { s.error = [s.error, 'The public market cache could not be saved.'].filter(Boolean).join(' '); }
    return this.snapshot();
  }
}
