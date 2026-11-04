import { itemKey, scopeEvents } from './analysis.mjs';

// Keep the saved session format and IDs: older named runs are solo hunts until edited.
export function huntMembers(hunt, character) {
  return hunt.members?.length ? hunt.members : [character];
}

export function validateMembers(members, character) {
  if (!Array.isArray(members) || members.length > 24) throw new Error('Enter up to 24 hunt members, one name per line.');
  const unique = new Map();
  for (const value of [character, ...members]) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 60 || /[\p{C}|,]/u.test(value))
      throw new Error('Use player names of 1–60 characters without commas, bars or control characters.');
    const name = value.trim();
    if (!unique.has(itemKey(name))) unique.set(itemKey(name), name);
  }
  if (unique.size > 24) throw new Error('A hunt can have up to 24 members.');
  return [...unique.values()];
}

const add = (a, b) => {
  const sum = a + b;
  if (!Number.isSafeInteger(sum) || sum < 0) throw new Error('Hunt value is too large to calculate safely.');
  return sum;
};

export function huntSummary(hunt, events, prices, character) {
  const members = huntMembers(hunt, character);
  const players = members.map(name => ({ name, value: 0, count: 0, unpriced: 0 }));
  const byName = new Map(players.map(p => [itemKey(p.name), p]));
  const book = new Map(prices.map(p => [p.key, p.unit]));
  const items = new Map();
  let coin = 0, unknownCoin = 0, ignored = 0, excluded = 0;
  for (const e of scopeEvents(events, { session: hunt })) {
    const player = byName.get(itemKey(e.actor));
    if (e.act === 'act_14' && player) {
      if (e.copper === null) unknownCoin++; else coin = add(coin, e.copper);
    }
    if (e.act !== 'act_13') continue;
    if (!player) { ignored += e.quantity; continue; }
    const key = itemKey(e.item);
    const override = Object.hasOwn(hunt.itemValues ?? {}, key);
    const unit = override ? hunt.itemValues[key] : book.get(key);
    const item = items.get(key) ?? { key, name: e.item, quantity: 0, unit, override };
    item.quantity = add(item.quantity, e.quantity); items.set(key, item);
    player.count = add(player.count, e.quantity);
    if (unit === null) excluded = add(excluded, e.quantity);
    else if (unit === undefined) player.unpriced = add(player.unpriced, e.quantity);
    else player.value = add(player.value, unit * e.quantity);
  }
  const total = players.reduce((n, p) => add(n, p.value), 0);
  const unpriced = players.reduce((n, p) => add(n, p.unpriced), 0);
  const baseShare = Math.floor(total / players.length), remainder = total % players.length;
  // Whole copper only. Alphabetical names break ties for the remainder, consistently.
  const extra = new Set([...players].sort((a, b) => itemKey(a.name).localeCompare(itemKey(b.name), 'en'))
    .slice(0, remainder).map(p => p.name));
  for (const p of players) {
    p.share = baseShare + Number(extra.has(p.name));
    p.balance = p.value - p.share;
  }
  const payments = [];
  if (!unpriced) {
    const payers = players.filter(p => p.balance > 0).map(p => ({ ...p, amount: p.balance })).sort((a, b) => b.amount - a.amount);
    const receivers = players.filter(p => p.balance < 0).map(p => ({ ...p, amount: -p.balance })).sort((a, b) => b.amount - a.amount);
    let i = 0, j = 0;
    while (i < payers.length && j < receivers.length) {
      const amount = Math.min(payers[i].amount, receivers[j].amount);
      payments.push({ from: payers[i].name, to: receivers[j].name, amount });
      payers[i].amount -= amount; receivers[j].amount -= amount;
      if (!payers[i].amount) i++;
      if (!receivers[j].amount) j++;
    }
  }
  return { players, items: [...items.values()].sort((a, b) => a.name.localeCompare(b.name)),
    total, coin, unknownCoin, combined: add(total, coin), unpriced, ignored, excluded, baseShare, remainder, payments,
    running: hunt.endedAt === null };
}

export function shortMoney(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Enter a non-negative whole copper value.');
  if (!value) return '0';
  return [[1_000_000, 'p'], [10_000, 'g'], [100, 's'], [1, 'c']].flatMap(([scale, suffix]) => {
    const amount = Math.floor(value / scale); value %= scale;
    return amount ? [`${amount}${suffix}`] : [];
  }).join(' ');
}

export function huntCopyLabel(summary) {
  return summary.running ? 'Copy running summary' : summary.unpriced ? 'Copy loot summary'
    : summary.players.length > 1 ? 'Copy settlement' : 'Copy hunt summary';
}

// Return copyable game-chat messages, never silently truncate a name or payment.
export function huntMessages(summary, limit = 240) {
  const share = summary.unpriced ? 'split pending prices' : summary.remainder ? `${shortMoney(summary.baseShare)} each + ${summary.remainder}c remainder`
    : `${shortMoney(summary.baseShare)} each`;
  const heading = `${summary.running ? 'Loot so far' : 'Loot value'} ${shortMoney(summary.total)}${summary.unpriced ? ` + ${summary.unpriced} unpriced` : ''} (${share})${summary.excluded ? `, ${summary.excluded} items excluded` : ''}`;
  const players = summary.players.map(p => `${p.name} ${shortMoney(p.value)}${p.unpriced ? ` + ${p.unpriced} unpriced` : ''}`);
  const payLabel = summary.running ? 'Pay so far' : 'Pay';
  const payments = summary.players.length > 1 && !summary.unpriced ? summary.payments.map(p => `${p.from} to ${p.to} ${shortMoney(p.amount)}`) : [];
  const settled = summary.players.length > 1 && !summary.unpriced && !payments.length ? `${payLabel}: settled` : null;
  const parts = [heading, ...players, ...payments.map(p => `${payLabel}: ${p}`), ...(settled ? [settled] : [])];
  const compact = [heading, players.join(', '), ...(payments.length ? [`${payLabel}: ${payments.join(', ')}`] : []), ...(settled ? [settled] : [])].join(' | ');
  if (compact.length <= limit) return [compact];
  const pack = size => {
    const messages = []; let current = '';
    for (const part of parts) {
      if (part.length > size) throw new Error('A player name or value is too long for game chat.');
      if (current && current.length + 3 + part.length > size) { messages.push(current); current = ''; }
      current += `${current ? ' | ' : ''}${part}`;
    }
    if (current) messages.push(current);
    return messages;
  };
  let messages = pack(limit);
  if (messages.length === 1) return messages;
  // Reserve the actual page prefix, including when there are more than nine pages.
  let digits = String(messages.length).length;
  for (;;) {
    messages = pack(limit - (2 * digits + 4));
    if (String(messages.length).length <= digits) break;
    digits = String(messages.length).length;
  }
  return messages.map((message, i) => `(${i + 1}/${messages.length}) ${message}`);
}
