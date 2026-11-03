// A code-drawn compass, matching the app's existing compass mark. No art dependency.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

function crc(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const body = Buffer.concat([Buffer.from(type), bytes]), head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(bytes.length); tail.writeUInt32BE(crc(body));
  return Buffer.concat([head, body, tail]);
}
function png(size) {
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + 0.5) / size * 2 - 1, py = (y + 0.5) / size * 2 - 1;
    const radius = Math.hypot(px, py);
    const along = (px - py) / Math.SQRT2, across = Math.abs((px + py) / Math.SQRT2);
    const needle = Math.abs(along) < 0.57 && across < (0.57 - Math.abs(along)) * 0.38;
    const ring = radius > 0.69 && radius < 0.75;
    const color = ring || needle ? (needle && along < 0 ? [106, 158, 143] : [224, 191, 124]) : [16, 26, 28];
    const i = y * (size * 4 + 1) + 1 + x * 4;
    rows.set([...color, radius < 0.97 ? 255 : 0], i);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const sizes = [16, 32, 48, 64, 128, 256], images = sizes.map(png);
const directory = Buffer.alloc(6 + sizes.length * 16); directory.writeUInt16LE(1, 2); directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
sizes.forEach((size, i) => {
  const at = 6 + i * 16; directory[at] = directory[at + 1] = size === 256 ? 0 : size;
  directory.writeUInt16LE(1, at + 4); directory.writeUInt16LE(32, at + 6);
  directory.writeUInt32LE(images[i].length, at + 8); directory.writeUInt32LE(offset, at + 12); offset += images[i].length;
});
await mkdir('build', { recursive: true });
await writeFile('build/icon.ico', Buffer.concat([directory, ...images]));
