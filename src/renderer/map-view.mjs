import { atlasUrl } from './maps.mjs';
import { MapLoader } from './map-loader.mjs';
const ns = 'http://www.w3.org/2000/svg';
export function createMapView(root, api, getSnapshot, showMessage) {
  const e = (tag, text) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
  const call = async fn => { const r = await fn(); if (!r.ok) throw new Error(r.error); return r.value; };
  const controls = e('div'); controls.className = 'map-controls';
  const select = e('select'), follow = e('button', 'Follow zone'), fit = e('button', 'Fit map'), plus = e('button', '+'), minus = e('button', '−'), pinButton = e('button', 'Add pin');
  const opacity = e('input'); opacity.type = 'range'; opacity.min = '35'; opacity.max = '100'; opacity.value = '85';
  opacity.className = 'map-opacity'; opacity.title = 'Map image opacity; markers stay solid'; opacity.setAttribute('aria-label', 'Map image opacity');
  select.setAttribute('aria-label', 'Zone map'); controls.append(select, follow, fit, plus, minus, pinButton, opacity);
  const atlas = e('button', 'Atlas ↗'); atlas.hidden = true; atlas.title = 'Open this zone in the community atlas in your browser'; controls.append(atlas);
  const filters = e('details'); filters.className = 'map-filters'; filters.append(e('summary', 'Markers'));
  const stage = e('div'); stage.className = 'map-stage';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('aria-label', 'Zone map: drag to pan, wheel to zoom'); stage.append(svg);
  const empty = e('div'); empty.className = 'map-empty'; empty.setAttribute('role', 'status');
  const emptyTitle = e('strong'), emptyDetail = e('p'); empty.append(emptyTitle, emptyDetail); stage.append(empty);
  const popup = e('div'); popup.className = 'map-popup'; popup.hidden = true; stage.append(popup);
  const pinForm = e('form'); pinForm.className = 'map-pin-form'; pinForm.hidden = true;
  const name = e('input'); name.placeholder = 'Pin name'; name.maxLength = 200; name.required = true; name.setAttribute('aria-label', 'Pin name');
  const category = e('select'); category.setAttribute('aria-label', 'Pin category');
  const save = e('button', 'Save private pin'); save.type = 'submit'; const cancel = e('button', 'Cancel'); cancel.type = 'button';
  pinForm.append(name, category, save, cancel);
  const credit = e('div', 'Community wiki maps via MnMdb · no player position tracking'); credit.className = 'map-credit';
  const network = e('label', 'Allow map downloads'), networkToggle = e('input');
  network.className = 'map-network'; networkToggle.type = 'checkbox'; network.prepend(networkToggle);
  network.title = 'Downloads start off. Enable them to save community maps from mnm-db.com on this PC. Files are checked, but those checks can’t guarantee an image is safe.';
  const networkState = e('span', ' · Downloads off'); network.append(networkState);
  root.append(controls, filters, stage, pinForm, network, credit);
  let catalogue, zone, following = true, online = false, lastLedger = '', adding = false, point, drag, view;
  const visible = new Set();
  const say = message => { credit.textContent = message; showMessage?.(message); };
  const svgNode = tag => document.createElementNS(ns, tag);
  function world(event) { const r = svg.getBoundingClientRect(); return { x: view.x + (event.clientX - r.left) / r.width * view.w, y: view.y + (event.clientY - r.top) / r.height * view.h }; }
  function redraw() {
    if (!zone || !view) return;
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`); svg.replaceChildren();
    const image = svgNode('image'); image.setAttribute('href', zone.imageUrl); image.setAttribute('width', zone.width); image.setAttribute('height', zone.height);
    image.setAttribute('opacity', String(Number(opacity.value) / 100)); svg.append(image);
    const ratio = view.w / Math.max(1, svg.clientWidth);
    for (const marker of [...zone.markers, ...zone.pins.map(p => ({ ...p, personal: true }))]) {
      if (!visible.has(marker.category) && !marker.personal) continue;
      const circle = svgNode('circle'); circle.setAttribute('cx', marker.x); circle.setAttribute('cy', marker.y); circle.setAttribute('r', String(5 * ratio));
      circle.setAttribute('fill', marker.personal ? '#f7db91' : catalogue.categories.find(c => c.id === marker.category)?.color ?? '#ccd6ce');
      circle.setAttribute('stroke', '#102018'); circle.setAttribute('stroke-width', String(1.5 * ratio));
      const title = svgNode('title'); title.textContent = marker.label; circle.append(title);
      circle.addEventListener('pointerdown', event => event.stopPropagation());
      circle.addEventListener('click', event => {
        event.stopPropagation(); popup.replaceChildren(e('strong', marker.label), e('p', marker.notes ?? (marker.personal ? 'Your private pin' : marker.category)));
        if (marker.personal) { const remove = e('button', 'Remove pin'); remove.onclick = async () => {
          try { await call(() => api.removeMapPin(marker.id)); zone.pins = zone.pins.filter(p => p.id !== marker.id); popup.hidden = true; redraw(); } catch (error) { say(error.message); }
        }; popup.append(remove); }
        const close = e('button', 'Close'); close.onclick = () => { popup.hidden = true; }; popup.append(close); popup.hidden = false;
      }); svg.append(circle);
    }
  }
  function fitMap() { if (!zone) return; const r = svg.getBoundingClientRect(), aspect = Math.max(0.3, r.width / Math.max(1, r.height));
    const w = Math.max(zone.width, zone.height * aspect); view = { x: (zone.width - w) / 2, y: (zone.height - w / aspect) / 2, w, h: w / aspect }; redraw(); }
  function zoom(scale, focus) { if (!view) return; const p = focus ?? { x: view.x + view.w / 2, y: view.y + view.h / 2 };
    const factor = Math.max(zone.width / 50, Math.min(zone.width * 5, view.w * scale)) / view.w;
    view = { x: p.x - (p.x - view.x) * factor, y: p.y - (p.y - view.y) * factor, w: view.w * factor, h: view.h * factor }; redraw(); }
  const loader = new MapLoader(key => call(() => api.mapZone(key)), state => {
    zone = state.zone; view = null; drag = null; point = null; adding = false;
    svg.replaceChildren(); svg.removeAttribute('viewBox'); svg.hidden = !zone;
    popup.hidden = true; pinForm.hidden = true; pinButton.textContent = 'Add pin'; atlas.hidden = true;
    for (const control of [fit, plus, minus, pinButton, opacity]) control.disabled = !zone;
    empty.hidden = Boolean(zone); emptyTitle.textContent = state.title; emptyDetail.textContent = state.detail;
    select.value = zone?.key ?? (catalogue?.zones.some(z => z.key === state.key) ? state.key : '');
    credit.textContent = 'Community wiki maps via MnMdb · no player position tracking';
    if (zone) {
      fitMap(); atlas.hidden = !atlasUrl(zone.name);
      credit.textContent = `${zone.name} · ${zone.source} · MnMdb · no player position tracking${zone.pinError ? ' · ' + zone.pinError : ''}`;
    }
  });
  loader.clear('Loading maps…', 'Checking available maps.');
  const load = key => loader.load(key, { online, name: catalogue?.zones.find(z => z.key === key)?.name ?? key });
  const currentZone = () => getSnapshot()?.mapZone?.zone ?? getSnapshot()?.events.find(e => e.zone)?.zone;
  async function followLedger(force = false) {
    const raw = getSnapshot()?.mapZone?.zone ?? getSnapshot()?.events.find(e => e.zone)?.zone;
    if (!raw || !catalogue) return;
    const result = await call(() => api.resolveMapZone(raw));
    if (!following || currentZone() !== raw) return;
    if (!force && raw === lastLedger && loader.state.key === (result ?? raw)) return;
    lastLedger = raw;
    if (result) await load(result);
    else loader.clear('No map available', `No community map is available for ${raw}. Choose another zone.`, raw);
  }
  select.onchange = () => { following = false; follow.textContent = 'Follow zone'; load(select.value); };
  follow.onclick = () => { following = true; followLedger(true).catch(error => say(error.message)); };
  fit.onclick = fitMap; plus.onclick = () => zoom(0.8); minus.onclick = () => zoom(1.25);
  opacity.oninput = redraw;
  atlas.onclick = () => { if (zone) call(() => api.openMap(zone.name)).catch(error => say(error.message)); };
  pinButton.onclick = () => { adding = !adding; pinButton.textContent = adding ? 'Choose a spot on the map…' : 'Add pin'; };
  cancel.onclick = () => { pinForm.hidden = true; adding = false; pinButton.textContent = 'Add pin'; };
  pinForm.onsubmit = async event => { event.preventDefault(); try {
    const pin = await call(() => api.saveMapPin({ zone: zone.key, x: point.x, y: point.y, label: name.value, category: category.value }));
    zone.pins.push(pin); pinForm.hidden = true; adding = false; pinButton.textContent = 'Add pin'; name.value = ''; redraw();
  } catch (error) { say(error.message); } };
  svg.addEventListener('pointerdown', event => { if (!zone || event.button !== 0) return;
    if (adding) { point = world(event); pinForm.hidden = false; name.focus(); return; }
    drag = { x: event.clientX, y: event.clientY, view: { ...view } }; svg.setPointerCapture(event.pointerId); popup.hidden = true;
  });
  svg.addEventListener('pointermove', event => { if (!drag) return; const r = svg.getBoundingClientRect(); view = { ...drag.view,
    x: drag.view.x - (event.clientX - drag.x) * drag.view.w / r.width, y: drag.view.y - (event.clientY - drag.y) * drag.view.h / r.height }; redraw(); });
  svg.addEventListener('pointerup', () => { drag = null; }); svg.addEventListener('lostpointercapture', () => { drag = null; });
  svg.addEventListener('wheel', event => { if (!view) return; event.preventDefault(); zoom(event.deltaY > 0 ? 1.15 : 0.87, world(event)); }, { passive: false });
  new ResizeObserver(() => { if (zone) fitMap(); }).observe(stage);
  async function refreshCatalogue() {
    const result = await call(() => api.mapCatalogue()); catalogue = result.catalogue;
    online = result.online;
    networkToggle.checked = result.online;
    networkState.textContent = result.online ? ' · MnMdb' : ' · Cached maps only';
    if (!catalogue) { loader.clear(online ? 'Map list unavailable' : 'No cached map found', result.error || 'Enable map downloads to fetch community maps.'); return; }
    const manualKey = zone?.key ?? loader.state.key;
    select.replaceChildren(); filters.replaceChildren(e('summary', 'Markers')); category.replaceChildren(); visible.clear();
    const placeholder = e('option', 'Choose a zone'); placeholder.value = ''; placeholder.disabled = true; select.append(placeholder);
    for (const z of catalogue.zones) { const option = e('option', z.name); option.value = z.key; select.append(option); }
    for (const c of catalogue.categories) {
      visible.add(c.id); const label = e('label', c.name), input = e('input'); input.type = 'checkbox'; input.checked = true;
      input.onchange = () => { if (input.checked) visible.add(c.id); else visible.delete(c.id); redraw(); }; label.prepend(input); filters.append(label);
      const option = e('option', c.name); option.value = c.id; category.append(option);
    }
    if (following) {
      if (currentZone()) await followLedger(true);
      else loader.clear('No zone detected', 'Choose a map manually or wait for a recorded zone.');
    } else if (catalogue.zones.some(z => z.key === manualKey)) await load(manualKey);
    if (result.error) say('Using cached maps: ' + result.error);
  }
  networkToggle.onchange = async () => {
    networkToggle.disabled = true;
    try {
      const policy = await call(() => api.setMapDownloads(networkToggle.checked));
      online = policy.online;
      networkToggle.checked = policy.online;
      networkState.textContent = policy.online ? ' · MnMdb' : ' · Cached maps only';
      if (policy.online) await refreshCatalogue();
      else say('Map downloads are off. Saved maps that pass validation remain available.');
    } catch (error) { networkToggle.checked = false; say(error.message); }
    finally { networkToggle.disabled = false; }
  };
  const ready = refreshCatalogue().catch(error => say(error.message));
  return { ready, update: () => { if (following) return followLedger().catch(error => say(error.message)); } };
}
