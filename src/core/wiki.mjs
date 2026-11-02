// Item text can only produce a path on the fixed wiki host, never an arbitrary URL.
export function itemWikiUrl(item) {
  if (typeof item !== 'string' || !item.trim() || item.length > 200) throw new Error('Choose an item name.');
  const slug = item.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) throw new Error('This item name cannot be linked to the wiki.');
  return 'https://monstersandmemories.wiki/items/' + slug;
}
