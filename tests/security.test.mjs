import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { testPng } from '../src/smoke-fixtures.mjs';
import { MapCache, parseMaps, limitedFile } from '../src/core/map-cache.mjs';
import { validateMapImage } from '../src/core/map-safety.mjs';
import { publicUrl, publicResponse, responseBytes } from '../src/core/public-download.mjs';
import { mapImageResponse, rendererRequestAllowed } from '../src/core/protocol-security.mjs';
import { MarketClient } from '../src/core/market.mjs';

const catalogue = { categories: [{ id: 'ore', name: 'Ore', color: '#aabbcc' }], zones: [
  { name: 'Night Harbor', image: 'safe.png', width: 100, height: 80, markers: [] }
] };
const png = testPng(100, 80);
async function scratch(t) { const dir = await mkdtemp(path.join(os.tmpdir(), 'neverquest-security-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
const imageResponse = () => new Response(png, { headers: { 'Content-Type': 'image/png' } });
const fetcher = async url => url.endsWith('maps.json') ? Response.json(catalogue) : imageResponse();

test('public downloads accept only fixed HTTPS data paths, without redirects or credentials', async () => {
  for (const url of ['http://mnm-db.com/maps.json', 'https://evil.test/maps.json', 'file:///secret',
    'https://user:pass@mnm-db.com/maps.json', 'https://mnm-db.com/maps/a.svg', 'https://mnm-db.com/maps/a.png?secret=1',
    'https://mnm-db.com/maps/%2e%2e/private.json', 'https://mnm-db.com/maps/a.png#fragment']) assert.throws(() => publicUrl(url), /Blocked/);
  let called = false;
  await assert.rejects(publicResponse(async () => { called = true; }, 'https://evil.test/a.png'), /Blocked/);
  assert.equal(called, false);
  await publicResponse(async (url, options) => {
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    assert.equal(url, 'https://mnm-db.com/maps.json'); return Response.json(catalogue);
  }, 'https://mnm-db.com/maps.json', { accept: 'application/json' });
  await assert.rejects(publicResponse(async () => ({ redirected: true }), 'https://mnm-db.com/maps.json'), /redirected/);
});

test('downloads reject wrong MIME types, HTTP redirects and both declared and streamed oversized bodies', async () => {
  await assert.rejects(responseBytes(new Response('<script>bad</script>', { headers: { 'Content-Type': 'text/html' } }), 100, 'image/png'), /content type/);
  await assert.rejects(responseBytes(new Response('', { status: 302 }), 100, 'image/png'), /HTTP 302/);
  await assert.rejects(responseBytes(new Response(png, { headers: { 'Content-Type': 'image/png', 'Content-Length': '999999' } }), 100, 'image/png'), /larger/);
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(101)); }, cancel() { cancelled = true; } });
  await assert.rejects(responseBytes(new Response(stream, { headers: { 'Content-Type': 'image/png' } }), 100, 'image/png'), /larger/);
  assert.equal(cancelled, true);
});

test('raster validation rejects HTML/executables/SVG masquerading as images, truncation and changed checksums', () => {
  assert.equal(validateMapImage(png, 'safe.png', { width: 100, height: 80 }), 'image/png');
  for (const content of ['<html><script>bad()</script></html>', '<svg onload="bad()"/>', 'MZ executable'])
    assert.throws(() => validateMapImage(Buffer.from(content), 'safe.png', { width: 100, height: 80 }), /format/);
  assert.throws(() => validateMapImage(png, 'safe.avif', { width: 100, height: 80 }), /format/);
  assert.throws(() => validateMapImage(png, 'safe.png', { width: 1, height: 1 }), /dimension/);
  assert.throws(() => validateMapImage(png.subarray(0, -2), 'safe.png', { width: 100, height: 80 }), /format/);
  const corrupt = Buffer.from(png); corrupt[40] ^= 1;
  assert.throws(() => validateMapImage(corrupt, 'safe.png', { width: 100, height: 80 }), /format/);
});

test('AVIF structural validation bounds boxes and declared image dimensions and refuses sequences', () => {
  const box = (type, data) => { const b = Buffer.alloc(data.length + 8); b.writeUInt32BE(b.length); b.write(type, 4); data.copy(b, 8); return b; };
  const avif = (width, brand = 'avif') => {
    const ispe = Buffer.alloc(12); ispe.writeUInt32BE(width, 4); ispe.writeUInt32BE(80, 8);
    return Buffer.concat([box('ftyp', Buffer.concat([Buffer.from(brand), Buffer.alloc(4), Buffer.from('avif')])),
      box('meta', Buffer.concat([Buffer.alloc(4), box('iprp', box('ipco', box('ispe', ispe)))])), box('mdat', Buffer.from([0]))]);
  };
  // Structural fixture, not a decodable AV1 image; this check is explicitly not a full codec validator.
  assert.equal(validateMapImage(avif(100), 'safe.avif', { width: 100, height: 80 }), 'image/avif');
  assert.throws(() => validateMapImage(avif(999999), 'safe.avif', { width: 999999, height: 80 }), /dimension/);
  assert.throws(() => validateMapImage(avif(100, 'avis'), 'safe.avif', { width: 100, height: 80 }), /format/);
  const broken = avif(100); broken.writeUInt32BE(0xffffffff, 0);
  assert.throws(() => validateMapImage(broken, 'safe.avif', { width: 100, height: 80 }), /format/);
});

test('map catalogues bound dimensions and counts, reject paths/active formats and discard out-of-bounds markers', () => {
  const mixed = structuredClone(catalogue);
  mixed.zones.push(...['../secret.png', 'C:\\private.png', 'script.svg', 'a.html', 'https://evil.test/a.png', 'bad%2epng', 'CON.png', 'nul.avif'].map(image => ({ ...mixed.zones[0], name: image, image })));
  mixed.zones[0].markers.push({ x: -1, y: 0, label: 'outside' }, { x: 1, y: 2, label: '<script>text only</script>' });
  const parsed = parseMaps(mixed); assert.equal(parsed.zones.length, 1); assert.equal(parsed.zones[0].markers.length, 1);
  assert.equal(parsed.zones[0].markers[0].label, '<script>text only</script>');
  assert.throws(() => parseMaps({ ...catalogue, zones: Array(129).fill(catalogue.zones[0]) }), /oversized/);
  assert.throws(() => parseMaps({ ...catalogue, zones: [{ ...catalogue.zones[0], width: 999999 }] }), /supported/);
});

test('map downloads are off by default, persist the user choice and make no offline requests', async t => {
  const dir = await scratch(t); let calls = 0;
  const maps = await new MapCache(dir, async url => { calls++; return fetcher(url); }).load();
  assert.equal((await maps.list()).online, false); assert.equal(calls, 0);
  await assert.rejects(maps.fetchBytes('https://mnm-db.com/maps/safe.png', 10000, 'image/png'), /off/);
  await maps.setOnline(true); await maps.list(); await maps.zone('Night Harbor'); assert.equal(calls, 2);
  await maps.setOnline(false);
  const reopened = await new MapCache(dir, async () => { throw new Error('Offline network request!'); }).load();
  assert.equal((await reopened.list()).online, false); await reopened.zone('Night Harbor');
  assert.deepEqual(await reopened.image('safe.png'), png);
});

test('turning downloads off aborts an in-flight fetch and prevents an uncooperative fetcher committing data', async t => {
  const dir = await scratch(t); let started, signal, finish;
  const began = new Promise(resolve => { started = resolve; });
  const maps = await new MapCache(dir, async (_url, options) => { signal = options.signal; started(); return new Promise(resolve => { finish = resolve; }); }).load();
  await maps.setOnline(true); const pending = maps.list(); await began;
  await maps.setOnline(false); assert.equal(signal.aborted, true); finish(Response.json(catalogue));
  const result = await pending; assert.equal(result.catalogue, null); assert.match(result.error, /off/);
  await assert.rejects(readFile(path.join(dir, 'catalogue.json')), { code: 'ENOENT' });
});

test('tampered cached bytes are refused at the serving boundary and legacy unverified images stay blocked', async t => {
  const dir = await scratch(t), maps = await new MapCache(dir, fetcher).load();
  await maps.setOnline(true); await maps.list(); await maps.zone('Night Harbor'); await maps.setOnline(false);
  const changed = Buffer.from(png); changed[changed.length - 1] ^= 1; await writeFile(path.join(dir, 'safe.png'), changed);
  await assert.rejects(maps.image('safe.png'), /integrity/);
  assert.equal((await mapImageResponse(new Request('app://maps/safe.png'), maps)).status, 404);
  await rm(path.join(dir, 'integrity.json')); await writeFile(path.join(dir, 'safe.png'), png);
  const reopened = await new MapCache(dir, fetcher).load(); await assert.rejects(reopened.zone('Night Harbor'), /no integrity/);
});

test('cached catalogue traversal and oversized files cannot bypass download-time validation', async t => {
  const dir = await scratch(t);
  await writeFile(path.join(dir, 'catalogue.json'), JSON.stringify({ catalogue: { ...catalogue, zones: [{ ...catalogue.zones[0], image: '../outside.png' }] }, cachedAt: Date.now() }));
  const maps = await new MapCache(dir, async () => { throw new Error('Must not download'); }).load();
  assert.equal((await maps.list()).catalogue, null); await assert.rejects(maps.zone('Night Harbor'), /No provider/);
  await writeFile(path.join(dir, 'big'), Buffer.alloc(100)); await assert.rejects(limitedFile(path.join(dir, 'big'), 99), /larger/);
});

test('image responses are isolated, cannot be used as scripts/documents and always disable MIME sniffing', async t => {
  const dir = await scratch(t), maps = await new MapCache(dir, fetcher).load();
  await maps.setOnline(true); await maps.list(); await maps.zone('Night Harbor');
  const response = await mapImageResponse(new Request('app://maps/safe.png'), maps);
  assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff'); assert.match(response.headers.get('Content-Security-Policy'), /sandbox/);
  assert.match(response.headers.get('Content-Security-Policy'), /default-src 'none'/);
  assert.equal(rendererRequestAllowed({ url: 'app://maps/safe.png', resourceType: 'image' }), true);
  for (const resourceType of ['script', 'mainFrame', 'subFrame', 'xhr', 'object', 'stylesheet'])
    assert.equal(rendererRequestAllowed({ url: 'app://maps/safe.png', resourceType }), false);
  for (const url of ['https://mnm-db.com/maps/safe.png', 'file:///secret', 'app://maps/bad.svg', 'app://maps/safe.png?x=1', 'app://maps/%2e%2e/private'])
    assert.equal(rendererRequestAllowed({ url, resourceType: 'image' }), false);
  assert.equal((await mapImageResponse(new Request('app://maps/safe.png', { method: 'POST' }), maps)).status, 400);
});

test('market downloads also reject HTML rather than replacing a cached feed', async () => {
  const market = new MarketClient(null, async () => new Response('<script>bad()</script>', { headers: { 'Content-Type': 'text/html' } }));
  const result = await market.get(true); assert.equal(result.feed, null); assert.match(result.error, /content type/);
});
