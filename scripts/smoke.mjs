import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const packaged = process.argv.includes('--packaged');
const executable = packaged ? fileURLToPath(new URL('../dist/win-unpacked/Neverquest.exe', import.meta.url)) : require('electron');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, packaged ? ['--packaged-smoke-test'] : ['.', '--smoke-test'],
  { cwd: new URL('..', import.meta.url), env, stdio: 'inherit', windowsHide: true });
const timeout = setTimeout(() => { console.error('Electron smoke test timed out.'); child.kill(); process.exitCode = 1; }, 45000);
child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
child.on('exit', code => { clearTimeout(timeout); process.exitCode = code ?? 1; });
