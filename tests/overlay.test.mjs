import test from 'node:test';
import assert from 'node:assert/strict';
import { overlayView, overlayRows, overlayScope, overlayContentKey } from '../src/renderer/overlay-model.mjs';
import { configureOverlay, overlaySettings, applyOverlayProfile, revealOverlay } from '../src/core/overlays.mjs';
import { applyMainProfile } from '../src/core/main-window.mjs';
import { LocalStore } from '../src/core/store.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const at = Date.parse('2026-11-01T12:00:00Z');

test('saving overlay backgrounds through 100 percent persists without touching native opacity or pinning', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'neverquest-overlay-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).load(), companion = { data: store.data, store, sourceId: 'hero' };
  const panel = { isDestroyed: () => false, isAlwaysOnTop: () => true,
    setOpacity() { assert.fail('Native opacity must never change for a transparent overlay'); },
    setAlwaysOnTop() { assert.fail('Background changes must not reset an unchanged pin state'); } };
  const panels = new Map([['loot', panel]]);
  for (const background of [0, 15, 60, 95, 100]) {
    const result = await configureOverlay(companion, panels, 'loot', background, true);
    assert.deepEqual(result, { background, pinned: true });
    applyOverlayProfile(panel, result);
  }
  const reopened = await new LocalStore(dir).load();
  assert.deepEqual(overlaySettings({ data: reopened.data, sourceId: 'hero' }, 'loot'), { background: 100, pinned: true });
});

test('overlay native updates only change pinning when requested and tolerate a closed panel', () => {
  let pinned = true, calls = 0;
  const panel = { isDestroyed: () => false, isAlwaysOnTop: () => pinned,
    setOpacity() { assert.fail('Native opacity must remain untouched'); },
    setAlwaysOnTop(value) { calls++; pinned = value; } };
  applyOverlayProfile(panel, { background: 100, pinned: false });
  applyOverlayProfile(panel, { background: 15, pinned: false });
  assert.equal(pinned, false); assert.equal(calls, 1);
  applyOverlayProfile({ isDestroyed: () => true }, { background: 100, pinned: true });
});

test('saving view preferences does not reorder, fade or reposition the main window above overlays', () => {
  const window = { isDestroyed: () => false, isAlwaysOnTop: () => true, getOpacity: () => 1,
    setAlwaysOnTop() { assert.fail('Unchanged pinning must not reorder the main window'); },
    setOpacity() { assert.fail('Unchanged opacity must not touch native composition'); },
    getBounds() { assert.fail('View saves must not restore old bounds'); },
    setBounds() { assert.fail('View saves must not reposition the main window'); } };
  for (const page of ['market', 'goals', 'settings']) applyMainProfile(window, { pinned: true, opacity: 100, page, bounds: { x: 0, y: 0, width: 900, height: 700 } });
});

test('main-window profile restoration applies only changed native preferences and explicit layout changes', () => {
  let pinned = false, opacity = 1, bounds = { x: 0, y: 0, width: 900, height: 700 }; const calls = [];
  const window = { isDestroyed: () => false, isAlwaysOnTop: () => pinned, getOpacity: () => opacity, getBounds: () => bounds,
    setAlwaysOnTop(value) { calls.push('pin'); pinned = value; }, setOpacity(value) { calls.push('opacity'); opacity = value; },
    setBounds(value) { calls.push('bounds'); bounds = value; } };
  const profile = { pinned: true, opacity: 90, bounds: { x: 20, y: 30, width: 1000, height: 800 } };
  applyMainProfile(window, profile, { restoreBounds: true });
  assert.deepEqual(calls, ['pin', 'opacity', 'bounds']);
  applyMainProfile(window, profile, { restoreBounds: true }); assert.equal(calls.length, 3);
});

test('reopening an existing overlay restores, raises and repaints it without changing native opacity', () => {
  const calls = [];
  const panel = { isDestroyed: () => false, isMinimized: () => true,
    restore: () => calls.push('restore'), show: () => calls.push('show'), moveTop: () => calls.push('raise'),
    webContents: { invalidate: () => calls.push('repaint') }, setOpacity() { assert.fail('Never reset native overlay opacity'); } };
  revealOverlay(panel); assert.deepEqual(calls, ['restore', 'show', 'raise', 'repaint']);
  revealOverlay({ isDestroyed: () => true });
});

test('a changed main-window profile keeps pinned overlays above it without restacking on repeated saves', () => {
  const calls = []; let pinned = false;
  const main = { isDestroyed: () => false, isAlwaysOnTop: () => pinned, getOpacity: () => 1,
    setAlwaysOnTop(value) { pinned = value; calls.push('main raised'); } };
  const panel = { isDestroyed: () => false, isAlwaysOnTop: () => true, isVisible: () => true, moveTop: () => calls.push('overlay raised') };
  const apply = () => applyOverlayProfile(panel, { pinned: true }, { raise: applyMainProfile(main, { pinned: true }) });
  apply(); apply(); assert.deepEqual(calls, ['main raised', 'overlay raised']);
  applyOverlayProfile({ ...panel, isVisible: () => false }, { pinned: true }, { raise: true });
  assert.equal(calls.length, 2, 'Hidden overlays must not be shown by a profile update');
});
const snapshot = () => ({ sessions: [], events: Array.from({ length: 100 }, (_, i) => ({ identity: String(i),
  at: at - i * 1000, act: 'act_13', item: 'Rat Tooth', quantity: 1, actor: 'Rowan', social: false })),
  timers: Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: 'Timer ' + i, seconds: 90, expiresAt: i ? at + i * 1000 : null })),
  prices: [{ key: 'rat tooth', unit: 9 }], goals: [{ item: 'Rat Tooth', progress: { completed: false } }] });

test('overlay content keys ignore polling and unrelated preferences while reflecting displayed changes', () => {
  const data = snapshot(), key = kind => overlayContentKey(data, kind, overlayView(data, kind, 280));
  const before = ['loot', 'session', 'timers'].map(key);
  data.dataRevision = 100; data.preferences = { page: 'settings' }; data.checkedAt = Date.now();
  assert.deepEqual(['loot', 'session', 'timers'].map(key), before);
  data.events[0] = { ...data.events[0], quantity: 2 };
  assert.notEqual(key('loot'), before[0]); assert.notEqual(key('session'), before[1]); assert.equal(key('timers'), before[2]);
  data.timers[1].name = 'Changed countdown'; assert.notEqual(key('timers'), before[2]);
});

test('compact overlays bound visible rows to their height while keeping full totals', () => {
  const data = snapshot(), small = overlayView(data, 'loot', 110), large = overlayView(data, 'loot', 280);
  assert.equal(small.loot.length, 1); assert.equal(small.lootCount, 100); assert.equal(small.value.value, 900);
  assert.equal(large.loot.length, 5); assert.equal(large.wanted.has('rat tooth'), true);
  assert.ok(overlayRows(5000, 39) <= 12);
  const timers = overlayView(data, 'timers', 240);
  assert.equal(timers.timers.length, 3); assert.equal(timers.timerCount, 20);
  assert.equal(timers.timers[0].id, '1', 'Running timers are shown before stopped timers');
});

test('loot overlays keep following recent loot after a named adventure ends', () => {
  const data = snapshot();
  data.sessions.push({ name: 'Yesterday', startedAt: at - 86400000, endedAt: at - 86000000 });
  assert.equal(overlayScope(data, 'loot').events.length, 100);
  assert.equal(overlayScope(data, 'session').events.length, 0);
  assert.equal(overlayScope(data, 'session').caption, 'Finished · Yesterday');
  data.sessions.push({ name: 'Current run', startedAt: at - 10000, endedAt: null });
  assert.equal(overlayScope(data, 'loot').events.length, 11);
  assert.equal(overlayScope(data, 'session').caption, 'Current run');
});
