import { readdir, readFile, lstat, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootFiles = new Set(['.gitignore', '.gitattributes', '.editorconfig', '.env.example', 'license', 'readme.md', 'security.md',
  'contributing.md', 'third_party.md', 'release.md', 'package.json', 'package-lock.json']);
const localDirectories = new Set(['.git', '.local', 'node_modules', 'coverage', 'dist', 'out', 'release', '.codex', '.agents', '.aws']);
const privateDirectories = new Set([...localDirectories, 'ledger', 'archive', 'journal']);
const dataFile = /^(?:collection\.json(?:\..*)?|preferences\.json|market\.json|catalogue\.json|integrity\.json|network\.json|pins\.json|chats\.json|windows\.json|controls\.json|.*_(?:character|social)_.*\.json)$/i;
const privateExtension = /\.(?:log|db(?:-.*)?|sqlite(?:3|-.*)?|pem|key|pfx|p12)$/i;

export function inspectPublicFile(filename, text = '') {
  const normalized = filename.replaceAll('\\', '/'), lower = normalized.toLowerCase(), parts = lower.split('/');
  const reasons = [];
  if (path.isAbsolute(filename) || parts.includes('..') || parts.slice(0, -1).some(p => privateDirectories.has(p))
      || dataFile.test(parts.at(-1)) || privateExtension.test(lower) || /^\.env(?:\.|$)/.test(parts.at(-1)) && parts.at(-1) !== '.env.example')
    reasons.push('Private, generated or game-data path');
  const allowed = rootFiles.has(lower) || ['docs/images/neverquest.gif', 'docs/images/overlays.png'].includes(lower)
    || /^(?:src|scripts|tests)\/[a-z0-9_./-]+\.(?:mjs|cjs|html|css)$/.test(lower)
    || /^docs\/[a-z0-9_./-]+\.md$/.test(lower) || /^\.github\/(?:workflows\/[a-z0-9_-]+\.ya?ml|[a-z0-9_./-]+\.md)$/.test(lower);
  if (!allowed) reasons.push('File is outside the public source allowlist');
  if (/[a-z]:[\\/]+Users[\\/]+[^\\/\s'"<>]+|\/(?:Users|home)\/[^/\s'"<>]+/i.test(text)) reasons.push('Personal absolute path');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{24,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b|\bAKIA[A-Z0-9]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b/.test(text))
    reasons.push('Possible credential or private key');
  return reasons;
}

export async function publicCandidates(root) {
  const git = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true });
  let hasGitMetadata = false;
  try { await lstat(path.join(root, '.git')); hasGitMetadata = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (hasGitMetadata && git.status !== 0) throw new Error('Git metadata exists but the Git index could not be inspected.');
  // Git may expand Windows short paths or resolve directory junctions. Compare
  // filesystem locations so those aliases still receive staged-content checks.
  const isRepositoryRoot = git.status === 0
    && path.relative(await realpath(root), await realpath(git.stdout.trim())) === '';
  if (hasGitMetadata && !isRepositoryRoot) throw new Error('Git metadata exists but the repository root could not be verified.');
  if (isRepositoryRoot) {
    const listed = spawnSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 10_000_000 });
    if (listed.status !== 0) throw new Error('Cannot enumerate public Git files.');
    const indexed = spawnSync('git', ['-C', root, 'ls-files', '--cached', '-z'], { encoding: 'utf8', windowsHide: true, maxBuffer: 10_000_000 });
    if (indexed.status !== 0) throw new Error('Cannot enumerate staged Git files.');
    // Includes tracked files even when .gitignore would normally exclude them.
    return { files: [...new Set(listed.stdout.split('\0').filter(Boolean))], tracked: new Set(indexed.stdout.split('\0').filter(Boolean)), mode: 'Git index and unignored files' };
  }
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && localDirectories.has(entry.name.toLowerCase())) continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename); else files.push(path.relative(root, filename));
    }
  }
  await walk(root); return { files, mode: 'Source tree (Git not initialized)' };
}

export async function checkPublicFiles(root) {
  const { files, mode, tracked = new Set() } = await publicCandidates(root), findings = [];
  for (const file of files) {
    const reasons = inspectPublicFile(file), filename = path.resolve(root, file), relative = path.relative(root, filename);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) { findings.push({ file, reasons: ['Path escapes repository'] }); continue; }
    try {
      const info = await lstat(filename);
      if (info.isSymbolicLink()) reasons.push('Symbolic links are not permitted in the public source set');
      else if (!info.isFile() || info.size > 2_000_000) reasons.push('Unexpected or oversized source file');
      else reasons.push(...inspectPublicFile(file, await readFile(filename, 'utf8')).filter(reason => !reasons.includes(reason)));
    } catch (error) { if (error.code !== 'ENOENT') reasons.push('File could not be inspected'); }
    if (tracked.has(file)) {
      const staged = spawnSync('git', ['-C', root, 'show', ':' + file], { encoding: 'utf8', windowsHide: true, maxBuffer: 2_000_001 });
      if (staged.status !== 0) reasons.push('Staged file could not be inspected or exceeds the size limit');
      else for (const reason of inspectPublicFile(file, staged.stdout)) if (!reasons.includes(reason)) reasons.push('Staged: ' + reason);
    }
    if (reasons.length) findings.push({ file, reasons });
  }
  return { mode, files: files.length, findings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkPublicFiles(fileURLToPath(new URL('..', import.meta.url)));
    if (result.findings.length) { console.error(JSON.stringify(result.findings, null, 2)); process.exitCode = 1; }
    else console.log(`Public-file check passed: ${result.files} files (${result.mode}).`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
