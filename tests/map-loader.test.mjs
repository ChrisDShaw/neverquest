import test from 'node:test';
import assert from 'node:assert/strict';
import { MapLoader } from '../src/renderer/map-loader.mjs';

test('a missing offline map clears the previous map immediately and names the empty state', async () => {
  const states = [], loader = new MapLoader(async key => {
    if (key === 'nightharbor') return { key, name: 'Night Harbor', imageUrl: 'app://maps/invented.png', pins: [{ id: 'invented' }] };
    throw new Error('No checked cached image');
  }, state => states.push(state));
  await loader.load('nightharbor'); assert.equal(loader.state.phase, 'ready');
  const missing = loader.load('shadeddunes', { online: false, name: 'Shaded Dunes' });
  assert.equal(loader.state.zone, null, 'Do not display the old image or pins during the next request');
  await missing;
  assert.equal(loader.state.phase, 'missing'); assert.equal(loader.state.zone, null);
  assert.equal(loader.state.title, 'No cached map found'); assert.match(loader.state.detail, /Shaded Dunes/);
  assert.match(loader.state.detail, /downloads are off/);
  assert.ok(states.slice(-2).every(state => state.zone === null));
});

test('an old map request cannot replace the current zone or its missing-cache message', async () => {
  let finish;
  const loader = new MapLoader(key => key === 'old-zone' ? new Promise(resolve => { finish = resolve; })
    : Promise.reject(new Error('Not cached')), () => {});
  const old = loader.load('old-zone', { online: true });
  await loader.load('new-zone'); finish({ key: 'old-zone' }); await old;
  assert.equal(loader.state.key, 'new-zone'); assert.equal(loader.state.title, 'No cached map found');
  assert.equal(loader.state.zone, null);
});

test('enabling downloads can retry a missing map and a failed online load never keeps stale content', async () => {
  let available = false;
  const loader = new MapLoader(async key => { if (!available) throw new Error('Unavailable'); return { key, pins: [] }; }, () => {});
  await loader.load('zone'); assert.equal(loader.state.phase, 'missing');
  available = true; await loader.load('zone', { online: true }); assert.equal(loader.state.phase, 'ready');
  available = false; await loader.load('other-zone', { online: true });
  assert.equal(loader.state.phase, 'error'); assert.equal(loader.state.zone, null);
});

test('an unsupported zone clears the previous map and invalidates any pending request', async () => {
  let finish;
  const loader = new MapLoader(() => new Promise(resolve => { finish = resolve; }), () => {});
  const pending = loader.load('old-zone');
  loader.clear('No map available', 'Choose a zone manually.', 'unsupported-zone');
  finish({ key: 'old-zone' }); await pending;
  assert.equal(loader.state.key, 'unsupported-zone'); assert.equal(loader.state.zone, null);
  assert.equal(loader.state.title, 'No map available');
});
