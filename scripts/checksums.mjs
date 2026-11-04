import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const installer = `Neverquest-Setup-${version}.exe`;
const expected = [installer, `${installer}.blockmap`, 'latest.yml'];
const files = (await readdir('dist')).filter(file => expected.includes(file)).sort();
if (files.length !== expected.length) throw new Error('Build the current Windows installer and update metadata before generating checksums.');
const lines = [];
for (const file of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(`dist/${file}`)) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${file}`);
}
await writeFile('dist/SHA256SUMS.txt', lines.join('\n') + '\n');
console.log(`Wrote checksums for ${files.length} release files.`);
