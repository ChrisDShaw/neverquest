import { mapFilename, mapMime } from './map-safety.mjs';

export const UI_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' app://maps; font-src 'self'; media-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'";
export const inertHeaders = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; sandbox", 'Cache-Control': 'no-store' };

export function rendererRequestAllowed({ url, resourceType }) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'app:' || parsed.username || parsed.password || parsed.port) return false;
    if (parsed.host === 'neverquest') return true;
    return parsed.host === 'maps' && resourceType === 'image' && !parsed.search && !parsed.hash && !!mapFilename(parsed.pathname.slice(1));
  } catch { return false; }
}

export async function mapImageResponse(request, cache) {
  const url = new URL(request.url), name = url.pathname.slice(1);
  if (request.method !== 'GET' || url.host !== 'maps' || url.search || url.hash || !mapFilename(name))
    return new Response('Blocked map request', { status: 400, headers: inertHeaders });
  try {
    return new Response(await cache.image(name), { headers: { ...inertHeaders,
      'Content-Type': mapMime(name), 'Cross-Origin-Resource-Policy': 'cross-origin' } });
  } catch { return new Response('Map unavailable or failed validation', { status: 404, headers: inertHeaders }); }
}
