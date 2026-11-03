import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { huntSummary, huntMessages, shortMoney, validateMembers, huntMembers } from '../src/renderer/hunts.mjs';
import { Companion } from '../src/core/companion.mjs';
import { LocalStore } from '../src/core/store.mjs';

const members = ['Rowan', 'Mira', 'Thorne', 'Elowen', 'Bram', 'Sable'];
const hunt = { id: 'hunt', sourceId: 'a', name: 'Ruins', members, startedAt: 1000, endedAt: 2000 };
const loot = (actor, quantity = 1, extra = {}) => ({ act: 'act_13', actor, item: 'Test tooth', quantity, at: 1500, ...extra });
const prices = [{ key: 'test tooth', name: 'Test tooth', unit: 100 }];
const events = [loot('Rowan', 5), loot('Mira', 3), loot('Thorne', 2), loot('Elowen'), loot('Bram')];

function assertSettled(summary) {
  const balances = new Map(summary.players.map(p => [p.name, p.value]));
  for (const payment of summary.payments) {
    assert.ok(Number.isSafeInteger(payment.amount) && payment.amount > 0);
    balances.set(payment.from, balances.get(payment.from) - payment.amount);
    balances.set(payment.to, balances.get(payment.to) + payment.amount);
  }
  for (const player of summary.players) assert.equal(balances.get(player.name), player.share);
  assert.equal([...balances.values()].reduce((a, b) => a + b, 0), summary.total);
}

test('six-player hunt includes zero-loot members and produces the agreed item-only chat message', () => {
  const summary = huntSummary(hunt, [...events, loot('Rowan', 1, { act: 'act_14', copper: 600 })], prices, 'Rowan');
  assert.equal(summary.total, 1200); assert.equal(summary.coin, 600); assert.equal(summary.combined, 1800);
  assert.equal(summary.players.length, 6); assert.equal(summary.players.at(-1).value, 0);
  assert.deepEqual(summary.payments, [
    { from: 'Rowan', to: 'Sable', amount: 200 },
    { from: 'Rowan', to: 'Elowen', amount: 100 },
    { from: 'Mira', to: 'Bram', amount: 100 }
  ]);
  assertSettled(summary);
  assert.deepEqual(huntMessages(summary), ['Loot value 12s (2s each) | Rowan 5s, Mira 3s, Thorne 2s, Elowen 1s, Bram 1s, Sable 0 | Pay: Rowan to Sable 2s, Rowan to Elowen 1s, Mira to Bram 1s']);
  assert.ok(huntMessages(summary)[0].length <= 240);
  const withoutCoin = huntSummary(hunt, events, prices, 'Rowan');
  assert.deepEqual(summary.payments, withoutCoin.payments);
  assert.deepEqual(huntMessages(summary), huntMessages(withoutCoin));
});

test('hunt boundaries, member names and action types exclude unrelated activity', () => {
  const summary = huntSummary(hunt, [...events, loot('Nearby player', 100), loot('Rowan', 100, { at: 999 }),
    loot('Mira', 100, { at: 2000 }), loot('Rowan', 100, { act: 'act_27' }), loot('mIrA'),
    loot('Nearby player', 1, { act: 'act_14', copper: 1000 }), loot('Rowan', 1, { act: 'act_14', copper: null })], prices, 'Rowan');
  assert.equal(summary.total, 1300); assert.equal(summary.ignored, 100);
  assert.equal(summary.coin, 0); assert.equal(summary.unknownCoin, 1);
  assertSettled(summary);
});

test('unpriced items block settlement, zero is a price, and explicit exclusions are disclosed', () => {
  const unknown = [...events, loot('Mira', 2, { item: 'Test ring' })];
  const summary = huntSummary(hunt, unknown, prices, 'Rowan');
  assert.equal(summary.unpriced, 2); assert.deepEqual(summary.payments, []);
  assert.throws(() => huntMessages(summary), /unpriced/);
  const priced = huntSummary({ ...hunt, itemValues: { 'test ring': 0 } }, unknown, prices, 'Rowan');
  assert.equal(priced.unpriced, 0); assert.equal(priced.excluded, 0); assertSettled(priced);
  const excluded = huntSummary({ ...hunt, itemValues: { 'test ring': null } }, unknown, prices, 'Rowan');
  assert.equal(excluded.unpriced, 0); assert.equal(excluded.excluded, 2);
  assert.match(huntMessages(excluded)[0], /2 items excluded/); assertSettled(excluded);
});

test('whole-copper rounding conserves value and uses alphabetical remainder allocation', () => {
  for (let value = 0; value < 30; value++) {
    const summary = huntSummary(hunt, [loot('Rowan')], [{ ...prices[0], unit: value }], 'Rowan');
    assertSettled(summary);
    assert.ok(Math.max(...summary.players.map(p => p.share)) - Math.min(...summary.players.map(p => p.share)) <= 1);
  }
  const summary = huntSummary(hunt, [loot('Rowan')], [{ ...prices[0], unit: 1 }], 'Rowan');
  assert.equal(summary.players.find(p => p.name === 'Bram').share, 1);
  assert.match(huntMessages(summary)[0], /1c remainder/);
});

test('long chat reports split without losing a player or payment and include page numbers in the limit', () => {
  const longMembers = Array.from({ length: 24 }, (_, i) => `Player${String(i).padStart(2, '0')}${'x'.repeat(50)}`);
  const summary = huntSummary({ ...hunt, members: longMembers }, [loot(longMembers[0], 24)], prices, longMembers[0]);
  const messages = huntMessages(summary);
  assert.ok(messages.length > 9);
  for (const [i, message] of messages.entries()) {
    assert.ok(message.length <= 240); assert.ok(!/[\r\n]/.test(message));
    assert.ok(message.startsWith(`(${i + 1}/${messages.length}) `));
  }
  for (const player of summary.players) assert.ok(messages.some(message => message.includes(`${player.name} ${shortMoney(player.value)}`)));
  for (const p of summary.payments) assert.ok(messages.some(message => message.includes(`${p.from} to ${p.to} ${shortMoney(p.amount)}`)));
});

test('solo hunts and older named runs retain their scope and do not offer payments', () => {
  const legacy = { ...hunt }; delete legacy.members;
  assert.deepEqual(huntMembers(legacy, 'Rowan'), ['Rowan']);
  const summary = huntSummary(legacy, events, prices, 'Rowan');
  assert.equal(summary.total, 500); assert.equal(summary.players.length, 1);
  assert.deepEqual(summary.payments, []);
  assert.deepEqual(huntMessages(summary), ['Loot value 5s (5s each) | Rowan 5s']);
});

test('member validation preserves the owner, deduplicates case and rejects broken chat names', () => {
  assert.deepEqual(validateMembers(['Mira', 'rowan', 'mira'], 'Rowan'), ['Rowan', 'Mira']);
  assert.deepEqual(validateMembers([], 'Rowan'), ['Rowan']);
  for (const invalid of [null, [''], ['A|B'], ['A,B'], ['A\nB'], ['x'.repeat(61)], Array(25).fill('Mira')])
    assert.throws(() => validateMembers(invalid, 'Rowan'));
  assert.equal(shortMoney(1_020_304), '1p 2g 3s 4c');
  assert.throws(() => shortMoney(-1));
  assert.throws(() => huntSummary(hunt, [loot('Rowan', Number.MAX_SAFE_INTEGER)], prices, 'Rowan'), /too large/);
});

test('hunt setup and prices survive restart; stale copies and foreign-character edits are rejected', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neverquest-hunt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await new LocalStore(directory).load(), app = new Companion(store);
  app.data.sources.push({ id: 'a', character: 'Rowan', server: 'test', events }); app.sourceId = 'a';
  await app.action('session:start', { name: 'Test hunt', startedAt: 1000 }, 1200);
  const id = app.data.sessions[0].id;
  assert.deepEqual(app.hunt(id).members, ['Rowan']);
  const live = huntMessages(huntSummary(app.hunt(id), events, [], 'Rowan'))[0];
  assert.match(live, /Loot so far/); assert.match(live, /unpriced/); assert.doesNotMatch(live, /Pay/);
  assert.equal(app.huntMessage(id, 0, live), live);
  await app.action('hunt:members', { id, members });
  await app.action('hunt:price', { id, item: 'Test tooth', mode: 'custom', unit: 100 });
  await assert.rejects(app.action('hunt:price', { id, item: 'Test tooth', mode: 'custom', unit: -1 }));
  await app.action('session:end', { id }, 2000);
  assert.throws(() => app.huntMessage(id, 0, live), /values changed/);
  const message = huntMessages(huntSummary(app.hunt(id), events, [], 'Rowan'))[0];
  assert.equal(app.huntMessage(id, 0, message), message);
  assert.throws(() => app.huntMessage(id, -1, message), /Choose a hunt message/);
  const loaded = new Companion(await new LocalStore(directory).load()); loaded.sourceId = 'a';
  assert.deepEqual(loaded.hunt(id).members, members);
  assert.equal(loaded.huntMessage(id, 0, message), message);
  await loaded.action('hunt:price', { id, item: 'Test tooth', mode: 'custom', unit: 200 });
  assert.throws(() => loaded.huntMessage(id, 0, message), /values changed/);
  await loaded.action('hunt:price', { id, item: 'Test tooth', mode: 'vendor' });
  assert.throws(() => loaded.huntMessage(id, 0, message), /unpriced/);
  loaded.sourceId = 'another';
  await assert.rejects(loaded.action('hunt:members', { id, members }), /Choose a character/);
  app.data.sources.push({ id: 'b', character: 'Other', server: 'test', events: [] }); app.sourceId = 'b';
  await assert.rejects(app.action('hunt:members', { id, members }), /current character/);
  assert.throws(() => app.huntMessage(id, 0, message), /current character/);
});

test('running copies label provisional payments and omit payments until prices are complete', () => {
  const active = { ...hunt, endedAt: null };
  const known = huntMessages(huntSummary(active, events, prices, 'Rowan'));
  assert.match(known.join(' '), /Loot so far 12s/); assert.match(known.join(' '), /Pay so far:/);
  assert.ok(known.every(message => message.length <= 240));
  const unknown = huntMessages(huntSummary(active, [...events, loot('Sable', 2, { item: 'Test ring' })], prices, 'Rowan'));
  assert.match(unknown.join(' '), /2 unpriced/); assert.match(unknown.join(' '), /split pending prices/);
  assert.doesNotMatch(unknown.join(' '), /Pay/); assert.ok(unknown.every(message => message.length <= 240));
});

test('overlay member actions merge into the current roster and always keep the owner', async () => {
  const app = new Companion(new LocalStore()); app.sourceId = 'a';
  app.data.sources.push({ id: 'a', character: 'Rowan', server: 'test', events });
  await app.action('session:start', { name: 'Live hunt', startedAt: 1000 }, 1200);
  const id = app.data.sessions[0].id;
  await app.action('hunt:add-member', { id, name: 'Mira' });
  await app.action('hunt:add-member', { id, name: 'Thorne' });
  await app.action('hunt:add-member', { id, name: 'mira' });
  assert.deepEqual(new Set(app.hunt(id).members.map(name => name.toLowerCase())), new Set(['rowan', 'mira', 'thorne']));
  await app.action('hunt:remove-member', { id, name: 'MIRA' });
  await app.action('hunt:remove-member', { id, name: 'Rowan' });
  assert.deepEqual(app.hunt(id).members, ['Rowan', 'Thorne']);
});
