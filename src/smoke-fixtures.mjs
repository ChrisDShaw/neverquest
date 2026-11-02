import { crc32, deflateSync } from 'node:zlib';
import { parseMarket } from './core/market.mjs';
import { parseMaps } from './core/map-cache.mjs';

// Invented raster fixture with correct chunk checksums; never decodes a game image.
export function testPng(width = 1000, height = 800) {
  const chunk = (type, data) => {
    const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(type, 4, 'ascii'); data.copy(bytes, 8);
    bytes.writeUInt32BE(crc32(bytes.subarray(4, bytes.length - 4)), bytes.length - 4); return bytes;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}

export async function prepareSources(market, maps) {
  const refuse = async () => { throw new Error('The isolated smoke test must not contact a public provider.'); };
  market.fetcher = refuse; maps.fetcher = refuse;
  market.state.feed = parseMarket({ generatedAt: new Date().toISOString(), listings: [
    { server: 'Demo realm', item: 'Rat Tooth', player: 'Invented seller', intent: 'sell', price: 50, unit: 50, matched: true },
    { server: 'Demo realm', item: 'Rat Tooth', player: 'Invented buyer', intent: 'buy', price: 40, unit: 40, matched: true }
  ] });
  market.state.checkedAt = Date.now();
  maps.catalogue = parseMaps({ categories: [{ id: 'misc', name: 'Other', color: '#ddcc88' }], zones: [
    { name: 'Night Harbor', image: 'smoke-map.png', width: 100, height: 100, markers: [{ x: 20, y: 20, category: 'misc', label: 'Invented landmark' }] },
    { name: 'Shaded Dunes', image: 'smoke-uncached.png', width: 100, height: 100, markers: [] }
  ] });
  maps.cachedAt = Date.now();
  maps.fetcher = async () => new Response(testPng(100, 100), { headers: { 'Content-Type': 'image/png' } });
  await maps.setOnline(true); await maps.zone('Night Harbor'); await maps.setOnline(false); maps.fetcher = refuse;
}
