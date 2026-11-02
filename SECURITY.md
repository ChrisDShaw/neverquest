# Security

## Report a vulnerability

Use the repository’s **Security → Advisories → Report a vulnerability** option to send a private report. Tell us which version is affected, what could happen and how to reproduce it with invented data. Keep real ledgers, chat, character paths, private notes and credentials out of attachments.

If private reporting isn’t available, open an issue asking a maintainer to enable it. Keep the vulnerability details private. Maintainers must enable private reporting before a public release; see [RELEASE.md](RELEASE.md).

## Downloads and your data

Map downloads start **off**. Turn on **Allow map downloads** in the map overlay to fetch community maps from MnMdb. Neverquest saves your choice on this PC. Turning it off cancels current map requests; saved maps that pass validation remain available offline.

This switch controls maps only. Market listings and links you choose to open in your browser have separate network access. Map and market requests send no ledger records, log text or private pins. Map requests tell the provider which map you requested.

Downloaded maps and listings are untrusted data. Neverquest checks them before use and doesn’t install or run other companion tools. The sections below explain those checks and what they can’t protect against.

## How downloads are checked

- Requests use fixed HTTPS addresses on `mnm-db.com`. The app rejects provider-supplied URLs, credentials, query strings and redirects. Requests omit cookies and referrers and time out after 30 seconds.
- Map catalogues must be JSON and at most 2 MB. Images must have the expected MIME type and be at most 25 MB. Limits apply while bytes arrive, including responses without a size header.
- File names reject path traversal, encoded paths, Windows device names and active formats such as HTML and SVG.
- Catalogues are checked on download and when loaded from disk. Limits are 128 maps, 64 categories and 5,000 markers per map. Declared dimensions are limited to 8,192 pixels per side and 40 million pixels in total. Marker and source strings are displayed as plain text.
- PNG checks cover signatures, chunk boundaries, checksums and declared dimensions. AVIF checks cover signatures, container bounds and spatial dimensions. Animated AVIF, video containers and other image formats are rejected. The privileged Node main process doesn’t decode images.
- Images are saved by atomic replacement with a SHA-256 integrity record. Before serving an image, the app checks its size, hash and structure again. Older cached images without an integrity record need a new checked download. Invalid catalogues are ignored; unreadable private pin files are left untouched.
- Turning downloads off aborts pending requests and prevents their results from entering the cache, even if a fetch ignores cancellation.

Market responses use the same fixed download destinations and response checks. Redirects and non-JSON responses are rejected, and byte and record limits are enforced.

## How the app isolates content

Map images use `app://maps`, separate from the UI at `app://neverquest`. Only image resource requests can reach the map origin. Responses block MIME sniffing and document/script execution through a restrictive content security policy and sandbox directive.

Electron renderers use sandboxing, context isolation and no Node integration. The app blocks browser-initiated downloads, arbitrary navigation, popups, frames, webviews and permission requests. A small preload bridge exposes specific app operations.

Item details filter the full public market feed locally by item and server. The wiki button builds a bounded `https://monstersandmemories.wiki/items/<slug>` link and opens it in your browser when clicked. That API doesn’t accept arbitrary URLs or embed pages in the app.

## Remaining risks

These checks reduce risk, but can’t guarantee a downloaded image is safe. They check file structure rather than fully validating the compressed image or scanning for malware. AVIF container dimensions may differ from dimensions inside the compressed AV1 data. An unknown Electron or Chromium decoder or sandbox vulnerability could still affect the app. Keep Electron updated; see the [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

SHA-256 records help detect cache changes after download. They don’t prove the provider’s original file was trustworthy, and they aren’t signatures or independently reviewed hashes. Someone who can replace both an image and its integrity record can bypass that check. HTTPS also can’t protect against a compromised provider.

Leave map downloads off to avoid map network requests. If you also want to avoid decoding third-party images, leave cached maps closed too.

## Check the safeguards

`npm test` covers malicious URLs, redirects, content-type mismatches, disguised files, size limits, malformed images, changed caches, path traversal, offline use, cancellation and image-only protocol access. `npm run check` checks JavaScript syntax.

`npm run smoke` checks Electron workflows with isolated invented data, including image decoding, offline maps, item decisions, session editing and overlay layout. It needs the Electron runtime and a Windows desktop. Smoke and manual Windows checks remain pending for this early build. Record completed checks for each release using [RELEASE.md](RELEASE.md).
