// Only these public data endpoints may be fetched. No provider-supplied URLs.
export function publicUrl(value) {
  const url = new URL(value);
  if (url.origin !== 'https://mnm-db.com' || url.username || url.password || url.search || url.hash
      || !/^\/(maps\.json|auctions\.json|maps\/[A-Za-z0-9_-]+\.(avif|png))$/.test(url.pathname)) {
    throw new Error('Blocked public download address.');
  }
  return url.href;
}

export async function publicResponse(fetcher, address, { accept, headers = {}, signal } = {}) {
  const url = publicUrl(address);
  const response = await fetcher(url, { method: 'GET', redirect: 'error', credentials: 'omit',
    referrerPolicy: 'no-referrer', headers: { Accept: accept, 'User-Agent': 'Neverquest/0.3.0', ...headers },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  if (response.redirected || (response.url && response.url !== url)) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Blocked redirected public download.');
  }
  return response;
}

export async function responseBytes(response, maxBytes, mime) {
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const reject = async message => { await response.body?.cancel().catch(() => {}); throw new Error(message); };
  if (response.status !== 200) return reject(`Public provider returned HTTP ${response.status}.`);
  if (type !== mime) return reject('Public download has an unexpected content type.');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) return reject('Public download is larger than allowed.');
  if (!response.body) return reject('Public download has no body.');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Public download is larger than allowed.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!size) throw new Error('Public download is empty.');
  return Buffer.concat(chunks);
}
