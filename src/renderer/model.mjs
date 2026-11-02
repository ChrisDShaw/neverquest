export function formatMoney(copper) {
  if (copper === null || copper === undefined) return 'Unknown';
  if (!Number.isSafeInteger(copper)) return 'Out of range';
  if (copper < 0) return `−${formatMoney(-copper)}`;
  if (!copper) return '0 cp';
  return [[1_000_000, 'pp'], [10_000, 'gp'], [100, 'sp'], [1, 'cp']].flatMap(([scale, unit]) => {
    const value = Math.floor(copper / scale);
    copper %= scale;
    return value ? [`${value.toLocaleString()} ${unit}`] : [];
  }).join(' ');
}

export function category(act) {
  if (['act_13', 'act_14'].includes(act)) return 'Loot';
  if (['act_24', 'act_28'].includes(act)) return 'Vendors';
  if (['act_31', 'act_32', 'act_33', 'act_34', 'act_35', 'act_36'].includes(act)) return 'Party';
  if (act === 'act_27') return 'Harvest';
  if (['act_16', 'act_20'].includes(act)) return 'Trade';
  if (['act_11', 'act_12', 'act_15'].includes(act)) return 'Items';
  if (act === 'act_01') return 'Progression';
  return 'Other';
}

export function describe(event) {
  const item = `${event.quantity} × ${event.item || 'unnamed item'}`;
  switch (event.act) {
    case 'act_13': return `Looted ${item}`;
    case 'act_14': return `Looted ${formatMoney(event.copper)}${event.split ? ' · shared coin drop' : ' · coin drop'}`;
    case 'act_24': return `Sold ${item} for ${formatMoney(event.copper)}`;
    case 'act_28': return `Bought ${item} for ${formatMoney(event.copper)}`;
    case 'act_27': return `Gathered ${item}`;
    case 'act_31': return 'Created a party';
    case 'act_32': return 'Joined a party';
    case 'act_33': return 'Party disbanded';
    case 'act_34': return 'Left a party';
    case 'act_35': return 'Party leader changed';
    case 'act_36': return 'Party invite received';
    case 'act_01': return event.newLevel ? `Reached level ${event.newLevel}${event.oldLevel ? ` (from ${event.oldLevel})` : ''}` : 'Levelled up';
    case 'act_02': return 'Died';
    case 'act_11': return `Dropped ${item}`;
    case 'act_12': return `Picked up ${item}`;
    case 'act_15': return `Destroyed ${item}`;
    case 'act_16': case 'act_20': {
      const items = (event.tradeItems ?? []).map(i => `${i.quantity} × ${i.item}`).join(', ');
      return `${event.act === 'act_16' ? 'Gave' : 'Received'} ${[formatMoney(event.copper), items].filter(Boolean).join(' + ')} · Trader ${event.partner || 'unknown'}`;
    }
    default: return `Ledger event ${event.act}`;
  }
}

export function dayKey(at) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function filterEvents(events, { day = '', type = 'All', search = '' } = {}) {
  const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return events.filter(e => (!day || dayKey(e.at) === day) && (type === 'All' || category(e.act) === type)
    && terms.every(term => `${e.actor} ${e.item} ${e.creature} ${e.zone} ${describe(e)}`.toLowerCase().includes(term)));
}

export function summarize(events) {
  const loots = events.filter(e => e.act === 'act_13');
  const purses = events.filter(e => e.act === 'act_14');
  const sales = events.filter(e => !e.social && e.act === 'act_24');
  const purchases = events.filter(e => !e.social && e.act === 'act_28');
  const sum = rows => rows.reduce((total, e) => total + (e.copper ?? 0), 0);
  const participants = new Map();
  for (const e of loots) {
    const key = e.actor.toLowerCase();
    const entry = participants.get(key) ?? { name: e.actor || 'Unknown', items: 0 };
    entry.items += e.quantity;
    participants.set(key, entry);
  }
  const items = new Map();
  for (const e of loots) {
    const key = e.item.toLowerCase();
    const entry = items.get(key) ?? { name: e.item || 'Unnamed item', quantity: 0, players: new Set() };
    entry.quantity += e.quantity;
    entry.players.add(e.actor);
    items.set(key, entry);
  }
  return {
    items: loots.reduce((sum, e) => sum + e.quantity, 0), itemKinds: items.size,
    purses: sum(purses), unknownPurses: purses.filter(e => e.copper === null).length,
    vendorNet: sum(sales) - sum(purchases), sales: sum(sales), purchases: sum(purchases),
    unknownVendors: [...sales, ...purchases].filter(e => e.copper === null).length,
    players: [...participants.values()].sort((a, b) => b.items - a.items || a.name.localeCompare(b.name)),
    itemRows: [...items.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))
  };
}
