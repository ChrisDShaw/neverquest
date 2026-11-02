import { crc32 } from 'node:zlib';

export const MAP_BYTES = 25_000_000;
export const mapFilename = name => typeof name === 'string' && /^[A-Za-z0-9_-]{1,100}\.(avif|png)$/.test(name)
  && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name) ? name : null;
export const mapMime = name => name.endsWith('.avif') ? 'image/avif' : 'image/png';
export function mapDimensions(w, h) {
  return Number.isSafeInteger(w) && Number.isSafeInteger(h) && w > 0 && h > 0 && w <= 8192 && h <= 8192 && w * h <= 40_000_000;
}
const invalid = () => { throw new Error('Map image failed format or dimension checks.'); };

// Structural checks, not a decoder or a malware scan. Decoding stays in Chromium's sandbox.
export function validateMapImage(bytes, name, expected) {
  if (!mapFilename(name) || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAP_BYTES) invalid();
  const dimensions = [];
  if (name.endsWith('.png')) {
    if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) invalid();
    let pos = 8, count = 0, data = false, ended = false;
    while (pos < bytes.length) {
      if (++count > 4096 || bytes.length - pos < 12) invalid();
      const size = bytes.readUInt32BE(pos), type = bytes.toString('ascii', pos + 4, pos + 8), end = pos + size + 12;
      if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type)
          || crc32(bytes.subarray(pos + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) invalid();
      if (count === 1) {
        if (type !== 'IHDR' || size !== 13) invalid();
        dimensions.push([bytes.readUInt32BE(pos + 8), bytes.readUInt32BE(pos + 12)]);
      } else if (type === 'IHDR' || ['acTL', 'fcTL', 'fdAT'].includes(type)) invalid();
      if (type === 'IDAT') data = true;
      if (type === 'IEND') { if (size !== 0 || end !== bytes.length) invalid(); ended = true; }
      pos = end;
    }
    if (!data || !ended) invalid();
  } else {
    let count = 0, fileType = false, metadata = false, data = false;
    const boxes = (start, end, depth) => {
      if (depth > 6) invalid();
      for (let pos = start; pos < end;) {
        if (++count > 4096 || end - pos < 8) invalid();
        let size = bytes.readUInt32BE(pos), header = 8;
        const type = bytes.toString('ascii', pos + 4, pos + 8);
        if (size === 1) {
          if (end - pos < 16) invalid();
          const wide = bytes.readBigUInt64BE(pos + 8); if (wide > BigInt(MAP_BYTES)) invalid();
          size = Number(wide); header = 16;
        }
        if (size < header || pos + size > end) invalid();
        const body = pos + header, limit = pos + size;
        if (depth === 0 && pos === 0 && type !== 'ftyp') invalid();
        if (type === 'ftyp') {
          if (depth !== 0 || fileType || size - header < 12 || (size - header) % 4) invalid();
          const brands = [bytes.toString('ascii', body, body + 4)];
          for (let p = body + 8; p < limit; p += 4) brands.push(bytes.toString('ascii', p, p + 4));
          if (!brands.includes('avif') || brands.includes('avis')) invalid(); fileType = true;
        }
        if (['moov', 'trak'].includes(type)) invalid(); // No animated/video containers.
        if (type === 'meta') { if (limit - body < 4) invalid(); metadata = true; boxes(body + 4, limit, depth + 1); }
        if (['iprp', 'ipco'].includes(type)) boxes(body, limit, depth + 1);
        if (type === 'ispe') {
          if (limit - body !== 12) invalid();
          dimensions.push([bytes.readUInt32BE(body + 4), bytes.readUInt32BE(body + 8)]);
        }
        if (type === 'mdat') data = limit > body;
        pos = limit;
      }
    };
    boxes(0, bytes.length, 0);
    if (!fileType || !metadata || !data) invalid();
  }
  if (!dimensions.length || dimensions.some(([w, h]) => !mapDimensions(w, h))
      || !dimensions.some(([w, h]) => w === expected.width && h === expected.height)) invalid();
  return mapMime(name);
}
