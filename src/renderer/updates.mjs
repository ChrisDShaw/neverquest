export class UpdateView {
  constructor({ api, call, element }) { Object.assign(this, { api, call, element }); }
  async start() {
    this.api.onUpdateStatus(status => { this.status = status; this.paint(); });
    const info = await this.call(() => this.api.appInfo());
    if (!info) return;
    this.info = info; this.status ??= info.update;
    document.getElementById('app-version').textContent = `NEVERQUEST / ${info.version}`;
    const ready = document.getElementById('update-ready');
    ready.addEventListener('click', () => this.call(() => this.api.installUpdate()));
    this.paint();
  }
  mount(host) {
    host.open = true;
    if (!this.info) { host.append(this.element('p', 'help', 'Loading app information…')); return; }
    this.host = host;
    host.append(this.element('p', '', `Neverquest ${this.info.version} · ${this.info.packaged ? 'Windows installation' : 'Source build'}`));
    host.append(this.element('p', 'help', this.info.signed
      ? `Signed publisher: ${this.info.publisher}`
      : 'Unsigned build. Windows may show an Unknown publisher warning. Update downloads have no verified publisher signature.'));
    this.label = this.element('p', 'help'); this.label.setAttribute('role', 'status'); host.append(this.label);
    const actions = this.element('div', 'button-row');
    const button = (text, action) => {
      const node = this.element('button', 'secondary', text); node.type = 'button';
      node.addEventListener('click', () => this.call(action)); actions.append(node); return node;
    };
    this.check = button('Check for updates', () => this.api.checkUpdates());
    this.restart = button('Restart to update', () => this.api.installUpdate());
    button('Release notes ↗', () => this.api.openAppLink('releases'));
    button('Report an issue ↗', () => this.api.openAppLink('issues'));
    button('Save diagnostic report…', () => this.api.exportDiagnostics());
    host.append(actions, this.element('p', 'help', 'Updates download in the background and install when you restart or quit Neverquest. Saved history and settings stay on this PC.'));
    host.append(this.element('p', 'help', 'Diagnostic reports contain only app, runtime, Windows and update status information. Review the saved file before sharing it.'));
    this.paint();
  }
  paint() {
    const status = this.status; if (!status) return;
    const ready = document.getElementById('update-ready');
    ready.hidden = status.state !== 'ready';
    ready.textContent = `Update ${status.availableVersion ?? ''} ready — Restart`;
    if (!this.host?.isConnected) return;
    const labels = {
      disabled: 'Automatic updates are available in installed Windows builds. You can download releases below.',
      idle: 'Updates will be checked shortly.', checking: 'Checking for updates…',
      current: 'You’re up to date.', downloading: `Downloading ${status.availableVersion ?? 'update'}… ${status.percent ?? 0}%`,
      ready: `Version ${status.availableVersion} is ready. Restart now or keep playing and update when you quit.`,
      installing: 'Saving your records and restarting…', error: status.message
    };
    this.label.textContent = (labels[status.state] ?? '')
      + (status.state === 'ready' && status.message ? ` ${status.message}` : '')
      + (status.checkedAt ? ` Last checked: ${new Date(status.checkedAt).toLocaleString()}.` : '');
    this.restart.hidden = status.state !== 'ready';
    this.check.disabled = ['disabled', 'checking', 'downloading', 'ready', 'installing'].includes(status.state);
  }
}
