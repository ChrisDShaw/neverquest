import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { LedgerFolder, resolveLedgerFolder, findCharacters, latestLedgerWrite } from './folder.mjs';
import { mergeLedgers } from './ledger.mjs';
import { priceBook, scopeEvents, report, itemKey, goalProgress } from '../renderer/analysis.mjs';
import { category, describe } from '../renderer/model.mjs';
import { exportBundle, validateBundle } from './portable.mjs';
import { starterKnowledge } from './knowledge.mjs';
import { automaticSessions, sessionEdits } from '../renderer/sessions.mjs';
import { validateMembers, huntMembers, huntSummary, huntMessages } from '../renderer/hunts.mjs';

const text = (value, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Enter text between 1 and ${max} characters.`);
  return value.trim();
};
const integer = (value, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Enter a whole number from ${min} to ${max}.`);
  return value;
};
const directoryKey = directory => process.platform === 'win32' ? path.resolve(directory).toLowerCase() : path.resolve(directory);
const ledgerId = directory => createHash('sha256').update(directoryKey(directory)).digest('hex').slice(0, 24);

export class Companion {
  constructor(store) {
    this.store = store; this.sourceId = null; this.reader = null; this.live = { files: 0, invalidRows: 0, problems: [] };
    this.notifications = []; this.followStamp = null;
    this.discover = async () => this.source?.directory && path.basename(this.source.directory).toLowerCase() === 'ledger'
      ? findCharacters(path.dirname(path.dirname(path.dirname(this.source.directory)))) : [];
    this.sessionCache = new Map();
    this.characterActivity = null; this.activityCandidate = null; this.activityCheck = null;
    this.otherReaders = new Map(); this.otherCheck = null; this.otherProblems = [];
    for (const reference of starterKnowledge)
      if (!this.data.knowledge.some(k => itemKey(k.item) === itemKey(reference.item))) this.data.knowledge.push({ ...reference });
  }
  get data() { return this.store.data; }
  get source() { return this.data.sources.find(s => s.id === this.sourceId); }
  sessions(now = Date.now()) {
    const events = this.source?.events ?? [], gap = this.data.preferences.sessionGapMinutes ?? 30;
    const edits = this.data.preferences.sessionEdits?.[this.sourceId];
    let cached = this.sessionCache.get(this.sourceId);
    if (!cached || cached.events !== events || cached.gap !== gap || cached.edits !== edits) {
      cached = { events, gap, edits, sessions: automaticSessions(events, this.sourceId, gap, now, edits) };
      this.sessionCache.set(this.sourceId, cached);
    }
    const names = this.data.preferences.sessionNames ?? {};
    const automatic = cached.sessions.map((s, i, all) => ({ ...s, name: names[s.id] ?? s.name,
      active: i === all.length - 1 && now - s.lastActivityAt < gap * 60_000 }));
    return [...automatic, ...this.data.sessions.filter(s => s.sourceId === this.sourceId).map(s => ({ ...s, kind: 'manual' }))]
      .sort((a, b) => a.startedAt - b.startedAt);
  }
  async connect(directory, source = {}) {
    const resolved = await resolveLedgerFolder(directory);
    const characterDir = path.basename(resolved).toLowerCase() === 'ledger' ? path.dirname(resolved) : resolved;
    const id = ledgerId(resolved);
    let saved = this.data.sources.find(s => s.id === id);
    if (!saved) {
      saved = { id, directory: resolved, character: source.character ?? path.basename(characterDir),
        server: source.server ?? path.basename(path.dirname(characterDir)), events: [] };
      this.data.sources.push(saved);
    }
    this.sourceId = id; this.reader = new LedgerFolder(resolved);
    this.data.preferences.sourceId = id;
    await this.refresh({ baseline: true, allowFollow: false });
    await this.store.save();
    return this.snapshot();
  }
  async select(id) {
    const source = this.data.sources.find(s => s.id === id);
    if (!source) throw new Error('Choose a saved character.');
    this.sourceId = id; this.reader = source.directory ? new LedgerFolder(source.directory) : null;
    this.data.preferences.sourceId = id;
    await this.refresh({ baseline: true, allowFollow: false }); await this.store.save();
    return this.snapshot();
  }
  async refresh({ baseline = false, allowFollow = true } = {}) {
    const followProblem = allowFollow && this.data.preferences.follow ? await this.followLedgers() : null;
    const reader = this.reader, source = this.source;
    if (reader && source) {
      const latest = await reader.refresh();
      if (this.reader !== reader) return this.snapshot();
      this.live = { ...latest, problems: [...latest.problems, ...(followProblem ? [followProblem] : [])] };
      const merged = mergeLedgers([{ events: source.events }, { events: latest.events }]);
      if (JSON.stringify(source.events) !== JSON.stringify(merged)) {
        if (!baseline) this.checkAlerts(source.events, merged);
        source.events = merged; await this.store.save();
      }
    }
    const found = await this.refreshOtherCharacters();
    await this.checkCharacterActivity({ found });
    await this.tick();
    return this.snapshot();
  }
  notify(message, soundId = '') {
    this.notifications.push({ id: randomUUID(), at: Date.now(), message, soundId });
    this.notifications = this.notifications.slice(-50);
  }
  checkAlerts(before, after) {
    const counts = new Map();
    for (const e of before) counts.set(e.identity, (counts.get(e.identity) ?? 0) + 1);
    const fresh = after.filter(e => { const n = counts.get(e.identity) ?? 0; if (n) { counts.set(e.identity, n - 1); return false; } return true; });
    for (const rule of this.data.alerts.filter(a => a.sourceId === this.sourceId && a.enabled)) {
      if (rule.type === 'Goal') {
        for (const goal of this.data.goals.filter(g => g.sourceId === this.sourceId))
          if (!goalProgress(goal, before).completed && goalProgress(goal, after).completed
              && itemKey(goal.item).includes(itemKey(rule.match))) this.notify(`${rule.name}: reached ${goal.item}`, rule.soundId);
      } else {
        const matches = fresh.filter(e => (rule.type === 'Any' || category(e.act) === rule.type)
          && itemKey(`${e.actor} ${e.item} ${e.creature} ${e.zone} ${describe(e)}`).includes(itemKey(rule.match)));
        if (matches.length) this.notify(`${rule.name}: ${matches.length} new matching event${matches.length === 1 ? '' : 's'} · ${describe(matches[0])}`, rule.soundId);
      }
    }
  }
  async tick(now = Date.now()) {
    let changed = false;
    for (const timer of this.data.timers) {
      if (timer.expiresAt !== null && timer.expiresAt <= now && !timer.notified) {
        timer.notified = true; changed = true;
        const character = this.data.sources.find(s => s.id === timer.sourceId)?.character ?? '';
        this.notify(`${character} · ${timer.name} ended`, timer.soundId);
      }
    }
    if (changed) await this.store.save();
  }
  async discoverLedgers() {
    const found = await this.discover();
    const known = new Set(found.map(s => path.resolve(s.directory).toLowerCase()));
    for (const source of this.data.sources) {
      if (!source.directory || known.has(path.resolve(source.directory).toLowerCase())) continue;
      try { found.push({ ...source, lastActive: await latestLedgerWrite(source.directory) }); } catch { /* Preserve saved history. */ }
    }
    return found;
  }
  async refreshOtherCharacters(now = Date.now()) {
    if (!this.reader || !this.source?.directory) return;
    if (this.otherCheck?.sourceId === this.sourceId && now - this.otherCheck.at < 10000) return;
    this.otherCheck = { sourceId: this.sourceId, at: now };
    this.otherProblems = [];
    let found;
    try { found = await this.discoverLedgers(); }
    catch (error) { this.otherProblems.push(`Cannot discover other character ledgers: ${error.message}`); return; }
    let changed = false;
    const seen = new Set([directoryKey(this.source.directory)]);
    for (const candidate of found) {
      const key = directoryKey(candidate.directory);
      if (seen.has(key)) continue;
      seen.add(key);
      let reader = this.otherReaders.get(key);
      if (!reader) { reader = new LedgerFolder(candidate.directory); this.otherReaders.set(key, reader); }
      const latest = await reader.refresh();
      this.otherProblems.push(...latest.problems.map(problem => `${candidate.character}: ${problem}`));
      if (latest.invalidRows) this.otherProblems.push(`${candidate.character}: ${latest.invalidRows} unreadable ledger records`);
      if (!latest.events.length) continue;
      const id = ledgerId(candidate.directory);
      let saved = this.data.sources.find(s => s.id === id);
      if (!saved) {
        saved = { id, directory: candidate.directory, character: candidate.character, server: candidate.server, events: [] };
        this.data.sources.push(saved);
      }
      // Import quietly: another character's history must not trigger the selected character's alerts.
      const merged = mergeLedgers([{ events: saved.events }, { events: latest.events }]);
      if (JSON.stringify(saved.events) !== JSON.stringify(merged)) { saved.events = merged; changed = true; }
    }
    if (changed) await this.store.save();
    return found;
  }
  async checkCharacterActivity({ force = false, now = Date.now(), found } = {}) {
    if (!this.reader || !this.source?.directory) { this.characterActivity = null; this.activityCandidate = null; return null; }
    if (!force && this.activityCheck?.sourceId === this.sourceId && now - this.activityCheck.at < 10000) return this.characterActivity;
    this.activityCheck = { sourceId: this.sourceId, at: now };
    this.activityCandidate = null;
    try {
      found ??= await this.discoverLedgers();
      const directory = path.resolve(this.source.directory).toLowerCase();
      const selected = found.find(s => path.resolve(s.directory).toLowerCase() === directory);
      const newest = found.filter(s => Number.isFinite(s.lastActive) && s.lastActive > 0 && s.lastActive <= now + 60000)
        .sort((a, b) => b.lastActive - a.lastActive)[0];
      if (newest && selected && newest.lastActive > selected.lastActive
          && newest.lastActive >= now - 15 * 60000 && path.resolve(newest.directory).toLowerCase() !== directory) {
        this.activityCandidate = newest;
        this.characterActivity = { state: 'different', selectedLastActive: selected.lastActive,
          recent: { id: createHash('sha256').update(path.resolve(newest.directory).toLowerCase()).digest('hex').slice(0, 24),
            character: newest.character, server: newest.server, lastActive: newest.lastActive } };
      } else this.characterActivity = { state: selected ? 'selected' : 'unknown', selectedLastActive: selected?.lastActive ?? null };
    } catch { this.characterActivity = { state: 'unknown', selectedLastActive: null }; }
    return this.characterActivity;
  }
  async selectRecentCharacter(candidateId) {
    const activity = await this.checkCharacterActivity({ force: true });
    if (activity?.state !== 'different' || activity.recent.id !== candidateId || !this.activityCandidate)
      throw new Error('The most recent character changed. Review the activity notice and try again.');
    return this.connect(this.activityCandidate.directory, this.activityCandidate);
  }
  async followLedgers() {
    try {
      const found = await this.discoverLedgers();
      found.sort((a, b) => b.lastActive - a.lastActive);
      const newest = found[0];
      if (!newest) return;
      const previous = this.followStamp; this.followStamp = Math.max(this.followStamp ?? 0, newest.lastActive);
      if (previous !== null && newest.lastActive > previous && newest.directory.toLowerCase() !== this.source?.directory.toLowerCase()) {
        await this.connect(newest.directory, newest);
        this.notify(`Switched to ${newest.character}.`);
      }
    } catch (error) { return `Cannot check ledger updates: ${error.message}`; }
  }
  snapshot() {
    const source = this.source;
    return { ...this.live, problems: [...this.live.problems, ...this.otherProblems],
      events: source?.events ?? [], character: source?.character ?? '', server: source?.server ?? '',
      directory: source?.directory ?? '', sourceId: this.sourceId,
      characterActivity: this.characterActivity,
      revision: this.data.revision, sources: this.data.sources.map(({ events, ...s }) => ({ ...s, count: events.length })),
      sessions: this.sessions(),
      prices: priceBook(this.data.sources, source?.server),
      goals: this.data.goals.filter(g => g.sourceId === this.sourceId).map(g => ({ ...g, progress: goalProgress(g, source?.events ?? []) })),
      knowledge: this.data.knowledge, notes: this.data.notes.filter(n => n.sourceId === this.sourceId),
      bookmarks: this.data.bookmarks.filter(b => b.sourceId === this.sourceId), labels: this.data.labels,
      profile: this.data.profiles[this.sourceId] ?? {}, preferences: this.data.preferences,
      alerts: this.data.alerts.filter(a => a.sourceId === this.sourceId), timers: this.data.timers.filter(t => t.sourceId === this.sourceId),
      sounds: this.data.sounds.map(({ filename, ...sound }) => sound), notifications: this.notifications };
  }
  scoped({ sessionId = '', day = '' } = {}) {
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Choose a valid date.');
    const session = sessionId ? this.sessions().find(s => s.id === sessionId) : null;
    if (sessionId && !session) throw new Error('This session or hunt is no longer available. Reopen Hunt history and choose another.');
    return { session, events: scopeEvents(this.source?.events ?? [], { session, day }) };
  }
  report(scope) {
    if (!this.source) throw new Error('Choose a character first.');
    const { events, session } = this.scoped(scope);
    return report(this.source, events, priceBook(this.data.sources, this.source.server), session?.name ?? (scope.day || 'All recorded history'));
  }
  hunt(id) {
    const hunt = this.data.sessions.find(s => s.id === id && s.sourceId === this.sourceId);
    if (!this.source || !hunt) throw new Error('This hunt is no longer available. Choose a hunt for the current character.');
    return hunt;
  }
  huntMessage(id, part, expectedText) {
    const hunt = this.hunt(id);
    const summary = huntSummary(hunt, this.source.events, priceBook(this.data.sources, this.source.server), this.source.character);
    const messages = huntMessages(summary);
    if (!Number.isInteger(part) || !messages[part]) throw new Error('Choose a hunt message to copy.');
    if (messages[part] !== expectedText) throw new Error('The hunt values changed. Review the updated summary before copying.');
    return messages[part];
  }
  async action(command, payload = {}, now = Date.now()) {
    if (!this.source) throw new Error('Choose a character first.');
    switch (command) {
      case 'session:start': {
        const activity = await this.checkCharacterActivity({ force: true, now });
        if (activity?.state === 'different' && payload.acknowledgeCharacterId !== activity.recent.id)
          throw new Error(`${activity.recent.character} has newer ledger activity. Reopen Start hunt to switch characters or confirm a hunt for ${this.source.character}.`);
        if (this.data.sessions.some(s => s.sourceId === this.sourceId && s.endedAt === null)) throw new Error('End the current hunt first.');
        const startedAt = payload.startedAt === undefined ? now : integer(payload.startedAt, 0, now);
        const members = validateMembers(payload.members ?? [], this.source.character);
        this.data.sessions.push({ id: randomUUID(), sourceId: this.sourceId, name: text(payload.name), startedAt, endedAt: null, members });
        break;
      }
      case 'session:end': {
        const session = this.data.sessions.find(s => s.id === payload.id && s.sourceId === this.sourceId);
        if (!session || session.endedAt !== null) throw new Error('No active hunt selected.');
        session.endedAt = Math.max(session.startedAt + 1, now); break;
      }
      case 'session:rename': {
        const session = this.sessions().find(s => s.id === payload.id);
        if (!session) throw new Error('This session or hunt is no longer available. Reopen Hunt history and choose another.');
        if (session.kind === 'automatic') {
          this.data.preferences.sessionNames ??= {}; this.data.preferences.sessionNames[session.id] = text(payload.name);
        } else this.data.sessions.find(s => s.id === payload.id).name = text(payload.name);
        break;
      }
      case 'hunt:members': {
        const hunt = this.hunt(payload.id);
        hunt.members = validateMembers(payload.members, this.source.character); break;
      }
      case 'hunt:add-member': case 'hunt:remove-member': {
        const hunt = this.hunt(payload.id), name = text(payload.name, 60);
        const members = huntMembers(hunt, this.source.character);
        hunt.members = validateMembers(command === 'hunt:add-member' ? [...members.filter(member => itemKey(member) !== itemKey(name)), name]
          : members.filter(member => itemKey(member) !== itemKey(name)), this.source.character);
        break;
      }
      case 'hunt:price': {
        const hunt = this.hunt(payload.id), key = itemKey(text(payload.item));
        const summary = huntSummary(hunt, this.source.events, priceBook(this.data.sources, this.source.server), this.source.character);
        if (!summary.items.some(item => item.key === key)) throw new Error('Choose an item looted by a hunt member.');
        if (!['vendor', 'custom', 'exclude'].includes(payload.mode)) throw new Error('Choose a value source for this item.');
        const value = payload.mode === 'custom' ? integer(payload.unit, 0, 1_000_000_000_000) : null;
        const itemValues = { ...hunt.itemValues };
        if (payload.mode === 'vendor') delete itemValues[key];
        else Object.defineProperty(itemValues, key, { value, writable: true, enumerable: true, configurable: true });
        huntSummary({ ...hunt, itemValues }, this.source.events, priceBook(this.data.sources, this.source.server), this.source.character);
        hunt.itemValues = itemValues;
        break;
      }
      case 'session:gap': this.data.preferences.sessionGapMinutes = integer(payload.minutes, 10, 180); break;
      case 'session:merge': {
        const automatic = this.sessions(now).filter(s => s.kind === 'automatic');
        const index = automatic.findIndex(s => s.id === payload.id), left = automatic[index], right = automatic[index + 1];
        if (!left || !right || right.id !== payload.nextId) throw new Error('Choose two adjacent automatic sessions for this character.');
        const edits = sessionEdits(this.data.preferences.sessionEdits?.[this.sourceId]);
        edits.splits = edits.splits.filter(at => at <= left.lastActivityAt || at > right.startedAt);
        edits.merges.push({ from: left.lastActivityAt, to: right.startedAt });
        this.data.preferences.sessionEdits ??= {};
        this.data.preferences.sessionEdits[this.sourceId] = sessionEdits(edits); break;
      }
      case 'session:split': {
        const session = this.sessions(now).find(s => s.id === payload.id && s.kind === 'automatic');
        const at = payload.at;
        if (!session || !Number.isSafeInteger(at) || at <= session.startedAt || at > session.lastActivityAt
            || !this.source.events.some(e => e.at === at)) throw new Error('Choose a recorded event after the start of this automatic session.');
        const edits = sessionEdits(this.data.preferences.sessionEdits?.[this.sourceId]); edits.splits.push(at);
        this.data.preferences.sessionEdits ??= {};
        this.data.preferences.sessionEdits[this.sourceId] = sessionEdits(edits); break;
      }
      case 'session:reset': {
        if (this.data.preferences.sessionEdits) delete this.data.preferences.sessionEdits[this.sourceId];
        break;
      }
      case 'goal:save': {
        const old = payload.id ? this.data.goals.find(g => g.id === payload.id && g.sourceId === this.sourceId) : null;
        if (payload.id && !old) throw new Error('This goal is no longer available. Reopen Goals & wishlist to check your goals.');
        const goal = { id: old?.id ?? randomUUID(), sourceId: this.sourceId, item: text(payload.item),
          target: integer(payload.target, 1, 1_000_000), adjustment: integer(payload.adjustment ?? 0, -1_000_000, 1_000_000),
          startedAt: old?.startedAt ?? now, completed: payload.completed === true, wishlist: payload.wishlist === true };
        if (old) Object.assign(old, goal); else this.data.goals.push(goal);
        break;
      }
      case 'knowledge:save': {
        const name = text(payload.item);
        const old = this.data.knowledge.find(k => itemKey(k.item) === itemKey(name));
        const entry = { item: name, quests: String(payload.quests ?? '').slice(0, 5000),
          recipes: String(payload.recipes ?? '').slice(0, 5000), notes: String(payload.notes ?? '').slice(0, 5000),
          source: String(payload.source ?? '').slice(0, 1000) };
        if (old) Object.assign(old, entry); else this.data.knowledge.push(entry); break;
      }
      case 'note:save': {
        const old = payload.id ? this.data.notes.find(n => n.id === payload.id && n.sourceId === this.sourceId) : null;
        if (payload.id && !old) throw new Error('This note is no longer available. Reopen Field notes to check your notes.');
        const note = { id: old?.id ?? randomUUID(), sourceId: this.sourceId, kind: text(payload.kind, 20),
          subject: text(payload.subject), body: text(payload.body, 10000), at: old?.at ?? now };
        if (!['item', 'creature', 'zone', 'session'].includes(note.kind)) throw new Error('Choose a note category.');
        if (old) Object.assign(old, note); else this.data.notes.push(note); break;
      }
      case 'bookmark:add': {
        const event = this.source.events.find(e => e.identity === payload.identity);
        if (!event) throw new Error('Recorded event not found.');
        this.data.bookmarks.push({ id: randomUUID(), sourceId: this.sourceId, at: event.at, identity: event.identity,
          label: text(payload.label), actor: event.actor, item: event.item, zone: event.zone }); break;
      }
      case 'label:save': {
        const name = text(payload.item);
        if (!['keep', 'sell', 'save', ''].includes(payload.label)) throw new Error('Choose keep, sell or save.');
        this.data.labels = this.data.labels.filter(l => itemKey(l.item) !== itemKey(name));
        if (payload.label) this.data.labels.push({ item: name, label: payload.label }); break;
      }
      case 'profile:save': {
        const profile = { pinned: payload.pinned === true, opacity: integer(payload.opacity ?? 100, 30, 100),
          view: String(payload.view ?? 'All').slice(0, 30), page: String(payload.page ?? '').slice(0, 30) };
        this.data.profiles[this.sourceId] = { ...this.data.profiles[this.sourceId], ...profile }; break;
      }
      case 'follow:set':
        this.data.preferences.follow = payload.enabled === true; this.followStamp = null; break;
      case 'timer:save': {
        const old = payload.id ? this.data.timers.find(t => t.id === payload.id && t.sourceId === this.sourceId) : null;
        if (payload.id && !old) throw new Error('This timer is no longer available. Reopen Timers to choose another.');
        const timer = { id: old?.id ?? randomUUID(), sourceId: this.sourceId, name: text(payload.name),
          seconds: integer(payload.seconds, 1, 86400), soundId: this.validSound(payload.soundId), expiresAt: null, notified: false };
        if (old) Object.assign(old, timer); else this.data.timers.push(timer); break;
      }
      case 'timer:start': case 'timer:stop': {
        const timer = this.data.timers.find(t => t.id === payload.id && t.sourceId === this.sourceId);
        if (!timer) throw new Error('This timer is no longer available. Reopen Timers to choose another.');
        timer.expiresAt = command === 'timer:start' ? now + timer.seconds * 1000 : null; timer.notified = false; break;
      }
      case 'alert:save': {
        const old = payload.id ? this.data.alerts.find(a => a.id === payload.id && a.sourceId === this.sourceId) : null;
        if (payload.id && !old) throw new Error('This alert is no longer available. Reopen Timers & alerts to check your alerts.');
        if (!['Any', 'Loot', 'Party', 'Harvest', 'Vendors', 'Goal'].includes(payload.type)) throw new Error('Choose an alert event type.');
        const alert = { id: old?.id ?? randomUUID(), sourceId: this.sourceId, name: text(payload.name), type: payload.type,
          match: String(payload.match ?? '').slice(0, 200), soundId: this.validSound(payload.soundId), enabled: payload.enabled === true };
        if (old) Object.assign(old, alert); else this.data.alerts.push(alert); break;
      }
      case 'entry:remove': {
        const allowed = ['goals', 'notes', 'bookmarks', 'alerts', 'timers'];
        if (!allowed.includes(payload.collection)) throw new Error('Invalid collection.');
        const rows = this.data[payload.collection];
        const index = rows.findIndex(e => e.id === payload.id && e.sourceId === this.sourceId);
        if (index < 0) throw new Error('Entry not found.');
        rows.splice(index, 1); break;
      }
      default: throw new Error('Unknown companion action.');
    }
    await this.store.save();
    return this.snapshot();
  }
  validSound(id) {
    if (!id) return '';
    if (id === 'bell' || this.data.sounds.some(s => s.id === id)) return id;
    throw new Error('Choose an available local sound.');
  }
  exportSettings() { return exportBundle(this.data, this.sourceId); }
  async importSettings(input, now = Date.now()) {
    const bundle = validateBundle(input);
    // Explicit import adds definitions. Existing knowledge and decisions are kept.
    for (const g of bundle.goals) this.data.goals.push({ ...g, id: randomUUID(), sourceId: this.sourceId, startedAt: now, adjustment: 0, completed: false });
    for (const a of bundle.alerts) this.data.alerts.push({ ...a, id: randomUUID(), sourceId: this.sourceId, soundId: '' });
    for (const k of bundle.knowledge) if (!this.data.knowledge.some(old => itemKey(old.item) === itemKey(k.item))) this.data.knowledge.push(k);
    for (const l of bundle.labels) if (!this.data.labels.some(old => itemKey(old.item) === itemKey(l.item))) this.data.labels.push(l);
    this.data.profiles[this.sourceId] = bundle.profile;
    await this.store.save(); return this.snapshot();
  }
}
