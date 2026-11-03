import { category, describe, dayKey, filterEvents, summarize, formatMoney } from './model.mjs';
import { scopeEvents, valueLoot, playerBreakdown, gathering } from './analysis.mjs';
import { Workbench } from './workbench.mjs';
import { atlasUrl } from './maps.mjs';
import { Requests } from './requests.mjs';

const $ = id => document.getElementById(id);
const api = window.companion;
let snapshot;
let view = 'All';
let limit = 60;
let busy = false;
const requests = new Requests();
let pinned = false;
let notice = '';
let noticeError = false;
let signature = '';
let resetPeriod = false;
let restoringProfile = false;
let rememberTimer;
const workbench = new Workbench({ api, call, accept, getSnapshot: () => snapshot, getPeriod: periodEvents, element,
  onPage: page => rememberView(page) });
const seenNotifications = new Set();
const toasts = element('div', 'toast-stack'); toasts.setAttribute('aria-live', 'polite'); document.body.append(toasts);
function rememberView(page = '') {
  if (restoringProfile || !snapshot) return;
  clearTimeout(rememberTimer);
  rememberTimer = setTimeout(async () => {
    if (busy) return rememberView(page);
    const sourceId = snapshot.sourceId;
    const next = await call(() => api.action('profile:save', { ...snapshot.profile, view, page }, sourceId));
    if (next) accept(next);
  }, 300);
}
function periodEvents() {
  return scopeEvents(snapshot?.events ?? [], { day: $('day-select').value,
    session: snapshot?.sessions?.find(s => s.id === $('session-select').value) });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS(svg.namespaceURI, 'use');
  use.setAttribute('href', `#${name}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.append(use);
  return svg;
}
const icons = { Loot: 'gem', Vendors: 'coin', Party: 'people', Harvest: 'leaf', Trade: 'coin', Items: 'gem', Progression: 'compass', Other: 'book' };
function showNotice() {
  const issues = snapshot ? [...snapshot.problems] : [];
  if (snapshot?.invalidRows) issues.push(`${snapshot.invalidRows} unreadable ledger rows were skipped.`);
  if (notice) issues.unshift(notice);
  $('notice').textContent = issues.join('\n');
  $('notice').hidden = !issues.length;
  $('notice').classList.toggle('error', noticeError);
}

async function call(action, { polling = false } = {}) {
  if (polling && requests.busy) return null;
  if (!polling) {
    document.querySelectorAll('button:not(.dialog-close)').forEach(b => { b.disabled = true; });
  }
  const operation = requests.run(async () => {
    if (!polling) { notice = ''; noticeError = false; }
    try {
      const result = await action();
      if (!result.ok) throw new Error(result.error);
      return result.value;
    } catch (error) {
      notice = error.message; noticeError = true; showNotice(); return null;
    }
  }, { polling });
  busy = requests.busy;
  return operation.finally(() => {
    busy = requests.busy;
    if (!busy) document.querySelectorAll('button').forEach(b => { b.disabled = false; });
  });
}

function accept(next) {
  if (!next || (snapshot && next.revision < snapshot.revision)) return;
  const changedSource = !snapshot || next.sourceId !== snapshot.sourceId || next.demo !== snapshot.demo;
  snapshot = next;
  if (changedSource) { $('day-select').value = ''; $('session-select').value = ''; limit = 60; $('search').value = ''; resetPeriod = true; }
  pinned = next.profile?.pinned === true;
  $('pin-button').setAttribute('aria-pressed', String(pinned));
  if (next.notice) notice = next.notice;
  const nextSignature = JSON.stringify([next.revision, next.dataRevision, next.files, next.invalidRows, next.problems,
    next.events.map(e => e.identity)]);
  if (nextSignature !== signature) {
    signature = nextSignature;
    render();
  }
  if (changedSource) {
    restoringProfile = true;
    if (['goals', 'notebook', 'settings', 'market'].includes(next.profile?.page)) workbench.open(next.profile.page, false);
    else {
      const target = [...document.querySelectorAll('[data-view]')].find(b => b.dataset.view === next.profile?.view)
        ?? document.querySelector('[data-view="All"]');
      target.click();
      if ([...$('activity-filter').options].some(o => o.value === next.profile?.view)) {
        $('activity-filter').value = next.profile.view; $('activity-filter').dispatchEvent(new Event('change'));
      }
    }
    restoringProfile = false;
  }
  for (const notification of next.notifications ?? []) {
    if (seenNotifications.has(notification.id)) continue;
    seenNotifications.add(notification.id);
    const toast = element('div', 'toast', notification.message); toasts.append(toast);
    setTimeout(() => toast.remove(), 8000);
    if (next.audioTarget === 'main') workbench.playSound(notification.soundId);
  }
  showNotice();
  $('refresh-label').textContent = next.demo ? 'Showing sample data.' : `Checked ${new Date().toLocaleTimeString()} · every 2 seconds`;
}

function render() {
  if (!snapshot) return;
  const { events, demo, character, server } = snapshot;
  $('character-name').textContent = character;
  $('server-name').textContent = server;
  $('avatar').textContent = character.slice(0, 1).toUpperCase();
  $('mode-badge').textContent = demo ? 'DEMO DATA' : 'LOCAL LEDGER';
  $('demo-banner').hidden = !demo;
  $('connection-status').textContent = demo ? 'Showing demo data' : snapshot.problems.length ? 'Couldn’t read the ledger · trying again' : 'Checking for new activity';
  $('source-label').textContent = demo ? 'DEMO · NO GAME FILES CONNECTED' : `${snapshot.files} FILES · ${snapshot.directory}`;
  $('source-label').title = snapshot.directory;

  const day = $('day-select').value;
  const days = [...new Set(events.map(e => dayKey(e.at)))].sort().reverse();
  const currentDays = [...$('day-select').options].slice(1).map(o => o.value);
  if (JSON.stringify(days) !== JSON.stringify(currentDays)) {
    const all = element('option', '', 'All dates'); all.value = '';
    $('day-select').replaceChildren(all);
    for (const key of days) {
      const option = element('option', '', new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
      option.value = key; $('day-select').append(option);
    }
    $('day-select').value = days.includes(day) ? day : '';
  }
  const selectedSession = $('session-select').value;
  $('session-select').replaceChildren();
  const whole = element('option', '', 'All activity in the selected dates'); whole.value = ''; $('session-select').append(whole);
  for (const session of snapshot.sessions ?? []) {
    const option = element('option', '', `${session.name}${session.endedAt === null ? ' · running' : ''}`);
    option.textContent = `${session.name}${session.kind === 'automatic' ? ' · auto' : ''}${session.active || session.endedAt === null ? ' · current' : ''}`;
    option.value = session.id; $('session-select').append(option);
  }
  $('session-select').value = snapshot.sessions?.some(s => s.id === selectedSession) ? selectedSession : '';
  const running = snapshot.sessions?.find(s => s.endedAt === null);
  if (resetPeriod) {
    const automatic = snapshot.sessions?.find(s => s.kind === 'automatic' && s.active);
    if (running || automatic) { $('day-select').value = ''; $('session-select').value = (running ?? automatic).id; }
    else $('day-select').value = days[0] ?? '';
    resetPeriod = false;
  }
  $('running-session').textContent = running ? `Hunt: ${running.name}` : 'Sessions are logged automatically';
  $('start-adventure').hidden = Boolean(running); $('end-adventure').hidden = !running;
  $('hunt-summary').hidden = !snapshot.sessions?.some(s => s.id === $('session-select').value && s.kind !== 'automatic');
  $('open-map').hidden = !atlasUrl(snapshot.events.find(e => e.zone)?.zone);
  const period = periodEvents();
  const summary = summarize(period);
  const valuation = valueLoot(period, snapshot.prices ?? []);
  $('stat-value').textContent = formatMoney(valuation.value) + (valuation.unpriced ? '+' : '');
  $('stat-value-note').textContent = valuation.unpriced ? `${valuation.unpriced} items have no saved vendor price` : 'Estimated from saved vendor sales';
  $('stat-items').textContent = summary.items.toLocaleString();
  $('stat-kinds').textContent = `Across ${summary.itemKinds} item types`;
  $('stat-coin').textContent = `${formatMoney(summary.purses)}${summary.unknownPurses ? '+' : ''}`;
  $('stat-coin-note').textContent = `Total before party splits; may include nearby players.${summary.unknownPurses ? ` ${summary.unknownPurses} coin drops have unreadable amounts.` : ''}`;
  $('stat-vendor').textContent = `${formatMoney(summary.vendorNet)}${summary.unknownVendors ? ' *' : ''}`;
  $('stat-vendor-note').textContent = summary.unknownVendors ? `${summary.unknownVendors} transactions have unreadable amounts; total is incomplete` : 'Your sales minus your purchases';
  $('stat-players').textContent = summary.players.length;
  renderPlayers({ ...summary, players: playerBreakdown(period, snapshot.prices).map(p => ({ ...p, items: p.count })) });
  renderItems(summary);
  renderGoalPreview();
  renderFeed();
  workbench.render();
}

function renderPlayers(summary) {
  const nodes = summary.players.map(player => {
    const row = element('div', 'player');
    const top = element('div', 'player-top');
    const name = element('span', 'player-name');
    name.append(element('span', 'mini-avatar', player.name.slice(0, 1)), document.createTextNode(player.name));
    top.append(name, element('span', 'player-total', `${player.items} items`));
    const track = element('div', 'bar-track');
    const fill = element('div', 'bar-fill');
    // No dynamic style attributes: the CSP stays restrictive. SVG encodes the share as geometry.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 4'); svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('width', '100%'); svg.setAttribute('height', '4');
    const bar = document.createElementNS(svg.namespaceURI, 'rect');
    bar.setAttribute('width', String(100 * player.items / Math.max(1, summary.items))); bar.setAttribute('height', '4');
    svg.append(bar); fill.append(svg); track.append(fill); row.append(top, track);
    row.append(element('p', 'player-context', `Item value ${formatMoney(player.value)}${player.unpriced ? ' + unpriced' : ''} · Coin looted ${formatMoney(player.recordedPurses)} · Recorded split shares ${formatMoney(player.recordedShares)}`));
    return row;
  });
  $('players').replaceChildren(...(nodes.length ? nodes : [element('div', 'empty', 'No item loot recorded for this period.')]));
}

function renderItems(summary) {
  const nodes = summary.itemRows.slice(0, 8).map(item => {
    const row = element('div', 'item-row');
    const glyph = element('div', 'item-glyph'); glyph.append(icon('gem'));
    const price = snapshot.prices.find(p => p.key === item.name.toLocaleLowerCase('en'));
    const label = snapshot.labels.find(l => l.item.toLowerCase() === item.name.toLowerCase());
    const reference = snapshot.knowledge.find(k => k.item.toLowerCase() === item.name.toLowerCase());
    const itemButton = workbench.button(item.name, () => workbench.itemDetails(item.name), 'item-link');
    const content = element('div'); content.append(itemButton,
      element('small', '', `${[...item.players].join(', ')} · ${price ? `${formatMoney(price.unit)} each` : 'Unpriced'}${label ? ` · ${label.label}` : ''}`));
    if (reference) content.title = `Quests: ${reference.quests || 'Not recorded'}\nRecipes: ${reference.recipes || 'Not recorded'}\n${reference.notes}\n${reference.source}`;
    row.append(glyph, content, element('span', 'item-quantity', `×${item.quantity}`));
    return row;
  });
  if (summary.itemRows.length > 8) nodes.push(element('p', 'panel-footnote', `${summary.itemRows.length - 8} more item types · search the activity feed to see them.`));
  $('items').replaceChildren(...(nodes.length ? nodes : [element('div', 'empty', 'No loot recorded for these dates or this session.')]));
}

function renderGoalPreview() {
  const goals = snapshot.goals.filter(g => !g.progress.completed).slice(0, 3);
  const nodes = goals.map(goal => {
    const card = element('div', 'mini-goal');
    card.append(workbench.button(goal.item, () => workbench.itemDetails(goal.item), 'item-link'),
      element('span', 'count', `${goal.progress.current} / ${goal.target}`)); return card;
  });
  if (!nodes.length) nodes.push(element('p', 'help', snapshot.goals.length ? 'You’ve reached all your goals. Add another when you’re ready.' : 'Add an item and how many you need. Save a note about why you want it, and check its recorded drop locations.'));
  $('goal-preview').replaceChildren(...nodes);
}

function renderFeed() {
  if (!snapshot) return;
  const events = filterEvents(periodEvents(), { type: view, search: $('search').value });
  const harvest = view === 'Harvest' ? gathering(periodEvents(), snapshot.prices) : null;
  const vendor = view === 'Vendors' ? summarize(periodEvents()) : null;
  $('activity-summary').textContent = harvest ? `${harvest.units} gathered · ${harvest.perHour === null ? 'More gathering records are needed to estimate your pace' : `about ${Math.round(harvest.perHour)} / active hour`} · ${formatMoney(harvest.value)} estimated vendor value${harvest.unpriced ? ` + ${harvest.unpriced} unpriced` : ''}. The pace estimate leaves out gaps longer than ten minutes.`
    : vendor ? `Sold for ${formatMoney(vendor.sales)} · spent ${formatMoney(vendor.purchases)}${vendor.unknownVendors ? ' · some amounts unreadable' : ''}. Choose an item to see its estimated vendor price per item.` : '';
  $('activity-summary').hidden = !$('activity-summary').textContent;
  $('event-count').textContent = `${events.length.toLocaleString()} events`;
  const nodes = events.slice(0, limit).map(event => {
    const kind = category(event.act);
    const row = element('article', 'event');
    const glyph = element('div', `event-icon ${kind}`); glyph.append(icon(icons[kind]));
    const body = element('div', 'event-content');
    const top = element('div', 'event-top');
    const date = new Date(event.at);
    const time = element('time', '', date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
    time.dateTime = date.toISOString(); time.title = date.toLocaleString();
    top.append(element('strong', '', event.actor || 'Unknown adventurer'), time);
    const context = [date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), event.creature, event.zone].filter(Boolean);
    if (event.split) context.push(`Recorded share for ${event.owner}: ${formatMoney(event.ownerShare)}`);
    const description = element('p');
    if (event.item) description.append(workbench.button(describe(event), () => workbench.itemDetails(event.item), 'event-link'));
    else description.textContent = describe(event);
    const actions = element('div', 'event-actions');
    if (event.creature) actions.append(workbench.button('Creature notes', () => workbench.creatureDetails(event.creature, event.zone), 'quiet'));
    actions.append(workbench.button('Save moment', () => workbench.bookmark(event), 'quiet'));
    body.append(top, description, element('small', '', context.join(' · ')), actions);
    row.append(glyph, body); return row;
  });
  $('feed').replaceChildren(...(nodes.length ? nodes : [element('div', 'empty', snapshot.events.length
    ? 'No events match this view. Try another date or search.' : 'No ledger events yet. New activity will appear here as the game writes it.')]));
  $('show-more').hidden = events.length <= limit;
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  workbench.close();
  view = button.dataset.view; limit = 60;
  $('activity-filter').value = view;
  document.querySelectorAll('[data-page]').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b === button));
  const titles = { All: 'Your adventure ledger', Loot: 'Recorded loot', Vendors: 'Vendor purchases and sales', Party: 'Party activity', Harvest: 'Gathering' };
  const subtitles = { All: 'Loot, coin drops and notes from your time in the game.', Loot: 'Items and coin drops recorded around your character.', Vendors: 'Your purchases and sales recorded by the game.', Party: 'Recorded party changes and invitations.', Harvest: 'Items gathered and recorded by the game.' };
  $('page-title').replaceChildren(document.createTextNode(titles[view]), element('span', '', '.'));
  $('page-subtitle').textContent = subtitles[view];
  $('feed-title').textContent = view === 'All' ? 'Recent activity' : `${view === 'Vendors' ? 'Vendor' : view} activity`;
  renderFeed();
  rememberView();
}));
$('search').addEventListener('input', () => { limit = 60; renderFeed(); });
$('activity-filter').addEventListener('change', () => { view = $('activity-filter').value; limit = 60; renderFeed(); rememberView(); });
$('start-adventure').addEventListener('click', () => workbench.startAdventure());
$('end-adventure').addEventListener('click', async () => {
  const running = snapshot.sessions.find(s => s.endedAt === null);
  if (running && await workbench.act('session:end', { id: running.id })) workbench.huntDetails(running.id);
});
$('hunt-summary').addEventListener('click', () => workbench.huntDetails($('session-select').value));
$('past-adventures').addEventListener('click', () => workbench.drawer('Hunt history', () => workbench.history()));
$('open-timers').addEventListener('click', () => workbench.drawer('Timers', () => workbench.timerQuick()));
$('open-overlays').addEventListener('click', () => workbench.overlayPicker());
$('open-map').addEventListener('click', async () => { const result = await call(() => api.openMap()); if (result) workbench.message(result); });
$('manage-goals').addEventListener('click', () => workbench.open('goals'));
$('day-select').addEventListener('change', () => { limit = 60; render(); });
$('session-select').addEventListener('change', () => { limit = 60; render(); });
$('copy-report').addEventListener('click', async () => {
  const result = await call(() => api.copyReport({ sessionId: $('session-select').value, day: $('day-select').value }));
  if (result) { notice = result; showNotice(); }
});
$('show-more').addEventListener('click', () => { limit += 60; renderFeed(); });
for (const id of ['source-button', 'banner-connect']) $(id).addEventListener('click', () => $('source-dialog').showModal());
$('choose-folder').addEventListener('click', async () => {
  const next = await call(() => api.chooseFolder());
  if (next) { accept(next); $('source-dialog').close(); }
  else if (notice) $('sources').textContent = notice;
});
$('find-characters').addEventListener('click', async () => {
  const found = await call(() => api.discover());
  if (!found) { $('sources').textContent = notice; return; }
  $('sources').replaceChildren();
  if (!found.sources.length) {
    $('sources').textContent = `No characters found at ${found.root}. You can choose a folder manually.`; return;
  }
  for (const source of found.sources) {
    const button = element('button', 'source-option'); button.type = 'button';
    button.append(document.createTextNode(source.character), element('span', '', source.server));
    button.addEventListener('click', async () => {
      const next = await call(() => api.selectCharacter(source.id));
      if (next) { accept(next); $('source-dialog').close(); }
      else if (notice) $('sources').textContent = notice;
    });
    $('sources').append(button);
  }
});
$('demo-button').addEventListener('click', async () => accept(await call(() => api.useDemo())));
$('pin-button').addEventListener('click', async () => {
  const result = await call(() => api.pin(!pinned));
  if (result !== null) {
    pinned = result; snapshot.profile = { ...snapshot.profile, pinned };
    $('pin-button').setAttribute('aria-pressed', String(pinned));
  }
});
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !$('source-dialog').open) {
    event.preventDefault(); $('search').focus();
  }
});
api.onShowHunt(async request => {
  const next = await call(() => api.getSnapshot());
  if (!next || next.sourceId !== request.sourceId) return;
  accept(next);
  if (request.id) workbench.huntDetails(request.id); else workbench.startAdventure();
});
accept(await call(() => api.getSnapshot()));
setInterval(async () => { if (!busy && !$('source-dialog').open) accept(await call(() => api.getSnapshot(), { polling: true })); }, 2000);
setInterval(() => workbench.updateTimers(), 1000);
