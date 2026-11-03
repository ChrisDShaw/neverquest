# Third-party notices and data sources

Neverquest’s original code uses the [MIT licence](LICENSE). Dependencies, game content and downloaded data keep their own licences. The app bundles no game artwork or community map images. The README’s overlay screenshot shows a community map with its on-screen attribution.

## Electron runtime

The app uses [Electron](https://www.electronjs.org/), pinned in `package.json` and `package-lock.json`. Electron uses the MIT licence, included below. Its dependencies keep their own licences. The lockfile records their exact versions and available licence details; installed packages include the licence texts.

If you distribute a packaged app, include Electron’s `LICENSE`, `LICENSES.chromium.html` and any required dependency notices. Source releases leave out the installed runtime and `node_modules`.

```text
Copyright (c) Electron contributors
Copyright (c) 2013-2020 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Packaging and updates

[`electron-builder` 26.15.7 and `electron-updater` 6.8.9](https://github.com/electron-userland/electron-builder) use the MIT licence. The builder is development tooling; the updater and its production dependencies ship in the app. Their exact dependency versions are recorded in `package-lock.json`.

`scripts/notices.mjs` collects installed production dependency licence files into `resources/THIRD-PARTY-LICENSES.txt` for each packaged build. The one reviewed package that omits a licence file, `lazy-val` 1.0.5, has its manifest-declared MIT notice and attribution in [docs/licenses/lazy-val.md](docs/licenses/lazy-val.md). Electron’s `LICENSE.electron.txt` and `LICENSES.chromium.html` remain beside the executable. NSIS and its helper tools retain the notices supplied by the packaging toolchain.

The installer/update design was informed by [EverQuest Companion](https://github.com/jmoyers/everquest-companion). Neverquest’s implementation was written independently; no project code or assets were copied.

## External data and browser links

| Source | How Neverquest uses it |
| --- | --- |
| [MnMdb](https://mnm-db.com/) | Player listings, map lists, markers and optional map-image downloads. Map credits stay visible in the app. This content is downloaded separately. |
| [Monsters & Memories Wiki](https://monstersandmemories.wiki/) | Sources for the starter quest and crafting notes, with source links saved alongside them. Item buttons open the wiki in your browser. No walkthroughs or wiki artwork are included. |
| [MnM Atlas](https://www.mnmatlas.com/) | Optional links to zone maps in your browser. The site stays separate from the app. |

Before sharing downloaded images or data, check the original source’s terms and keep any required credits. Neverquest’s MIT licence doesn’t grant permission to redistribute that content. Private pins and player records stay on your PC; they aren’t uploaded to these services.

## CI tooling

The CI workflows use GitHub’s official [checkout](https://github.com/actions/checkout/blob/v6/LICENSE), [setup-node](https://github.com/actions/setup-node/blob/v6/LICENSE) and [upload-artifact](https://github.com/actions/upload-artifact/blob/v4/LICENSE) actions, pinned to full commit hashes. Their own licence notices apply. They run repository checks and prepare releases in CI and aren’t app dependencies.

Neverquest is an independent fan project and isn’t affiliated with or endorsed by Monsters & Memories or its developers. Game names and content belong to their respective owners.
