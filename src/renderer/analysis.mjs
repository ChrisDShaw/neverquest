import { formatMoney, dayKey, summarize } from './model.mjs';

export const itemKey = name => String(name ?? '').trim().toLocaleLowerCase('en');
export const eventKey = event => `${event.social ? 'S' : 'C'}:${event.identity}`;

export function priceBook(sources, server) {
  const samples = new Map();
  for (const source of sources) {
    if (source.server !== server) continue;
    for (const event of source.events) {
      if (event.social || event.act !== 'act_24' || event.copper === null || !event.item || event.quantity < 1) continue;
      const key = itemKey(event.item);
      const item = samples.get(key) ?? { key, name: event.item, observations: [] };
      item.observations.push({ unit: Math.floor(event.copper / event.quantity), at: event.at, quantity: event.quantity });
      samples.set(key, item);
    }
  }
  return [...samples.values()].map(item => {
    const prices = item.observations.map(s => s.unit).sort((a, b) => a - b);
    const middle = Math.floor(prices.length / 2);
    return { key: item.key, name: item.name,
      unit: prices.length % 2 ? prices[middle] : Math.floor((prices[middle - 1] + prices[middle]) / 2),
      low: prices[0], high: prices.at(-1), samples: prices.length,
      units: item.observations.reduce((n, o) => n + o.quantity, 0), lastSeen: item.observations.reduce((n, o) => Math.max(n, o.at), 0) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function scopeEvents(events, { session, day } = {}) {
  return events.filter(e => (!day || dayKey(e.at) === day)
    && (!session || (e.at >= session.startedAt && (session.endedAt === null || e.at < session.endedAt))));
}

export function compareSessions(events, sessions, prices) {
  return sessions.map(session => {
    const rows = scopeEvents(events, { session }), summary = summarize(rows);
    return { name: session.name, ...valueLoot(rows, prices), items: summary.items, vendorNet: summary.vendorNet,
      unknownVendors: summary.unknownVendors, gathered: gathering(rows, prices).units };
  });
}

export function valueLoot(events, prices) {
  const book = new Map(prices.map(p => [p.key, p]));
  let value = 0, unpriced = 0;
  for (const e of events.filter(e => e.act === 'act_13')) {
    const price = book.get(itemKey(e.item));
    if (price) value += price.unit * e.quantity;
    else unpriced += e.quantity;
  }
  return { value, unpriced };
}

export function playerBreakdown(events, prices) {
  const players = new Map();
  const get = name => {
    const key = itemKey(name);
    if (!players.has(key)) players.set(key, { name: name || 'Unknown', items: [], recordedPurses: 0, recordedShares: 0 });
    return players.get(key);
  };
  for (const e of events) {
    if (e.act === 'act_13') get(e.actor).items.push(e);
    if (e.act === 'act_14') {
      if (e.split) { if (e.ownerShare !== null) get(e.owner).recordedShares += e.ownerShare; }
      else get(e.actor).recordedPurses += e.copper ?? 0;
    }
  }
  return [...players.values()].map(p => ({ ...p, count: p.items.reduce((n, e) => n + e.quantity, 0), ...valueLoot(p.items, prices) }))
    .sort((a, b) => b.value - a.value || b.count - a.count);
}

export function report(source, events, prices, title = 'Adventure summary') {
  const summary = summarize(events);
  const valuation = valueLoot(events, prices);
  const players = playerBreakdown(events, prices);
  return [
    `Neverquest · ${title}`, `${source.character} · ${source.server}`,
    `${events.length} recorded events · ${summary.items} items (${summary.itemKinds} kinds)`,
    `Coin drops: ${formatMoney(summary.purses)}${summary.unknownPurses ? ' + drops with unreadable amounts' : ''}`,
    `Estimated item vendor value: ${formatMoney(valuation.value)}${valuation.unpriced ? ` + ${valuation.unpriced} unpriced items` : ''}`,
    `Vendor sales: ${formatMoney(summary.sales)} · Purchases: ${formatMoney(summary.purchases)} · Net vendor earnings: ${formatMoney(summary.vendorNet)}${summary.unknownVendors ? ' (incomplete)' : ''}`,
    '', 'Recorded loot by player:',
    ...players.map(p => `${p.name}: ${p.count} items; vendor value ${formatMoney(p.value)}${p.unpriced ? ' + unpriced items' : ''}; coin looted ${formatMoney(p.recordedPurses)}; recorded split shares ${formatMoney(p.recordedShares)}`),
    '', 'Coin drops are totals before party splits and may include nearby players. Your personal share may differ. Item values are estimates from saved vendor sales; player asking prices are separate.'
  ].join('\n');
}

export function goalProgress(goal, events) {
  const acquisitions = events.filter(e => !e.social && e.at >= goal.startedAt).reduce((n, e) => {
    if (['act_13', 'act_27', 'act_12', 'act_28'].includes(e.act) && itemKey(e.item) === itemKey(goal.item)) return n + e.quantity;
    if (e.act === 'act_20') return n + (e.tradeItems ?? []).filter(i => itemKey(i.item) === itemKey(goal.item)).reduce((sum, i) => sum + i.quantity, 0);
    return n;
  }, 0);
  return { acquired: acquisitions, current: Math.max(0, acquisitions + goal.adjustment),
    target: goal.target, completed: goal.completed || acquisitions + goal.adjustment >= goal.target };
}

export function creatureRecords(events) {
  // A visit is inferred from one actor, creature and zone with <=6s between rows.
  // A second purse starts a new visit. There is no real corpse identifier.
  const visits = new Map(), records = new Map();
  for (const e of [...events].filter(e => ['act_13', 'act_14'].includes(e.act) && e.creature).sort((a, b) => a.at - b.at)) {
    const kind = `${itemKey(e.zone)}\0${itemKey(e.creature)}`;
    const actor = `${kind}\0${itemKey(e.actor)}`;
    const record = records.get(kind) ?? { creature: e.creature, zone: e.zone, visits: [], items: new Map(), copper: 0 };
    let visit = visits.get(actor);
    if (!visit || e.at - visit.at > 6000 || (e.act === 'act_14' && visit.purse)) {
      visit = { at: e.at, purse: false, items: new Set() }; visits.set(actor, visit); record.visits.push(visit);
    }
    visit.at = e.at;
    if (e.act === 'act_14') { visit.purse = true; record.copper += e.copper ?? 0; }
    else {
      const key = itemKey(e.item); visit.items.add(key);
      const item = record.items.get(key) ?? { name: e.item, key, quantity: 0 };
      item.quantity += e.quantity; record.items.set(key, item);
    }
    records.set(kind, record);
  }
  return [...records.values()].map(r => ({ creature: r.creature, zone: r.zone, visits: r.visits.length, copper: r.copper,
    items: [...r.items.values()].map(i => {
      const n = r.visits.length, hits = r.visits.filter(v => v.items.has(i.key)).length, p = hits / n, z = 1.96;
      const center = (p + z * z / (2 * n)) / (1 + z * z / n);
      const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n);
      return { ...i, hits, rate: p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
    }).sort((a, b) => b.hits - a.hits) })).sort((a, b) => b.visits - a.visits);
}

export function gathering(events, prices) {
  const rows = events.filter(e => !e.social && e.act === 'act_27').sort((a, b) => a.at - b.at);
  const units = rows.reduce((n, e) => n + e.quantity, 0);
  const activeMs = rows.reduce((n, e, i) => n + (i && e.at - rows[i - 1].at <= 600_000 ? e.at - rows[i - 1].at : 0), 0);
  const valuation = valueLoot(rows.map(e => ({ ...e, act: 'act_13' })), prices);
  return { harvests: rows.length, units, activeMs, perHour: activeMs ? units * 3_600_000 / activeMs : null, ...valuation };
}
