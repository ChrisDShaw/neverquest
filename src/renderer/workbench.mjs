import { flows } from './flows.mjs';
import { renderMarket } from './market-view.mjs';

const $ = id => document.getElementById(id);
const stamp = at => at === null ? 'Running' : new Date(at).toLocaleString();
const alertTypes = { Any: 'Any activity', Loot: 'Loot', Party: 'Party', Harvest: 'Gathering', Vendors: 'Vendor visits', Goal: 'Goal reached' };

export class Workbench {
  constructor(context) {
    Object.assign(this, context); this.page = ''; this.edit = {};
    document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => this.open(b.dataset.page)));
    this.detailDialog = this.e('dialog', 'detail-dialog'); this.detailDialog.id = 'detail-dialog';
    const close = this.e('form'); close.method = 'dialog';
    const button = this.e('button', 'dialog-close quiet', '×'); button.type = 'submit'; button.setAttribute('aria-label', 'Close details');
    close.append(button); this.detailTitle = this.e('h2'); this.detailBody = this.e('div', 'detail-body');
    this.detailDialog.append(close, this.detailTitle, this.detailBody); document.body.append(this.detailDialog);
    this.detailDialog.addEventListener('close', () => { this.drawerBuilder = null; });
  }
  open(page, remember = true) {
    this.page = page; this.edit = {};
    document.querySelectorAll('[data-view],[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    $('ledger-dashboard').hidden = true; $('workbench').hidden = false; this.render();
    if (remember) this.onPage?.(page);
  }
  close() { this.page = ''; $('ledger-dashboard').hidden = false; $('workbench').hidden = true; }
  drawer(title, builder) {
    this.detailTitle.textContent = title; this.drawerBuilder = builder;
    this.s = this.getSnapshot(); this.period = this.getPeriod();
    this.renderDrawer(); if (!this.detailDialog.open) this.detailDialog.showModal();
  }
  renderDrawer() {
    if (!this.drawerBuilder) return;
    this.detailBody.replaceChildren(); this.target = this.detailBody;
    this.drawerBuilder(); this.target = null; this.updateTimers();
  }
  e(tag, cls, text) { return this.element(tag, cls, text); }
  button(text, action, cls = 'secondary') {
    const b = this.e('button', cls, text); b.type = 'button'; b.addEventListener('click', action); return b;
  }
  async act(command, payload) {
    const sourceId = this.getSnapshot().sourceId;
    const next = await this.call(() => this.api.action(command, payload, sourceId));
    if (next) {
      this.accept(next);
      if (command === 'session:start') {
        $('day-select').value = ''; $('session-select').value = next.sessions.find(s => s.kind !== 'automatic' && s.endedAt === null).id;
        $('session-select').dispatchEvent(new Event('change'));
        document.querySelector('[data-view="All"]').click();
      }
    }
    return next;
  }
  panel(title, subtitle = '') {
    const root = this.target ?? $('workbench'), fold = this.page === 'settings' && root === $('workbench');
    const section = this.e(fold ? 'details' : 'section', 'panel bench-panel');
    section.append(this.e(fold ? 'summary' : 'h2', '', title));
    if (subtitle) section.append(this.e('p', 'help', subtitle));
    root.append(section); return section;
  }
  table(parent, headings, rows) {
    if (!rows.length) { parent.append(this.e('p', 'empty', 'Nothing recorded here yet.')); return; }
    const wrap = this.e('div', 'table-scroll'), table = this.e('table');
    const head = this.e('tr'); headings.forEach(h => head.append(this.e('th', '', h)));
    const thead = this.e('thead'); thead.append(head); table.append(thead);
    const tbody = this.e('tbody');
    for (const row of rows) {
      const tr = this.e('tr');
      for (const content of row) {
        const td = this.e('td');
        if (content instanceof Node) td.append(content); else td.textContent = String(content ?? '');
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody); wrap.append(table); parent.append(wrap);
  }
  form(parent, fields, submitText, submit) {
    const form = this.e('form', 'bench-form');
    const inputs = {};
    for (const field of fields) {
      const label = this.e('label', '', field.label);
      const input = this.e(field.type === 'textarea' ? 'textarea' : field.options ? 'select' : 'input');
      if (!field.options && field.type !== 'textarea') input.type = field.type ?? 'text';
      if (field.options) for (const [value, title] of field.options) {
        const option = this.e('option', '', title); option.value = value; input.append(option);
      }
      input.name = field.name; input.value = field.value ?? ''; input.required = field.required ?? false;
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      if (field.step !== undefined) input.step = field.step;
      if (input.tagName === 'INPUT' && input.type === 'text') input.maxLength = 200;
      if (input.tagName === 'TEXTAREA') input.maxLength = 10000;
      label.append(input); form.append(label); inputs[field.name] = input;
    }
    const button = this.e('button', 'primary', submitText); button.type = 'submit'; form.append(button);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]));
      button.focus();
      await submit(values);
    });
    parent.append(form); return form;
  }
  render() {
    if (!this.getSnapshot()) return;
    this.s = this.getSnapshot(); this.period = this.getPeriod();
    const focus = document.activeElement, typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(focus?.tagName);
    if (this.page && !(typing && $('workbench').contains(focus))) {
      $('workbench').replaceChildren();
      const titles = { goals: 'Goals & wishlist', notebook: 'Field notes', settings: 'Your preferences', tools: 'Timers', market: 'Player market' };
      $('page-title').textContent = titles[this.page] ?? 'Your adventure';
      $('page-subtitle').textContent = this.page === 'goals' ? 'Items you want to collect, with notes and recorded drop locations.' : '';
      if (this.page === 'tools') this.timerQuick(); else this[this.page]?.();
    }
    if (this.detailDialog.open && !(typing && this.detailDialog.contains(focus))) this.renderDrawer();
  }
  message(text) {
    const p = this.e('p', 'toast', text); document.querySelector('.toast-stack').append(p); setTimeout(() => p.remove(), 8000);
  }
  market() { renderMarket(this); }
  soundOptions() { return [['', 'Silent'], ['bell', 'Built-in bell'], ...this.s.sounds.map(s => [s.id, s.name])]; }
  tools() {
    const timers = this.panel('Manual timers', 'Start, reset or stop your own countdowns. Timers keep their deadlines when you close the app. They don’t start automatically from spells or buffs.');
    this.form(timers, [{ name: 'name', label: 'Timer name', required: true },
      { name: 'seconds', label: 'Duration (seconds)', type: 'number', min: 1, max: 86400, value: 90, required: true },
      { name: 'soundId', label: 'End sound', options: this.soundOptions() }], 'Add timer', v => this.act('timer:save', { ...v, seconds: Number(v.seconds) }));
    this.table(timers, ['Timer', 'Duration', 'Remaining', ''], this.s.timers.map(t => {
      const remaining = this.e('span', 'timer-remaining', 'Stopped');
      if (t.expiresAt !== null) remaining.dataset.deadline = String(t.expiresAt);
      const actions = this.e('div', 'button-row');
      actions.append(this.button('Start / reset', () => this.act('timer:start', { id: t.id })),
        this.button('Stop', () => this.act('timer:stop', { id: t.id })),
        this.button('Remove', () => this.act('entry:remove', { collection: 'timers', id: t.id })));
      return [t.name, `${t.seconds}s`, remaining, actions];
    }));
    this.updateTimers();
    const alerts = this.panel('Activity alerts', 'Choose which new activities or completed goals you want to hear about. Importing older activity won’t trigger alerts.');
    const editing = this.s.alerts.find(a => a.id === this.edit.alert) ?? {};
    this.form(alerts, [{ name: 'name', label: 'Alert name', required: true, value: editing.name },
      { name: 'type', label: 'Activity type', options: Object.entries(alertTypes), value: editing.type ?? 'Loot' },
      { name: 'match', label: 'Text to match (leave blank for all)', value: editing.match },
      { name: 'soundId', label: 'Sound', options: this.soundOptions(), value: editing.soundId },
      { name: 'enabled', label: 'Rule status', options: [['yes', 'Enabled'], ['no', 'Disabled']], value: editing.enabled === false ? 'no' : 'yes' }
    ], editing.id ? 'Save alert' : 'Add alert', async v => { this.edit = {}; await this.act('alert:save', { ...v, id: editing.id, enabled: v.enabled === 'yes' }); });
    this.table(alerts, ['Rule', 'Type', 'Match', 'Status', ''], this.s.alerts.map(a => {
      const actions = this.e('div', 'button-row');
      actions.append(this.button('Edit', () => { this.edit.alert = a.id; this.render(); }),
        this.button(a.enabled ? 'Disable' : 'Enable', () => this.act('alert:save', { ...a, enabled: !a.enabled })),
        this.button('Remove', () => this.act('entry:remove', { collection: 'alerts', id: a.id })));
      return [a.name, alertTypes[a.type] ?? a.type, a.match || 'All', a.enabled ? 'On' : 'Off', actions];
    }));
    const sounds = this.panel('Alert sounds', 'Use the built-in bell or choose a WAV, MP3 or OGG file. Neverquest saves a copy in its own data folder.');
    sounds.append(this.button('Choose sound file', async () => this.accept(await this.call(() => this.api.chooseSound()))));
    this.form(sounds, [{ name: 'soundId', label: 'Preview a sound', options: this.soundOptions() }], 'Preview', v => this.playSound(v.soundId));
    const notices = this.panel('Recent alerts', 'Alerts appear here and as brief messages in the app.');
    this.table(notices, ['When', 'Message'], [...this.s.notifications].reverse().map(n => [stamp(n.at), n.message]));
  }
  updateTimers() {
    document.querySelectorAll('.timer-remaining[data-deadline]').forEach(node => {
      const seconds = Math.max(0, Math.ceil((Number(node.dataset.deadline) - Date.now()) / 1000));
      node.textContent = seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Ended';
    });
  }
  playSound(id) {
    if (!id) return;
    const audio = new Audio(`app://neverquest/sounds/${encodeURIComponent(id)}`);
    audio.volume = 0.65;
    audio.play().catch(() => this.message('We couldn’t play that sound. Try a different WAV, MP3 or OGG file.'));
  }
  settings() {
    const sessions = this.panel('Automatic sessions', 'Neverquest groups recorded activity into sessions. A gap between activities starts a new session. Session duration can differ from your total time in the game. Named runs are optional.');
    this.form(sessions, [{ name: 'minutes', label: 'Start a new session after a gap of (minutes)', type: 'number', min: 10, max: 180,
      value: this.s.preferences.sessionGapMinutes ?? 30, required: true }], 'Save session setting', v => this.act('session:gap', { minutes: Number(v.minutes) }));
    const utilities = this.panel('Timers & alerts', 'Set up countdowns, choose activity alerts and add sounds.');
    utilities.append(this.button('Set up timers & alerts', () => this.drawer('Timers & alerts', () => this.tools())));
    const panel = this.panel('Window appearance', 'Change Neverquest’s main window for this character.');
    this.form(panel, [{ name: 'opacity', label: 'Main window opacity (%)', type: 'number', min: 30, max: 100, value: this.s.profile.opacity ?? 100, required: true },
      { name: 'pinned', label: 'Always on top', options: [['no', 'Off'], ['yes', 'On']], value: this.s.profile.pinned ? 'yes' : 'no' }
    ], 'Save appearance', v => this.act('profile:save', { opacity: Number(v.opacity), pinned: v.pinned === 'yes', view: 'All', page: this.page }));
    const follow = this.panel('Automatically switch characters', 'Switch to the character with the most recently updated ledger. This uses file timestamps without checking game processes or windows.');
    follow.append(this.button(this.s.preferences.follow ? 'Disable automatic switching' : 'Enable automatic switching', () => this.act('follow:set', { enabled: !this.s.preferences.follow })));
    const panels = this.panel('Overlays', 'Keep loot, session totals, timers or a map visible while you play. Drag the handle to move an overlay and the corner to resize it. Use its controls to pin it or change the background; text stays fully visible.');
    panels.append(this.e('p', 'help', 'Use windowed mode for reliable overlay interaction. If the game offers borderless mode, test it as an alternative. Full-screen mode can cover desktop overlays.'));
    const buttons = this.e('div', 'button-row');
    for (const kind of ['loot', 'session', 'timers', 'map']) buttons.append(this.button(`Open ${kind} overlay`, async () => {
      const result = await this.call(() => this.api.openPanel(kind)); if (result) this.message(result);
    }));
    panels.append(buttons);
    this.form(panels, [{ name: 'kind', label: 'Overlay to adjust', options: ['loot', 'session', 'timers', 'map'].map(k => [k, k]) },
      { name: 'opacity', label: 'Background only (%)', type: 'number', value: 15, min: 0, max: 100, required: true },
      { name: 'pinned', label: 'Always on top', options: [['no', 'Off'], ['yes', 'On']], value: 'yes' }], 'Adjust open overlay', async v => {
      const result = await this.call(() => this.api.configurePanel(v.kind, Number(v.opacity), v.pinned === 'yes')); if (result) this.message('Overlay background and pinning updated. Text stays solid.');
    });
    const sharing = this.panel('Import and export settings', 'Export appearance settings, goals, alerts, item decisions and reference notes. History, progress, character paths and window positions stay on this PC. Imported goals start fresh, and custom sound files aren’t copied.');
    const actions = this.e('div', 'button-row');
    actions.append(this.button('Export settings', async () => { const result = await this.call(() => this.api.exportSettings()); if (result) this.message(result); }),
      this.button('Preview settings import', async () => {
        const bundle = await this.call(() => this.api.previewSettings());
        if (!bundle) return;
        sharing.querySelector('.import-preview')?.remove();
        const preview = this.e('div', 'import-preview');
        preview.append(this.e('p', 'help', `Preview: ${bundle.goals.length} goals, ${bundle.alerts.length} alerts, ${bundle.knowledge.length} item references, ${bundle.labels.length} decisions. Existing entries are kept. The imported appearance and view preferences replace the current ones.`));
        const details = this.e('details'); details.append(this.e('summary', '', 'View settings to import'), this.e('pre', '', JSON.stringify(bundle, null, 2)));
        preview.append(details, this.button('Import these settings', async () => { const next = await this.call(() => this.api.applySettings()); if (next) this.accept(next); }, 'primary'));
        sharing.append(preview);
      }));
    sharing.append(actions);
  }
}

Object.assign(Workbench.prototype, flows);
