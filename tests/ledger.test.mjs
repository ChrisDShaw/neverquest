import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { decode, parseMoney, parseLedger, mergeLedgers } from '../src/core/ledger.mjs';
import { LedgerFolder, resolveLedgerFolder, findCharacters } from '../src/core/folder.mjs';
import { demoSnapshot } from '../src/core/demo.mjs';
import { summarize, filterEvents, formatMoney, dayKey } from '../src/renderer/model.mjs';

const b64 = text => Buffer.from(text).toString('base64');
const row = (overrides = {}) => ({ f01: 'act_13', f02: 'ref_700',
  f03: JSON.stringify({ d01: 1, d02: b64('a small cellar rat'), d04: 'Rat Tooth' }),
  f04: '2026-11-01T18:02:03.1234567+00:00', f05: `zone_${b64('nightharborw')}`,
  f07: 'Rowan', f08: 0, f09: 'Rowan', ...overrides });
const file = (...rows) => JSON.stringify({ c01: rows });

test('reads nested detail, offsets and encoded labels without damaging plain names', () => {
  const result = parseLedger(file(row()));
  assert.equal(result.invalidRows, 0);
  assert.equal(result.events[0].item, 'Rat Tooth');
  assert.equal(result.events[0].creature, 'a small cellar rat');
  assert.equal(result.events[0].zone, 'nightharborw');
  assert.equal(result.events[0].at, Date.parse('2026-11-01T18:02:03.123Z'));
  assert.equal(decode('None'), 'None');
  assert.equal(decode('9a818e77c3484fe98efd9081'), '9a818e77c3484fe98efd9081');
  assert.equal(decode(b64('Élan’s sword')), 'Élan’s sword');
});

test('currency uses 100 per denomination and distinguishes unreadable coin from zero', () => {
  assert.equal(parseMoney('1,2,3,4'), 1_020_304);
  assert.equal(parseMoney('0 platinum 1 gold 2 silver 3 copper'), 10_203);
  assert.equal(parseMoney('0,0,0,0'), 0);
  for (const bad of ['', '1,2,3', '-1,0,0,0', 'broken', '2 silver junk', '9007199254740991,0,0,0'])
    assert.equal(parseMoney(bad), null, bad);
  assert.equal(formatMoney(1_020_304), '1 pp 2 gp 3 sp 4 cp');
  assert.equal(formatMoney(null), 'Unknown');
  assert.equal(formatMoney(-5), '−5 cp');
});

test('rejects partial files but reports individual malformed rows', () => {
  assert.throws(() => parseLedger('{"c01":['), SyntaxError);
  assert.throws(() => parseLedger('{}'), SyntaxError);
  const result = parseLedger(file(row(), row({ f04: 'not a date' }), row({ f03: '{bad' }), null,
    row({ f04: '2026-11-01T18:02:03' })));
  assert.equal(result.events.length, 1);
  assert.equal(result.invalidRows, 4);
});

test('normalizes JSON field order and nested formatting for overlap identity', () => {
  const original = row();
  const shuffled = Object.fromEntries(Object.entries(original).reverse());
  shuffled.f03 = JSON.stringify(JSON.parse(original.f03), null, 2);
  assert.equal(parseLedger(file(original)).events[0].identity, parseLedger(file(shuffled)).events[0].identity);
});

test('drops own Social twins and archive overlaps while preserving in-file repeats', () => {
  const own = parseLedger(file(row()));
  const other = row({ f07: 'Mira', f08: 2 });
  const social = parseLedger(file(row({ f08: 2 }), other, other), true);
  const archive = parseLedger(file(other), true);
  const merged = mergeLedgers([own, social, archive]);
  assert.equal(merged.length, 3);
  assert.equal(merged.filter(e => e.actor === 'Rowan').length, 1);
  assert.equal(merged.filter(e => e.actor === 'Mira').length, 2);
});

test('purse total and owner share stay separate, without guessing allocations', () => {
  const event = parseLedger(file(row({ f01: 'act_14', f07: 'Mira', f08: 2,
    f03: JSON.stringify({ d12: b64('0,0,3,30'), d13: b64('a rat'), d14: b64('party_split'), d15: b64('0,0,1,10') }) })), true).events[0];
  assert.equal(event.copper, 330);
  assert.equal(event.ownerShare, 110);
  assert.equal(event.split, true);
  assert.equal(summarize([event]).purses, 330);
});

async function scratch(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neverquest-check-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('folder refresh reads growth, archive overlap and preserves last good data during rewrites', async t => {
  const directory = await scratch(t);
  const current = path.join(directory, 'Rowan_Social_today.json');
  const other = row({ f07: 'Mira', f08: 2 });
  const first = file(other);
  await writeFile(current, first);
  const folder = new LedgerFolder(directory);
  assert.equal((await folder.refresh()).events.length, 1);
  assert.equal(await readFile(current, 'utf8'), first, 'reader never changes the source');
  await writeFile(current, '{"c01":[');
  const partial = await folder.refresh();
  assert.equal(partial.events.length, 1);
  assert.equal(partial.problems.length, 1);
  await writeFile(current, file(other, row({ f07: 'Thorne', f08: 2, f02: 'ref_701' })));
  assert.equal((await folder.refresh()).events.length, 2);
  await mkdir(path.join(directory, 'Archive'));
  await writeFile(path.join(directory, 'Archive', 'ledger_Rowan_Social_archive_1.json'), first);
  assert.equal((await folder.refresh()).events.length, 2);
  const [a, b] = await Promise.all([folder.refresh(), folder.refresh()]);
  assert.equal(a, b, 'overlapping refreshes share one operation');
});

test('rotation retains deleted-file cache until the replacement archive is readable', async t => {
  const directory = await scratch(t);
  const current = path.join(directory, 'Rowan_Character_today.json');
  await writeFile(current, file(row()));
  const folder = new LedgerFolder(directory);
  await folder.refresh();
  await mkdir(path.join(directory, 'Archive'));
  const archived = path.join(directory, 'Archive', 'ledger_Rowan_Character_archive_1.json');
  await writeFile(archived, '{');
  await rm(current);
  const partial = await folder.refresh();
  assert.equal(partial.events.length, 1);
  assert.equal(partial.problems.length, 1);
  await writeFile(archived, file(row()));
  const recovered = await folder.refresh();
  assert.equal(recovered.events.length, 1);
  assert.equal(recovered.files, 1);
  assert.deepEqual(recovered.problems, []);
});

test('folder selection and discovery scope reads to one character, including archived Character data', async t => {
  const root = await scratch(t);
  const character = path.join(root, 'alpha', 'Rowan');
  const ledger = path.join(character, 'Ledger');
  await mkdir(path.join(ledger, 'Archive'), { recursive: true });
  await writeFile(path.join(ledger, 'Archive', 'ledger_Rowan_Character_archive_1.json'), '\uFEFF' + file(row()));
  await writeFile(path.join(ledger, 'unrelated.json'), '{invalid and should not be read');
  assert.equal(await resolveLedgerFolder(character), ledger);
  assert.equal(await resolveLedgerFolder(ledger), ledger);
  await assert.rejects(resolveLedgerFolder(root), /No ledger found/);
  const found = await findCharacters(root);
  assert.equal(found.length, 1);
  assert.equal(found[0].character, 'Rowan');
  const snapshot = await new LedgerFolder(ledger).refresh();
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.files, 1);
  assert.deepEqual(snapshot.problems, []);
});

test('vendor net uses whole-stack totals and item loot counts do not include harvests', () => {
  const base = parseLedger(file(row())).events[0];
  const summary = summarize([base, { ...base, act: 'act_27', quantity: 5 },
    { ...base, act: 'act_24', quantity: 2, copper: 18 },
    { ...base, act: 'act_28', copper: 5 }, { ...base, act: 'act_24', copper: null }]);
  assert.equal(summary.items, 1);
  assert.equal(summary.sales, 18);
  assert.equal(summary.vendorNet, 13);
  assert.equal(summary.unknownVendors, 1);
});

test('demo runs through the real parser, with honest totals and usable filters', () => {
  const demo = demoSnapshot();
  assert.equal(demo.events.length, 15);
  assert.equal(demo.invalidRows, 0);
  const summary = summarize(demo.events);
  assert.equal(summary.items, 6);
  assert.equal(summary.itemKinds, 5);
  assert.equal(summary.purses, 503);
  assert.equal(summary.vendorNet, 13);
  assert.equal(summary.players.length, 3);
  assert.equal(filterEvents(demo.events, { type: 'Party' }).length, 3);
  assert.equal(filterEvents(demo.events, { search: 'mira bone' }).length, 1);
  assert.equal(filterEvents(demo.events, { day: dayKey(demo.events[0].at) }).length,
    demo.events.filter(e => dayKey(e.at) === dayKey(demo.events[0].at)).length);
  assert.equal(filterEvents(demo.events, { search: '<img onerror=evil>' }).length, 0);
});
