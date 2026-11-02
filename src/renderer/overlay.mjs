import { formatMoney } from './model.mjs';
import { itemKey } from './analysis.mjs';
import { overlayView, overlayContentKey } from './overlay-model.mjs';
import { Requests } from './requests.mjs';
import { createMapView } from './map-view.mjs';

const api = window.companion, kind = new URL(location.href).searchParams.get('panel');
const $ = id => document.getElementById(id), requests = new Requests();
let snapshot, background = 15, pinned = true;
let mapView;
let contentKey;
const seenNotifications = new Set();
function node(tag, cls, text) {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e;
}
async function call(action, polling = false) {
  if (polling && requests.busy) return;
  return requests.run(async () => {
    try { const result = await action(); if (!result.ok) throw new Error(result.error); return result.value; }
    catch (error) { $('overlay-status').textContent = error.message; $('overlay-status').hidden = false; }
  });
}
function applySettings(settings) {
  background = settings.background; pinned = settings.pinned;
  if ($('overlay').dataset.shade !== String(background)) $('overlay').dataset.shade = String(background);
  if ($('background-opacity').value !== String(background)) $('background-opacity').value = background;
  setText('background-value', `${background}%`);
  if ($('overlay-pin').getAttribute('aria-pressed') !== String(pinned)) $('overlay-pin').setAttribute('aria-pressed', String(pinned));
}
function setText(id, value) { if ($(id).textContent !== value) $(id).textContent = value; }
async function configure(shade, pin) {
  const result = await call(() => api.configurePanel(kind, shade, pin));
  if (result) {
    if (snapshot) snapshot.overlaySettings = { ...snapshot.overlaySettings, [kind]: result };
    applySettings(result);
  }
}
function render(next = snapshot) {
  if (!next) return; snapshot = next;
  const view = overlayView(snapshot, kind, innerHeight);
  if (document.activeElement !== $('background-opacity')) applySettings(snapshot.overlaySettings?.[kind] ?? { background: 15, pinned: true });
  setText('overlay-kind', kind === 'session' ? 'Session' : kind === 'timers' ? 'Timers' : kind === 'map' ? 'Map' : 'Loot');
  setText('overlay-source', `${snapshot.demo ? 'Demo · ' : ''}${snapshot.character}`);
  const content = $('overlay-content');
  const nextKey = kind === 'map' ? null : overlayContentKey(snapshot, kind, view);
  const changed = nextKey !== contentKey;
  if (kind !== 'map' && changed) { content.replaceChildren(); contentKey = nextKey; }
  if (kind === 'map') {
    content.classList.add('map-mode');
    if (!mapView) mapView = createMapView(content, api, () => snapshot, null); else mapView.update();
    setText('overlay-footnote', `${snapshot.mapZone?.source ?? 'Ledger'} · ${snapshot.mapZone?.zone ?? 'No zone yet'} · no position tracking`);
  } else if (kind === 'session' && changed) {
    content.append(node('div', 'overlay-caption', view.caption));
    const stats = node('dl', 'overlay-stats');
    for (const [label, value, money] of [['Items found', view.summary.items, false],
      ['Item vendor value', formatMoney(view.value.value) + (view.value.unpriced ? '+' : ''), true],
      ['Coin drops', formatMoney(view.summary.purses) + (view.summary.unknownPurses ? '+' : ''), true],
      ['Net vendor earnings', formatMoney(view.summary.vendorNet) + (view.summary.unknownVendors ? '*' : ''), true]]) {
      const stat = node('div', 'overlay-stat'), number = node('dd', `${money ? 'money' : ''}${String(value).length > 15 ? ' long' : ''}`, String(value));
      number.title = String(value); stat.append(node('dt', '', label), number); stats.append(stat);
    }
    content.append(stats);
    $('overlay-footnote').textContent = `${view.value.unpriced ? `${view.value.unpriced} unpriced items · ` : ''}Coin totals before splits; may include nearby players`;
  } else if (kind === 'timers' && changed) {
    for (const timer of view.timers) {
      const row = node('div', 'overlay-timer'), line = node('div', 'timer-line');
      const name = node('span', 'timer-name', timer.name); name.title = timer.name;
      const remaining = node('span', 'timer-time'); remaining.dataset.deadline = timer.expiresAt ?? ''; remaining.dataset.duration = String(timer.seconds);
      const controls = node('div', 'timer-buttons');
      for (const [label, title, command] of [['▶', 'Start / reset timer', 'timer:start'], ['×', 'Stop timer', 'timer:stop']]) {
        const button = node('button', '', label); button.title = title; button.setAttribute('aria-label', `${title}: ${timer.name}`);
        button.addEventListener('click', async () => {
          const sourceId = snapshot.sourceId, next = await call(() => api.action(command, { id: timer.id }, sourceId));
          if (next) render(next);
        }); controls.append(button);
      }
      line.append(name, remaining, controls); row.append(line);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('timer-track');
      svg.setAttribute('viewBox', '0 0 100 2'); svg.setAttribute('preserveAspectRatio', 'none');
      const bar = document.createElementNS(svg.namespaceURI, 'rect'); bar.setAttribute('height', '2'); svg.append(bar); row.append(svg); content.append(row);
    }
    if (!view.timerCount) content.append(empty('No timers yet.', 'Set them up in the companion.'));
    $('overlay-footnote').textContent = view.timerCount > view.capacity ? `+${view.timerCount - view.capacity} more · resize to show more` : 'Manual timers';
    updateTimers();
  } else if (changed) {
    for (const event of view.loot) {
      const row = node('div', 'loot-line'), line = node('div', `loot-primary${event.act === 'act_14' ? ' coin' : ''}`);
      const text = event.act === 'act_14' ? formatMoney(event.copper) : `${event.quantity} × ${event.item}`;
      const name = node('span', 'loot-name', text); name.title = text; line.append(name);
      if (event.item && view.wanted.has(itemKey(event.item))) line.append(node('span', 'wanted', 'WANTED'));
      const when = new Date(event.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      row.append(line, node('div', 'loot-detail', `${event.actor} · ${when}${event.act === 'act_14' ? event.split ? ' · shared coin drop' : ' · coin drop' : ''}`)); content.append(row);
    }
    if (!view.lootCount) content.append(empty('No loot recorded for this session or date.', 'Open the companion for history.'));
    $('overlay-footnote').textContent = view.lootCount > view.capacity ? `Latest ${view.loot.length} of ${view.lootCount} · full history in Adventure` : view.caption;
  }
  const hideStatus = !snapshot.problems?.length;
  if ($('overlay-status').hidden !== hideStatus) $('overlay-status').hidden = hideStatus;
  if (!hideStatus) setText('overlay-status', 'Couldn’t read the ledger · trying again');
  for (const notification of snapshot.notifications ?? []) {
    if (seenNotifications.has(notification.id)) continue; seenNotifications.add(notification.id);
    if (snapshot.audioTarget !== kind || !notification.soundId) continue;
    const audio = new Audio(`app://neverquest/sounds/${encodeURIComponent(notification.soundId)}`); audio.volume = 0.65; audio.play().catch(() => {});
  }
}
function empty(text, action) {
  const e = node('div', 'overlay-empty'); e.append(node('div', '', text));
  const button = node('button', '', action); button.addEventListener('click', () => call(() => api.showMain())); e.append(button); return e;
}
function updateTimers() {
  document.querySelectorAll('.timer-time').forEach(time => {
    const deadline = time.dataset.deadline, seconds = deadline ? Math.max(0, Math.ceil((Number(deadline) - Date.now()) / 1000)) : null;
    const label = seconds === null ? '—' : seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Ended';
    if (time.textContent !== label) time.textContent = label;
    time.classList.toggle('ending', seconds !== null && seconds <= 30);
    const width = seconds === null ? 0 : Math.min(100, seconds / Number(time.dataset.duration) * 100);
    const bar = time.closest('.overlay-timer').querySelector('rect');
    if (bar.getAttribute('width') !== String(width)) bar.setAttribute('width', String(width));
  });
}
$('overlay-close').addEventListener('click', () => call(() => api.closePanel(kind)));
$('open-companion').addEventListener('click', () => call(() => api.showMain()));
$('overlay-pin').addEventListener('click', () => configure(background, !pinned));
$('overlay-settings').addEventListener('click', () => {
  const hidden = !$('background-settings').hidden; $('background-settings').hidden = hidden; $('overlay-settings').setAttribute('aria-expanded', String(!hidden));
});
$('background-opacity').addEventListener('input', event => {
  background = Number(event.target.value); $('overlay').dataset.shade = String(background); $('background-value').textContent = `${background}%`;
});
$('background-opacity').addEventListener('change', () => configure(background, pinned));
let drag, resizeFrame;
$('resize-grip').addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  drag = { x: event.screenX, y: event.screenY, width: outerWidth, height: outerHeight };
  event.target.setPointerCapture(event.pointerId);
});
$('resize-grip').addEventListener('pointermove', event => {
  if (!drag || resizeFrame) return;
  const width = drag.width + event.screenX - drag.x, height = drag.height + event.screenY - drag.y;
  resizeFrame = requestAnimationFrame(async () => { resizeFrame = null; await call(() => api.resizePanel(kind, Math.round(width), Math.round(height))); });
});
$('resize-grip').addEventListener('pointerup', () => { drag = null; });
$('resize-grip').addEventListener('lostpointercapture', () => { drag = null; });
window.addEventListener('resize', () => render());
render(await call(() => api.getSnapshot()));
setInterval(async () => { const next = await call(() => api.getSnapshot(), true); if (next) render(next); }, 2000);
setInterval(updateTimers, 250);
