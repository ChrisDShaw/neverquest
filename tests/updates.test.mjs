import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Updates } from '../src/core/updates.mjs';

function fixture(options = {}) {
  const updater = new EventEmitter(), states = [];
  updater.checkForUpdates = async () => ({ isUpdateAvailable: false, updateInfo: { version: '0.3.0' } });
  updater.downloadUpdate = async () => { updater.emit('update-downloaded', { version: '0.4.0' }); };
  updater.quitAndInstall = (...args) => { updater.installArgs = args; };
  const updates = new Updates({ updater, enabled: true, version: '0.3.0', now: () => 1234,
    publish: status => states.push(status), ...options });
  return { updater, updates, states };
}

test('source and smoke builds never check, download, or schedule updates', async () => {
  const { updates, updater } = fixture({ enabled: false });
  updater.checkForUpdates = () => { throw new Error('Must not contact release host'); };
  updates.start();
  assert.equal((await updates.check()).state, 'disabled');
  assert.equal(updates.timer, null);
  await assert.rejects(updates.install(async () => {}), /Download an update/);
});

test('stable checks deduplicate requests and download once without allowing downgrades', async () => {
  const { updater, updates } = fixture();
  let resolve, checks = 0, downloads = 0;
  updater.checkForUpdates = () => { checks++; return new Promise(r => { resolve = r; }); };
  updater.downloadUpdate = async () => { downloads++; updater.emit('update-downloaded', { version: '0.4.0' }); };
  const first = updates.check(), second = updates.check();
  assert.equal(first, second);
  resolve({ isUpdateAvailable: true, updateInfo: { version: '0.4.0' } });
  assert.equal((await first).state, 'ready');
  await updates.check();
  assert.equal(checks, 1); assert.equal(downloads, 1);
  assert.equal(updater.autoDownload, false); assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false); assert.equal(updater.allowDowngrade, false);
  assert.equal(updates.snapshot().checkedAt, 1234);
});

test('failed and missing releases are recoverable and do not expose provider errors or personal paths', async () => {
  const { updater, updates } = fixture();
  updater.checkForUpdates = async () => { throw new Error('Synthetic private provider details'); };
  assert.equal((await updates.check()).state, 'error');
  assert.equal(JSON.stringify(updates.snapshot()).includes('Synthetic'), false);
  assert.equal(updates.snapshot().checkedAt, null);
  updater.checkForUpdates = async () => null;
  assert.equal((await updates.check()).state, 'error');
  updater.checkForUpdates = async () => ({ isUpdateAvailable: false });
  assert.equal((await updates.check()).state, 'current');
});

test('download failure allows a retry without offering a restart for incomplete bytes', async () => {
  const { updater, updates } = fixture();
  updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { version: '0.4.0' } });
  updater.downloadUpdate = async () => { updater.emit('download-progress', { percent: 42.7 }); throw new Error('Truncated'); };
  assert.equal((await updates.check()).state, 'error');
  await assert.rejects(updates.install(async () => {}), /Download an update/);
  updater.downloadUpdate = async () => { updater.emit('update-downloaded', { version: '0.4.0' }); };
  assert.equal((await updates.check()).state, 'ready');
});

test('installer waits for saved data; failed saves leave the current app running and allow retry', async () => {
  const { updater, updates } = fixture();
  updater.emit('update-downloaded', { version: '0.4.0' });
  await assert.rejects(updates.install(async () => { throw new Error('Disk full'); }), /Disk full/);
  assert.equal(updater.installArgs, undefined); assert.equal(updates.snapshot().state, 'ready');
  let finish;
  const installing = updates.install(() => new Promise(resolve => { finish = resolve; }));
  assert.equal(updater.installArgs, undefined);
  await assert.rejects(updates.install(async () => {}), /Download an update/);
  finish(); await installing;
  assert.deepEqual(updater.installArgs, [true, true]);
});

test('normal quit stages silent installation without relaunch and installer launch errors are reported', async () => {
  const { updater, updates } = fixture();
  updater.emit('update-downloaded', { version: '0.4.0' });
  await updates.install(async () => {}, false);
  assert.deepEqual(updater.installArgs, [true, false]);
  updater.emit('update-downloaded', { version: '0.4.0' });
  updater.quitAndInstall = () => updater.emit('error', new Error('Launch failed'));
  await assert.rejects(updates.install(async () => {}), /installer could not start/);
  assert.equal(updates.snapshot().state, 'ready');
});
