import { formatMoney } from './model.mjs';
import { itemKey } from './analysis.mjs';
import { marketGroups, itemMarket, readMarket } from './market-data.mjs';


export function renderMarket(wb) {
  const panel = wb.panel('Player market', 'See player buying and selling listings from MnMdb, updated roughly every six hours. Prices show what players ask or offer; they don’t confirm completed sales. Your ledger stays on your PC.');
  wb.marketFilters ??= { side: 'sell', search: '', server: '', limit: 30 };
  const filters = wb.marketFilters, actions = wb.e('div', 'button-row');
  const refresh = wb.button('Refresh listings', () => fetchFeed(true)); actions.append(refresh);
  actions.append(wb.button('Open mnm-db.com', () => wb.call(() => wb.api.openMarket()).then(v => { if (v) wb.message(v); })));
  panel.append(actions);
  const status = wb.e('p', 'help'), controls = wb.e('div', 'market-controls'), tabs = wb.e('div', 'button-row');
  const search = wb.e('input'); search.type = 'search'; search.placeholder = 'Find an item or player…'; search.value = filters.search; search.setAttribute('aria-label', 'Search public listings');
  const server = wb.e('select'); server.setAttribute('aria-label', 'Market server');
  for (const [side, title] of [['sell', 'Selling'], ['buy', 'Buying'], ['yours', 'Your recorded loot']]) tabs.append(wb.button(title, () => {
    filters.side = side; filters.limit = 30; update();
  }));
  controls.append(tabs, search, server); panel.append(status, controls);
  const results = wb.e('div', 'market-results'); panel.append(results);
  search.oninput = () => { filters.search = search.value; filters.limit = 30; update(); };
  server.onchange = () => { filters.server = server.value; filters.limit = 30; update(); };
  wb.marketUpdate = update;
  const details = group => showMarketListings(wb, group.item, filters.server);
  function update() {
    if (!panel.isConnected) return;
    const state = wb.marketState, feed = state?.feed;
    refresh.disabled = Boolean(wb.marketLoading) || Boolean(state?.nextManualAt && Date.now() < state.nextManualAt);
    refresh.title = state?.nextManualAt ? `You can refresh again at: ${new Date(state.nextManualAt).toLocaleString()}` : '';
    if (!feed) { status.textContent = wb.marketLoading ? 'Loading player listings…' : state?.error || 'Player listings aren’t available yet. Try refreshing.'; return; }
    const previous = filters.server || feed.servers.find(s => s.toLowerCase() === wb.s.server.toLowerCase()) || feed.servers[0];
    server.replaceChildren(...feed.servers.map(s => { const o = wb.e('option', '', s); o.value = s; return o; }));
    server.value = previous; filters.server = previous;
    const sameServer = filters.server?.toLowerCase() === wb.s.server.toLowerCase();
    status.textContent = `Listings saved ${feed.generatedAt ? new Date(feed.generatedAt).toLocaleString() : 'time unknown'} · ${feed.listings.length.toLocaleString()} listings · servers: ${feed.servers.join(', ')}${!sameServer ? ` · your character is on ${wb.s.server}` : ''}${state.error ? ' · cached data: ' + state.error : ''}${feed.capture.blindNowMin ? ` · Market source hasn’t captured updates for ${feed.capture.blindNowMin} minutes` : ''}`;
    [...tabs.children].forEach((b, i) => b.classList.toggle('selected', ['sell', 'buy', 'yours'][i] === filters.side));
    results.replaceChildren();
    const book = marketGroups(feed, filters.server), term = itemKey(filters.search);
    if (filters.side === 'yours') {
      results.append(wb.e('p', 'help', 'Items you looted during the selected session or dates. Quantities count recorded loot and may differ from your current inventory. Estimates use the median seller price per item: the middle price, or the average of the two middle prices. They don’t guarantee what you’ll receive.'));
      const owned = new Map();
      for (const event of wb.getPeriod().filter(e => !e.social && e.act === 'act_13')) {
        const entry = owned.get(itemKey(event.item)) ?? { item: event.item, quantity: 0 }; entry.quantity += event.quantity; owned.set(itemKey(event.item), entry);
      }
      let total = 0, unpriced = 0;
      const cards = wb.e('div', 'task-grid');
      for (const item of [...owned.values()].filter(i => itemKey(i.item).includes(term))) {
        const quote = sameServer ? book.find(g => g.key === itemKey(item.item)) : null;
        const value = quote?.median === null || quote?.median === undefined ? null : quote.median * item.quantity;
        if (value === null) unpriced += item.quantity; else total += value;
        const card = wb.e('article', 'task-card'); card.append(wb.e('h3', '', `${item.quantity} × ${item.item}`),
          wb.e('p', '', value === null ? sameServer ? 'No seller price available' : 'Prices aren’t compared across servers' : `Estimated value at seller asking prices: ${formatMoney(value)}`));
        const vendor = wb.s.prices.find(p => p.key === itemKey(item.item));
        card.append(wb.e('p', 'help', `Estimated vendor value: ${vendor ? formatMoney(vendor.unit * item.quantity) : 'Unpriced'}`));
        if (quote) card.append(wb.button('See sellers and buyers', () => details(quote))); else card.append(wb.button('Item details', () => wb.itemDetails(item.item)));
        cards.append(card);
      }
      results.append(wb.e('p', 'item-price', `Estimated total at seller asking prices: ${formatMoney(total)}${unpriced ? ` + ${unpriced} unpriced items` : ''}`), cards);
      if (!owned.size) results.append(wb.e('p', 'empty', 'No loot recorded for your character in this session or these dates. Try another session or date.'));
      return;
    }
    const entries = book.filter(g => g[filters.side].length && (itemKey(g.item).includes(term)
      || [...g.sell, ...g.buy].some(l => itemKey(l.player).includes(term)))).sort((a, b) => b[filters.side].length - a[filters.side].length || a.item.localeCompare(b.item));
    const cards = wb.e('div', 'task-grid');
    for (const group of entries.slice(0, filters.limit)) {
      const card = wb.e('article', 'task-card'); card.append(wb.e('h3', '', group.item),
        wb.e('p', 'item-price', filters.side === 'sell' ? `Median seller price: ${formatMoney(group.median)} / item` : `Highest buyer offer: ${formatMoney(group.bid)} / item`),
        wb.e('p', 'help', `${group.sell.length} sellers · ${group.buy.length} buyers`), wb.button('Prices & listings', () => details(group))); cards.append(card);
    }
    results.append(cards);
    if (!entries.length) results.append(wb.e('p', 'empty', 'No matching listings. Try another search or server.'));
    if (entries.length > filters.limit) results.append(wb.button(`Show more (${entries.length} matching items)`, () => { filters.limit += 30; update(); }));
    if (filters.side === 'buy') {
      const requests = feed.requests.filter(r => r.server === filters.server && itemKey(r.text + ' ' + r.player).includes(term));
      if (requests.length) {
        const extra = wb.e('details'); extra.append(wb.e('summary', '', `General gear requests (${requests.length})`));
        for (const request of requests.slice(0, 50)) extra.append(wb.e('p', 'help', `${request.player}: ${request.text}`)); results.append(extra);
      }
    }
  }
  async function fetchFeed(manual) { await readMarket(wb, manual); update(); }

  update();
  if (!wb.marketState || Date.now() - (wb.lastMarketRead ?? 0) > 60_000) fetchFeed(false);
}

export function showMarketListings(wb, item, server) {
    wb.drawer(item, () => {
      const group = itemMarket(wb.marketState, item, server).quote;
      if (!group) { const empty = wb.panel('Player listings', 'No matching listings on this server.'); empty.append(wb.button('Back to item', () => wb.itemDetails(item))); return; }
      const detail = wb.panel(group.item, `${server} · player asking prices · amounts below are per item where known.`);
      detail.append(wb.e('p', 'item-price', `Median seller price ${formatMoney(group.median)} · range ${formatMoney(group.low)}–${formatMoney(group.high)} · highest buyer offer ${formatMoney(group.bid)}`));
      detail.append(wb.e('p', 'help', 'Listings saved: ' + (wb.marketState?.feed?.generatedAt ? new Date(wb.marketState.feed.generatedAt).toLocaleString() : 'time unknown') + ' · updated roughly every six hours' + (wb.marketState?.error ? ' · cached data: ' + wb.marketState.error : '')));
      const buttons = wb.e('div', 'button-row');
      buttons.append(wb.button('Open item wiki ↗', () => wb.call(() => wb.api.openItemWiki(group.item))),
        wb.button('Item uses & your notes', () => wb.itemDetails(group.item)),
        wb.button('Open auction page', () => wb.call(() => wb.api.openMarket(group.item))),
        wb.button('Copy price check', async () => { const text = await wb.call(() => wb.api.copyMarket(group.item, server)); if (text) wb.message(text); })); detail.append(buttons);
      wb.table(detail, ['Player', 'Buying or selling', 'Listed amount', 'Per item', 'First recorded'], [...group.sell, ...group.buy].map(l =>
        [l.player, l.intent === 'sell' ? 'Selling' : 'Buying', `${formatMoney(l.price)}${l.perStack ? ` / stack${l.stack ? ' of ' + l.stack : ''}` : l.qty ? ' / ' + l.qty + ' items' : ''}${l.assumed ? ' (automatically read; amount may be incorrect)' : ''}`,
          formatMoney(l.unit), l.firstSeen ? new Date(l.firstSeen).toLocaleString() : 'Unknown']).slice(0, 100));
      detail.append(wb.e('p', 'help', 'First recorded shows when the source first captured the listing. The item may no longer be available. Listings are read automatically from images, so details may be missing or incorrect. The median is the middle seller price, or the average of the two middle prices.'));
      const history = (wb.marketState?.history ?? []).flatMap(h => (h.servers[server] ?? []).filter(i => i.key === group.key)
        .map(i => [new Date(h.generatedAt).toLocaleString(), formatMoney(i.median), formatMoney(i.bid), i.sellers]));
      if (history.length) { const past = wb.panel('Price history saved on this PC'); wb.table(past, ['Saved at', 'Median seller price/item', 'Highest buyer offer/item', 'Sellers'], history.reverse()); }
    });
  }
