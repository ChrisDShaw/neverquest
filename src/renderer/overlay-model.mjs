import { dayKey, summarize } from './model.mjs';
import { scopeEvents, valueLoot, itemKey } from './analysis.mjs';
import { huntSummary } from './hunts.mjs';

export function overlayScope(snapshot, kind = 'session') {
  const session = snapshot.sessions.find(s => s.endedAt === null) ?? snapshot.sessions.find(s => s.kind === 'automatic' && s.active)
    ?? (kind === 'session' ? snapshot.sessions.at(-1) : null);
  const day = snapshot.events[0] ? dayKey(snapshot.events[0].at) : '';
  return { events: scopeEvents(snapshot.events, session ? { session } : { day }),
    caption: session ? `${session.endedAt === null || session.active ? '' : 'Finished · '}${session.name}` : 'Latest recorded day', session };
}
export function overlayRows(height, rowHeight) {
  return Math.max(1, Math.min(12, Math.floor((height - 63) / rowHeight)));
}
export function overlayView(snapshot, kind, height) {
  if (kind === 'hunt') {
    const hunts = snapshot.sessions.filter(s => s.kind !== 'automatic');
    const hunt = hunts.find(s => s.endedAt === null)
      ?? [...hunts].sort((a, b) => b.endedAt - a.endedAt || b.startedAt - a.startedAt)[0] ?? null;
    const summary = hunt ? huntSummary(hunt, snapshot.events, snapshot.prices, snapshot.character) : null;
    const entries = summary ? [...summary.players.map(player => ({ type: 'member', ...player })),
      ...summary.payments.map(payment => ({ type: 'payment', ...payment }))] : [];
    return { hunt, huntSummary: summary, entries, capacity: Math.max(1, Math.min(24, Math.floor((height - 210) / 34))),
      caption: hunt ? `${summary.running ? 'Live' : 'Finished'} · ${hunt.name}` : 'No hunt yet' };
  }
  const scope = overlayScope(snapshot, kind), summary = summarize(scope.events), value = valueLoot(scope.events, snapshot.prices);
  const capacity = overlayRows(height, kind === 'timers' ? 46 : 39);
  const loot = scope.events.filter(e => ['act_13', 'act_14'].includes(e.act));
  const timers = [...snapshot.timers].sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
  return { ...scope, summary, value, capacity, loot: loot.slice(0, capacity), lootCount: loot.length,
    timers: timers.slice(0, capacity), timerCount: timers.length,
    wanted: new Set(snapshot.goals.filter(g => !g.progress.completed).map(g => itemKey(g.item))) };
}

// Compare displayed content, not collection revisions or polling timestamps.
// Stable snapshots must keep the same DOM nodes and native hit-test regions.
export function overlayContentKey(snapshot, kind, view) {
  const source = [snapshot.sourceId, snapshot.demo, kind, view.caption];
  if (kind === 'hunt') return JSON.stringify([...source, view.hunt?.id, view.capacity, view.huntSummary]);
  if (kind === 'session') return JSON.stringify([...source, view.summary.items, view.value.value, view.value.unpriced,
    view.summary.purses, view.summary.unknownPurses, view.summary.vendorNet, view.summary.unknownVendors]);
  if (kind === 'timers') return JSON.stringify([...source, view.capacity, view.timerCount,
    view.timers.map(t => [t.id, t.name, t.expiresAt, t.seconds])]);
  return JSON.stringify([...source, view.capacity, view.lootCount,
    view.loot.map(e => [e.identity, e.at, e.actor, e.act, e.item, e.quantity, e.copper, view.wanted.has(itemKey(e.item))])]);
}
