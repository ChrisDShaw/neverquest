import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm, utimes } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { MarketClient, parseMarket, marketSummary, MARKET_URL } from '../src/core/market.mjs';
import { MapCache, parseMaps, mapZoneKey } from '../src/core/map-cache.mjs';
import { ZoneLog, zoneFromLines } from '../src/core/zone-log.mjs';
import { automaticSessions } from '../src/renderer/sessions.mjs';
import { Companion } from '../src/core/companion.mjs';
import { LocalStore } from '../src/core/store.mjs';
import { testPng } from '../src/smoke-fixtures.mjs';

const feed = { generatedAt: '2026-11-01T07:00:00Z', listings: [
  { item: 'Test ore', player: 'Invented seller', server: 'Trem', intent: 'sell', price: 500, unit: 25, perStack: true, stack: 20, matched: true },
  { item: 'Test ore', player: 'Another seller', server: 'Trem', intent: 'sell', price: 700, unit: 35, matched: true },
  { item: 'Test ore', player: 'Invented buyer', server: 'Trem', intent: 'buy', price: 300, unit: 15, matched: true },
  { item: 'Unknown', player: 'No price', server: 'Trem', intent: 'sell', price: null, unit: null, matched: false }
], requests: [{ server: 'Trem', player: 'Gear buyer', text: 'A useful ring' }] };
const catalogue = { categories: [{ id: 'ore', name: 'Ore', color: '#ab1234' }], zones: [
  { name: 'Night Harbor', image: 'night_harbor.png', width: 1000, height: 800, markers: [{ x: 20, y: 30, category: 'ore', label: 'A vein' }] },
  { name: 'Evershade Weald', image: 'evershade_weald.avif', width: 1000, height: 1000, markers: [] }
] };
async function scratch(t) { const dir = await mkdtemp(path.join(os.tmpdir(), 'neverquest-source-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

test('market feed keeps asking price units, unknown prices and server coverage distinct', () => {
  const parsed = parseMarket(feed), summary = marketSummary(parsed, 'Trem');
  assert.deepEqual(parsed.servers, ['Trem']); assert.equal(parsed.listings[0].perStack, true);
  assert.equal(parsed.listings[0].price, 500); assert.equal(parsed.listings[0].unit, 25);
  assert.equal(parsed.listings[3].unit, null); assert.equal(summary[0].median, 30); assert.equal(summary[0].bid, 15);
  assert.equal(marketSummary(parsed, 'Other server').length, 0);
  assert.equal(parseMarket({ listings: [{ ...feed.listings[0], unit: 25.6 }] }).listings[0].unit, 26);
  assert.throws(() => parseMarket({ error: 'not a feed' }), /auction feed/);
});

test('public market requests are conditional and rate-limited, with no ledger payload', async () => {
  const calls = [], now = Date.parse('2026-11-01T08:00:00Z');
  const client = new MarketClient(null, async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? Response.json(feed, { headers: { ETag: 'snapshot-1' } }) : new Response(null, { status: 304 });
  });
  const first = await client.get(false, now);
  assert.equal(first.feed.listings.length, 4); assert.equal(calls[0].url, MARKET_URL);
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.body, undefined); assert.equal(calls[0].options.redirect, 'error');
  await client.get(true, now + 1000); assert.equal(calls.length, 1);
  await client.get(true, now + 601000); assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers['If-None-Match'], 'snapshot-1'); assert.equal(client.state.history.length, 1);
});

test('market errors retain a public cached snapshot and respect provider backoff', async () => {
  const client = new MarketClient(null, async () => new Response('', { status: 429, headers: { 'retry-after': '7200' } }));
  client.state.feed = parseMarket(feed);
  const now = Date.parse('2026-11-02T08:00:00Z'), result = await client.get(true, now);
  assert.equal(result.feed.listings.length, 4); assert.match(result.error, /limiting requests/); assert.equal(result.notBefore, now + 7200000);
});

test('map catalogue rejects paths and resolves known ledger/log zone aliases', () => {
  assert.equal(mapZoneKey('nightharborw'), 'nightharbor'); assert.equal(mapZoneKey('evergrove'), 'evershadeweald');
  assert.equal(parseMaps({ ...catalogue, zones: [...catalogue.zones, { name: 'Unsafe', image: '../Player.log', width: 10, height: 10 }] }).zones.length, 2);
});

test('map images cache locally and private pins persist without being published', async t => {
  const directory = await scratch(t), urls = [];
  const fetcher = async url => { urls.push(url); return url.endsWith('maps.json') ? Response.json(catalogue) : new Response(testPng(), { headers: { 'Content-Type': 'image/png' } }); };
  const maps = await new MapCache(directory, fetcher).load();
  await maps.setOnline(true);
  await maps.list(); const zone = await maps.zone('nightharborw');
  assert.equal(zone.key, 'nightharbor'); assert.equal(urls.length, 2);
  await maps.zone('nightharbore'); assert.equal(urls.length, 2, 'Image cache avoids another request');
  const pin = await maps.savePin({ zone: zone.key, x: 30, y: 40, label: 'My private place', category: 'ore' });
  assert.equal(urls.length, 2, 'Saving a pin must not make a network request');
  const reopened = await new MapCache(directory, fetcher).load();
  assert.equal((await reopened.zone('nightharbor')).pins[0].label, 'My private place');
  await reopened.removePin(pin.id); assert.equal((await reopened.zone('nightharbor')).pins.length, 0);
  await assert.rejects(maps.image('../Player.log'), /Unknown map/);
  await assert.rejects(maps.savePin({ zone: zone.key, x: -1, y: 0, label: 'outside' }), /position/);
});

test('automatic sessions reconstruct history, cross midnight and split on quiet gaps', () => {
  const at = Date.parse('2026-11-01T23:55:00Z'), events = [0, 10, 45, 46].map((minutes, i) => ({ at: at + minutes * 60000, identity: String(i) }));
  const sessions = automaticSessions(events, 'source', 30, at + 47 * 60000);
  assert.equal(sessions.length, 2); assert.equal(sessions[0].events, 2); assert.equal(sessions[1].active, true);
  assert.equal(sessions[0].endedAt, events[1].at + 1);
  assert.equal(automaticSessions([...events].reverse(), 'source', 30)[0].id, sessions[0].id);
  assert.equal(automaticSessions(events, 'source', 60).length, 1);
});

test('automatic sessions are available without manual starts and preserve renamed sessions across restart', async t => {
  const dir = await scratch(t), store = await new LocalStore(dir).load(), app = new Companion(store);
  store.data.sources.push({ id: 'one', character: 'Tester', server: 'Trem', directory: '', events: [{ at: 1000, identity: 'first', act: 'act_13', item: 'Ore', quantity: 1, social: false }] });
  app.sourceId = 'one'; const automatic = app.snapshot().sessions[0]; assert.equal(automatic.kind, 'automatic');
  await app.action('session:rename', { id: automatic.id, name: 'Yesterday evening' });
  const reopened = new Companion(await new LocalStore(dir).load()); reopened.sourceId = 'one';
  assert.equal(reopened.snapshot().sessions[0].name, 'Yesterday evening');
  assert.equal(reopened.scoped({ sessionId: automatic.id }).events.length, 1);
});

test('Player.log contributes only zoning tokens; partial appends and rotation are handled read-only', async t => {
  const dir = await scratch(t), filename = path.join(dir, 'Player.log'), reader = new ZoneLog(dir);
  assert.equal((await reader.refresh()).zone, null);
  await writeFile(filename, 'Unrelated account/network/chat text\nStart zoning process to night');
  assert.equal((await reader.refresh()).zone, null, 'A partial line is not yet a completed zone event');
  await appendFile(filename, 'harborw\nOther engine text\n');
  const before = await readFile(filename, 'utf8');
  assert.equal((await reader.refresh()).zone, 'nightharborw');
  assert.equal(await readFile(filename, 'utf8'), before);
  await writeFile(filename, 'Start zoning process to evergrove\n');
  assert.equal((await reader.refresh()).zone, 'evergrove');
  await writeFile(filename, 'nothing relevant here\n');
  await utimes(filename, new Date(), new Date(Date.now() + 5000));
  assert.equal((await reader.refresh()).zone, null, 'A new log with no zoning falls back to the ledger');
  assert.equal(zoneFromLines('other engine messages'), null);
});
