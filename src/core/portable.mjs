// Export definitions only: no paths, source identities, window positions, history or goal progress.
function string(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('This settings file contains invalid text. Try exporting it again from Neverquest.');
  return value.trim();
}
export function validateBundle(input) {
  if (!input || input.version !== 1) throw new Error('This settings file uses an unsupported version. Check that you’re using the matching Neverquest version.');
  const list = (key, convert) => {
    const rows = input[key] ?? [];
    if (!Array.isArray(rows) || rows.length > 1000) throw new Error(`The ${key} entries in this settings file are invalid or exceed the 1,000-entry limit. Try exporting the settings again.`);
    return rows.map(convert);
  };
  const goals = list('goals', g => {
    if (!g || !Number.isSafeInteger(g.target) || g.target < 1 || g.target > 1_000_000) throw new Error('Invalid goal quantity in this settings file. Use a whole number from 1 to 1,000,000.');
    return { item: string(g.item, 200, true), target: g.target, wishlist: g.wishlist === true };
  });
  const alerts = list('alerts', a => {
    if (!a || !['Any', 'Loot', 'Party', 'Harvest', 'Vendors', 'Goal'].includes(a.type)) throw new Error('Invalid alert type in this settings file. Try exporting the settings again.');
    return { name: string(a.name, 200, true), type: a.type, match: string(a.match ?? '', 200), enabled: a.enabled === true };
  });
  const knowledge = list('knowledge', k => ({ item: string(k.item, 200, true), quests: string(k.quests ?? '', 5000),
    recipes: string(k.recipes ?? '', 5000), notes: string(k.notes ?? '', 5000), source: string(k.source ?? '', 1000) }));
  const labels = list('labels', l => {
    if (!['keep', 'sell', 'save'].includes(l.label)) throw new Error('This settings file contains an invalid item decision. Choose Keep, Sell or Save for later.');
    return { item: string(l.item, 200, true), label: l.label };
  });
  const p = input.profile ?? {};
  if (!Number.isInteger(p.opacity ?? 100) || (p.opacity ?? 100) < 30 || (p.opacity ?? 100) > 100) throw new Error('The window opacity in this settings file must be a whole number from 30 to 100.');
  const profile = { opacity: p.opacity ?? 100, pinned: p.pinned === true,
    view: string(p.view ?? 'All', 30), page: string(p.page ?? '', 30) };
  return { version: 1, profile, goals, alerts, knowledge, labels };
}
export function exportBundle(data, sourceId) {
  return validateBundle({ version: 1, profile: data.profiles[sourceId] ?? {},
    goals: data.goals.filter(g => g.sourceId === sourceId).map(g => ({ item: g.item, target: g.target, wishlist: g.wishlist })),
    alerts: data.alerts.filter(a => a.sourceId === sourceId).map(a => ({ name: a.name, type: a.type, match: a.match, enabled: a.enabled })),
    knowledge: data.knowledge, labels: data.labels });
}
