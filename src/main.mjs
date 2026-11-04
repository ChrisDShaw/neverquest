import { app, BrowserWindow, dialog, ipcMain, protocol, session, clipboard, shell } from 'electron';
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import os from 'node:os';
import { Updates } from './core/updates.mjs';
import { findCharacters, defaultRoot } from './core/folder.mjs';
import { demoSnapshot } from './core/demo.mjs';
import { LocalStore } from './core/store.mjs';
import { Companion } from './core/companion.mjs';
import { validateBundle } from './core/portable.mjs';
import { atlasUrl } from './renderer/maps.mjs';
import { MarketClient } from './core/market.mjs';
import { MapCache, mapZoneKey } from './core/map-cache.mjs';
import { ZoneLog } from './core/zone-log.mjs';
import { UI_CSP, inertHeaders, rendererRequestAllowed, mapImageResponse } from './core/protocol-security.mjs';
import { overlaySettings as settingsForOverlay, applyOverlayProfile, configureOverlay, revealOverlay } from './core/overlays.mjs';
import { applyMainProfile } from './core/main-window.mjs';
import { itemWikiUrl } from './core/wiki.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const packagedSmoke = process.argv.includes('--packaged-smoke-test');
const smokeTest = packagedSmoke || process.argv.includes('--smoke-test');
if (smokeTest) {
  const directory = path.join(os.tmpdir(), 'neverquest-smoke', randomUUID());
  mkdirSync(directory, { recursive: true }); app.setPath('userData', directory);
}
const origin = 'app://neverquest';
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.enableSandbox();
app.setName('Neverquest');
app.setAppUserModelId('com.chrisdshaw.neverquest');
const release = createRequire(import.meta.url)('../package.json').neverquestRelease ?? { signed: false };
let updates, stopping = false, allowQuit = false;
const pendingBounds = new Map();
let window;
let revision = 0;
let offeredSources = [];
let real, demo, active;
let queue = Promise.resolve();
const ownWindows = new Set(), panels = new Map();
let pendingImport;
let market, mapCache, zoneLog, zoneRoot, currentMapZone;

function snapshot() { return { ...active.snapshot(), demo: active === demo, dataRevision: active.data.revision, revision,
  audioTarget: window ? 'main' : panels.keys().next().value,
  mapZone: active === demo ? { zone: active.source?.events.find(e => e.zone)?.zone ?? '', source: 'Ledger' }
    : currentMapZone ?? { zone: active.source?.events.find(e => e.zone)?.zone ?? '', source: 'Ledger' },
  overlaySettings: Object.fromEntries(['loot', 'hunt', 'session', 'timers', 'map'].map(kind => [kind, overlaySettings(kind)])),
  savedSources: real.data.sources.map(({ events, ...s }) => ({ ...s, count: events.length })) }; }

function overlaySettings(kind) {
  return settingsForOverlay(active, kind);
}

async function refresh() {
  const before = active.sourceId;
  await active.refresh();
  if (active.sourceId !== before) { revision++; applyProfile(); }
  if (active !== demo && !smokeTest && panels.has('map')) {
    const dir = active.source?.directory;
    const candidate = dir && path.basename(dir).toLowerCase() === 'ledger' ? path.dirname(path.dirname(path.dirname(dir))) : '';
    const root = path.basename(candidate).toLowerCase() === 'monsters and memories' ? candidate : defaultRoot();
    if (root !== zoneRoot) { zoneRoot = root; zoneLog = new ZoneLog(root); }
    const detected = await zoneLog.refresh();
    currentMapZone = detected.zone ? detected : { zone: active.source?.events.find(e => e.zone)?.zone ?? '', source: 'Ledger', error: detected.error };
  }
  return snapshot();
}

async function connect(directory, source = {}) {
  await real.connect(directory, source);
  active = real;
  revision++;
  applyProfile();
  return snapshot();
}

function applyProfile({ restoreBounds = true } = {}) {
  const profile = active.data.profiles[active.sourceId] ?? {};
  const changed = applyMainProfile(window, profile, { restoreBounds });
  for (const [kind, panel] of panels) applyOverlayProfile(panel, overlaySettings(kind), { raise: changed });
}

function handle(name, action, serialized = true) {
  ipcMain.handle(name, async (event, ...args) => {
    const sender = [...ownWindows].find(w => w.webContents === event.sender);
    if (!sender || event.senderFrame !== sender.webContents.mainFrame) throw new Error('Untrusted request');
    const url = new URL(event.senderFrame.url);
    if (`${url.protocol}//${url.host}` !== origin || !['/index.html', '/overlay.html'].includes(url.pathname)) throw new Error('Untrusted request');
    if (url.pathname === '/overlay.html' && panels.get(url.searchParams.get('panel')) !== sender) throw new Error('Untrusted overlay');
    if (stopping) return { ok: false, error: 'Neverquest is closing. Please wait for it to finish saving.' };
    const run = async () => {
      try { return { ok: true, value: await action(...args) }; }
      catch (error) { return { ok: false, error: error.message }; }
    };
    if (!serialized) return run();
    const operation = queue.catch(() => {}).then(run);
    queue = operation;
    return operation;
  });
}

function secureWindow(target) {
  ownWindows.add(target);
  target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  target.webContents.on('will-navigate', event => event.preventDefault());
  target.webContents.on('will-frame-navigate', event => event.preventDefault());
  target.webContents.on('will-redirect', event => event.preventDefault());
  target.webContents.on('will-attach-webview', event => event.preventDefault());
  target.on('closed', () => ownWindows.delete(target));
}

function createWindow() {
  window = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 660, backgroundColor: '#101a1c', show: !smokeTest,
    title: 'Neverquest · Monsters & Memories', autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required' }
  });
  secureWindow(window);
  let boundsTimer;
  const flushBounds = () => {
    clearTimeout(boundsTimer); pendingBounds.delete(window);
    if (!window || !active?.sourceId || window.isMinimized()) return;
    const bounds = window.getBounds(), companion = active, id = active.sourceId;
    queue = queue.catch(() => {}).then(async () => {
      companion.data.profiles[id] = { ...companion.data.profiles[id], bounds };
      await companion.store.save();
    });
    queue.catch(error => console.error('Could not save window layout:', error));
  };
  const saveBounds = () => {
    if (stopping) return;
    clearTimeout(boundsTimer);
    pendingBounds.set(window, flushBounds);
    boundsTimer = setTimeout(flushBounds, 500);
  };
  window.on('resize', saveBounds); window.on('move', saveBounds);
  window.on('close', flushBounds);
  window.on('closed', () => { window = undefined; });
  const loaded = window.loadURL(`${origin}/index.html`);
  applyProfile();
  return loaded;
}

// Electron waits for native ESM entry evaluation before emitting ready. Do not
// await whenReady at the top level: that makes the two wait on each other.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => { if (window) { window.show(); window.focus(); } else createWindow(); });
app.whenReady().then(async () => {
const enabled = app.isPackaged && process.platform === 'win32' && !smokeTest;
const updater = app.isPackaged && process.platform === 'win32' ? (await import('electron-updater')).default.autoUpdater : null;
updates = new Updates({ updater, enabled, version: app.getVersion(), signed: release.signed === true,
  publish: status => { for (const target of ownWindows) if (!target.isDestroyed()) target.webContents.send('updates:status', status); } });
real = new Companion(await new LocalStore(app.getPath('userData')).load());
demo = new Companion(new LocalStore());
demo.data.sources.push({ id: 'demo', character: 'Rowan', server: 'Demo realm', directory: '', events: demoSnapshot().events });
demo.sourceId = 'demo';
demo.live = { files: 2, invalidRows: 0, problems: [] };
active = demo;
market = await new MarketClient(app.getPath('userData')).load();
mapCache = await new MapCache(path.join(app.getPath('userData'), 'maps')).load();
if (packagedSmoke) {
  const refuse = async () => { throw new Error('Packaged smoke checks must stay offline.'); };
  market.fetcher = refuse; mapCache.fetcher = refuse;
} else if (smokeTest) { const { prepareSources } = await import('./smoke-fixtures.mjs'); await prepareSources(market, mapCache); }
// Serve only this explicit list of local UI files. No arbitrary filesystem paths cross the bridge.
const assets = new Map([
  ['/index.html', ['index.html', 'text/html']], ['/style.css', ['style.css', 'text/css']],
  ['/app.mjs', ['app.mjs', 'text/javascript']], ['/model.mjs', ['model.mjs', 'text/javascript']],
  ['/analysis.mjs', ['analysis.mjs', 'text/javascript']], ['/workbench.mjs', ['workbench.mjs', 'text/javascript']],
  ['/flows.mjs', ['flows.mjs', 'text/javascript']],
  ['/hunts.mjs', ['hunts.mjs', 'text/javascript']],
  ['/requests.mjs', ['requests.mjs', 'text/javascript']],
  ['/updates.mjs', ['updates.mjs', 'text/javascript']],
  ['/overlay.html', ['overlay.html', 'text/html']], ['/overlay.css', ['overlay.css', 'text/css']],
  ['/overlay.mjs', ['overlay.mjs', 'text/javascript']], ['/overlay-model.mjs', ['overlay-model.mjs', 'text/javascript']],
  ['/sessions.mjs', ['sessions.mjs', 'text/javascript']], ['/market-view.mjs', ['market-view.mjs', 'text/javascript']],
  ['/map-view.mjs', ['map-view.mjs', 'text/javascript']],
  ['/map-loader.mjs', ['map-loader.mjs', 'text/javascript']],
  ['/market-data.mjs', ['market-data.mjs', 'text/javascript']],
  ['/maps.mjs', ['maps.mjs', 'text/javascript']]
]);
protocol.handle('app', async request => {
  const url = new URL(request.url);
  if (url.host === 'maps') return mapImageResponse(request, mapCache);
  if (url.host === 'neverquest' && url.pathname.startsWith('/sounds/')) {
    const id = url.pathname.slice('/sounds/'.length);
    if (id === 'bell') return new Response(bell(), { headers: { 'Content-Type': 'audio/wav' } });
    const sound = [...real.data.sounds, ...demo.data.sounds].find(s => s.id === id);
    if (!sound) return new Response('Not found', { status: 404 });
    const bytes = await readFile(path.join(app.getPath('userData'), 'sounds', path.basename(sound.filename)));
    return new Response(bytes, { headers: { 'Content-Type': sound.mime } });
  }
  const asset = url.host === 'neverquest' ? assets.get(url.pathname) : null;
  if (!asset) return new Response('Not found', { status: 404, headers: inertHeaders });
  return new Response(await readFile(path.join(here, 'renderer', asset[0])), {
    headers: { 'Content-Type': `${asset[1]}; charset=utf-8`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': UI_CSP }
  });
});
session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
session.defaultSession.setPermissionCheckHandler(() => false);
session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !rendererRequestAllowed(details) }));
session.defaultSession.on('will-download', event => event.preventDefault());

handle('ledger:get', refresh);
handle('hunt:prepare', async expectedSourceId => {
  if (expectedSourceId !== active.sourceId) throw new Error('The character changed. Reopen Start hunt.');
  await active.refresh({ allowFollow: false });
  await active.checkCharacterActivity({ force: true });
  return snapshot();
});
handle('ledger:recent', async (expectedSourceId, candidateId) => {
  if (active === demo || expectedSourceId !== active.sourceId) throw new Error('The character changed. Review the activity notice.');
  await real.selectRecentCharacter(candidateId);
  active = real; revision++; applyProfile(); return snapshot();
});
handle('app:info', () => appInfo(), false);
handle('updates:check', () => updates.check(), false);
handle('updates:install', () => installUpdate(true), false);
handle('app:link', async kind => {
  const links = { releases: 'https://github.com/ChrisDShaw/neverquest/releases',
    issues: 'https://github.com/ChrisDShaw/neverquest/issues/new/choose' };
  if (!Object.hasOwn(links, kind)) throw new Error('Choose a release or support link.');
  if (!smokeTest) await shell.openExternal(links[kind]);
  return 'Opened in your browser.';
});
handle('app:diagnostics', async () => {
  if (smokeTest) return diagnostics();
  const selection = await dialog.showSaveDialog(window, { title: 'Save diagnostic report', defaultPath: 'neverquest-diagnostics.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (selection.canceled) return null;
  assertOutsideGame(selection.filePath);
  await writeFile(selection.filePath, JSON.stringify(diagnostics(), null, 2));
  return 'Diagnostic report saved. You can review the file before sharing it.';
});
handle('ledger:choose', async () => {
  const selection = await dialog.showOpenDialog(window, {
    title: 'Choose a character folder or its Ledger folder', properties: ['openDirectory'], defaultPath: defaultRoot()
  });
  return selection.canceled ? null : connect(selection.filePaths[0]);
});
handle('ledger:discover', async () => {
  offeredSources = await findCharacters();
  return { root: defaultRoot(), sources: offeredSources.map((s, id) => ({ id, character: s.character, server: s.server })) };
});
handle('ledger:select', async id => {
  if (!Number.isInteger(id) || !offeredSources[id]) throw new Error('Choose a listed character.');
  const source = offeredSources[id];
  return connect(source.directory, source);
});
handle('ledger:demo', async () => {
  active = demo;
  revision++;
  real.data.preferences.sourceId = null;
  await real.store.save();
  applyProfile();
  return snapshot();
});
handle('window:pin', async value => {
  active.data.profiles[active.sourceId] = { ...active.data.profiles[active.sourceId], pinned: value === true };
  await active.store.save();
  applyProfile({ restoreBounds: false });
  return window.isAlwaysOnTop();
});
handle('companion:action', async (command, payload, expectedSourceId) => {
  if (expectedSourceId !== undefined && expectedSourceId !== active.sourceId) throw new Error('The character changed. Review the current character and try again.');
  if (active === demo && command === 'follow:set' && payload?.enabled) throw new Error('Connect your character’s ledger before enabling automatic switching.');
  await active.refresh({ allowFollow: false });
  await active.action(command, payload);
  if (command === 'profile:save') applyProfile({ restoreBounds: false });
  return snapshot();
});
handle('history:select', async id => {
  await real.select(id); active = real; revision++; applyProfile(); return snapshot();
});
handle('report:copy', scope => { clipboard.writeText(active.report(scope)); return 'Report copied to clipboard.'; });
handle('hunt:copy', (id, part, expectedText, sourceId) => {
  if (sourceId !== active.sourceId) throw new Error('The character changed. Reopen the hunt summary and try again.');
  clipboard.writeText(active.huntMessage(id, part, expectedText));
  return 'Hunt message copied.';
});
handle('settings:export', async () => {
  const selection = await dialog.showSaveDialog(window, { title: 'Export companion settings', defaultPath: 'neverquest-settings.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (selection.canceled) return null;
  assertOutsideGame(selection.filePath);
  await writeFile(selection.filePath, JSON.stringify(active.exportSettings(), null, 2));
  return 'Settings exported. No history, progress or local paths were included.';
});
handle('settings:preview', async () => {
  const selection = await dialog.showOpenDialog(window, { title: 'Preview companion settings', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (selection.canceled) return null;
  assertOutsideGame(selection.filePaths[0]);
  if ((await stat(selection.filePaths[0])).size > 2_000_000) throw new Error('Settings file is too large (maximum 2 MB).');
  const bundle = validateBundle(JSON.parse(await readFile(selection.filePaths[0], 'utf8')));
  pendingImport = { companion: active, sourceId: active.sourceId, bundle };
  return bundle;
});
handle('settings:apply', async () => {
  if (!pendingImport || pendingImport.companion !== active || pendingImport.sourceId !== active.sourceId) throw new Error('Preview a settings file for this character first.');
  await active.importSettings(pendingImport.bundle); pendingImport = null; applyProfile(); return snapshot();
});
handle('sound:choose', async () => {
  const selected = await dialog.showOpenDialog(window, { title: 'Choose a local alert sound', properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg'] }] });
  if (selected.canceled) return null;
  const filename = selected.filePaths[0], extension = path.extname(filename).toLowerCase();
  assertOutsideGame(filename);
  const mime = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' }[extension];
  if (!mime || (await stat(filename)).size > 32_000_000) throw new Error('Choose a WAV, MP3 or OGG file under 32 MB.');
  const id = randomUUID(), directory = path.join(app.getPath('userData'), 'sounds');
  await mkdir(directory, { recursive: true }); await copyFile(filename, path.join(directory, id + extension));
  active.data.sounds.push({ id, name: path.basename(filename), filename: id + extension, mime });
  await active.store.save(); return snapshot();
});
handle('map:open', async selectedZone => {
  const zone = typeof selectedZone === 'string' ? selectedZone : snapshot().mapZone.zone;
  const url = atlasUrl(zone);
  if (!url) throw new Error('No atlas map is known for the last recorded zone.');
  await shell.openExternal(url); return `Opened the atlas for ${zone}.`;
});
handle('panel:open', kind => {
  if (!['loot', 'hunt', 'session', 'timers', 'map'].includes(kind)) throw new Error('Unknown panel.');
  if (panels.has(kind)) { if (!smokeTest) revealOverlay(panels.get(kind)); return 'Overlay opened.'; }
  const size = { loot: { width: 340, height: 280 }, hunt: { width: 410, height: 520 }, session: { width: 330, height: 195 }, timers: { width: 320, height: 240 }, map: { width: 560, height: 430 } }[kind];
  const panel = new BrowserWindow({ ...size, minWidth: kind === 'map' ? 340 : kind === 'hunt' ? 320 : 240, minHeight: kind === 'map' ? 260 : kind === 'hunt' ? 290 : kind === 'session' ? 180 : 110, show: false,
    title: `Neverquest · ${kind}`, frame: false, transparent: true, backgroundColor: '#00000000',
    hasShadow: false, thickFrame: false, resizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: overlaySettings(kind).pinned, autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' } });
  secureWindow(panel); panels.set(kind, panel);
  panel.once('ready-to-show', () => { if (!smokeTest) revealOverlay(panel); });
  panel.on('closed', () => panels.delete(kind));
  panel.loadURL(`${origin}/overlay.html?panel=${kind}`);
  return 'Overlay opened. Use its controls to move, pin or close it.';
});
handle('panel:configure', (kind, background, pinned) => configureOverlay(active, panels, kind, background, pinned));
handle('panel:close', kind => { panels.get(kind)?.close(); return true; });
handle('panel:resize', (kind, width, height) => {
  if (!panels.has(kind) || !Number.isFinite(width) || !Number.isFinite(height)) throw new Error('Invalid overlay size.');
  const size = { width: Math.round(Math.max(kind === 'map' ? 340 : kind === 'hunt' ? 320 : 240, Math.min(1200, width))), height: Math.round(Math.max(kind === 'map' ? 260 : kind === 'hunt' ? 290 : kind === 'session' ? 180 : 110, Math.min(1000, height))) };
  panels.get(kind).setBounds(size); return size;
});
handle('window:show-main', async () => {
  if (!window) await createWindow();
  window.show(); window.focus(); return true;
});
handle('window:show-hunt', async (id, sourceId) => {
  if (sourceId !== active.sourceId) throw new Error('The character changed. Try opening the current hunt again.');
  if (id) active.hunt(id);
  if (!window) await createWindow();
  window.webContents.send('hunt:show', { id, sourceId });
  if (!smokeTest) { window.show(); window.focus(); }
  return true;
});
handle('market:get', manual => market.get(manual === true), false);
handle('market:open', async item => {
  await shell.openExternal('https://mnm-db.com/#/auctions' + (typeof item === 'string' && item ? '/' + encodeURIComponent(item.slice(0, 200)) : ''));
  return 'Opened mnm-db.com in your browser.';
});
handle('market:copy', (item, server) => {
  if (typeof item !== 'string' || typeof server !== 'string') throw new Error('Choose a market item and server.');
  const rows = market.state.history.at(-1)?.servers[server] ?? [];
  const quote = rows.find(r => r.key === item.toLowerCase());
  if (!quote) throw new Error('No saved player price is available for this item. Refresh the listings and try again.');
  clipboard.writeText(`${quote.item} · ${server} · median seller price ${quote.median === null ? 'unknown' : quote.median + ' cp/item'} · highest buyer offer ${quote.bid === null ? 'unknown' : quote.bid + ' cp/item'} · ${quote.sellers} sellers / ${quote.buyers} buyers · player asking prices; completed sales aren’t confirmed · mnm-db.com`);
  return 'Price check copied.';
});
handle('maps:list', () => mapCache.list(), false);
handle('wiki:item', async item => {
  await shell.openExternal(itemWikiUrl(item)); return 'Opened the item wiki in your browser.';
});
handle('maps:network', enabled => mapCache.setOnline(enabled));
handle('maps:zone', key => mapCache.zone(key), false);
handle('maps:resolve', raw => mapCache.catalogue?.zones.find(z => z.key === mapZoneKey(raw))?.key ?? null, false);
handle('maps:pin', input => mapCache.savePin(input));
handle('maps:remove-pin', id => mapCache.removePin(id));

try {
  if (real.data.preferences.sourceId) { await real.select(real.data.preferences.sourceId); active = real; }
  else if (!real.data.sources.length) {
    const preferences = JSON.parse(await readFile(path.join(app.getPath('userData'), 'preferences.json'), 'utf8'));
    if (typeof preferences.directory === 'string') await connect(preferences.directory);
  }
} catch { /* First launch or moved folder: use the clearly labelled demo. */ }
await createWindow();
updates.start();
if (smokeTest) {
  try {
    if (packagedSmoke) {
      await window.webContents.executeJavaScript(`(async () => {
        const info = await window.companion.appInfo();
        const snapshot = await window.companion.getSnapshot();
        if (!info.ok || !info.value.packaged || info.value.update.state !== 'disabled') throw new Error('Packaged app identity or update isolation failed');
        if (!snapshot.ok || !snapshot.value.demo || window.require !== undefined) throw new Error('Packaged demo or renderer isolation failed');
        document.querySelector('[data-page=settings]').click();
        if (!document.querySelector('#workbench').textContent.includes('About & updates')) throw new Error('Packaged update controls did not load');
        const goal = await window.companion.action('goal:save', { item: 'Invented packaging item', target: 2 }, snapshot.value.sourceId);
        if (!goal.ok) throw new Error('Packaged IPC action failed');
      })()`);
    } else {
      const { verifyUI } = await import('./smoke.mjs');
      await verifyUI(window, panels, demo);
    }
    console.log('Neverquest Electron smoke test passed.'); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
}
app.on('activate', () => { if (!window) createWindow(); });
}).catch(error => {
  console.error('Neverquest failed to start:', error);
  dialog.showErrorBox('Neverquest could not start', error.stack ?? String(error));
  app.exit(1);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  if (allowQuit || smokeTest || !real) return;
  event.preventDefault();
  if (stopping) return;
  const closing = updates.status.state === 'ready' ? installUpdate(false) : settleSaves().then(() => { allowQuit = true; app.quit(); });
  closing.catch(error => {
    stopping = false; allowQuit = false;
    dialog.showErrorBox('Neverquest could not close safely', `Please try again. Your current saved files have been kept.\n${error.message}`);
    if (!window) createWindow();
  });
});

function appInfo() {
  return { version: app.getVersion(), packaged: app.isPackaged, signed: release.signed === true,
    publisher: release.publisher ?? null, update: updates.snapshot() };
}
function diagnostics() {
  // Deliberate allowlist: no error stacks, paths, game records or installation identifiers.
  const { state, checkedAt } = updates.snapshot();
  return { version: app.getVersion(), packaged: app.isPackaged, signed: release.signed === true,
    platform: process.platform, architecture: process.arch, osVersion: os.release(),
    runtime: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    update: { state, checkedAt } };
}
async function settleSaves() {
  stopping = true;
  for (const flush of [...pendingBounds.values()]) flush();
  await queue;
  await real.store.queue;
}
async function installUpdate(restart) {
  try {
    await updates.install(async () => { await settleSaves(); allowQuit = true; }, restart);
    updates.stop();
    return 'Restarting Neverquest…';
  } catch (error) { stopping = false; allowQuit = false; throw error; }
}

function assertOutsideGame(filename) {
  const roots = [defaultRoot(), ...real.data.sources.map(s => path.basename(s.directory).toLowerCase() === 'ledger' ? path.dirname(s.directory) : s.directory)];
  for (const root of roots.filter(Boolean)) {
    const relative = path.relative(path.resolve(root), path.resolve(filename));
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)))
      throw new Error('Choose a file location outside the game’s data folders.');
  }
}

function bell() {
  const rate = 22050, count = Math.floor(rate * 0.5), buffer = Buffer.alloc(44 + count * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) buffer.writeInt16LE(Math.round(Math.sin(i / rate * 880 * 2 * Math.PI) * Math.exp(-i / rate * 8) * 8000), 44 + i * 2);
  return buffer;
}
