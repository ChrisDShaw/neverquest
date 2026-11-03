// Electron-independent orchestration so update failures and save ordering can be tested.
export class Updates {
  constructor({ updater, enabled = false, version, signed = false, publish = () => {}, now = Date.now }) {
    Object.assign(this, { updater, enabled, publish, now });
    this.status = { state: enabled ? 'idle' : 'disabled', version, signed, checkedAt: null };
    this.operation = null; this.timer = null; this.stopped = false;
    if (!enabled) return;
    updater.autoDownload = false;
    // We settle saves ourselves before handing control to the installer.
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false; updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    updater.logger = null;
    updater.on('download-progress', p => this.set({ state: 'downloading', percent: Math.max(0, Math.min(100, Math.floor(p.percent || 0))) }));
    updater.on('update-downloaded', info => this.set({ state: 'ready', availableVersion: info.version, percent: 100 }));
    updater.on('error', () => this.fail());
  }
  snapshot() { return { ...this.status }; }
  set(change) { this.status = { ...this.status, ...change }; this.publish(this.snapshot()); }
  fail() { this.set({ state: 'error', percent: null, message: 'The update could not finish. Check your connection and try again, or download the latest installer.' }); }
  start() {
    if (!this.enabled || this.stopped || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.check().finally(() => this.schedule()); }, 45000);
    this.timer.unref?.();
  }
  schedule() {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.check().finally(() => this.schedule()); }, 4 * 60 * 60 * 1000);
    this.timer.unref?.();
  }
  stop() { this.stopped = true; clearTimeout(this.timer); this.timer = null; }
  check() {
    if (!this.enabled || this.stopped || ['ready', 'installing'].includes(this.status.state)) return Promise.resolve(this.snapshot());
    if (this.operation) return this.operation;
    this.operation = this.runCheck().finally(() => { this.operation = null; });
    return this.operation;
  }
  async runCheck() {
    try {
      this.set({ state: 'checking', message: null, percent: null });
      const result = await this.updater.checkForUpdates();
      if (!result) throw new Error('No update response');
      this.set({ checkedAt: this.now() });
      // electron-updater performs the semantic version comparison, including downgrade policy.
      if (!result.isUpdateAvailable) this.set({ state: 'current', availableVersion: null });
      else {
        this.set({ state: 'downloading', availableVersion: result.updateInfo.version, percent: 0 });
        await this.updater.downloadUpdate();
      }
    } catch { this.fail(); }
    return this.snapshot();
  }
  async install(settle, restart = true) {
    if (this.status.state !== 'ready') throw new Error('Download an update before restarting.');
    this.set({ state: 'installing', message: null });
    try {
      await settle();
      this.updater.quitAndInstall(true, restart);
      // The library reports installer launch failures through its error event.
      if (this.status.state === 'error') throw new Error('The installer could not start. Try again or download the latest installer.');
    } catch (error) {
      this.set({ state: 'ready', message: 'Could not restart safely. Your current version is still available. Try again.' });
      throw error;
    }
  }
}
