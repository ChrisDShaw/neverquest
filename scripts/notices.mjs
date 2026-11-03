import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Collect the original licence texts for every runtime dependency in the lockfile.
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = ['Neverquest runtime dependency notices\n\nElectron and Chromium notices are also included beside the application executable.'];
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location || entry.dev) continue;
  const manifest = JSON.parse(await readFile(path.join(location, 'package.json'), 'utf8'));
  const files = (await readdir(location)).filter(file => /^(?:licen[cs]e|copying|notice)(?:\..*)?$/i.test(file));
  if (!files.length && manifest.name === 'lazy-val' && manifest.version === '1.0.5') {
    notices.push(await readFile('docs/licenses/lazy-val.md', 'utf8')); continue;
  }
  if (!files.length) throw new Error(`Missing licence text for ${manifest.name}. Review the package before distributing it.`);
  notices.push(`\n${manifest.name}@${manifest.version} (${manifest.license ?? entry.license ?? 'see licence'})\n`);
  for (const file of files) notices.push(await readFile(path.join(location, file), 'utf8'));
}
await mkdir('build', { recursive: true });
await writeFile('build/THIRD-PARTY-LICENSES.txt', notices.join('\n\n') + '\n');
