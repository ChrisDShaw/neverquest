import { describe, formatMoney } from './model.mjs';
import { itemKey, valueLoot, scopeEvents, creatureRecords, compareSessions } from './analysis.mjs';
import { atlasUrl } from './maps.mjs';
import { itemMarket, readMarket, snapshotAge } from './market-data.mjs';
import { showMarketListings } from './market-view.mjs';
import { splitPoint } from './sessions.mjs';

const $ = id => document.getElementById(id);
const stamp = at => at === null ? 'Still running' : new Date(at).toLocaleString();
const localTime = (at = Date.now()) => new Date(at - new Date(at).getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export const flows = {
  overlayPicker() {
    this.drawer('Overlays', () => {
      const panel = this.panel('Keep the essentials in view', 'Keep loot, totals, timers or a map visible while you play. Drag the handle to move an overlay. Use its controls to pin it, change the background or close it.');
      panel.append(this.e('p', 'help', 'Use the game in windowed mode for reliable overlay interaction. You can also try borderless mode. Full-screen mode can cover overlays when you click or hover over them.'));
      const buttons = this.e('div', 'button-row');
      for (const [kind, title] of [['loot', 'Recent loot'], ['session', 'Session totals'], ['timers', 'Timers'], ['map', 'Zone map']])
        buttons.append(this.button(title, async () => {
          const result = await this.call(() => this.api.openPanel(kind)); if (result) this.detailDialog.close();
        }));
      panel.append(buttons, this.e('p', 'help', 'Map downloads start off. Enable them in the map overlay to save community maps from MnMdb on this PC. Your pins stay private.'));
    });
  },
  startAdventure() {
    this.drawer('Start named run', () => {
      const panel = this.panel('Give your run a name', 'Start now, or choose an earlier time if you have already been playing.');
      this.form(panel, [{ name: 'name', label: 'Run name', required: true },
        { name: 'start', label: 'Started at', type: 'datetime-local', value: localTime(), required: true }], 'Start run', async v => {
        const next = await this.act('session:start', { name: v.name, startedAt: new Date(v.start).getTime() });
        if (next) this.detailDialog.close();
      });
    });
  },
  history() {
    const panel = this.panel('Sessions & named runs', 'Neverquest groups saved activity into sessions, including older records. A gap between activities starts a new session. You can also start and end a named run yourself.');
    const sources = this.s.savedSources ?? [];
    if (sources.length > 1 || (this.s.demo && sources.length)) this.form(panel,
      [{ name: 'source', label: 'Saved character', options: sources.map(s => [s.id, `${s.character} · ${s.server}`]), value: this.s.sourceId }],
      'Open character', async v => {
        const next = await this.call(() => this.api.selectHistory(v.source));
        if (next) this.accept(next);
      });
    if (!this.s.sessions.length) panel.append(this.e('p', 'help', 'No sessions yet. They’ll appear automatically when the game records activity.'));
    const automatic = this.s.sessions.filter(s => s.kind === 'automatic');
    const edits = this.s.preferences.sessionEdits?.[this.s.sourceId];
    if (edits?.splits?.length || edits?.merges?.length) panel.append(this.button('Restore automatic grouping', async () => {
      if (await this.act('session:reset')) this.drawer('Session history', () => this.history());
    }));
    for (const session of [...this.s.sessions].reverse()) {
      const events = scopeEvents(this.s.events, { session }), valuation = valueLoot(events, this.s.prices);
      const card = this.e('article', 'task-card');
      card.append(this.e('h3', '', session.name), this.e('p', 'help', `${session.kind === 'automatic' ? 'Automatic ledger session · ' : 'Named run · '}${stamp(session.startedAt)} · ${stamp(session.endedAt)}`),
        this.e('p', '', `${events.filter(e => e.act === 'act_13').reduce((n, e) => n + e.quantity, 0)} items · ${formatMoney(valuation.value)} estimated vendor value${valuation.unpriced ? ` · ${valuation.unpriced} unpriced` : ''}`));
      const actions = this.e('div', 'button-row');
      actions.append(this.button('Revisit', () => {
        $('day-select').value = ''; $('session-select').value = session.id; $('session-select').dispatchEvent(new Event('change'));
        document.querySelector('[data-view="All"]').click(); this.detailDialog.close();
      }), this.button('Rename', () => this.drawer(session.kind === 'automatic' ? 'Rename session' : 'Rename run', () => {
        const rename = this.panel(session.kind === 'automatic' ? 'Session name' : 'Run name');
        this.form(rename, [{ name: 'name', label: 'Name', value: session.name, required: true }], 'Save name', async v => {
          const next = await this.act('session:rename', { id: session.id, name: v.name }); if (next) this.detailDialog.close();
        });
      })));
      if (session.kind === 'automatic') {
        const previous = automatic[automatic.findIndex(s => s.id === session.id) - 1];
        if (previous) actions.append(this.button('Merge with previous…', () => this.sessionMerge(previous, session)));
        if (session.lastActivityAt > session.startedAt) actions.append(this.button('Split session…', () => this.sessionSplit(session)));
      }
      card.append(actions); panel.append(card);
    }
    if (this.s.sessions.length >= 2) {
      const comparison = this.panel('Compare sessions or runs');
      const options = this.s.sessions.map(s => [s.id, s.name]);
      this.form(comparison, [{ name: 'a', label: 'First session or run', options },
        { name: 'b', label: 'Second session or run', options, value: options[1][0] }], 'Compare', v => {
        comparison.querySelector('.comparison-result')?.remove(); const result = this.e('div', 'comparison-result comparison-cards');
        for (const run of compareSessions(this.s.events, [v.a, v.b].map(id => this.s.sessions.find(s => s.id === id)), this.s.prices)) {
          const card = this.e('article', 'task-card');
          card.append(this.e('h3', '', run.name), this.e('p', '', `Item value: ${formatMoney(run.value)}${run.unpriced ? ` + ${run.unpriced} unpriced` : ''}`),
            this.e('p', '', `Net vendor earnings: ${formatMoney(run.vendorNet)}${run.unknownVendors ? ' · incomplete' : ''}`), this.e('p', '', `Gathered: ${run.gathered} items`)); result.append(card);
        }
        result.append(this.e('p', 'help', 'Both selections use the current estimates from saved vendor sales.')); comparison.append(result);
      });
    }
  },
  sessionMerge(left, right) {
    this.drawer('Merge sessions', () => {
      const panel = this.panel('Combine these sessions', 'Combine the activity into one session using the earlier name. Ledger records and named runs stay unchanged.');
      panel.append(this.e('p', '', `${left.name} · ${stamp(left.startedAt)} → ${right.name} · ${stamp(right.startedAt)}`));
      panel.append(this.button('Merge these sessions', async () => {
        if (await this.act('session:merge', { id: left.id, nextId: right.id })) this.drawer('Session history', () => this.history());
      }, 'primary'));
    });
  },
  sessionSplit(session) {
    this.drawer('Split session', () => {
      const current = this.s.sessions.find(s => s.id === session.id && s.kind === 'automatic');
      if (!current) { this.panel('This session changed', 'Reopen session history and choose a current session.'); return; }
      const events = scopeEvents(this.s.events, { session: current }).sort((a, b) => a.at - b.at);
      const times = [...new Set(events.map(e => e.at))]; let suggested = times[1], gap = -1;
      for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] > gap) { gap = times[i] - times[i - 1]; suggested = times[i]; }
      if (suggested === undefined) { this.panel('Nothing to split', 'All records have the same timestamp.'); return; }
      const toInput = at => new Date(at - new Date(at).getTimezoneOffset() * 60000).toISOString().slice(0, 23);
      const panel = this.panel(current.name, 'Choose when the second session begins. The first record at or after that time starts the new session; records with the same timestamp stay together. The largest recorded pause is suggested.');
      const form = this.form(panel, [{ name: 'at', label: 'Second session starts at (local time)', type: 'datetime-local', step: 0.001,
        value: toInput(suggested), min: toInput(times[0]), max: toInput(times.at(-1)), required: true }], 'Split this session', async v => {
        const at = splitPoint(events, new Date(v.at).getTime());
        if (at === null) { this.message('Choose a time after the first record and before the last record.'); return; }
        if (await this.act('session:split', { id: current.id, at })) this.drawer('Session history', () => this.history());
      });
      const preview = this.e('p', 'help'); panel.append(preview);
      const input = form.elements.namedItem('at');
      const update = () => {
        const at = splitPoint(events, new Date(input.value).getTime());
        const before = at === null ? 0 : events.filter(e => e.at < at).length;
        preview.textContent = at === null ? 'Choose a time with recorded activity before and after it.'
          : `${before} records in the first session · ${events.length - before} in the second · first new record ${stamp(at)}. No ledger records are changed.`;
      };
      input.addEventListener('input', update); update();
    });
  },
  goals() {
    const panel = this.panel('What are you looking for?', 'Keep a short list of things you want. Progress counts items collected since you created this goal. Adjust progress for items already owned or used.');
    panel.append(this.button('Add a goal', () => this.goalEditor(), 'primary'));
    if (!this.s.goals.length) panel.append(this.e('p', 'empty', 'Looking for crafting materials or a quest item? Add its name and how many you need. You can also choose a find from your adventure feed.'));
    const grid = this.e('div', 'task-grid');
    for (const goal of [...this.s.goals].sort((a, b) => Number(a.progress.completed) - Number(b.progress.completed))) {
      const card = this.e('article', `task-card${goal.progress.completed ? ' reached' : ''}`);
      card.append(this.e('h3', '', `${goal.wishlist ? '☆ ' : ''}${goal.item}`),
        this.e('p', 'goal-progress', `${goal.progress.current} / ${goal.target}${goal.progress.completed ? ' · reached' : ''}`));
      const reference = this.s.knowledge.find(k => itemKey(k.item) === itemKey(goal.item));
      if (reference?.quests) card.append(this.e('p', 'help', reference.quests));
      const places = [...new Set(this.s.events.filter(e => e.act === 'act_13' && itemKey(e.item) === itemKey(goal.item)).map(e => e.zone))];
      card.append(this.e('p', 'help', places.length ? `Previously found in ${places.join(', ')}.` : 'No drop location saved for this item yet.'));
      const actions = this.e('div', 'button-row');
      actions.append(this.button('Item details', () => this.itemDetails(goal.item)),
        this.button('Adjust progress', () => this.goalEditor(goal.item, goal)),
        this.button(goal.completed ? 'Reopen' : 'Mark complete', () => this.act('goal:save', { ...goal, completed: !goal.completed })));
      card.append(actions); grid.append(card);
    }
    panel.append(grid);
  },
  goalEditor(item = '', goal = {}) {
    this.drawer(goal.id ? 'Adjust your goal' : 'Something to work towards', () => {
      const panel = this.panel(goal.id ? goal.item : 'Add a goal', 'Items you loot, gather, pick up, buy or receive in a trade count towards this goal from now on. Adjust progress for items you already own or have used.');
      this.form(panel, [{ name: 'item', label: 'Item name', required: true, value: goal.item ?? item },
        { name: 'target', label: 'How many do you need?', type: 'number', min: 1, max: 1000000, value: goal.target ?? 1, required: true },
        { name: 'adjustment', label: 'Adjust progress (+ / −)', type: 'number', value: goal.adjustment ?? 0, required: true },
        { name: 'wishlist', label: 'Wishlist', options: [['no', 'Collection goal'], ['yes', 'Wishlist item']], value: goal.wishlist ? 'yes' : 'no' }],
      goal.id ? 'Save goal' : 'Add goal', async v => {
        const next = await this.act('goal:save', { ...v, id: goal.id, target: Number(v.target), adjustment: Number(v.adjustment), wishlist: v.wishlist === 'yes', completed: goal.completed });
        if (next) this.detailDialog.close();
      });
      if (goal.id) panel.append(this.button('Remove goal', async () => { if (await this.act('entry:remove', { collection: 'goals', id: goal.id })) this.detailDialog.close(); }, 'quiet'));
    });
  },
  itemDetails(item) {
    this.drawer(item, () => {
      const price = this.s.prices.find(p => p.key === itemKey(item));
      const reference = this.s.knowledge.find(k => itemKey(k.item) === itemKey(item));
      const decision = this.s.labels.find(l => itemKey(l.item) === itemKey(item));
      const context = this.panel('Keep it, sell it, or save it?');
      if (reference?.quests) context.append(this.e('p', 'help', `Quest uses: ${reference.quests}`));
      if (reference?.recipes) context.append(this.e('p', 'help', `Crafting uses: ${reference.recipes}`));
      if (reference?.notes) context.append(this.e('p', 'help', reference.notes));
      if (!reference) context.append(this.e('p', 'help', 'No quest or crafting notes saved yet. Add what you learn below.'));
      context.append(this.e('p', 'item-price', price ? `${formatMoney(price.unit)} each at a vendor, estimated from ${price.samples} saved sales.` : 'Unpriced — there are no saved vendor sales for this item on this server.'));
      if (price) context.append(this.e('p', 'help', `Saved vendor prices per item: ${formatMoney(price.low)}–${formatMoney(price.high)}. Player asking prices are shown separately below.`));
      const wiki = this.button('Open item wiki ↗', async () => {
        const result = await this.call(() => this.api.openItemWiki(item)); if (result) this.message(result);
      });
      wiki.title = 'Open this item on monstersandmemories.wiki in your browser'; context.append(wiki);
      const matchingGoals = this.s.goals.filter(g => itemKey(g.item) === itemKey(item));
      for (const goal of matchingGoals) context.append(this.e('p', 'goal-progress',
        `Your ${goal.wishlist ? 'wishlist' : 'collection goal'}: ${goal.progress.current} / ${goal.target}${goal.progress.completed ? ' · reached' : ''}`));
      const market = this.e('section', 'item-market'); market.append(this.e('h3', '', `Player market · ${this.s.server}`));
      const marketBody = this.e('div'); market.append(marketBody); context.append(market);
      const sourceId = this.s.sourceId, server = this.s.server;
      const updateMarket = () => {
        if (!market.isConnected || this.getSnapshot().sourceId !== sourceId) return;
        const state = itemMarket(this.marketState, item, server); marketBody.replaceChildren();
        if (!state.available) marketBody.append(this.e('p', 'help', this.marketLoading ? 'Loading player listings…' : state.error || 'Player listings aren’t available yet. Try refreshing.'));
        else {
          marketBody.append(this.e('p', 'help', `Listings saved ${state.generatedAt ? new Date(state.generatedAt).toLocaleString() : 'time unknown'} · ${snapshotAge(state.generatedAt)} · updated roughly every six hours${state.error ? ' · cached data: ' + state.error : ''}`));
          if (!state.covered) marketBody.append(this.e('p', 'help', `No listings are available for ${server}. Servers with listings: ${state.servers.join(', ') || 'none'}.`));
          else if (!state.quote) marketBody.append(this.e('p', 'help', 'No matching sellers or buyers in these saved listings.'));
          else {
            const q = state.quote;
            marketBody.append(this.e('p', 'item-price', `Median seller price ${formatMoney(q.median)} / item · highest buyer offer ${formatMoney(q.bid)} / item`),
              this.e('p', 'help', `Seller price range ${formatMoney(q.low)}–${formatMoney(q.high)} · ${q.sell.length} selling listings · ${q.buy.length} buying listings. The median is the middle seller price, or the average of the two middle prices. Listings don’t confirm completed sales.`),
              this.button('See matching listings', () => showMarketListings(this, item, server)));
          }
        }
        const refresh = this.button('Refresh listings', () => readMarket(this, true));
        refresh.disabled = Boolean(this.marketLoading) || Boolean(this.marketState?.nextManualAt && Date.now() < this.marketState.nextManualAt);
        refresh.title = this.marketState?.nextManualAt ? `You can refresh again at: ${new Date(this.marketState.nextManualAt).toLocaleString()}` : '';
        marketBody.append(refresh);
      };
      this.itemMarketUpdate = updateMarket;
      // The drawer is attached after its builder returns; defer the connected check.
      queueMicrotask(() => { updateMarket(); readMarket(this).then(updateMarket); });
      context.append(this.button('Add collection goal', () => this.goalEditor(item), 'primary'));
      this.form(context, [{ name: 'label', label: 'Your decision', options: [['', 'Undecided'], ['keep', 'Keep'], ['sell', 'Sell'], ['save', 'Save for later']], value: decision?.label ?? '' }],
        'Save decision', v => this.act('label:save', { item, label: v.label }));
      const locations = this.panel('Recorded drop locations', 'From your saved ledger, including nearby players’ recorded loot.');
      const creatures = creatureRecords(this.s.events).filter(c => c.items.some(i => itemKey(i.name) === itemKey(item)));
      if (!creatures.length) locations.append(this.e('p', 'help', 'No creature drops are recorded for this item yet.'));
      for (const creature of creatures) {
        const observed = creature.items.find(i => itemKey(i.name) === itemKey(item));
        const row = this.e('article', 'task-card');
        row.append(this.e('h3', '', `${creature.creature} · ${creature.zone}`), this.e('p', 'help', `${observed.quantity} recorded items · ${creature.visits} estimated loot visits${creature.visits < 20 ? ' · small sample' : ''}`),
          this.button('See recorded creature loot', () => this.creatureDetails(creature.creature, creature.zone)));
        locations.append(row);
      }
      const notes = this.s.notes.filter(n => n.kind === 'item' && itemKey(n.subject) === itemKey(item));
      if (notes.length) { const panel = this.panel('Your notes'); notes.forEach(n => panel.append(this.e('p', 'help', n.body))); }
      locations.append(this.button('Add a personal note', () => this.noteEditor({ kind: 'item', subject: item })));
      const edit = this.e('details', 'reference-editor'); edit.append(this.e('summary', '', 'Edit quest and crafting notes'));
      const inner = this.e('div'); edit.append(inner); context.append(edit);
      this.form(inner, [{ name: 'quests', label: 'Quest uses', type: 'textarea', value: reference?.quests },
        { name: 'recipes', label: 'Crafting uses', type: 'textarea', value: reference?.recipes },
        { name: 'notes', label: 'Other reference notes', type: 'textarea', value: reference?.notes },
        { name: 'source', label: 'Source or reference link', value: reference?.source }], 'Save reference', v => this.act('knowledge:save', { ...v, item }));
      if (reference?.source) context.append(this.e('p', 'help reference-source', `Reference: ${reference.source}`));
    });
  },
  creatureDetails(name, zone) {
    this.drawer(name, () => {
      const creature = creatureRecords(this.s.events).find(c => c.creature === name && c.zone === zone);
      if (!creature) return;
      const panel = this.panel(`${name} · ${zone}`, `${creature.visits} estimated loot visits${creature.visits < 20 ? ' — small sample' : ''}. A loot visit groups records close together in time. It may combine separate visits or count a corpse more than once. It excludes unlooted corpses and items left behind, so it can’t confirm kills or true drop chances.`);
      for (const item of creature.items) {
        const card = this.e('article', 'task-card');
        card.append(this.button(item.name, () => this.itemDetails(item.name)), this.e('p', 'help', `${item.quantity} items across ${item.hits} of ${creature.visits} estimated loot visits.`));
        const details = this.e('details'); details.append(this.e('summary', '', 'How often this item appears in the records'),
          this.e('p', 'help', `${(item.rate * 100).toFixed(1)}% of estimated loot visits; 95% confidence interval ${(item.low * 100).toFixed(1)}–${(item.high * 100).toFixed(1)}%. This describes the recorded visits, not the chance of a drop from a kill. The confidence interval shows statistical uncertainty; it doesn’t account for missing records or grouping errors.`));
        card.append(details); panel.append(card);
      }
      panel.append(this.button('Add a creature note', () => this.noteEditor({ kind: 'creature', subject: `${name} (${zone})` })));
    });
  },
  notebook() {
    const panel = this.panel('Field notes', 'Save useful discoveries and moments from your adventures. Your notes stay here, separate from the game’s journal.');
    panel.append(this.button('Write a note', () => this.noteEditor(), 'primary'));
    const grid = this.e('div', 'task-grid');
    for (const note of this.s.notes) {
      const card = this.e('article', 'task-card'); card.append(this.e('span', 'eyebrow', note.kind), this.e('h3', '', note.subject),
        this.e('p', 'note-body', note.body), this.button('Edit note', () => this.noteEditor(note))); grid.append(card);
    }
    for (const bookmark of this.s.bookmarks) {
      const card = this.e('article', 'task-card'); card.append(this.e('span', 'eyebrow', 'A MOMENT TO REMEMBER'), this.e('h3', '', bookmark.label),
        this.e('p', 'help', `${stamp(bookmark.at)} · ${[bookmark.actor, bookmark.item, bookmark.zone].filter(Boolean).join(' · ')}`)); grid.append(card);
    }
    if (!grid.children.length) panel.append(this.e('p', 'empty', 'Write a note, or use “Save moment” beside an event in your adventure feed.'));
    panel.append(grid);
  },
  noteEditor(note = {}) {
    this.drawer('A note for next time', () => {
      const panel = this.panel(note.subject || 'Write a field note');
      this.form(panel, [{ name: 'kind', label: 'About', options: ['item', 'creature', 'zone', 'session'].map(k => [k, k]), value: note.kind ?? 'item' },
        { name: 'subject', label: 'Subject', required: true, value: note.subject }, { name: 'body', label: 'What do you want to remember?', type: 'textarea', required: true, value: note.body }],
      'Save note', async v => { if (await this.act('note:save', { ...v, id: note.id })) this.detailDialog.close(); });
    });
  },
  bookmark(event) {
    this.drawer('Save this moment', () => {
      const panel = this.panel(describe(event), `${stamp(event.at)} · ${event.actor} · ${event.zone}`);
      this.form(panel, [{ name: 'label', label: 'What made it memorable?', required: true }], 'Save moment', async v => {
        if (await this.act('bookmark:add', { identity: event.identity, label: v.label })) this.detailDialog.close();
      });
    });
  },
  timerQuick() {
    const panel = this.panel('Timers', 'Your own countdowns. Start and reset them manually.');
    if (!this.s.timers.length) panel.append(this.e('p', 'help', 'Add a timer for a break, a buff reminder or anything else you want to keep track of.'));
    for (const timer of this.s.timers) {
      const card = this.e('article', 'task-card'), remaining = this.e('span', 'timer-remaining', 'Stopped');
      if (timer.expiresAt !== null) remaining.dataset.deadline = String(timer.expiresAt);
      card.append(this.e('h3', '', timer.name), remaining);
      const buttons = this.e('div', 'button-row'); buttons.append(this.button('Start / reset', () => this.act('timer:start', { id: timer.id })),
        this.button('Stop', () => this.act('timer:stop', { id: timer.id }))); card.append(buttons); panel.append(card);
    }
    panel.append(this.button('Set up timers & alerts', () => this.drawer('Timers & alerts', () => this.tools()), 'primary'));
    this.updateTimers();
  },
  mapControl(parent) {
    const zone = this.s.events.find(e => e.zone)?.zone;
    if (atlasUrl(zone)) parent.append(this.button(`Map: ${zone}`, async () => {
      const result = await this.call(() => this.api.openMap()); if (result) this.message(result);
    }, 'quiet'));
  }
};
