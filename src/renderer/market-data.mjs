import { itemKey } from './analysis.mjs';

export function marketGroups(feed, server) {
  const items = new Map(), realm = itemKey(server);
  for (const row of feed?.listings ?? []) {
    if (itemKey(row.server) !== realm || !row.matched || !['sell', 'buy'].includes(row.intent)) continue;
    const key = itemKey(row.item), group = items.get(key) ?? { item: row.item, key, sell: [], buy: [] };
    group[row.intent].push(row); items.set(key, group);
  }
  return [...items.values()].map(g => {
    const values = g.sell.map(l => l.unit).filter(n => n !== null).sort((a, b) => a - b), mid = Math.floor(values.length / 2);
    return { ...g, median: values.length ? values.length % 2 ? values[mid] : Math.floor((values[mid - 1] + values[mid]) / 2) : null,
      low: values[0] ?? null, high: values.at(-1) ?? null, bid: g.buy.reduce((best, l) => l.unit === null ? best : Math.max(best ?? 0, l.unit), null) };
  });
}

export function itemMarket(state, item, server) {
  const feed = state?.feed;
  return { quote: marketGroups(feed, server).find(g => g.key === itemKey(item)) ?? null,
    covered: Boolean(feed?.servers.some(s => itemKey(s) === itemKey(server))), generatedAt: feed?.generatedAt ?? null,
    error: state?.error ?? '', available: Boolean(feed), servers: feed?.servers ?? [] };
}

export function snapshotAge(at, now = Date.now()) {
  if (!Number.isFinite(at)) return 'age unknown';
  if (at > now) return 'timestamp is in the future';
  const minutes = Math.floor((now - at) / 60000);
  return minutes < 60 ? `${minutes} min old` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min old`;
}

// Share one full public feed request between Market and item drawers. Item/server
// filters are applied locally; they never become provider query parameters.
export function readMarket(wb, manual = false) {
  if (wb.marketPromise) return wb.marketPromise;
  if (!manual && wb.marketState && Date.now() - (wb.lastMarketRead ?? 0) < 60000) return Promise.resolve();
  wb.marketLoading = true; wb.lastMarketRead = Date.now();
  wb.marketPromise = (async () => {
    try { const result = await wb.api.getMarket(manual); if (!result.ok) throw new Error(result.error); wb.marketState = result.value; }
    catch (error) { wb.marketState = { ...wb.marketState, error: error.message }; }
    finally { wb.marketLoading = false; wb.marketPromise = null; wb.marketUpdate?.(); wb.itemMarketUpdate?.(); }
  })();
  wb.marketUpdate?.(); wb.itemMarketUpdate?.();
  return wb.marketPromise;
}
