import { readFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const tag = process.env.GITHUB_REF_NAME;
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '') || tag !== `v${version}`) {
  throw new Error('Use a stable vMAJOR.MINOR.PATCH tag matching package.json and the lockfile.');
}
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
if (lock.version !== version || lock.packages[''].version !== version) throw new Error('Package and lockfile versions differ.');
const notes = await readFile(`docs/releases/${version}.md`, 'utf8');
if (!notes.trim()) throw new Error('Release notes must describe this version.');
console.log(`Verified ${tag} and its release notes.`);
