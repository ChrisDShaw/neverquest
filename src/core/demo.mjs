import { parseLedger, mergeLedgers } from './ledger.mjs';

// Invented events, built in the documented game format and passed through the real parser.
export function demoSnapshot() {
  const b64 = text => Buffer.from(text).toString('base64');
  const base = new Date(Date.now() - 36 * 60_000);
  function row(act, minute, actor, detail, social = false) {
    return { f01: act, f02: 'ref_100', f03: JSON.stringify(detail),
      f04: new Date(base.getTime() + minute * 60_000).toISOString(), f05: `zone_${b64('nightharborw')}`,
      f06: 8, f07: actor, f08: social ? 2 : 0, f09: 'Rowan', f10: 'None' };
  }
  const own = [
    row('act_31', 0, 'Rowan', { d63: b64('PartyCreate') }),
    row('act_13', 8, 'Rowan', { d01: 1, d02: b64('a small cellar rat'), d04: 'Rat Tooth' }),
    row('act_14', 9, 'Rowan', { d12: b64('0,0,1,25'), d13: b64('a small cellar rat'), d14: b64('npc_corpse') }),
    row('act_13', 14, 'Rowan', { d01: 1, d02: b64('a restless skeleton'), d04: 'Bone Chips' }),
    row('act_13', 21, 'Rowan', { d01: 1, d02: b64('a restless skeleton'), d04: 'Wool Scraps' }),
    row('act_27', 29, 'Rowan', { d01: 1, d04: 'Wild Berries' }),
    row('act_24', 34, 'Rowan', { d01: 2, d04: 'Rat Tooth', d03: b64('0 platinum 0 gold 0 silver 18 copper') }),
    row('act_28', 35, 'Rowan', { d01: 1, d04: 'Fresh Water', d03: b64('0 platinum 0 gold 0 silver 5 copper') })
  ];
  const social = [
    ...own.map(r => ({ ...r, f08: 2 })),
    row('act_32', 1, 'Mira', { d63: b64('PartyJoin') }, true),
    row('act_32', 2, 'Thorne', { d63: b64('PartyJoin') }, true),
    row('act_13', 12, 'Mira', { d01: 1, d02: b64('a restless skeleton'), d04: 'Bone Chips' }, true),
    row('act_14', 13, 'Mira', { d12: b64('0,0,3,30'), d13: b64('a restless skeleton'), d14: b64('party_split'), d15: b64('0,0,1,10') }, true),
    row('act_13', 23, 'Thorne', { d01: 1, d02: b64('a crocodile hatchling'), d04: 'Crocodile Tooth' }, true),
    row('act_14', 25, 'Thorne', { d12: b64('0,0,0,48'), d13: b64('a small cellar rat'), d14: b64('npc_corpse') }, true),
    row('act_13', 31, 'Mira', { d01: 1, d02: b64('a restless skeleton'), d04: 'Weathered Medallion' }, true)
  ];
  return { events: mergeLedgers([
    parseLedger(JSON.stringify({ c01: own })), parseLedger(JSON.stringify({ c01: social }), true)
  ]), files: 2, invalidRows: 0, problems: [] };
}
