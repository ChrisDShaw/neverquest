import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, utimes } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { LocalStore } from '../src/core/store.mjs';
import { Companion } from '../src/core/companion.mjs';
import { priceBook, valueLoot, scopeEvents, playerBreakdown, goalProgress, creatureRecords, gathering, compareSessions } from '../src/renderer/analysis.mjs';
import { validateBundle } from '../src/core/portable.mjs';
import { latestLedgerWrite } from '../src/core/folder.mjs';
import { parseLedger } from '../src/core/ledger.mjs';
import { atlasUrl } from '../src/renderer/maps.mjs';
import { Requests } from '../src/renderer/requests.mjs';

const event = (identity, act, extras = {}) => ({ identity, act, at: 1000, actor: 'Rowan', owner: 'Rowan', zone: 'testzone', item: 'Test item',
  quantity: 1, creature: 'a test creature', copper: null, ownerShare: null, social: false, split: false, ...extras });
function companion() {
  const app = new Companion(new LocalStore());
  app.data.sources.push({ id: 'a', directory: '', character: 'Rowan', server: 'alpha', events: [] });
  app.sourceId = 'a'; return app;
}

test('sessions preserve event-time boundaries, names and character scope', async () => {
  const app = companion();
  await app.action('session:start', { name: 'First run', startedAt: 500 }, 1000);
  const session = app.snapshot().sessions[0];
  await assert.rejects(app.action('session:start', { name: 'Second run' }, 1100), /End the current/);
  await app.action('session:end', { id: session.id }, 2000);
  await app.action('session:rename', { id: session.id, name: 'The crypt' });
  const saved = app.snapshot().sessions[0];
  assert.equal(saved.name, 'The crypt');
  assert.deepEqual(scopeEvents([event('before', 'act_13', { at: 499 }), event('in', 'act_13'), event('end', 'act_13', { at: 2000 })], { session: saved }).map(e => e.identity), ['in']);
  assert.equal(app.scoped({ sessionId: saved.id }).session.id, saved.id);
  await assert.rejects(app.action('session:end', { id: 'foreign' }), /No active named run/);
});

test('price book learns whole-stack unit prices, includes zero-price sales and isolates servers', () => {
  const sources = [{ server: 'alpha', events: [event('1', 'act_24', { quantity: 2, copper: 18 }),
    event('2', 'act_24', { copper: 11 }), event('3', 'act_24', { copper: null })] },
  { server: 'beta', events: [event('4', 'act_24', { copper: 1000000 })] }];
  const prices = priceBook(sources, 'alpha');
  assert.equal(prices[0].unit, 10); assert.equal(prices[0].low, 9); assert.equal(prices[0].high, 11);
  assert.equal(prices[0].samples, 2);
  assert.deepEqual(valueLoot([event('5', 'act_13', { quantity: 3 }), event('6', 'act_13', { item: 'Unknown item', quantity: 2 })], prices), { value: 30, unpriced: 2 });
  assert.equal(priceBook([{ server: 'a', events: [event('z', 'act_24', { copper: 0 })] }], 'a')[0].unit, 0);
});

test('split amounts are attributed only to the explicitly recorded owner share', () => {
  const players = playerBreakdown([event('1', 'act_14', { actor: 'Mira', social: true, split: true, copper: 330, ownerShare: 110 })], []);
  assert.equal(players.length, 1); assert.equal(players[0].name, 'Rowan');
  assert.equal(players[0].recordedShares, 110); assert.equal(players[0].recordedPurses, 0);
});

test('goals count only own acquisitions since creation and allow corrections and completion', async () => {
  const app = companion();
  await app.action('goal:save', { item: 'Test item', target: 5, adjustment: 2, wishlist: true }, 1000);
  const goal = app.data.goals[0];
  const events = [event('old', 'act_13', { at: 999 }), event('new', 'act_13'),
    event('harvest', 'act_27', { quantity: 2 }), event('other', 'act_13', { social: true, actor: 'Mira' }), event('sale', 'act_24')];
  assert.deepEqual(goalProgress(goal, events), { acquired: 3, current: 5, target: 5, completed: true });
  await app.action('goal:save', { ...goal, adjustment: -1, completed: true });
  assert.equal(goalProgress(app.data.goals[0], []).completed, true);
});

test('local history and notes survive restart; malformed history is not overwritten', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neverquest-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = companion(); app.store = await new LocalStore(directory).load();
  app.data.sources.push({ id: 'a', directory: '', character: 'Rowan', server: 'alpha', events: [event('1', 'act_13')] });
  await app.action('note:save', { kind: 'item', subject: 'Test item', body: 'Keep this.' });
  await app.action('profile:save', { opacity: 85, pinned: true, view: 'Harvest', page: 'goals' });
  app.data.profiles.a.bounds = { x: 12, y: 23, width: 1050, height: 760 };
  await app.action('session:start', { name: 'Saved run' });
  const loaded = await new LocalStore(directory).load();
  assert.equal(loaded.data.notes[0].body, 'Keep this.'); assert.equal(loaded.data.sources[0].events.length, 1);
  assert.equal(loaded.data.sessions[0].name, 'Saved run');
  assert.equal(loaded.data.profiles.a.opacity, 85); assert.equal(loaded.data.profiles.a.view, 'Harvest');
  assert.equal(loaded.data.profiles.a.bounds.width, 1050);
  assert.equal(JSON.parse(await readFile(path.join(directory, 'collection.json.bak'), 'utf8')).notes.length, 1);
  await writeFile(path.join(directory, 'collection.json'), '{broken');
  await assert.rejects(new LocalStore(directory).load(), /left untouched/);
  assert.equal(await readFile(path.join(directory, 'collection.json'), 'utf8'), '{broken');
});

test('reports mark unknown value and never combine purse observations with item estimates', () => {
  const app = companion();
  app.source.events = [event('1', 'act_13'), event('2', 'act_14', { copper: 100 })];
  const report = app.report({});
  assert.match(report, /Coin drops: 1 sp/);
  assert.match(report, /Estimated item vendor value: 0 cp \+ 1 unpriced items/);
  assert.match(report, /Your personal share may differ/);
});

test('creature observations separate zones and new purses, with bounded uncertainty', () => {
  const records = creatureRecords([event('1', 'act_13'), event('2', 'act_14', { at: 2000, copper: 10 }),
    event('3', 'act_14', { at: 3000, copper: 20 }), event('4', 'act_13', { zone: 'otherzone' })]);
  assert.equal(records.length, 2); assert.equal(records[0].visits, 2); assert.equal(records[0].items[0].rate, 0.5);
  assert.ok(records[0].items[0].low >= 0 && records[0].items[0].high <= 1);
});

test('gathering excludes breaks over ten minutes and reports insufficient timing samples', () => {
  const rows = [event('1', 'act_27', { at: 0 }), event('2', 'act_27', { at: 60000 }), event('3', 'act_27', { at: 1200000 })];
  assert.equal(gathering(rows, []).activeMs, 60000); assert.equal(gathering(rows, []).perHour, 180);
  assert.equal(gathering([rows[0]], []).perHour, null);
});

test('timers preserve deadlines across restart, notify once and can be reset and stopped', async () => {
  const app = companion();
  await app.action('timer:save', { name: 'Rest', seconds: 90, soundId: 'bell' }, 0);
  const id = app.data.timers[0].id;
  await app.action('timer:start', { id }, 1000);
  const restartedStore = new LocalStore(); restartedStore.data = structuredClone(app.data);
  const restarted = new Companion(restartedStore); restarted.sourceId = 'a';
  assert.equal(restarted.snapshot().timers[0].expiresAt, 91000);
  await restarted.tick(91000); await restarted.tick(92000);
  assert.equal(restarted.notifications.length, 1); assert.equal(restarted.notifications[0].soundId, 'bell');
  await restarted.action('timer:start', { id }, 93000);
  assert.equal(restarted.data.timers[0].notified, false);
  await restarted.action('timer:stop', { id });
  assert.equal(restarted.data.timers[0].expiresAt, null);
  await assert.rejects(restarted.action('timer:save', { name: 'Invalid', seconds: 0 }), /whole number/);
});

test('alerts respect event type, text, enable state and new-event multiplicity', async () => {
  const app = companion();
  await app.action('alert:save', { name: 'Wanted tooth', type: 'Loot', match: 'tooth', enabled: true, soundId: 'bell' });
  await app.action('alert:save', { name: 'Disabled', type: 'Any', match: '', enabled: false });
  const old = event('old', 'act_13', { item: 'Rat Tooth' }), fresh = event('new', 'act_13', { item: 'Rat Tooth' });
  app.checkAlerts([old], [old, fresh]);
  assert.equal(app.notifications.length, 1); assert.match(app.notifications[0].message, /Wanted tooth/);
  assert.equal(app.notifications[0].soundId, 'bell');
  app.checkAlerts([old, fresh], [old, fresh]); assert.equal(app.notifications.length, 1);
  app.checkAlerts([old, fresh], [old, fresh, fresh]); assert.equal(app.notifications.length, 2);
});

test('goal alerts trigger only when the recorded threshold is crossed', async () => {
  const app = companion();
  await app.action('goal:save', { item: 'Test item', target: 2 }, 0);
  await app.action('alert:save', { name: 'Goal reached', type: 'Goal', match: 'test item', enabled: true });
  app.checkAlerts([event('a', 'act_13')], [event('a', 'act_13'), event('b', 'act_13')]);
  assert.equal(app.notifications.length, 1);
  app.checkAlerts([event('a', 'act_13'), event('b', 'act_13')], [event('a', 'act_13'), event('b', 'act_13'), event('c', 'act_13')]);
  assert.equal(app.notifications.length, 1);
});

test('portable settings strip private state and import goals without inherited progress', async () => {
  const app = companion();
  app.source.directory = 'C:/private/player/game/Ledger';
  await app.action('goal:save', { item: 'Test item', target: 5, adjustment: 4, completed: true });
  await app.action('profile:save', { opacity: 80, pinned: true, page: 'goals', view: 'Loot' });
  app.data.profiles.a.bounds = { x: 13, y: 21, width: 1000, height: 800 };
  await app.action('alert:save', { name: 'Find', type: 'Loot', match: 'test', enabled: true, soundId: 'bell' });
  const bundle = app.exportSettings(), json = JSON.stringify(bundle);
  for (const forbidden of ['C:/private', 'sourceId', 'bounds', 'adjustment', 'completed', 'startedAt', 'soundId'])
    assert.equal(json.includes(forbidden), false, forbidden);
  const imported = companion(); await imported.importSettings(bundle, 5000);
  assert.equal(imported.data.goals[0].startedAt, 5000); assert.equal(imported.data.goals[0].adjustment, 0);
  assert.equal(imported.data.goals[0].completed, false); assert.equal(imported.data.alerts[0].soundId, '');
  assert.equal(imported.data.profiles.a.opacity, 80);
  assert.throws(() => validateBundle({ version: 1, goals: [{ item: 'x', target: -1 }] }), /Invalid goal/);
  assert.throws(() => validateBundle({ version: 1, alerts: [{ name: 'x', type: 'execute' }] }), /Invalid alert/);
  assert.throws(() => validateBundle({ version: 2 }), /unsupported version/);
});

test('knowledge, labels, bookmarks and notebook edits are usable companion records', async () => {
  const app = companion(); app.source.events = [event('1', 'act_13')];
  await app.action('knowledge:save', { item: 'Test item', quests: 'A verified quest', recipes: 'A recipe', source: 'A source' });
  await app.action('knowledge:save', { item: 'test ITEM', quests: 'An updated quest', recipes: '', source: 'A source' });
  assert.equal(app.data.knowledge.filter(k => k.item.toLowerCase() === 'test item').length, 1);
  await app.action('label:save', { item: 'Test item', label: 'save' });
  assert.equal(app.snapshot().labels[0].label, 'save');
  await app.action('bookmark:add', { identity: '1', label: 'First find' });
  assert.equal(app.snapshot().bookmarks[0].zone, 'testzone');
  await app.action('note:save', { kind: 'session', subject: 'First run', body: 'Remember this.' });
  const id = app.data.notes[0].id;
  await app.action('note:save', { id, kind: 'session', subject: 'First run', body: 'Updated memory.' });
  assert.equal(app.snapshot().notes[0].body, 'Updated memory.');
});

test('trade and level-up details parse into separate meaningful fields', () => {
  const rows = [{ f01: 'act_20', f04: '2026-11-01T12:00:00Z', f07: 'Rowan', f09: 'Rowan',
    f03: JSON.stringify({ partner: 'ref_123', currency: Buffer.from('0,0,2,5').toString('base64'),
      items: [{ name: 'A backpack', quantity: 2, publicLinkID: 'id' }] }) },
  { f01: 'act_01', f04: '2026-11-01T12:01:00Z', f03: JSON.stringify({ d21: 9, d22: 8 }) }];
  const parsed = parseLedger(JSON.stringify({ c01: rows })).events;
  assert.equal(parsed[0].partner, 'ref_123'); assert.equal(parsed[0].copper, 205);
  assert.equal(parsed[0].tradeItems[0].quantity, 2); assert.equal(parsed[1].newLevel, 9); assert.equal(parsed[1].oldLevel, 8);
});

test('history imports are additive, do not replay alerts, and following responds only to ledger timestamps', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'neverquest-follow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const a = path.join(root, 'alpha', 'Rowan', 'Ledger'), b = path.join(root, 'alpha', 'Mira', 'Ledger');
  await mkdir(a, { recursive: true }); await mkdir(b, { recursive: true });
  const ledgerRow = (actor, second) => ({ f01: 'act_13', f02: 'ref_' + second, f04: `2026-11-01T12:00:${String(second).padStart(2, '0')}Z`, f07: actor, f09: actor,
    f03: JSON.stringify({ d01: 1, d04: 'Test item' }) });
  const fileA = path.join(a, 'Rowan_Character_today.json'), fileB = path.join(b, 'Mira_Character_today.json');
  await writeFile(fileA, JSON.stringify({ c01: [ledgerRow('Rowan', 1)] }));
  await writeFile(fileB, JSON.stringify({ c01: [ledgerRow('Mira', 1)] }));
  await utimes(fileA, 100, 100); await utimes(fileB, 50, 50);
  const app = new Companion(new LocalStore());
  await app.connect(a, { character: 'Rowan', server: 'alpha' });
  await app.action('alert:save', { name: 'New loot', type: 'Loot', match: '', enabled: true });
  await app.select(app.sourceId); assert.equal(app.notifications.length, 0);
  await writeFile(fileA, JSON.stringify({ c01: [ledgerRow('Rowan', 1), ledgerRow('Rowan', 2)] }));
  await app.refresh(); assert.equal(app.source.events.length, 2); assert.equal(app.notifications.length, 1);
  await writeFile(fileA, JSON.stringify({ c01: [ledgerRow('Rowan', 2)] }));
  await app.refresh(); assert.equal(app.source.events.length, 2, 'History survives source row removal');
  await utimes(fileA, 100, 100);
  app.discover = async () => [{ directory: a, character: 'Rowan', server: 'alpha', lastActive: await latestLedgerWrite(a) },
    { directory: b, character: 'Mira', server: 'alpha', lastActive: await latestLedgerWrite(b) }];
  await app.action('follow:set', { enabled: true }); await app.refresh();
  assert.equal(app.source.character, 'Rowan');
  await utimes(fileB, 200, 200); await app.refresh();
  assert.equal(app.source.character, 'Mira'); assert.equal(app.data.sources.length, 2);
});

test('atlas URLs are a fixed mapping and cannot become arbitrary external destinations', () => {
  assert.equal(atlasUrl('nightharborw'), 'https://www.mnmatlas.com/night-harbor/');
  assert.equal(atlasUrl('not-a-zone'), null); assert.equal(atlasUrl('https://evil.example/'), null);
});

test('adventure comparisons use each run’s scope and disclose incomplete values', () => {
  const rows = [event('1', 'act_13', { at: 1000, quantity: 2 }), event('2', 'act_24', { at: 1200, copper: 20 }),
    event('3', 'act_13', { at: 2100, item: 'Unknown' }), event('4', 'act_27', { at: 2200, quantity: 3 }),
    event('5', 'act_28', { at: 2300, copper: 5 }), event('6', 'act_24', { at: 2400, copper: null })];
  const compared = compareSessions(rows, [{ name: 'First', startedAt: 0, endedAt: 2000 },
    { name: 'Second', startedAt: 2000, endedAt: 3000 }], [{ key: 'test item', unit: 10 }]);
  assert.deepEqual(compared.map(r => [r.name, r.items, r.value, r.unpriced, r.vendorNet, r.gathered, r.unknownVendors]),
    [['First', 2, 20, 0, 20, 0, 0], ['Second', 1, 0, 1, -5, 3, 1]]);
});

test('user actions wait for a slow poll instead of disappearing, and a failed request does not block later work', async () => {
  const requests = new Requests(), order = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const poll = requests.run(async () => { await gate; order.push('poll'); }, { polling: true });
  const user = requests.run(() => { order.push('start adventure'); return 42; });
  assert.equal(await requests.run(() => order.push('redundant poll'), { polling: true }), null);
  release(); await poll; assert.equal(await user, 42);
  assert.deepEqual(order, ['poll', 'start adventure']); assert.equal(requests.busy, false);
  await assert.rejects(requests.run(() => { throw new Error('read failed'); }), /read failed/);
  assert.equal(await requests.run(() => 'recovered'), 'recovered');
});
