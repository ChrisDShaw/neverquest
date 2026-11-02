export function sessionEdits(input = {}) {
  const splits = [...new Set((Array.isArray(input.splits) ? input.splits : []).filter(n => Number.isSafeInteger(n) && n >= 0))].sort((a, b) => a - b);
  const ranges = (Array.isArray(input.merges) ? input.merges : []).filter(r => r && Number.isSafeInteger(r.from) && Number.isSafeInteger(r.to)
    && r.from >= 0 && r.to > r.from).map(r => ({ from: r.from, to: r.to })).sort((a, b) => a.from - b.from);
  if (splits.length > 1000 || ranges.length > 1000) throw new Error('Too many session corrections. Restore automatic grouping to start again.');
  const merges = [];
  for (const range of ranges) { const last = merges.at(-1); if (last && range.from <= last.to) last.to = Math.max(last.to, range.to); else merges.push(range); }
  return { splits, merges };
}

export function splitPoint(events, at) {
  const ordered = [...events].sort((a, b) => a.at - b.at);
  const first = ordered[0];
  if (!first || !Number.isFinite(at) || at <= first.at) return null;
  return ordered.find(e => e.at >= at && e.at > first.at)?.at ?? null;
}

export function automaticSessions(events, sourceId, gapMinutes = 30, now = Date.now(), edits = {}) {
  const gap = gapMinutes * 60_000, groups = [];
  const { splits, merges } = sessionEdits(edits); let splitIndex = 0, mergeIndex = 0;
  for (const event of [...events].sort((a, b) => a.at - b.at)) {
    const previous = groups.at(-1);
    while (previous && splits[splitIndex] <= previous.lastActivityAt) splitIndex++;
    while (merges[mergeIndex] && merges[mergeIndex].to < event.at) mergeIndex++;
    const forcedSplit = previous && splits[splitIndex] <= event.at;
    const range = merges[mergeIndex], joined = previous && range && range.from <= previous.lastActivityAt && event.at <= range.to;
    if (!previous || forcedSplit || (!joined && event.at - previous.lastActivityAt >= gap)) groups.push({
      id: `auto-${sourceId}-${event.identity}`, sourceId, kind: 'automatic', name: `Session · ${new Date(event.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      startedAt: event.at, lastActivityAt: event.at, endedAt: event.at + 1, events: 1
    });
    else { previous.lastActivityAt = event.at; previous.endedAt = event.at + 1; previous.events++; }
  }
  return groups.map(g => ({ ...g, active: g === groups.at(-1) && now - g.lastActivityAt < gap }));
}
