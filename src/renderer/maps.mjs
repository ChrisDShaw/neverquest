// Public atlas map slugs, keyed by the zone labels written in the ledger.
const maps = {
  ailvorith: 'ail-vorith', blindmidden: 'blind-midden', faelindral: 'faelindral', sungreetstrand: 'sungreet-strand',
  shadeddunes: 'shaded-dunes', fallenpass: 'fallen-pass', wyrmsbanetomb: 'wyrmsbane-tomb', glassflats: 'glass-flats',
  ancientcrypt: 'ancient-crypt', infestedcrypt: 'infested-crypt', blacktidebay: 'blacktide-bay', scarwood: 'scarwood',
  valeofzintar: 'vale-of-zintar', graincellar: 'grain-cellar', greatcavernsea: 'great-cavern-sea', cavesofirem: 'caves-of-irem',
  telekir: 'tel-ekir', keepersbight: 'keepers-bight', fallenwatch: 'fallen-watch', shallowshoals: 'shallow-shoals',
  tombofthelastwyrmsbane: 'wyrmsbane-tomb',
  glintinghollow: 'glinting-hollow', sunkenresort: 'sunken-resort', rothold: 'rothold', grimtidesanctum: 'grimtide-sanctum',
  underdocks: 'underdocks', evershadeweald: 'evershade-weald', nightharbor: 'night-harbor', nightharborw: 'night-harbor', nightharbore: 'night-harbor'
};
export function atlasUrl(zone) {
  const slug = maps[String(zone).toLowerCase().replace(/[^a-z]/g, '')];
  return slug ? `https://www.mnmatlas.com/${slug}/` : null;
}
