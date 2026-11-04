import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Companion } from '../src/core/companion.mjs';
import { LocalStore } from '../src/core/store.mjs';
import { valueLoot } from '../src/renderer/analysis.mjs';
import { huntSummary } from '../src/renderer/hunts.mjs';

const at = Date.parse('2026-11-01T12:00:00Z');
const row = (actor, act, item, quantity, copper, second = 0) => ({
  f01: act, f04: new Date(at + second * 1000).toISOString(), f07: actor, f09: actor,
  f03: JSON.stringify({ d01: quantity, d03: copper === null ? '' : `0,0,0,${copper}`, d04: item })
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'neverquest-prices-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ledger = async (server, character, rows, suffix = 'Character_today', archive = false) => {
    const directory = path.join(root, 'game', server, character, 'Ledger');
    const folder = archive ? path.join(directory, 'Archive') : directory;
    await mkdir(folder, { recursive: true });
    const filename = path.join(folder, `${character}_${suffix}.json`);
    await writeFile(filename, JSON.stringify({ c01: rows }));
    await utimes(filename, 100, 100);
    return { directory, filename };
  };
  const store = await new LocalStore(path.join(root, 'saved')).load();
  return { root, ledger, store, app: new Companion(store) };
}

test('connecting one character learns all local characters quietly, with shared same-server prices in hunts and reports', async t => {
  const { ledger, store, app } = await fixture(t);
  const selected = await ledger('alpha', 'Rowan', [
    row('Rowan', 'act_13', 'Test ore', 3, null), row('Rowan', 'act_13', 'Zero-value item', 1, null, 1),
    row('Rowan', 'act_13', 'Foreign-only item', 1, null, 2)
  ]);
  const sales = [row('Mira', 'act_24', 'Test ore', 2, 12), row('Mira', 'act_24', 'Test ore', 1, 2, 1),
    row('Mira', 'act_24', 'Zero-value item', 1, 0, 2), row('Mira', 'act_13', 'Other loot', 99, null, 3)];
  const other = await ledger('alpha', 'Mira', sales);
  await ledger('alpha', 'Mira', sales, 'Character_archive', true);
  await ledger('alpha', 'Mira', sales, 'Social_today');
  await ledger('beta', 'Tarin', [row('Tarin', 'act_24', 'Test ore', 1, 900),
    row('Tarin', 'act_24', 'Foreign-only item', 1, 800, 1)]);
  const before = await readFile(other.filename, 'utf8');
  await app.connect(selected.directory);
  const sourceId = app.sourceId, snapshot = app.snapshot();
  assert.equal(snapshot.character, 'Rowan');
  assert.equal(app.data.preferences.sourceId, sourceId);
  assert.equal(snapshot.events.length, 3, 'Other characters do not contribute loot to the selected character');
  assert.equal(snapshot.sources.length, 3);
  const ore = snapshot.prices.find(p => p.name === 'Test ore');
  assert.equal(ore.unit, 4); assert.equal(ore.samples, 2, 'Archive and Social copies do not inflate the median');
  assert.equal(snapshot.prices.find(p => p.name === 'Zero-value item').unit, 0);
  assert.equal(snapshot.prices.some(p => p.name === 'Foreign-only item'), false);
  assert.deepEqual(valueLoot(snapshot.events, snapshot.prices), { value: 12, unpriced: 1 });
  await app.action('session:start', { name: 'Shared estimates', startedAt: at - 1 }, at + 5000);
  const hunt = app.data.sessions[0];
  assert.equal(hunt.sourceId, sourceId);
  assert.equal(huntSummary(hunt, snapshot.events, snapshot.prices, 'Rowan').total, 12);
  assert.match(app.report({}), /Estimated item vendor value: 12 cp \+ 1 unpriced items/);
  assert.equal(app.notifications.length, 0);
  assert.equal(await readFile(other.filename, 'utf8'), before, 'Game files stay read-only');
  const restarted = new Companion(await new LocalStore(store.directory).load());
  restarted.sourceId = sourceId;
  assert.equal(restarted.snapshot().prices.find(p => p.name === 'Test ore').unit, 4);
  await restarted.select(snapshot.sources.find(s => s.character === 'Mira').id);
  assert.equal(restarted.source.character, 'Mira');
  assert.equal(restarted.data.sources.length, 3, 'Selecting an automatically imported character reuses its saved history');
});

test('background imports discover new characters, refresh changed sales and preserve prices through rotation and incomplete writes', async t => {
  const { ledger, app } = await fixture(t);
  const selected = await ledger('alpha', 'Rowan', [row('Rowan', 'act_13', 'Test ore', 1, null)]);
  await app.connect(selected.directory);
  const sourceId = app.sourceId;
  await app.action('alert:save', { name: 'Activity', type: 'Any', match: '', enabled: true });
  const sale = row('Mira', 'act_24', 'Test ore', 1, 6);
  const other = await ledger('alpha', 'Mira', [sale]);
  let now = Date.now() + 11000;
  await app.refreshOtherCharacters(now);
  assert.equal(app.snapshot().prices[0].unit, 6);
  await ledger('alpha', 'Mira', [sale, row('Mira', 'act_24', 'Test ore', 1, 10, 1)]);
  await app.refreshOtherCharacters(now += 11000);
  assert.equal(app.snapshot().prices[0].unit, 8);
  assert.equal(app.snapshot().prices[0].samples, 2);
  await writeFile(other.filename, '{');
  await app.refreshOtherCharacters(now += 11000);
  assert.equal(app.snapshot().prices[0].unit, 8);
  assert.ok(app.snapshot().problems.some(p => p.includes('Mira') && p.includes('invalid JSON')));
  await ledger('alpha', 'Mira', []);
  await app.refreshOtherCharacters(now += 11000);
  assert.equal(app.snapshot().prices[0].samples, 2, 'Imported sales survive removal from the game ledger');
  assert.equal(app.snapshot().problems.length, 0);
  assert.equal(app.sourceId, sourceId);
  assert.equal(app.notifications.length, 0);
});
