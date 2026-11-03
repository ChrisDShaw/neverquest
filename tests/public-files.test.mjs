import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { inspectPublicFile, checkPublicFiles } from '../scripts/check-public-files.mjs';

async function scratch(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'neverquest-public-'));
  t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}

test('public source guard rejects saved data, game files, credentials and unexpected assets', () => {
  for (const file of ['.local/smoke/collection.json', 'collection.json.bak', 'src/market.json', 'Ledger/sample.json',
    'Archive/sample.json', 'journal/npc.txt', 'Sample_Character_day.json', 'Sample_Social_day.json', 'Player.log',
    'chats.json', '.env', 'private.pem', 'save.sqlite3', '.codex/settings.json', 'maps/community.png', 'tests/export.json'])
    assert.ok(inspectPublicFile(file).length, file);
  assert.deepEqual(inspectPublicFile('src/core/ledger.mjs', 'export const example = 1;'), []);
  assert.deepEqual(inspectPublicFile('.github/workflows/checks.yml', 'name: Checks'), []);
  assert.deepEqual(inspectPublicFile('docs/images/neverquest.gif'), []);
  assert.deepEqual(inspectPublicFile('docs/images/overlays.png'), []);
  assert.ok(inspectPublicFile('docs/images/private-screenshot.png').length);
});

test('public source guard detects identifying absolute paths and strong credential patterns without needing a personal denylist', () => {
  const home = ['C:', 'Users', 'Synthetic', 'game'].join('\\');
  const token = 'ghp_' + 'a'.repeat(32);
  assert.ok(inspectPublicFile('src/example.mjs', home).includes('Personal absolute path'));
  assert.ok(inspectPublicFile('src/example.mjs', token).includes('Possible credential or private key'));
  assert.deepEqual(inspectPublicFile('README.md', '%APPDATA%\\Neverquest\\collection.json'), []);
});

test('public source guard excludes local caches before Git initialization and rejects unexpected public files', async t => {
  const dir = await scratch(t); await mkdir(path.join(dir, '.local')); await mkdir(path.join(dir, 'src'));
  await writeFile(path.join(dir, 'README.md'), 'Invented documentation');
  await writeFile(path.join(dir, 'src', 'example.mjs'), 'export const invented = true;');
  await writeFile(path.join(dir, '.local', 'collection.json'), '{}');
  const clean = await checkPublicFiles(dir); assert.equal(clean.files, 2); assert.deepEqual(clean.findings, []);
  await writeFile(path.join(dir, 'collection.json'), '{}');
  assert.ok((await checkPublicFiles(dir)).findings.some(f => f.file === 'collection.json'));
});

test('public source guard catches a force-tracked private file even when the ignore rule exists', async t => {
  const installed = spawnSync('git', ['--version'], { windowsHide: true });
  if (installed.error?.code === 'ENOENT') { t.skip('Git is not installed'); return; }
  const dir = await scratch(t);
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr || r.error?.message); };
  git('init', '--quiet');
  await writeFile(path.join(dir, '.gitignore'), '.local/\n'); await writeFile(path.join(dir, 'README.md'), 'Invented example');
  await mkdir(path.join(dir, '.local')); await writeFile(path.join(dir, '.local', 'collection.json'), '{}');
  git('add', '.gitignore', 'README.md'); git('add', '--force', '.local/collection.json');
  const result = await checkPublicFiles(dir);
  assert.equal(result.mode, 'Git index and unignored files');
  assert.ok(result.findings.some(f => f.file.replaceAll('\\', '/') === '.local/collection.json'));
});

test('public source guard catches staged sensitive content even after the working copy is cleaned', async t => {
  const installed = spawnSync('git', ['--version'], { windowsHide: true });
  if (installed.error?.code === 'ENOENT') { t.skip('Git is not installed'); return; }
  const dir = await scratch(t);
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr || r.error?.message); };
  git('init', '--quiet');
  await writeFile(path.join(dir, 'README.md'), 'ghp_' + 'a'.repeat(32)); git('add', 'README.md');
  await writeFile(path.join(dir, 'README.md'), 'Invented clean documentation');
  const result = await checkPublicFiles(dir);
  assert.ok(result.findings.some(f => f.file === 'README.md' && f.reasons.includes('Staged: Possible credential or private key')));
});

test('public source guard checks staged secrets and force-tracked private files through a directory alias', async t => {
  const installed = spawnSync('git', ['--version'], { windowsHide: true });
  if (installed.error?.code === 'ENOENT') { t.skip('Git is not installed'); return; }
  const dir = await scratch(t), repo = path.join(dir, 'repository'), alias = path.join(dir, 'alias');
  await mkdir(repo);
  const git = (...args) => { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr || r.error?.message); };
  git('init', '--quiet');
  await writeFile(path.join(repo, '.gitignore'), '.local/\n');
  await writeFile(path.join(repo, 'README.md'), 'ghp_' + 'a'.repeat(32));
  await mkdir(path.join(repo, '.local')); await writeFile(path.join(repo, '.local', 'collection.json'), '{}');
  git('add', '.gitignore', 'README.md'); git('add', '--force', '.local/collection.json');
  await writeFile(path.join(repo, 'README.md'), 'Invented clean documentation');
  await symlink(repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await checkPublicFiles(alias);
  assert.equal(result.mode, 'Git index and unignored files');
  assert.ok(result.findings.some(f => f.file.replaceAll('\\', '/') === '.local/collection.json'));
  assert.ok(result.findings.some(f => f.file === 'README.md' && f.reasons.includes('Staged: Possible credential or private key')));
});

test('public source guard fails closed when Git metadata exists but the index cannot be inspected', async t => {
  const dir = await scratch(t); await writeFile(path.join(dir, '.git'), 'Invalid Git metadata');
  await assert.rejects(checkPublicFiles(dir), /Git index could not be inspected/);
});
