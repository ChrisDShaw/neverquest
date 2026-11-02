import { createHash } from 'node:crypto';

const scales = [1_000_000, 10_000, 100, 1];
const words = /(\d+)\s*(platinum|gold|silver|copper)\b/gi;

export function decode(value) {
  if (typeof value !== 'string') return String(value ?? '');
  if (value.length < 4 || value.length % 4 || /^[a-f\d]+$/i.test(value)
      || !/^[A-Za-z\d+/]*={0,2}$/.test(value)) return value;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value, 'base64'));
    return text && !/[\x00-\x1f\x7f-\x9f]/.test(text) ? text : value;
  } catch { return value; }
}

function label(value) {
  const text = String(value ?? '');
  return /^(name|zone|ref)_/.test(text) ? decode(text.slice(text.indexOf('_') + 1)) : text;
}

export function parseMoney(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let total = 0;
  const parts = text.split(',');
  if (parts.length === 4) {
    if (!parts.every(p => /^\d+$/.test(p.trim()))) return null;
    total = parts.reduce((sum, p, i) => sum + Number(p.trim()) * scales[i], 0);
  } else {
    const matches = [...text.matchAll(words)];
    if (!matches.length || text.replace(words, '').trim()) return null;
    const units = { platinum: 1_000_000, gold: 10_000, silver: 100, copper: 1 };
    total = matches.reduce((sum, m) => sum + Number(m[1]) * units[m[2].toLowerCase()], 0);
  }
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

// Stable field order makes identity independent of JSON formatting and property order.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(k => [k, canonical(value[k])])
  );
  return value;
}

export function parseLedger(json, social = false) {
  const root = JSON.parse(json);
  const arrays = Array.isArray(root) ? [root] : root && typeof root === 'object'
    ? Object.values(root).filter(Array.isArray) : [];
  if (!arrays.length) throw new SyntaxError('No ledger row array found');
  const events = [];
  let invalidRows = 0;
  for (const row of arrays.flat()) {
    if (!row || typeof row !== 'object' || typeof row.f01 !== 'string') { invalidRows++; continue; }
    // Require an offset: otherwise the same record can mean different instants on different PCs.
    const at = typeof row.f04 === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(row.f04) ? Date.parse(row.f04) : NaN;
    if (!Number.isFinite(at)) { invalidRows++; continue; }
    try {
      const detail = typeof row.f03 === 'string' ? JSON.parse(row.f03 || '{}') : (row.f03 ?? {});
      if (!detail || Array.isArray(detail) || typeof detail !== 'object') { invalidRows++; continue; }
      const d = key => decode(detail[key]);
      const q = Number(detail.d01);
      // Parse the nested JSON before hashing so formatting inside f03 does not affect identity.
      const identity = createHash('sha256').update(JSON.stringify(canonical({ ...row, f03: detail }))).digest('hex');
      events.push({
        identity, act: row.f01, at, actor: label(row.f07), owner: label(row.f09),
        zone: label(row.f05), item: d('d04') || (['act_24', 'act_28', 'act_11', 'act_12', 'act_15', 'act_27'].includes(row.f01) ? label(row.f02) : ''),
        itemId: d('d05'), level: Number.isInteger(Number(row.f06)) ? Number(row.f06) : null,
        newLevel: Number.isInteger(Number(detail.d21)) ? Number(detail.d21) : null,
        oldLevel: Number.isInteger(Number(detail.d22)) ? Number(detail.d22) : null,
        partner: d('partner'),
        tradeItems: Array.isArray(detail.items) ? detail.items.filter(i => i && typeof i === 'object').map(i => ({
          item: decode(i.name), quantity: Number.isSafeInteger(Number(i.quantity)) && Number(i.quantity) > 0 ? Number(i.quantity) : 1,
          itemId: String(i.publicLinkID ?? '') })) : [],
        creature: row.f01 === 'act_14' ? d('d13') : (row.f01 === 'act_13' ? d('d02') : ''),
        quantity: Number.isSafeInteger(q) && q > 0 ? q : 1,
        copper: row.f01 === 'act_14' ? parseMoney(d('d12'))
          : ['act_24', 'act_28'].includes(row.f01) ? parseMoney(d('d03'))
          : ['act_16', 'act_20'].includes(row.f01) ? parseMoney(d('currency')) : null,
        ownerShare: parseMoney(d('d15')), split: d('d14') === 'party_split', social
      });
    } catch { invalidRows++; }
  }
  return { events, invalidRows };
}

export function mergeLedgers(files) {
  const merged = new Map();
  for (const file of files) {
    const occurrences = new Map();
    for (const event of file.events) {
      // Own actions are mirrored in Social. The Character stream is authoritative.
      if (event.social && event.actor && event.owner
          && event.actor.toLowerCase() === event.owner.toLowerCase()) continue;
      const key = `${event.social ? 'S' : 'C'}:${event.identity}`;
      const count = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, count);
      const prior = merged.get(key) ?? [];
      // Maximum copies per file deduplicates archives without collapsing repeats within a file.
      if (count > prior.length) { prior.push(event); merged.set(key, prior); }
    }
  }
  return [...merged.values()].flat().sort((a, b) => b.at - a.at);
}
