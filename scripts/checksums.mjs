import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';

const files = (await readdir('dist')).filter(file => /^Neverquest-Setup-[\d.]+\.exe(?:\.blockmap)?$/.test(file) || file === 'latest.yml').sort();
if (!files.some(file => file.endsWith('.exe'))) throw new Error('Build a Windows installer before generating checksums.');
const lines = [];
for (const file of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(`dist/${file}`)) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${file}`);
}
await writeFile('dist/SHA256SUMS.txt', lines.join('\n') + '\n');
console.log(`Wrote checksums for ${files.length} release files.`);
