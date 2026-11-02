import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { itemWikiUrl } from '../src/core/wiki.mjs';
import { parseMarket } from '../src/core/market.mjs';
import { itemMarket, readMarket, snapshotAge } from '../src/renderer/market-data.mjs';
import { automaticSessions, splitPoint } from '../src/renderer/sessions.mjs';
import { scopeEvents } from '../src/renderer/analysis.mjs';
import { Companion } from '../src/core/companion.mjs';
import { LocalStore } from '../src/core/store.mjs';

const base = Date.parse('2026-11-01T12:00:00Z');
const events = (minutes = [0, 5, 60, 65, 120]) => minutes.map((m, i) => ({ at: base + m * 60000,
  identity: 'event-' + i, act: 'act_13', item: 'Ore', quantity: 1, social: false, actor: 'Tester' }));
const publicFeed = () => parseMarket({ generatedAt: new Date(base).toISOString(), listings: [
  { server: 'Trem', item: "Aashir's Earring", player: 'Seller', intent: 'sell', price: 100, unit: 100, matched: true },
  { server: 'Trem', item: "Aashir's Earring", player: 'Seller 2', intent: 'sell', price: 300, unit: 300, matched: true },
  { server: 'Trem', item: "Aashir's Earring", player: 'Buyer', intent: 'buy', price: 80, unit: 80, matched: true },
  { server: 'Other', item: "Aashir's Earring", player: 'Other seller', intent: 'sell', price: 9999, unit: 9999, matched: true },
  { server: 'Trem', item: 'Unpriced', player: 'Seller', intent: 'sell', price: null, unit: null, matched: true },
  { server: 'Trem', item: 'Gift', player: 'Seller', intent: 'sell', price: 0, unit: 0, matched: true }
] });

test('wiki item links match the supplied apostrophe slug and always stay on the fixed host', () => {
  assert.equal(itemWikiUrl("Aashir's Earring"), 'https://monstersandmemories.wiki/items/aashirs-earring');
  assert.equal(itemWikiUrl(' Aashir’s Earring '), itemWikiUrl("Aashir's Earring"));
  assert.equal(itemWikiUrl('Rat Tooth'), 'https://monstersandmemories.wiki/items/rat-tooth');
  for (const input of ['../../private?token=1#x', 'https://evil.test/malware', '//evil.test', '<script>alert(1)</script>']) {
    const url = new URL(itemWikiUrl(input));
    assert.equal(url.origin, 'https://monstersandmemories.wiki'); assert.match(url.pathname, /^\/items\/[a-z0-9-]+$/);
    assert.equal(url.search + url.hash, '');
  }
  for (const input of ['', null, '!!!', 'a'.repeat(201)]) assert.throws(() => itemWikiUrl(input));
});

test('item quotes match only the requested item/server and distinguish unknown prices, zero and missing coverage', () => {
  const state = { feed: publicFeed(), error: 'Offline; showing cache' }, quote = itemMarket(state, "Aashir's Earring", 'trem');
  assert.equal(quote.covered, true); assert.equal(quote.quote.median, 200); assert.equal(quote.quote.bid, 80);
  assert.equal(quote.quote.sell.length, 2); assert.equal(quote.quote.low, 100); assert.equal(quote.quote.high, 300);
  assert.equal(quote.generatedAt, base); assert.equal(quote.error, state.error);
  assert.equal(itemMarket(state, "Aashir's Earring", 'No feed').quote, null);
  assert.equal(itemMarket(state, "Aashir's Earring", 'No feed').covered, false);
  assert.equal(itemMarket(state, 'Missing item', 'Trem').covered, true);
  assert.equal(itemMarket(state, 'Missing item', 'Trem').quote, null);
  assert.equal(itemMarket(state, 'Unpriced', 'Trem').quote.median, null);
  assert.equal(itemMarket(state, 'Gift', 'Trem').quote.median, 0);
  assert.equal(itemMarket(null, 'Anything', 'Trem').available, false);
});

test('item drawers and Market share a request and send no item or character fields', async () => {
  let calls = 0, release;
  const wb = { api: { async getMarket(...args) { calls++; assert.deepEqual(args, [false]); return new Promise(resolve => { release = resolve; }); } } };
  const one = readMarket(wb), two = readMarket(wb); assert.equal(one, two); assert.equal(calls, 1);
  release({ ok: true, value: { feed: publicFeed() } }); await one;
  assert.equal(wb.marketLoading, false); assert.equal(wb.marketPromise, null);
  assert.equal(wb.marketState.feed.listings.length, 6);
  await readMarket(wb); assert.equal(calls, 1, 'A new item drawer must reuse the recently read feed');
});

test('failed market refresh preserves cached quotes and makes the error visible', async () => {
  const wb = { marketState: { feed: publicFeed() }, api: { async getMarket() { return { ok: false, error: 'Network failed' }; } } };
  await readMarket(wb, true); assert.match(wb.marketState.error, /Network failed/);
  assert.equal(itemMarket(wb.marketState, "Aashir's Earring", 'Trem').quote.median, 200);
  assert.equal(snapshotAge(base, base + 125 * 60000), '2 hr 5 min old');
  assert.equal(snapshotAge(null), 'age unknown'); assert.match(snapshotAge(base, base - 1000), /future/);
});

test('merge ranges bridge quiet gaps while explicit splits take priority without losing or duplicating records', () => {
  const records = events(), edits = { merges: [{ from: records[1].at, to: records[2].at }], splits: [] };
  assert.equal(automaticSessions(records, 'hero').length, 3);
  const merged = automaticSessions(records, 'hero', 30, base, edits); assert.equal(merged.length, 2); assert.equal(merged[0].events, 4);
  edits.splits.push(records[2].at);
  const split = automaticSessions(records, 'hero', 30, base, edits); assert.equal(split.length, 3);
  assert.deepEqual(split.flatMap(s => scopeEvents(records, { session: s })).map(e => e.identity), records.map(e => e.identity));
  const filledGap = [...records, { ...records[1], at: base + 30 * 60000, identity: 'imported-later' }];
  assert.equal(automaticSessions(filledGap, 'hero', 30, base, { ...edits, splits: [] })[0].events, 5);
});

test('split boundaries keep simultaneous records together and select the next real record', () => {
  const records = events([0, 5, 5, 10]);
  assert.equal(splitPoint(records, base + 1), records[1].at);
  assert.equal(splitPoint(records, base), null); assert.equal(splitPoint(records, base + 11 * 60000), null);
  const sessions = automaticSessions(records, 'hero', 30, base, { splits: [records[1].at] });
  assert.deepEqual(sessions.map(s => s.events), [1, 3]);
  assert.deepEqual(scopeEvents(records, { session: sessions[1] }).map(e => e.identity), ['event-1', 'event-2', 'event-3']);
});

test('session corrections survive restart, preserve names and named runs, and remain scoped to one character', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'neverquest-session-edits-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).load(), app = new Companion(store);
  store.data.sources.push({ id: 'one', character: 'Tester', server: 'Trem', directory: '', events: events() },
    { id: 'two', character: 'Other', server: 'Trem', directory: '', events: events() }); app.sourceId = 'one';
  const original = JSON.stringify(app.source.events), [a, b] = app.sessions();
  await app.action('session:rename', { id: a.id, name: 'An evening out' });
  await app.action('session:start', { name: 'Small named run', startedAt: base + 1 }, base + 2);
  await app.action('session:merge', { id: a.id, nextId: b.id });
  assert.equal(app.sessions().filter(s => s.kind === 'automatic').length, 2);
  const reopened = new Companion(await new LocalStore(dir).load()); reopened.sourceId = 'one';
  assert.equal(reopened.sessions()[0].name, 'An evening out'); assert.equal(reopened.scoped({ sessionId: a.id }).events.length, 4);
  assert.equal(reopened.sessions().filter(s => s.kind === 'manual').length, 1);
  await reopened.action('session:split', { id: a.id, at: base + 60 * 60000 });
  assert.equal(reopened.sessions().filter(s => s.kind === 'automatic').length, 3);
  await reopened.action('session:merge', { id: a.id, nextId: b.id });
  assert.equal(reopened.sessions().filter(s => s.kind === 'automatic').length, 2);
  reopened.sourceId = 'two'; assert.equal(reopened.sessions().length, 3);
  await reopened.action('session:reset'); reopened.sourceId = 'one';
  assert.equal(reopened.sessions().filter(s => s.kind === 'automatic').length, 2, 'Reset only affects its selected character');
  await reopened.action('session:reset'); assert.equal(reopened.sessions().filter(s => s.kind === 'automatic').length, 3);
  assert.equal(reopened.sessions()[0].name, 'An evening out'); assert.equal(JSON.stringify(reopened.source.events), original);
  assert.equal(reopened.exportSettings().preferences, undefined, 'Private session edits must not be shared in portable definitions');
});

test('invalid/nonadjacent/manual session edits are refused before changing saved grouping', async () => {
  const app = new Companion(new LocalStore()); app.data.sources.push({ id: 'one', character: 'Tester', server: 'Trem', events: events() }); app.sourceId = 'one';
  const [a, b, c] = app.sessions();
  await assert.rejects(app.action('session:merge', { id: a.id, nextId: c.id }), /adjacent/);
  await assert.rejects(app.action('session:merge', { id: b.id, nextId: a.id }), /adjacent/);
  for (const at of [a.startedAt, a.lastActivityAt + 1, a.startedAt + 1, NaN])
    await assert.rejects(app.action('session:split', { id: a.id, at }), /recorded event/);
  await assert.rejects(app.action('session:split', { id: 'wrong-character', at: b.startedAt }), /recorded event/);
  assert.equal(app.data.preferences.sessionEdits, undefined); assert.equal(app.sessions().length, 3);
  await app.action('session:start', { name: 'Manual run' });
  const manual = app.sessions().find(s => s.kind === 'manual');
  await assert.rejects(app.action('session:merge', { id: manual.id, nextId: b.id }), /adjacent/);
  await assert.rejects(app.action('session:split', { id: manual.id, at: b.startedAt }), /recorded event/);
});
