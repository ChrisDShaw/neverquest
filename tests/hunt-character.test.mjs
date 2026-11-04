import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Companion } from '../src/core/companion.mjs';
import { LocalStore } from '../src/core/store.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'neverquest-character-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const now = Date.now(), files = {};
  for (const [character, age] of [['Rowan', 120000], ['Mira', 10000]]) {
    const directory = path.join(root, 'Test realm', character, 'Ledger');
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, `${character}_Character_today.json`);
    await writeFile(file, JSON.stringify({ c01: [{ f01: 'act_13', f04: new Date(now - age).toISOString(),
      f07: character, f09: character, f03: JSON.stringify({ d01: 1, d04: 'Test tooth' }) }] }));
    await utimes(file, new Date(now - age), new Date(now - age));
    files[character] = file;
  }
  const app = new Companion(new LocalStore());
  await app.connect(path.dirname(files.Rowan));
  return { app, files, now };
}

test('newer character activity warns even with automatic switching off and blocks an unconfirmed hunt', async t => {
  const { app } = await fixture(t), sourceId = app.sourceId;
  const activity = app.snapshot().characterActivity;
  assert.equal(activity.state, 'different'); assert.equal(activity.recent.character, 'Mira');
  assert.equal(activity.recent.server, 'Test realm'); assert.equal('directory' in activity.recent, false);
  await assert.rejects(app.action('session:start', { name: 'Wrong ledger' }), /Mira has newer ledger activity/);
  await assert.rejects(app.action('session:start', { name: 'Wrong ledger', acknowledgeCharacterId: 'invented' }), /Mira/);
  assert.equal(app.data.sessions.length, 0); assert.equal(app.sourceId, sourceId);
});

test('deliberate selection permits a historical-character hunt and switching preserves its owner', async t => {
  const { app } = await fixture(t), originalSource = app.sourceId;
  const candidate = app.snapshot().characterActivity.recent.id;
  await app.action('session:start', { name: 'Deliberate Rowan hunt', acknowledgeCharacterId: candidate });
  const hunt = app.data.sessions[0];
  assert.equal(hunt.sourceId, originalSource); assert.equal(hunt.endedAt, null);
  await app.selectRecentCharacter(candidate);
  assert.equal(app.source.character, 'Mira'); assert.notEqual(app.sourceId, originalSource);
  assert.equal(app.snapshot().sessions.filter(s => s.kind !== 'automatic').length, 0);
  assert.equal(hunt.sourceId, originalSource); assert.equal(hunt.endedAt, null);
  assert.equal(app.snapshot().characterActivity.state, 'selected');
  await app.action('session:start', { name: 'Mira hunt' });
  assert.equal(app.data.sessions[1].sourceId, app.sourceId);
});

test('hunt submission rechecks disk when another character becomes newer after opening the form', async t => {
  const { app, files, now } = await fixture(t);
  await utimes(files.Rowan, new Date(now), new Date(now));
  assert.equal((await app.checkCharacterActivity({ force: true })).state, 'selected');
  await utimes(files.Mira, new Date(now + 1000), new Date(now + 1000));
  await assert.rejects(app.action('session:start', { name: 'Race' }), /Mira has newer/);
  assert.equal(app.data.sessions.length, 0);
  await assert.rejects(app.selectRecentCharacter('outdated-candidate'), /most recent character changed/);
  assert.equal(app.source.character, 'Rowan');
});

test('old, tied and implausibly future timestamps do not claim another character is active', async t => {
  const { app, files, now } = await fixture(t);
  for (const [selectedAge, otherAge] of [[30 * 60000, 20 * 60000], [0, 0], [0, -3600000]]) {
    await utimes(files.Rowan, new Date(now - selectedAge), new Date(now - selectedAge));
    await utimes(files.Mira, new Date(now - otherAge), new Date(now - otherAge));
    assert.equal((await app.checkCharacterActivity({ force: true, now })).state, 'selected');
  }
});

test('discovery failure is explicit and a demo never discovers real characters', async t => {
  const { app } = await fixture(t);
  app.discover = async () => { throw new Error('Unavailable'); };
  assert.equal((await app.checkCharacterActivity({ force: true })).state, 'unknown');
  const demo = new Companion(new LocalStore());
  demo.data.sources.push({ id: 'demo', character: 'Rowan', server: 'Demo realm', directory: '', events: [] });
  demo.sourceId = 'demo';
  demo.discover = () => { throw new Error('Demo must not inspect character folders'); };
  await demo.refresh();
  await demo.action('session:start', { name: 'Demo hunt' });
  assert.equal(demo.snapshot().characterActivity, null);
});
